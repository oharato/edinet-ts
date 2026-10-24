import { createHash } from "node:crypto";
import { types } from "node:util";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { Database, type NativeDatabase } from "./node-sqlite";
import { normalizeFinancialDetailSnapshot, screenFinancialDetailSnapshots } from "../financial-detail-snapshots";
import type { FinancialDetailSnapshot, FinancialDetailScreeningOptions, FinancialDetailScreeningResult, FinancialDetailDiagnostic } from "../financial-detail-screening";

export const FINANCIAL_DETAIL_STORE_METRICS = Object.freeze(["noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits"] as const);
type StoreMetric = typeof FINANCIAL_DETAIL_STORE_METRICS[number];
export interface FinancialDetailStoreProvenance { extractorVersion: string; mappingVersion: string; sourceSha256: string; sourceCommit?: string; }
export interface FinancialDetailStoreInput { snapshot: FinancialDetailSnapshot; provenance: FinancialDetailStoreProvenance; }
export interface StoredFinancialDetailSnapshot extends FinancialDetailStoreInput { id: string; }
export interface FinancialDetailStoreCohort {
    instant: string; scope: "Consolidated" | "NonConsolidated"; accountingStandard: "J-GAAP"; currency: "JPY";
    extractorVersion: string; mappingVersion: string; snapshotIds?: readonly string[];
}
export interface FinancialDetailStoreOptions { readOnly?: boolean; timeout?: number; }
type SqlRow = Record<string, SQLOutputValue>;
type Projection = Record<StoreMetric, { available: boolean; numeric: number | null; raw: string | null;
    status: string; reason: string; failureKind: FinancialDetailDiagnostic["reason"] | null; unit: string | null; source: unknown }>;
const kind = "edinet-ts-financial-detail-instant", schemaVersion = 1, probeLimit = 256 * 1024 * 1024;
const columns = ["id", "record_json", "projection_json", "sec_code", "doc_id", "instant", "scope", "accounting_standard", "currency", "extractor_version", "mapping_version", "source_sha256"];
/** schema1は本クラスが生成する固定DDLだけ。任意のDDL等価性/外部拡張は扱いません。 */
const schema = {
    detail_store_meta: { type: "table", sql: "CREATE TABLE detail_store_meta(kind TEXT NOT NULL,schema_version INTEGER NOT NULL)" },
    detail_snapshots: { type: "table", sql: `CREATE TABLE detail_snapshots(id TEXT PRIMARY KEY NOT NULL,record_json TEXT NOT NULL,projection_json TEXT NOT NULL,
        sec_code TEXT NOT NULL,doc_id TEXT NOT NULL,instant TEXT NOT NULL,scope TEXT NOT NULL,accounting_standard TEXT NOT NULL,currency TEXT NOT NULL,
        extractor_version TEXT NOT NULL,mapping_version TEXT NOT NULL,source_sha256 TEXT NOT NULL,content_sha256 TEXT NOT NULL)` },
    detail_cohort: { type: "index", sql: "CREATE INDEX detail_cohort ON detail_snapshots(instant,scope,accounting_standard,currency,extractor_version,mapping_version,sec_code,doc_id)" },
    detail_metric_values: { type: "view", sql: `CREATE VIEW detail_metric_values AS SELECT s.id,s.sec_code,s.doc_id,s.instant,s.scope,s.accounting_standard,s.currency,
        s.extractor_version,s.mapping_version,s.source_sha256,m.key metric_id,
        json_extract(m.value,'$.available') available,json_extract(m.value,'$.numeric') numeric_value,
        json_extract(m.value,'$.raw') raw_text,json_extract(m.value,'$.status') status,json_extract(m.value,'$.reason') reason,
        json_extract(m.value,'$.unit') unit,json_extract(m.value,'$.source') source_json FROM detail_snapshots s,json_each(s.projection_json) m` }
} as const;
/** 自前DDLの改行/句読点周辺だけを揃え、文字列literal内は一切変更しません。 */
function normalizedSql(sql: string): string {
    return sql.trim().replace(/;\s*$/, "").split(/('(?:''|[^'])*')/).map((part, i) => i % 2 ? part : part.replace(/\s+/g, " ").replace(/\s*([(),])\s*/g, "$1")).join("");
}

