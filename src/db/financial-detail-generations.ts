import { createHash } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import { Database, type NativeDatabase } from "./node-sqlite";
import { normalizeFinancialDetailSnapshot, screenFinancialDetailSnapshots } from "../financial-detail-snapshots";
import type { FinancialDetailSnapshot, FinancialDetailScreeningOptions, FinancialDetailScreeningResult } from "../financial-detail-screening";
import type { FinancialDetailStoreProvenance } from "./financial-detail-store";

export interface FinancialDetailGenerationRecord {
    key: string;
    snapshot: FinancialDetailSnapshot;
    provenance: FinancialDetailStoreProvenance;
}
export interface FinancialDetailGenerationPlan { id: string; keys: readonly string[]; extractorVersion: string; mappingVersion: string; }
const kind = "edinet-ts-detail-generations-v1";
const identifier = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const canonical = (v: unknown): string => JSON.stringify(v, (_k, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
function prepare(input: FinancialDetailGenerationRecord): FinancialDetailGenerationRecord {
    if (!input) throw new Error("保存入力が必要です");
    const key = input.key, source = input.provenance;
    if (!identifier(key) || !source) throw new Error("保存キー/来歴が不正です");
    const snapshot = normalizeFinancialDetailSnapshot(input.snapshot), p = { extractorVersion: source.extractorVersion,
        mappingVersion: source.mappingVersion, sourceSha256: source.sourceSha256, sourceCommit: source.sourceCommit };
    if (!p || typeof p.extractorVersion !== "string" || !p.extractorVersion.trim() || p.extractorVersion.length > 256 ||
        typeof p.mappingVersion !== "string" || !p.mappingVersion.trim() || p.mappingVersion.length > 256 ||
        typeof p.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sourceSha256) ||
        p.sourceCommit !== undefined && (typeof p.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(p.sourceCommit))) throw new Error("原本hash/解析版が不正です");
    return { key, snapshot, provenance: { extractorVersion: p.extractorVersion, mappingVersion: p.mappingVersion,
        sourceSha256: p.sourceSha256, ...(p.sourceCommit === undefined ? {} : { sourceCommit: p.sourceCommit }) } };
}
/** 専用の新規DB用。計画した全キーを保存した世代だけを明示公開し、旧世代へ戻せます。 */
export class FinancialDetailGenerations {
    private db: NativeDatabase;
    constructor(path: string) {
        this.db = new Database(path);
        try {
            const objects = this.rows("SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
            if (!objects.length) this.db.exec(`BEGIN IMMEDIATE;
                CREATE TABLE generation_format(kind TEXT NOT NULL);
                INSERT INTO generation_format VALUES('${kind}');
                CREATE TABLE generations(id TEXT PRIMARY KEY,plan TEXT NOT NULL,extractor_version TEXT NOT NULL,mapping_version TEXT NOT NULL,complete INTEGER NOT NULL DEFAULT 0);
                CREATE TABLE generation_records(generation TEXT NOT NULL,key TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(generation,key));
                CREATE TABLE generation_active(singleton INTEGER PRIMARY KEY CHECK(singleton=1),generation TEXT NOT NULL);
                COMMIT;`);
            const names = this.rows("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
            if (names.length !== 4 || names.some(row => row.type !== "table" || !["generation_format", "generations", "generation_records", "generation_active"].includes(row.name as string)) ||
                this.rows("SELECT kind FROM generation_format").length !== 1 || this.rows("SELECT kind FROM generation_format")[0].kind !== kind) throw new Error("世代保存専用DBではありません");
        } catch (e) { this.db.close(); throw e; }
    }
    private rows(sql: string, values: SQLInputValue[] = []): Record<string, any>[] {
        const statement = this.db.prepare(sql); try { return statement.all(...values); } finally { statement.close(); }
    }
    private run(sql: string, values: SQLInputValue[] = []): void {
        const statement = this.db.prepare(sql); try { statement.run(...values); } finally { statement.close(); }
    }
    private transaction<T>(f: () => T): T {
        this.db.exec("BEGIN IMMEDIATE");
        try { const value = f(); this.db.exec("COMMIT"); return value; } catch (e) { this.db.exec("ROLLBACK"); throw e; }
    }
    private generation(id: string): { keys: string[]; complete: boolean; extractorVersion: string; mappingVersion: string } {
        if (!identifier(id)) throw new Error("世代IDが不正です");
        const row = this.rows("SELECT * FROM generations WHERE id=?", [id])[0];
        if (!row) throw new Error("未知の世代です");
        const keys: unknown = JSON.parse(row.plan);
        if (!Array.isArray(keys) || keys.some(k => !identifier(k)) || new Set(keys).size !== keys.length || ![0, 1].includes(row.complete)) throw new Error("世代計画が破損しています");
        return { keys, complete: row.complete === 1, extractorVersion: row.extractor_version, mappingVersion: row.mapping_version };
    }
    begin(plan: FinancialDetailGenerationPlan): void {
        if (!plan || !identifier(plan.id) || !identifier(plan.extractorVersion) || !identifier(plan.mappingVersion) || !Array.isArray(plan.keys) || plan.keys.some(k => !identifier(k)) || new Set(plan.keys).size !== plan.keys.length) throw new Error("世代計画が不正です");
        const keys = [...plan.keys].sort(), body = canonical(keys);
        this.transaction(() => {
            const old = this.rows("SELECT plan,extractor_version,mapping_version FROM generations WHERE id=?", [plan.id])[0];
            if (old && (old.plan !== body || old.extractor_version !== plan.extractorVersion || old.mapping_version !== plan.mappingVersion)) throw new Error("同じ世代の計画は変更できません");
            if (!old) this.run("INSERT INTO generations(id,plan,extractor_version,mapping_version) VALUES(?,?,?,?)", [plan.id, body, plan.extractorVersion, plan.mappingVersion]);
        });
    }
    put(id: string, inputs: readonly FinancialDetailGenerationRecord[]): void {
        if (!Array.isArray(inputs)) throw new Error("保存入力は配列です");
        const captured = inputs.map(prepare);
        this.transaction(() => {
            const plan = this.generation(id);
            if (plan.complete) throw new Error("完了世代は変更できません");
            for (const item of captured) {
                if (item.provenance.extractorVersion !== plan.extractorVersion || item.provenance.mappingVersion !== plan.mappingVersion) throw new Error("計画と解析/対応表の版が異なります");
                if (!plan.keys.includes(item.key)) throw new Error("計画外のキーです");
                const body = canonical(item), old = this.rows("SELECT body,sha256 FROM generation_records WHERE generation=? AND key=?", [id, item.key])[0];
                if (old) { if (old.sha256 !== hash(old.body) || old.body !== body) throw new Error("保存済みキーの内容が異なります"); }
                else this.run("INSERT INTO generation_records VALUES(?,?,?,?)", [id, item.key, body, hash(body)]);
            }
        });
    }
    read(id: string): FinancialDetailGenerationRecord[] {
        const plan = this.generation(id);
        return this.rows("SELECT * FROM generation_records WHERE generation=? ORDER BY key", [id]).map(row => {
            if (hash(row.body) !== row.sha256) throw new Error("保存内容のhashが一致しません");
            const input = prepare(JSON.parse(row.body));
            if (input.provenance.extractorVersion !== plan.extractorVersion || input.provenance.mappingVersion !== plan.mappingVersion || input.key !== row.key || !plan.keys.includes(input.key) || canonical(input) !== row.body) throw new Error("保存内容と計画が不整合です");
            return input;
        });
    }
    pending(id: string): string[] {
        const done = new Set(this.read(id).map(r => r.key));
        return this.generation(id).keys.filter(key => !done.has(key));
    }
    complete(id: string): void {
        this.transaction(() => {
            if (this.pending(id).length) throw new Error("未保存のキーがあります");
            this.run("UPDATE generations SET complete=1 WHERE id=?", [id]);
        });
    }
    activate(id: string): void {
        this.transaction(() => {
            if (!this.generation(id).complete || this.pending(id).length) throw new Error("完全な完了世代だけ公開できます");
            this.run("INSERT INTO generation_active VALUES(1,?) ON CONFLICT(singleton) DO UPDATE SET generation=excluded.generation", [id]);
        });
    }
    active(): string | undefined { return this.rows("SELECT generation FROM generation_active WHERE singleton=1")[0]?.generation; }
    screen(id: string, options: FinancialDetailScreeningOptions = {}): FinancialDetailScreeningResult {
        if (!this.generation(id).complete) throw new Error("未完了世代は検索できません");
        return screenFinancialDetailSnapshots(this.read(id).map(r => r.snapshot), options);
    }
    close(): void { this.db.close(); }
}
