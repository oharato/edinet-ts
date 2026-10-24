import { createHash } from "node:crypto";
import type { SQLInputValue, SQLOutputValue } from "node:sqlite";
import { Database, type NativeDatabase } from "./node-sqlite";
import { BALANCE_SHEET_REGISTRY } from "../balance-sheet-registry";
import { BalanceSheetScreeningMetric, calculateCurrentRatio, screenBalanceSheetSnapshots,
    type BalanceSheetSnapshot, type BalanceSheetScreeningOptions, type BalanceSheetScreeningResult,
    type BalanceSheetDiagnostic } from "../balance-sheet-screening";
import { decimalFraction, compareFractions } from "../decimal-fraction";
import { toSafeMetricNumber } from "../metric-selection";

export interface BalanceSheetProvenance {
    extractorVersion: string;
    mappingVersion: string;
    sourceSha256: string;
    sourceCommit?: string;
}
export interface BalanceSheetStoreInput { snapshot: BalanceSheetSnapshot; provenance: BalanceSheetProvenance; }
export interface StoredBalanceSheetSnapshot extends BalanceSheetStoreInput { id: string; }
export interface BalanceSheetStoreCohort {
    instant: string;
    scope: BalanceSheetSnapshot["scope"];
    accountingStandard: "J-GAAP";
    currency: "JPY";
    extractorVersion: string;
    mappingVersion: string;
    /** 訂正版等を自動選択せず、対象を明示するためのID集合。不明・混在はエラー。 */
    snapshotIds?: readonly string[];
}
export interface BalanceSheetStoreOptions { readOnly?: boolean; timeout?: number; }
type Failure = BalanceSheetDiagnostic["reason"];
type Projection = Record<BalanceSheetScreeningMetric, {
    available: boolean; value: number | null; raw: string | null;
    status: string; reason: string; failureKind: Failure | null;
    numerator: string | null; denominator: string | null;
}>;
type SqlRow = Record<string, SQLOutputValue>;
const rawIds = Object.keys(BALANCE_SHEET_REGISTRY) as (keyof typeof BALANCE_SHEET_REGISTRY)[];
const allIds = Object.values(BalanceSheetScreeningMetric);
const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
const version = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= 256;
const digest = (...parts: unknown[]): string => hash(JSON.stringify(parts));
const columns = ["id", "record_json", "projection_json", "sec_code", "doc_id", "instant", "scope", "accounting_standard", "currency", "extractor_version", "mapping_version", "source_sha256"];
const placeholders = (n: number): string => Array(n).fill("?").join(",");
const field = (metric: BalanceSheetScreeningMetric, key: string): string => `json_extract(s.projection_json, '$.${metric}.${key}')`;

/** optionalなundefinedだけ省略。原値・来歴にJSONで保持できない値を混ぜて黙って捨てません。 */
function stableJson(value: unknown): string {
    const active = new Set<object>();
    const clean = (v: unknown): unknown => {
        if (v === null || typeof v === "string" || typeof v === "boolean") return v;
        if (typeof v === "number" && Number.isFinite(v)) return v;
        if (!v || typeof v !== "object" || active.has(v)) throw new Error("循環参照またはJSONに保存できない値です");
        if (!Array.isArray(v) && ![Object.prototype, null].includes(Object.getPrototypeOf(v))) throw new Error("JSONオブジェクトが必要です");
        if (Object.getOwnPropertySymbols(v).length || Object.getOwnPropertyNames(v).length !== Object.keys(v).length + (Array.isArray(v) ? 1 : 0) ||
            Array.isArray(v) && Object.keys(v).some(k => !/^(0|[1-9]\d*)$/.test(k) || Number(k) >= v.length)) throw new Error("JSONへ保持できない追加属性です");
        active.add(v);
        const result = Array.isArray(v) ? Array.from(v, clean) : Object.fromEntries(Object.keys(v).sort()
            .filter(k => (v as Record<string, unknown>)[k] !== undefined).map(k => [k, clean((v as Record<string, unknown>)[k])]));
        active.delete(v); return result;
    };
    return JSON.stringify(clean(value));
}