const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().filter(key => item[key] !== undefined).map(key => [key, item[key]])) : item);
const hash = (value: string): string => createHash("sha256").update(value).digest("hex");
const digest = (values: readonly unknown[]): string => hash(canonical(values));
const version = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 256;
const metric = (value: unknown): value is StoreMetric => typeof value === "string" && (FINANCIAL_DETAIL_STORE_METRICS as readonly string[]).includes(value);
const idPattern = /^[a-f0-9]{64}$/;
const placeholders = (size: number) => Array(size).fill("?").join(",");
const field = (id: StoreMetric, property: "available" | "numeric") => `json_extract(s.projection_json,'$.${id}.${property}')`;
/** flatな設定だけを一度読む。getter等を評価して検証後に別値へ変えません。 */
function flat(value: unknown, allowed: readonly string[]): Record<string, any> {
    if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("plain objectが必要です");
    const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
    if (keys.some(key => typeof key !== "string" || !allowed.includes(key) || !("value" in descriptors[key]) || !descriptors[key].enumerable)) throw new Error("未知項目/getter/非JSON属性は使えません");
    return Object.fromEntries(keys.map(key => [key, descriptors[key as string].value]));
}
function array(value: unknown): any[] {
    if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) throw new Error("通常の配列が必要です");
    const descriptors = Object.getOwnPropertyDescriptors(value) as Record<string, PropertyDescriptor>, keys = Reflect.ownKeys(descriptors), length = descriptors.length.value as number;
    if (keys.length !== length + 1 || keys.some(key => typeof key !== "string" || key !== "length" &&
        (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length || !("value" in descriptors[key]) || !descriptors[key].enumerable))) throw new Error("疎配列/getter/追加属性は使えません");
    return Array.from({ length }, (_, index) => descriptors[index].value);
}
function provenance(value: unknown): FinancialDetailStoreProvenance {
    const p = flat(value, ["extractorVersion", "mappingVersion", "sourceSha256", "sourceCommit"]);
    if (!version(p.extractorVersion) || !version(p.mappingVersion) || typeof p.sourceSha256 !== "string" || !idPattern.test(p.sourceSha256) ||
        p.sourceCommit !== undefined && (typeof p.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(p.sourceCommit))) throw new Error("不正な抽出/対応表の版または原本hashです");
    return { extractorVersion: p.extractorVersion, mappingVersion: p.mappingVersion, sourceSha256: p.sourceSha256,
        ...(p.sourceCommit === undefined ? {} : { sourceCommit: p.sourceCommit }) };
}
function prepare(value: unknown): { id: string; input: FinancialDetailStoreInput; values: string[]; content: string } {
    const input = flat(value, ["snapshot", "provenance"]), snapshot = normalizeFinancialDetailSnapshot(input.snapshot), p = provenance(input.provenance);
    const m = snapshot.metadata;
    if (m.period.instant === undefined || m.accountingStandard !== "J-GAAP" || m.currency !== "JPY" ||
        Object.keys(snapshot.selections).length !== 3 || FINANCIAL_DETAIL_STORE_METRICS.some(id => !Object.hasOwn(snapshot.selections, id))) throw new Error("専用試験DBはJ-GAAP/JPYの時点3項目だけを保存します");
    const projection = {} as Projection;
    for (const id of FINANCIAL_DETAIL_STORE_METRICS) {
        const selection = snapshot.selections[id]!;
        const failureKind = selection.status !== "selected" ? selection.status : selection.safeNumber === undefined ? "unsafe-number" : null;
        projection[id] = { available: failureKind === null, numeric: selection.safeNumber ?? null, raw: selection.raw ?? null,
            status: selection.status, reason: selection.reason, failureKind, unit: selection.source?.unit ?? null, source: selection.source ?? null };
    }
    const normalized = { snapshot, provenance: p }, id = hash(canonical([m, p]));
    const values = [id, canonical(normalized), canonical(projection), m.secCode, m.docID, m.period.instant, m.scope, m.accountingStandard, m.currency, p.extractorVersion, p.mappingVersion, p.sourceSha256];
    return { id, input: normalized, values, content: digest(values) };
}
function all(db: NativeDatabase, sql: string, params: SQLInputValue[] = []): SqlRow[] {
    const statement = db.prepare(sql); try { return statement.all(...params) as SqlRow[]; } finally { statement.close(); }
}
function assertFormat(db: NativeDatabase): void {
    const objects = all(db, "SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
    const expectedNames = Object.keys(schema) as (keyof typeof schema)[];
    if (objects.length !== expectedNames.length || objects.some(item => typeof item.name !== "string" || !Object.hasOwn(schema, item.name)) ||
        expectedNames.some(name => {
            const actual = objects.find(item => item.name === name), expected = schema[name];
            return !actual || actual.type !== expected.type || typeof actual.sql !== "string" || normalizedSql(actual.sql) !== normalizedSql(expected.sql);
        })) throw new Error("固定schema1のtable/view/index以外（trigger/追加index等）は非対応です。別用途/変更済み形式は使いません");
    const tableColumns = (table: "detail_store_meta" | "detail_snapshots") => all(db, `PRAGMA table_info(${table})`).map(row =>
        ({ name: row.name, type: row.type, notnull: row.notnull, defaultValue: row.dflt_value, pk: row.pk }));
    const metaColumns = ["kind", "schema_version"].map((name, index) => ({ name, type: index ? "INTEGER" : "TEXT", notnull: 1, defaultValue: null, pk: 0 }));
    const snapshotColumns = [...columns, "content_sha256"].map((name, index) => ({ name, type: "TEXT", notnull: 1, defaultValue: null, pk: index ? 0 : 1 }));
    if (canonical(tableColumns("detail_store_meta")) !== canonical(metaColumns) || canonical(tableColumns("detail_snapshots")) !== canonical(snapshotColumns)) throw new Error("財務明細DBの列/型/PK/NOT NULLが不正です");
    const viewColumns = ["id", "sec_code", "doc_id", "instant", "scope", "accounting_standard", "currency", "extractor_version", "mapping_version", "source_sha256", "metric_id", "available", "numeric_value", "raw_text", "status", "reason", "unit", "source_json"];
    if (canonical(all(db, "PRAGMA table_info(detail_metric_values)").map(row => row.name)) !== canonical(viewColumns)) throw new Error("財務明細viewの列が不正です");
    const indexes = all(db, "PRAGMA index_list(detail_snapshots)"), cohortIndex = indexes.find(row => row.name === "detail_cohort"), pk = indexes.filter(row => row.origin === "pk");
    const cohortColumns = ["instant", "scope", "accounting_standard", "currency", "extractor_version", "mapping_version", "sec_code", "doc_id"];
    if (indexes.length !== 2 || !cohortIndex || cohortIndex.origin !== "c" || cohortIndex.unique !== 0 || cohortIndex.partial !== 0 || pk.length !== 1 || pk[0].unique !== 1 || pk[0].partial !== 0 ||
        canonical(all(db, "PRAGMA index_info(detail_cohort)").map(row => row.name)) !== canonical(cohortColumns)) throw new Error("財務明細DBの索引が不正です");
    // 自動PK索引の名前はSQLiteから取得し、識別子として渡さずpragma関数の値へbindします。
    if (canonical(all(db, "SELECT name FROM pragma_index_info(?) ORDER BY seqno", [pk[0].name as string]).map(row => row.name)) !== canonical(["id"])) throw new Error("保存IDのPK索引が不正です");
    const meta = all(db, "SELECT kind,schema_version FROM detail_store_meta");
    if (meta.length !== 1 || meta[0].kind !== kind || meta[0].schema_version !== schemaVersion) throw new Error("未対応の財務明細DB形式です");
}

function lstat(file: string): fs.Stats | undefined {
    try { return fs.lstatSync(file); } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; }
}
const fileIdentity = (stat: fs.BigIntStats) => `${stat.dev}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
function inspectPath(file: string): fs.Stats | undefined {
    const stat = lstat(file);
    if (stat && (!stat.isFile() || stat.isSymbolicLink())) throw new Error("DBにはsymlinkでない通常ファイルを指定してください");
    for (const suffix of ["-journal", "-wal", "-shm"]) if (lstat(file + suffix)) throw new Error("DB副ファイルが存在します。停止済み試験DBを指定してください");
    return stat;
}
/** readonly SQLiteでもcold WAL副ファイルを作り得るため、形式確認は私有コピーだけで行います。 */
function makeProbe(file: string): { dir: string; file: string; identity: string } {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    let bytes: Buffer, identity: string;
    try {
        const before = fs.fstatSync(fd, { bigint: true });
        if (!before.isFile() || before.size > BigInt(probeLimit)) throw new Error("既存DBの確認は通常ファイル/256MiB以下だけです");
        bytes = Buffer.alloc(Number(before.size) + 1); let length = 0;
        while (length < bytes.length) { const n = fs.readSync(fd, bytes, length, bytes.length - length, null); if (!n) break; length += n; }
        if (length !== Number(before.size) || fileIdentity(fs.fstatSync(fd, { bigint: true })) !== fileIdentity(before)) throw new Error("読取中にDBが変化しました");
        bytes = bytes.subarray(0, length); identity = fileIdentity(before);
    } finally { fs.closeSync(fd); }
    const dir = fs.mkdtempSync(join(tmpdir(), "edinet-detail-probe-")), target = join(dir, "probe.sqlite");
    try { fs.writeFileSync(target, bytes, { flag: "wx", mode: 0o600 }); return { dir, file: target, identity }; }
    catch (error) { fs.rmSync(dir, { recursive: true, force: true }); throw error; }
}

/** 固定3項目の専用試験Store。BS3 DBへの自動移行や異なる型の混在は行いません。 */
export class FinancialDetailSqliteStore {
    private db!: NativeDatabase;
    private closed = false;
    private readonly readOnly: boolean;
    private scratch?: string;
    constructor(file: string, options: FinancialDetailStoreOptions = {}) {
        if (typeof file !== "string" || !file.trim()) throw new Error("新しい試験DBパスが必要です");
        const settings = flat(options, ["readOnly", "timeout"]);
        if (settings.readOnly !== undefined && typeof settings.readOnly !== "boolean" || settings.timeout !== undefined && (!Number.isSafeInteger(settings.timeout) || settings.timeout < 0 || settings.timeout > 2147483647)) throw new Error("不正なDB設定です");
        this.readOnly = settings.readOnly ?? false; const timeout = settings.timeout ?? 5000;
        try {
            if (file === ":memory:") {
                if (this.readOnly) throw new Error("未作成memory DBをreadOnlyにはできません");
                this.db = new Database(file, { timeout }); this.initialize();
            } else {
                const target = resolve(file), exists = inspectPath(target);
                if (!exists) {
                    if (this.readOnly) throw new Error("DBがありません。readOnlyでは作成しません");
                    const fd = fs.openSync(target, "wx", 0o600); fs.closeSync(fd);
                    this.db = new Database(target, { timeout }); this.initialize();
                } else {
                    const probe = makeProbe(target); let reader: NativeDatabase | undefined;
                    try {
                        reader = new Database(probe.file, { readOnly: true, timeout }); assertFormat(reader);
                        if (this.readOnly) { this.db = reader; reader = undefined; this.scratch = probe.dir; }
                        else {
                            inspectPath(target);
                            if (fileIdentity(fs.statSync(target, { bigint: true })) !== probe.identity) throw new Error("形式確認中にDBが変化しました");
                            reader.close(); reader = undefined;
                            this.db = new Database(target, { timeout }); assertFormat(this.db);
                        }
                    } finally { reader?.close(); if (this.scratch !== probe.dir) fs.rmSync(probe.dir, { recursive: true, force: true }); }
                }
            }
        } catch (error) { try { this.db?.close(); } finally { this.closed = true; if (this.scratch) fs.rmSync(this.scratch, { recursive: true, force: true }); } throw error; }
    }
    private initialize(): void {
        this.db.exec(`BEGIN IMMEDIATE;
            ${schema.detail_store_meta.sql};
            INSERT INTO detail_store_meta VALUES('${kind}',${schemaVersion});
            ${schema.detail_snapshots.sql};
            ${schema.detail_cohort.sql};
            ${schema.detail_metric_values.sql};
            COMMIT;`);
        assertFormat(this.db);
    }
    private assertOpen(): void { if (this.closed) throw new Error("財務明細DBはclose済みです"); }
    private query(sql: string, params: SQLInputValue[] = []): SqlRow[] { this.assertOpen(); return all(this.db, sql, params); }
    private decode(row: SqlRow): StoredFinancialDetailSnapshot {
        if (digest(columns.map(column => row[column])) !== row.content_sha256) throw new Error("保存内容のhashが一致しません");
        const prepared = prepare(JSON.parse(row.record_json as string));
        if (prepared.values.some((value, i) => value !== row[columns[i]]) || prepared.content !== row.content_sha256) throw new Error("保存record/cache/metadataが不整合です");
        return { id: prepared.id, ...prepared.input };
    }
    /** 絞り込み外へ移した破損も隠さない小規模設計。全保存行を検証します。 */
    private verifyAll(): void { assertFormat(this.db); for (const row of this.query("SELECT * FROM detail_snapshots ORDER BY id")) this.decode(row); }
    putMany(inputs: readonly FinancialDetailStoreInput[]): { inserted: number; unchanged: number; ids: string[] } {
        this.assertOpen(); if (this.readOnly) throw new Error("readOnlyの財務明細DBです");
        const prepared = array(inputs).map(prepare); let inserted = 0, unchanged = 0, transaction = false;
        const statement = this.db.prepare(`INSERT INTO detail_snapshots(${columns.join(",")},content_sha256) VALUES(${placeholders(columns.length + 1)})`);
        try {
            this.db.exec("BEGIN IMMEDIATE"); transaction = true; this.verifyAll();
            for (const item of prepared) {
                const m = item.input.snapshot.metadata, p = item.input.provenance;
                if (this.query("SELECT id FROM detail_snapshots WHERE doc_id=? AND (sec_code<>? OR source_sha256<>?) LIMIT 1", [m.docID, m.secCode, p.sourceSha256]).length) throw new Error("同一書類の会社/原本hashが矛盾しています。上書きしません");
                const existing = this.query("SELECT * FROM detail_snapshots WHERE id=?", [item.id]);
                if (existing.length) { this.decode(existing[0]); if (existing[0].content_sha256 !== item.content) throw new Error("同じ原本/版の内容が異なります"); unchanged++; }
                else { statement.run(...item.values, item.content); inserted++; }
            }
            // 書込み後もrecord/cache/固定形式を検査し、破損が起きたbatchをCOMMITしません。
            this.verifyAll();
            this.db.exec("COMMIT"); transaction = false;
        } catch (error) { if (transaction) this.db.exec("ROLLBACK"); throw error; } finally { statement.close(); }
        return { inserted, unchanged, ids: prepared.map(item => item.id) };
    }
    get(id: string): StoredFinancialDetailSnapshot | undefined {
        this.assertOpen(); if (typeof id !== "string" || !idPattern.test(id)) throw new Error("不正な保存IDです");
        assertFormat(this.db);
        const rows = this.query("SELECT * FROM detail_snapshots WHERE id=?", [id]); return rows.length ? this.decode(rows[0]) : undefined;
    }
    screen(cohort: FinancialDetailStoreCohort, options: FinancialDetailScreeningOptions = {}): FinancialDetailScreeningResult {
        this.assertOpen();
        const c = flat(cohort, ["instant", "scope", "accountingStandard", "currency", "extractorVersion", "mappingVersion", "snapshotIds"]);
        if (typeof c.instant !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(c.instant) || !Number.isFinite(Date.parse(c.instant)) || new Date(c.instant).toISOString().slice(0, 10) !== c.instant ||
            !["Consolidated", "NonConsolidated"].includes(c.scope) || c.accountingStandard !== "J-GAAP" || c.currency !== "JPY" || !version(c.extractorVersion) || !version(c.mappingVersion)) throw new Error("同じ時点/scope/J-GAAP/JPY/抽出と対応表の版が必要です");
        const settings = flat(options, ["metricIds", "conditions", "sortBy", "order", "offset", "limit"]);
        if (settings.metricIds !== undefined) settings.metricIds = array(settings.metricIds);
        if (settings.conditions !== undefined) settings.conditions = array(settings.conditions).map(value => flat(value, ["metric", "operator", "value"]));
        screenFinancialDetailSnapshots([], settings);
        const selectedIds = (settings.metricIds ?? [...FINANCIAL_DETAIL_STORE_METRICS]) as StoreMetric[];
        if (selectedIds.some(id => !metric(id)) || settings.sortBy !== undefined && !metric(settings.sortBy) || (settings.conditions ?? []).some((condition: any) => !metric(condition.metric))) throw new Error("専用試験DBの検索は固定3項目だけです");
        const parameters: SQLInputValue[] = [c.instant, c.scope, c.accountingStandard, c.currency, c.extractorVersion, c.mappingVersion];
        let where = "s.instant=? AND s.scope=? AND s.accounting_standard=? AND s.currency=? AND s.extractor_version=? AND s.mapping_version=?";
        const requested = c.snapshotIds === undefined ? undefined : array(c.snapshotIds);
        if (requested && (requested.some(id => typeof id !== "string" || !idPattern.test(id)) || new Set(requested).size !== requested.length)) throw new Error("不正/重複した保存IDです");
        this.db.exec("BEGIN");
        try {
            this.verifyAll();
            if (requested) {
                const selection = requested.length ? `s.id IN(${placeholders(requested.length)})` : "0";
                if (this.count(`${where} AND ${selection}`, [...parameters, ...requested]) !== requested.length) throw new Error("不明IDまたは異なる比較範囲/版のIDです");
                where += ` AND ${selection}`; parameters.push(...requested);
            }
            for (const key of ["sec_code", "doc_id"]) if (this.query(`SELECT s.${key} FROM detail_snapshots s WHERE ${where} GROUP BY s.${key} HAVING COUNT(*)>1 LIMIT 1`, parameters).length) throw new Error("同一会社/書類の複数版はsnapshotIdsで明示してください");
            const required = new Set<StoreMetric>([...(settings.conditions ?? []).map((condition: any) => condition.metric), ...(settings.sortBy ? [settings.sortBy] : [])]);
            if (!required.size) selectedIds.forEach(id => required.add(id));
            const eligible = [...required].map(id => `${field(id, "available")}=1`).join(" AND "), compared = [...parameters];
            const operators = { gte: ">=", lte: "<=", gt: ">", lt: "<", eq: "=" };
            const filters = (settings.conditions ?? []).map((condition: any) => { compared.push(condition.value); return `${field(condition.metric, "numeric")} ${operators[condition.operator as keyof typeof operators]} ?`; });
            const matching = `${where} AND (${eligible})${filters.length ? " AND " + filters.join(" AND ") : ""}`;
            const total = this.count(matching, compared), excludedRows = this.count(`${where} AND NOT(${eligible})`, parameters), size = this.count(where, parameters);
            const diagnostics = this.query(`SELECT s.sec_code secCode,s.doc_id docID,m.key metric,json_extract(m.value,'$.failureKind') reason,json_extract(m.value,'$.reason') selectionReason
                FROM detail_snapshots s,json_each(s.projection_json) m WHERE ${where} AND m.key IN(${placeholders(selectedIds.length)}) AND json_extract(m.value,'$.failureKind') IS NOT NULL`, [...parameters, ...selectedIds])
                .map(row => ({ ...row, required: required.has(row.metric as StoreMetric) })) as unknown as FinancialDetailDiagnostic[];
            diagnostics.sort((a, b) => a.secCode < b.secCode ? -1 : a.secCode > b.secCode ? 1 : FINANCIAL_DETAIL_STORE_METRICS.indexOf(a.metric as StoreMetric) - FINANCIAL_DETAIL_STORE_METRICS.indexOf(b.metric as StoreMetric));
            const reasonCounts: FinancialDetailScreeningResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
            diagnostics.forEach(diagnostic => reasonCounts[diagnostic.reason]++);
            const order = settings.sortBy ? `${field(settings.sortBy, "numeric")} ${settings.order === "asc" ? "ASC" : "DESC"},` : "";
            const page = this.query(`SELECT s.id FROM detail_snapshots s WHERE ${matching} ORDER BY ${order}s.sec_code,s.doc_id LIMIT ? OFFSET ?`, [...compared, settings.limit ?? -1, settings.offset ?? 0]);
            const snapshots = page.map(row => this.get(row.id as string)!.snapshot);
            const checked = snapshots.length ? screenFinancialDetailSnapshots(snapshots, { ...settings, offset: 0, limit: undefined }).rows : [];
            if (checked.length !== snapshots.length || checked.some((row, index) => row.metadata.secCode !== snapshots[index].metadata.secCode)) throw new Error("保存SQLとJSON検索の判定が一致しません");
            this.db.exec("COMMIT");
            return { rows: checked, total, excludedRows, filteredRows: size - total - excludedRows, diagnostics, reasonCounts };
        } catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
    private count(where: string, params: SQLInputValue[]): number {
        const value = this.query(`SELECT COUNT(*) n FROM detail_snapshots s WHERE ${where}`, params)[0]?.n;
        if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw new Error("件数が安全整数の範囲外です"); return value;
    }
    close(): void {
        if (this.closed) return;
        try { this.db.close(); } finally { this.closed = true; if (this.scratch) fs.rmSync(this.scratch, { recursive: true, force: true }); }
    }
}