function prepareRecord(input: BalanceSheetStoreInput): { id: string; values: string[]; content: string } {
    if (!input || typeof input !== "object" || Array.isArray(input) || !input.provenance || typeof input.provenance !== "object" ||
        Array.isArray(input.provenance) || ![Object.prototype, null].includes(Object.getPrototypeOf(input.provenance)) || !input.snapshot) throw new Error("snapshotとprovenanceが必要です");
    const p = input.provenance;
    if (!version(p.extractorVersion) || !version(p.mappingVersion) || typeof p.sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(p.sourceSha256) ||
        p.sourceCommit !== undefined && (typeof p.sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(p.sourceCommit)) ||
        Object.keys(p).some(k => !["extractorVersion", "mappingVersion", "sourceSha256", "sourceCommit"].includes(k))) throw new Error("不正な抽出バージョン/原本ハッシュです");
    const row = input.snapshot;
    const ratio = calculateCurrentRatio(row); // メタデータ・元数値・証跡の既存検査を必ず通します。
    if (Object.keys(row).some(k => !["secCode", "docID", "instant", "scope", "accountingStandard", "currency", "selections", "derivedMetrics"].includes(k))) throw new Error("未知のsnapshot項目です");
    const snapshot: BalanceSheetSnapshot = { secCode: row.secCode.length === 4 ? row.secCode + "0" : row.secCode,
        docID: row.docID, instant: row.instant, scope: row.scope, accountingStandard: row.accountingStandard,
        currency: row.currency, selections: row.selections };
    const diagnostics = screenBalanceSheetSnapshots([snapshot], { sortBy: "currentRatio" }).diagnostics;
    const projection = {} as Projection;
    for (const id of rawIds) {
        const selected = row.selections[id], issue = diagnostics.find(d => d.metric === id);
        projection[id] = { available: !issue, value: selected.safeNumber ?? null, raw: selected.raw ?? null,
            status: selected.status, reason: selected.reason, failureKind: issue?.reason ?? null, numerator: null, denominator: null };
    }
    projection.currentRatio = { available: ratio.status === "calculated", value: ratio.value ?? null, raw: null,
        status: ratio.status, reason: ratio.reason, failureKind: diagnostics.find(d => d.metric === "currentRatio")?.reason ?? null,
        numerator: ratio.exact?.numerator ?? null, denominator: ratio.exact?.denominator ?? null };
    const identity = [snapshot.secCode, snapshot.docID, snapshot.instant, snapshot.scope, snapshot.accountingStandard, snapshot.currency, p];
    const id = hash(stableJson(identity));
    const values = [id, stableJson({ snapshot, provenance: p }), stableJson(projection), snapshot.secCode, snapshot.docID,
        snapshot.instant, snapshot.scope, snapshot.accountingStandard, snapshot.currency, p.extractorVersion, p.mappingVersion, p.sourceSha256];
    return { id, values, content: digest(...values) };
}

/** 小規模財務DBの追加API。既存の書類メタデータDBやキャッシュへ接続・移行しません。 */
export class BalanceSheetSqliteStore {
    private db: NativeDatabase;
    private closed = false;
    private readonly readOnly: boolean;
    constructor(path: string, options: BalanceSheetStoreOptions = {}) {
        this.readOnly = options.readOnly ?? false;
        this.db = new Database(path, { readOnly: this.readOnly, timeout: options.timeout ?? 5000 });
        try {
            const tables = this.all("SELECT name FROM sqlite_master WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%'");
            if (!tables.length) {
                if (this.readOnly) throw new Error("財務DBが初期化されていません");
                this.db.exec(`BEGIN IMMEDIATE;
                    CREATE TABLE financial_store_meta (kind TEXT NOT NULL, schema_version INTEGER NOT NULL);
                    INSERT INTO financial_store_meta VALUES ('edinet-ts-balance-sheet', 1);
                    CREATE TABLE financial_snapshots (
                        id TEXT PRIMARY KEY, record_json TEXT NOT NULL, projection_json TEXT NOT NULL,
                        sec_code TEXT NOT NULL, doc_id TEXT NOT NULL, instant TEXT NOT NULL, scope TEXT NOT NULL,
                        accounting_standard TEXT NOT NULL, currency TEXT NOT NULL,
                        extractor_version TEXT NOT NULL, mapping_version TEXT NOT NULL, source_sha256 TEXT NOT NULL,
                        content_sha256 TEXT NOT NULL);
                    CREATE INDEX financial_cohort ON financial_snapshots
                        (instant, scope, accounting_standard, currency, extractor_version, mapping_version, sec_code, doc_id);
                    CREATE VIEW financial_metric_values AS SELECT s.id, s.sec_code, s.doc_id, s.instant, s.scope,
                        s.accounting_standard, s.currency, s.extractor_version, s.mapping_version, s.source_sha256,
                        m.key AS metric_id, json_extract(m.value,'$.available') AS available,
                        json_extract(m.value,'$.value') AS value_approx, json_extract(m.value,'$.raw') AS raw_text,
                        json_extract(m.value,'$.status') AS status, json_extract(m.value,'$.reason') AS reason,
                        json_extract(m.value,'$.numerator') AS numerator, json_extract(m.value,'$.denominator') AS denominator
                        FROM financial_snapshots s, json_each(s.projection_json) m;
                    COMMIT;`);
            } else {
                if (!tables.some(t => t.name === "financial_store_meta")) throw new Error("既存の別用途DBは変更しません");
                const meta = this.all("SELECT kind, schema_version FROM financial_store_meta");
                if (meta.length !== 1 || meta[0].kind !== "edinet-ts-balance-sheet" || meta[0].schema_version !== 1) throw new Error("未対応の財務DB形式です");
            }
            this.db.function("edinet_record_hash", { deterministic: true, varargs: true }, (...parts) => digest(...parts));
            this.db.function("edinet_fraction_compare", { deterministic: true }, (n, d, bn, bd) => {
                if ([n, d, bn, bd].some(x => typeof x !== "string" || !/^-?\d+$/.test(x))) throw new Error("不正な保存分数です");
                const denominator = BigInt(d as string), boundDenominator = BigInt(bd as string);
                if (denominator <= 0n || boundDenominator <= 0n) throw new Error("不正な保存分母です");
                return compareFractions({ numerator: BigInt(n as string), denominator }, { numerator: BigInt(bn as string), denominator: boundDenominator });
            });
        } catch (error) { this.db.close(); this.closed = true; throw error; }
    }
    private assertOpen(): void { if (this.closed) throw new Error("財務DBはclose済みです"); }
    private all(sql: string, params: SQLInputValue[] = []): SqlRow[] {
        this.assertOpen(); const statement = this.db.prepare(sql);
        try { return statement.all(...params) as SqlRow[]; } finally { statement.close(); }
    }
    private count(sql: string, params: SQLInputValue[]): number {
        const n = this.all(sql, params)[0]?.n;
        if (typeof n !== "number" || !Number.isSafeInteger(n) || n < 0) throw new Error("件数が安全な整数範囲外です");
        return n;
    }
    private checkIntegrity(where: string, params: SQLInputValue[]): void {
        if (this.all(`SELECT id FROM financial_snapshots s WHERE ${where} AND
            content_sha256 <> edinet_record_hash(${columns.map(c => `s.${c}`).join(",")}) LIMIT 1`, params).length) throw new Error("保存内容のハッシュが一致しません");
    }
    /** 同一版・同一原本・同一内容は追加しません。同じIDの異なる内容は更新せず、バッチを戻します。 */
    putMany(inputs: readonly BalanceSheetStoreInput[]): { inserted: number; unchanged: number; ids: string[] } {
        this.assertOpen(); if (this.readOnly) throw new Error("readOnlyの財務DBです");
        if (!Array.isArray(inputs)) throw new Error("入力は配列です");
        const records = inputs.map(prepareRecord); let inserted = 0, unchanged = 0;
        const insert = this.db.prepare(`INSERT INTO financial_snapshots (${columns.join(",")}, content_sha256) VALUES (${placeholders(columns.length + 1)})`);
        let transaction = false;
        try {
            this.db.exec("BEGIN IMMEDIATE"); transaction = true;
            for (const record of records) {
                const existing = this.all("SELECT content_sha256 FROM financial_snapshots WHERE id = ?", [record.id]);
                if (existing.length) {
                    this.checkIntegrity("s.id = ?", [record.id]);
                    if (existing[0].content_sha256 !== record.content) throw new Error("同じ原本・抽出版に異なる内容があります");
                    unchanged++; continue;
                }
                insert.run(...record.values, record.content); inserted++;
            }
            this.db.exec("COMMIT"); transaction = false;
        } catch (error) { if (transaction) this.db.exec("ROLLBACK"); throw error; } finally { insert.close(); }
        return { inserted, unchanged, ids: records.map(r => r.id) };
    }
    private decode(row: SqlRow): StoredBalanceSheetSnapshot {
        const input = JSON.parse(row.record_json as string) as BalanceSheetStoreInput;
        // JSONのnumber表現では区別しない-0は、元の数値文字列から復元できます。
        for (const selection of Object.values(input.snapshot.selections)) if (selection.status === "selected") selection.safeNumber = toSafeMetricNumber(selection.raw);
        const verified = prepareRecord(input);
        if (verified.id !== row.id || verified.content !== row.content_sha256) throw new Error("保存データと抽出結果が不整合です");
        return { id: verified.id, ...input };
    }
    get(id: string): StoredBalanceSheetSnapshot | undefined {
        this.assertOpen(); if (typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) throw new Error("不正なsnapshot IDです");
        this.checkIntegrity("s.id = ?", [id]); const rows = this.all("SELECT * FROM financial_snapshots WHERE id = ?", [id]);
        return rows.length ? this.decode(rows[0]) : undefined;
    }
    search(cohort: BalanceSheetStoreCohort, options: BalanceSheetScreeningOptions = {}): BalanceSheetScreeningResult {
        this.assertOpen(); this.db.exec("BEGIN");
        try { const result = this.searchInTransaction(cohort, options); this.db.exec("COMMIT"); return result; }
        catch (error) { this.db.exec("ROLLBACK"); throw error; }
    }
    private searchInTransaction(cohort: BalanceSheetStoreCohort, options: BalanceSheetScreeningOptions): BalanceSheetScreeningResult {
        this.assertOpen(); screenBalanceSheetSnapshots([], options); // 入力条件の既存契約を再利用。
        if (!cohort || !/^\d{4}-\d{2}-\d{2}$/.test(cohort.instant) || !Number.isFinite(Date.parse(cohort.instant)) ||
            new Date(cohort.instant).toISOString().slice(0, 10) !== cohort.instant || !["Consolidated", "NonConsolidated"].includes(cohort.scope) ||
            cohort.accountingStandard !== "J-GAAP" || cohort.currency !== "JPY" || !version(cohort.extractorVersion) || !version(cohort.mappingVersion) ||
            Object.keys(cohort).some(k => !["instant", "scope", "accountingStandard", "currency", "extractorVersion", "mappingVersion", "snapshotIds"].includes(k))) throw new Error("比較する同一時点・範囲・基準・通貨・抽出版が必要です");
        const parameters: SQLInputValue[] = [cohort.instant, cohort.scope, cohort.accountingStandard, cohort.currency, cohort.extractorVersion, cohort.mappingVersion];
        let where = "s.instant=? AND s.scope=? AND s.accounting_standard=? AND s.currency=? AND s.extractor_version=? AND s.mapping_version=?";
        if (cohort.snapshotIds !== undefined) {
            const ids = cohort.snapshotIds;
            if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !/^[a-f0-9]{64}$/.test(id)) || new Set(ids).size !== ids.length) throw new Error("不正/重複snapshot IDです");
            const selection = ids.length ? `s.id IN (${placeholders(ids.length)})` : "0";
            const found = this.count(`SELECT COUNT(*) n FROM financial_snapshots s WHERE ${where} AND ${selection}`, [...parameters, ...ids]);
            if (found !== ids.length) throw new Error("不明なIDまたは対象時点・範囲・抽出版の混在です");
            where += ` AND ${selection}`; parameters.push(...ids);
        }
        // 条件不一致の行も先に検査。壊れた値を絞り込みで隠しません。
        this.checkIntegrity(where, parameters);
        for (const key of ["sec_code", "doc_id"]) if (this.all(`SELECT s.${key} FROM financial_snapshots s WHERE ${where} GROUP BY s.${key} HAVING COUNT(*) > 1 LIMIT 1`, parameters).length) throw new Error("同一企業/書類の複数版はsnapshotIdsで一意に指定してください");
        const required = new Set<BalanceSheetScreeningMetric>([...(options.conditions ?? []).map(c => c.metric), ...(options.sortBy ? [options.sortBy] : [])]);
        if (!required.size) rawIds.forEach(id => required.add(id));
        const needsRatio = required.has("currentRatio");
        if (needsRatio) { required.add("currentAssets"); required.add("currentLiabilities"); }
        const eligible = [...required].map(id => `${field(id, "available")}=1`).join(" AND ");
        const compared: SQLInputValue[] = [...parameters];
        const operators = { gte: ">=", lte: "<=", gt: ">", lt: "<", eq: "=" };
        const filters = (options.conditions ?? []).map(c => {
            if (c.metric === "currentRatio") {
                const bound = decimalFraction(c.value); compared.push(String(bound.numerator), String(bound.denominator));
                return `CASE WHEN ${field(c.metric, "available")}=1 THEN edinet_fraction_compare(${field(c.metric, "numerator")},${field(c.metric, "denominator")},?,?) ${operators[c.operator]} 0 ELSE 0 END`;
            }
            compared.push(c.value); return `${field(c.metric, "value")} ${operators[c.operator]} ?`;
        });
        const matching = `${where} AND (${eligible})${filters.length ? ` AND ${filters.join(" AND ")}` : ""}`;
        const total = this.count(`SELECT COUNT(*) n FROM financial_snapshots s WHERE ${matching}`, compared);
        const excludedRows = this.count(`SELECT COUNT(*) n FROM financial_snapshots s WHERE ${where} AND NOT (${eligible})`, parameters);
        const cohortSize = this.count(`SELECT COUNT(*) n FROM financial_snapshots s WHERE ${where}`, parameters);
        const selectedMetrics = [...rawIds, ...(needsRatio ? ["currentRatio" as const] : [])];
        const diagnostics = this.all(`SELECT s.sec_code secCode, s.doc_id docID, m.key metric,
            json_extract(m.value,'$.failureKind') reason, json_extract(m.value,'$.reason') selectionReason
            FROM financial_snapshots s, json_each(s.projection_json) m WHERE ${where}
            AND m.key IN (${placeholders(selectedMetrics.length)}) AND json_extract(m.value,'$.failureKind') IS NOT NULL`, [...parameters, ...selectedMetrics])
            .map(d => ({ ...d, required: required.has(d.metric as BalanceSheetScreeningMetric) })) as unknown as BalanceSheetDiagnostic[];
        diagnostics.sort((a, b) => a.secCode < b.secCode ? -1 : a.secCode > b.secCode ? 1 : allIds.indexOf(a.metric) - allIds.indexOf(b.metric));
        const reasonCounts: BalanceSheetScreeningResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
        for (const d of diagnostics) reasonCounts[d.reason]++;
        const offset = options.offset ?? 0; let pageIds: string[];
        if (options.limit === 0) pageIds = [];
        else if (options.sortBy === "currentRatio") {
            const candidates = this.all(`SELECT s.id, s.sec_code, s.doc_id, ${field("currentRatio", "numerator")} n, ${field("currentRatio", "denominator")} d FROM financial_snapshots s WHERE ${matching}`, compared);
            candidates.sort((a, b) => compareFractions({ numerator: BigInt(a.n as string), denominator: BigInt(a.d as string) }, { numerator: BigInt(b.n as string), denominator: BigInt(b.d as string) }) * (options.order === "asc" ? 1 : -1) || (a.sec_code! < b.sec_code! ? -1 : a.sec_code! > b.sec_code! ? 1 : a.doc_id! < b.doc_id! ? -1 : a.doc_id! > b.doc_id! ? 1 : 0));
            pageIds = candidates.slice(offset, options.limit === undefined ? undefined : offset + options.limit).map(r => r.id as string);
        } else {
            const order = options.sortBy ? `${field(options.sortBy, "value")} ${options.order === "asc" ? "ASC" : "DESC"},` : "";
            pageIds = this.all(`SELECT s.id FROM financial_snapshots s WHERE ${matching} ORDER BY ${order} s.sec_code,s.doc_id LIMIT ? OFFSET ?`, [...compared, options.limit ?? -1, offset]).map(r => r.id as string);
        }
        const rows = pageIds.map(id => this.get(id)!.snapshot);
        // 返却形・必要指標は既存APIでも再確認。SQL/TSでページング済みなのでページ指定だけ外します。
        const resultRows = rows.length ? screenBalanceSheetSnapshots(rows, { ...options, offset: 0, limit: undefined }).rows : [];
        if (resultRows.length !== rows.length) throw new Error("保存検索とメモリ検索の判定が一致しません");
        const byCode = new Map(resultRows.map(r => [r.secCode, r]));
        return { rows: rows.map(r => byCode.get(r.secCode)!), total, excludedRows, filteredRows: cohortSize - excludedRows - total, diagnostics, reasonCounts };
    }
    close(): void { if (!this.closed) { this.db.close(); this.closed = true; } }
}
