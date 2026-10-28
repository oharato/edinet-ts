import { createHash } from "node:crypto";
import type { SQLInputValue } from "node:sqlite";
import { DedicatedSqliteDatabase } from "./dedicated-sqlite";
import { ObservedFinancialArchive, type ArchivedFinancialSnapshotOptions, type ArchivedFinancialSnapshots } from "./observed-financial-archive";
import { BALANCE_SHEET_REGISTRY, type BalanceSheetMetricId } from "../balance-sheet-registry";
import { FINANCIAL_DETAIL_REGISTRY, type FinancialDetailMetricId } from "../financial-detail-registry";
import { IFRS_FINANCIAL_DETAIL_REGISTRY, type IfrsFinancialDetailMetricId } from "../ifrs-financial-detail-registry";
import { toSafeMetricNumber, type FactSelectionResult } from "../metric-selection";
import type { FinancialPeriodType, ComparisonOperator, SortOrder } from "../financial-options";
export const FINANCIAL_SEARCH_INDEX_VERSION = "1";
export type FinancialIndexMetricId = BalanceSheetMetricId | FinancialDetailMetricId | IfrsFinancialDetailMetricId;
export interface FinancialIndexCohort {
    generation: string;
    group: "balanceSheet" | "details";
    accountingStandard: "J-GAAP" | "IFRS";
    scope: "Consolidated" | "NonConsolidated";
    currency: "JPY";
    period: {
        instant: string;
        startDate?: never;
        endDate?: never;
    } | {
        startDate: string;
        endDate: string;
        instant?: never;
    };
    periodType?: FinancialPeriodType;
    docIDs?: readonly string[];
}
export interface FinancialIndexSearchOptions {
    metricIds: readonly FinancialIndexMetricId[];
    conditions?: readonly {
        metric: FinancialIndexMetricId;
        operator: ComparisonOperator;
        value: number;
    }[];
    sortBy?: FinancialIndexMetricId;
    order?: SortOrder;
    offset?: number;
    limit?: number;
}
export interface FinancialIndexRow {
    group: "balanceSheet" | "details";
    rootDocID: string;
    edinetCode: string;
    knownAt: string;
    sourceSha256: string;
    chainDocIDs: string[];
    observationIds: string[];
    snapshot: {
        metadata: Omit<FinancialIndexCohort, "generation" | "group" | "docIDs"> & {
            docID: string;
            secCode: string;
        };
        selections: Partial<Record<FinancialIndexMetricId, FactSelectionResult<FinancialIndexMetricId>>>;
    };
}
export interface FinancialIndexDiagnostic {
    secCode: string;
    docID: string;
    metric: FinancialIndexMetricId;
    reason: "missing" | "unsupported" | "ambiguous" | "unsafe-number";
    selectionReason: string;
    required: boolean;
}
export interface FinancialIndexSearchResult {
    rows: FinancialIndexRow[];
    total: number;
    excludedRows: number;
    filteredRows: number;
    diagnostics: FinancialIndexDiagnostic[];
    reasonCounts: Record<FinancialIndexDiagnostic["reason"], number>;
}
export interface FinancialIndexGeneration {
    id: string;
    indexVersion: typeof FINANCIAL_SEARCH_INDEX_VERSION;
    selection: ArchivedFinancialSnapshots["selection"];
    unavailableSources: ArchivedFinancialSnapshots["unavailableSources"];
    provenance: ArchivedFinancialSnapshots["provenance"];
    unresolvedRecords: ArchivedFinancialSnapshots["records"];
    unavailableGroups: {
        docID: string;
        group: string;
        reason: string;
    }[];
    rows: {
        id: string;
        metadata: SQLInputValue[];
        sha256: string;
        metrics: {
            id: string;
            sha256: string;
        }[];
    }[];
}
const schema = {
    financial_index_format: "CREATE TABLE financial_index_format(kind TEXT NOT NULL)",
    financial_generations: "CREATE TABLE financial_generations(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
    financial_rows: "CREATE TABLE financial_rows(generation TEXT NOT NULL,row_id TEXT NOT NULL,group_id TEXT NOT NULL,standard TEXT NOT NULL,scope TEXT NOT NULL,currency TEXT NOT NULL,period_start TEXT NOT NULL,period_end TEXT NOT NULL,period_type TEXT NOT NULL,edinet_code TEXT NOT NULL,sec_code TEXT NOT NULL,doc_id TEXT NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL,PRIMARY KEY(generation,row_id))",
    financial_cohort: "CREATE INDEX financial_cohort ON financial_rows(generation,group_id,standard,scope,currency,period_start,period_end,period_type,sec_code,doc_id)",
    financial_values: "CREATE TABLE financial_values(generation TEXT NOT NULL,row_id TEXT NOT NULL,metric_id TEXT NOT NULL,available INTEGER NOT NULL,numeric_value REAL,raw_text TEXT,status TEXT NOT NULL,reason TEXT NOT NULL,failure_kind TEXT,metric_order INTEGER NOT NULL,PRIMARY KEY(generation,row_id,metric_id))",
    financial_metric_range: "CREATE INDEX financial_metric_range ON financial_values(generation,metric_id,available,numeric_value,row_id)"
};
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const isFinancialIndexGenerationId = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,200}$/.test(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
function flat(v: unknown, keys: readonly string[]): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
    throw new Error("未知または不正な財務索引入力です"); return Object.fromEntries(Object.keys(v).map(k => [k, (v as Record<string, unknown>)[k]])); }
function array<T>(v: readonly T[], max: number): T[] { if (!Array.isArray(v))
    throw new Error("配列が必要です"); const length = v.length; if (!Number.isSafeInteger(length) || length < 0 || length > max)
    throw new Error("配列の件数上限を超えています"); return Array.from({ length }, (_, i) => { if (!Object.hasOwn(v, i))
    throw new Error("疎配列は使えません"); return v[i]; }); }
const families = (c: Pick<FinancialIndexCohort, "group" | "accountingStandard">): string[] => c.group === "balanceSheet" ? Object.keys(BALANCE_SHEET_REGISTRY) : c.accountingStandard === "IFRS" ? Object.keys(IFRS_FINANCIAL_DETAIL_REGISTRY) : Object.keys(FINANCIAL_DETAIL_REGISTRY).filter(k => FINANCIAL_DETAIL_REGISTRY[k as FinancialDetailMetricId].periodType === "duration");
export function normalizeFinancialIndexSearch(cohort: FinancialIndexCohort, options: FinancialIndexSearchOptions) {
    const c = flat(cohort, ["generation", "group", "accountingStandard", "scope", "currency", "period", "periodType", "docIDs"]), p = flat(c.period, ["instant", "startDate", "endDate"]);
    if (!isFinancialIndexGenerationId(c.generation) || !["balanceSheet", "details"].includes(c.group as string) || !["J-GAAP", "IFRS"].includes(c.accountingStandard as string) || !["Consolidated", "NonConsolidated"].includes(c.scope as string) || c.currency !== "JPY" || c.accountingStandard === "IFRS" && c.scope !== "Consolidated")
        throw new Error("同一世代・基準・scope・JPYの比較条件が必要です");
    if (c.group === "balanceSheet" ? !date(p.instant) || p.startDate !== undefined || p.endDate !== undefined || c.periodType !== undefined : !date(p.startDate) || !date(p.endDate) || p.startDate > p.endDate || p.instant !== undefined || !["annual", "ytd", "quarterly"].includes(c.periodType as string))
        throw new Error("groupと期間/期間分類が一致しません");
    const docIDs = c.docIDs === undefined ? undefined : array(c.docIDs as string[], 1000);
    if (docIDs !== undefined && (!docIDs.length || new Set(docIDs).size !== docIDs.length || docIDs.some(d => typeof d !== "string" || !d.trim() || d !== d.trim() || d.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(d))))
        throw new Error("明示書類IDが不正/重複しています");
    const normalized = { ...c, period: p, ...(docIDs === undefined ? {} : { docIDs }) } as unknown as FinancialIndexCohort, known = families(normalized), o = flat(options, ["metricIds", "conditions", "sortBy", "order", "offset", "limit"]), metrics = array(o.metricIds as FinancialIndexMetricId[], 50);
    if (!metrics.length || new Set(metrics).size !== metrics.length || metrics.some(k => !known.includes(k)))
        throw new Error("既知の重複しない項目を明示してください");
    const conditions = array((o.conditions ?? []) as NonNullable<FinancialIndexSearchOptions["conditions"]>, 100).map(v => { const k = flat(v, ["metric", "operator", "value"]); if (!known.includes(k.metric as string) || !["gte", "lte", "gt", "lt", "eq"].includes(k.operator as string) || typeof k.value !== "number" || !Number.isFinite(k.value) || c.accountingStandard === "IFRS" && Math.abs(k.value) > Number.MAX_SAFE_INTEGER)
        throw new Error("不正な財務数値条件です"); return k as unknown as {
        metric: FinancialIndexMetricId;
        operator: ComparisonOperator;
        value: number;
    }; });
    if (o.sortBy !== undefined && !known.includes(o.sortBy as string) || o.order !== undefined && !["asc", "desc"].includes(o.order as string))
        throw new Error("不正な並び指定です");
    for (const v of [o.offset, o.limit])
        if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0))
            throw new Error("ページ指定は0以上の安全な整数です");
    const required = new Set<FinancialIndexMetricId>([...conditions.map(c => c.metric), ...(o.sortBy ? [o.sortBy as FinancialIndexMetricId] : [])]);
    if ([...required].some(k => !metrics.includes(k)))
        throw new Error("条件/並び項目をmetricIdsへ明示してください");
    if (!required.size)
        metrics.forEach(k => required.add(k));
    return { cohort: normalized, metrics, conditions, sortBy: o.sortBy as FinancialIndexMetricId | undefined, order: o.order as SortOrder | undefined, offset: (o.offset ?? 0) as number, limit: o.limit as number | undefined, required };
}
const rowColumns = ["generation", "row_id", "group_id", "standard", "scope", "currency", "period_start", "period_end", "period_type", "edinet_code", "sec_code", "doc_id"];
const valueColumns = ["generation", "row_id", "metric_id", "available", "numeric_value", "raw_text", "status", "reason", "failure_kind", "metric_order"];
function prepare(generation: string, row: FinancialIndexRow) {
    const m = row.snapshot.metadata, body = canonical(row), rowID = hash(canonical([m.docID, row.group])), metadata: SQLInputValue[] = [generation, rowID, row.group, m.accountingStandard, m.scope, m.currency, m.period.startDate ?? "", m.period.endDate ?? m.period.instant!, m.periodType ?? "", row.edinetCode, m.secCode, m.docID], digest = hash(canonical([metadata, body])), ordered = families({ group: row.group, accountingStandard: m.accountingStandard });
    const values = Object.entries(row.snapshot.selections).map(([metric, s]) => { if (!s || !ordered.includes(metric) || s.metricId !== metric || !["selected", "missing", "unsupported", "ambiguous"].includes(s.status) || typeof s.reason !== "string" || s.status === "selected" && s.safeNumber !== toSafeMetricNumber(s.raw))
        throw new Error("索引へ保存する直接選択値が不整合です"); const failure = s.status !== "selected" ? s.status : s.safeNumber === undefined ? "unsafe-number" : null; return [generation, rowID, metric, failure === null ? 1 : 0, s.safeNumber ?? null, s.raw ?? null, s.status, s.reason, failure, ordered.indexOf(metric)] as SQLInputValue[]; });
    return { rowID, metadata, body, digest, values };
}
/** 観測アーカイブを入力に、固定世代の直接財務値をSQLで検索する専用DB。 */
export class FinancialSearchIndex extends DedicatedSqliteDatabase {
    constructor(file: string, options: {
        readOnly?: boolean;
    } = {}) { super(file, options, { table: "financial_index_format", kind: "edinet-ts-financial-search-index-v1", schema }); }
    materialize(generation: string, archive: ObservedFinancialArchive, options: ArchivedFinancialSnapshotOptions): FinancialIndexGeneration {
        if (this.closed || this.readOnly)
            throw new Error("close済み/readOnlyの財務索引です");
        if (!isFinancialIndexGenerationId(generation) || !(archive instanceof ObservedFinancialArchive))
            throw new Error("固定世代IDと観測アーカイブが必要です");
        const source = archive.createSnapshots(options), rows: ReturnType<typeof prepare>[] = [], unresolvedRecords: ArchivedFinancialSnapshots["records"] = [], unavailableGroups: FinancialIndexGeneration["unavailableGroups"] = [];
        for (const record of source.records) {
            const r = record.result;
            if (r.status !== "resolved") {
                unresolvedRecords.push(record);
                continue;
            }
            for (const group of ["balanceSheet", "details"] as const) {
                const g = r[group];
                if (g.status !== "created") {
                    unavailableGroups.push({ docID: record.docID, group, reason: g.reason });
                    continue;
                }
                const snapshot = g.snapshot, m = r.basis.metadata, metadata: FinancialIndexRow["snapshot"]["metadata"] = { docID: record.docID, secCode: m.securityCode!, accountingStandard: m.accountingStandard, scope: m.scope, currency: "JPY", period: group === "balanceSheet" ? { instant: m.instant } : { ...m.period }, ...(group === "details" ? { periodType: m.periodType } : {}) };
                rows.push(prepare(generation, { group, rootDocID: record.rootDocID, edinetCode: m.edinetCode, knownAt: record.knownAt, sourceSha256: record.sourceSha256, chainDocIDs: [...record.chainDocIDs], observationIds: [...record.observationIds], snapshot: { metadata, selections: snapshot.selections } }));
            }
        }
        const report: FinancialIndexGeneration = { id: generation, indexVersion: FINANCIAL_SEARCH_INDEX_VERSION, selection: source.selection, unavailableSources: source.unavailableSources, provenance: source.provenance, unresolvedRecords, unavailableGroups, rows: rows.map(r => ({ id: r.rowID, metadata: r.metadata, sha256: r.digest, metrics: r.values.map(v => ({ id: String(v[2]), sha256: hash(canonical(v)) })) })).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }, body = canonical(report), digest = hash(canonical([generation, body]));
        return this.transaction(() => {
            const old = this.rows("SELECT * FROM financial_generations WHERE id=?", [generation]);
            if (old.length) {
                this.audit(generation);
                if (old[0].body !== body)
                    throw new Error("完了世代の内容は変更できません。別IDを指定してください");
                return JSON.parse(body);
            }
            this.run("INSERT INTO financial_generations VALUES(?,?,?)", [generation, body, digest]);
            for (const r of rows) {
                this.run(`INSERT INTO financial_rows VALUES(${Array.from({ length: 14 }, () => "?").join(",")})`, [...r.metadata, r.digest, r.body]);
                for (const v of r.values)
                    this.run(`INSERT INTO financial_values VALUES(${valueColumns.map(() => "?").join(",")})`, v);
            }
            this.audit(generation);
            return JSON.parse(body);
        });
    }
    private audit(generation: string): FinancialIndexGeneration {
        const stored = this.rows("SELECT * FROM financial_generations WHERE id=?", [generation])[0];
        if (!stored || typeof stored.body !== "string" || hash(canonical([generation, stored.body])) !== stored.sha256)
            throw new Error("世代が未収録またはhash不一致です");
        const report = JSON.parse(stored.body) as FinancialIndexGeneration;
        if (report.id !== generation || report.indexVersion !== FINANCIAL_SEARCH_INDEX_VERSION)
            throw new Error("世代IDが不整合です");
        const expected = new Map(report.rows.map(r => [r.id, r])), rows = this.rows(`SELECT ${rowColumns.join(",")},sha256 FROM financial_rows WHERE generation=?`, [generation]);
        if (rows.length !== expected.size)
            throw new Error("世代の行数が不整合です");
        for (const row of rows) {
            const e = expected.get(String(row.row_id));
            if (!e || canonical(e.metadata) !== canonical(rowColumns.map(c => row[c])) || row.sha256 !== e.sha256)
                throw new Error("財務行の索引が不整合です");
        }
        const values = this.rows(`SELECT ${valueColumns.join(",")} FROM financial_values WHERE generation=?`, [generation]), metrics = new Map(report.rows.flatMap(r => r.metrics.map(m => [r.id + ":" + m.id, m.sha256] as const)));
        if (values.length !== metrics.size)
            throw new Error("世代の選択値件数が不整合です");
        for (const v of values)
            if (hash(canonical(valueColumns.map(c => v[c]))) !== metrics.get(v.row_id + ":" + v.metric_id))
                throw new Error("財務数値の索引が不整合です");
        return report;
    }
    generation(idValue: string): FinancialIndexGeneration { if (!isFinancialIndexGenerationId(idValue))
        throw new Error("世代IDが不正です"); return this.transaction(() => this.audit(idValue), false); }
    screen(cohort: FinancialIndexCohort, options: FinancialIndexSearchOptions): FinancialIndexSearchResult {
        const q = normalizeFinancialIndexSearch(cohort, options), c = q.cohort, p = c.period;
        return this.transaction(() => {
            this.audit(c.generation);
            const clause = "r.generation=? AND r.group_id=? AND r.standard=? AND r.scope=? AND r.currency=? AND r.period_start=? AND r.period_end=? AND r.period_type=?" + (c.docIDs ? ` AND r.doc_id IN (${c.docIDs.map(() => "?").join(",")})` : ""), params: SQLInputValue[] = [c.generation, c.group, c.accountingStandard, c.scope, c.currency, p.startDate ?? "", p.endDate ?? p.instant!, c.periodType ?? "", ...(c.docIDs ?? [])];
            const cohortRows = this.rows(`SELECT r.row_id,r.edinet_code,r.sec_code,r.doc_id FROM financial_rows r WHERE ${clause}`, params), codes = new Set<string>(), issuers = new Set<string>();
            if (c.docIDs && cohortRows.length !== c.docIDs.length)
                throw new Error("明示書類が対象cohortに保存されていません");
            for (const row of cohortRows) {
                if (codes.has(String(row.sec_code)) || issuers.has(String(row.edinet_code)))
                    throw new Error("同一企業の複数書類は自動選択しません");
                codes.add(String(row.sec_code));
                issuers.add(String(row.edinet_code));
            }
            const marks = q.metrics.map(() => "?").join(","), diagnostics: FinancialIndexDiagnostic[] = [], reasonCounts: FinancialIndexSearchResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
            const values = this.rows(`SELECT r.row_id,r.sec_code,r.doc_id,v.metric_id,v.failure_kind,v.reason FROM financial_rows r JOIN financial_values v ON v.generation=r.generation AND v.row_id=r.row_id WHERE ${clause} AND v.metric_id IN (${marks}) ORDER BY r.sec_code,r.doc_id,v.metric_order`, [...params, ...q.metrics]);
            if (values.length !== cohortRows.length * q.metrics.length)
                throw new Error("要求項目の選択記録が保存されていません");
            for (const v of values)
                if (v.failure_kind !== null) {
                    const reason = v.failure_kind as FinancialIndexDiagnostic["reason"];
                    reasonCounts[reason]++;
                    diagnostics.push({ secCode: String(v.sec_code), docID: String(v.doc_id), metric: v.metric_id as FinancialIndexMetricId, reason, selectionReason: String(v.reason), required: q.required.has(v.metric_id as FinancialIndexMetricId) });
                }
            const required = [...q.required], usable = `NOT EXISTS(SELECT 1 FROM financial_values req WHERE req.generation=r.generation AND req.row_id=r.row_id AND req.metric_id IN (${required.map(() => "?").join(",")}) AND req.available=0)`, operators = { gte: ">=", lte: "<=", gt: ">", lt: "<", eq: "=" };
            const predicates = q.conditions.map(condition => `r.row_id IN (SELECT row_id FROM financial_values INDEXED BY financial_metric_range WHERE generation=? AND metric_id=? AND available=1 AND numeric_value ${operators[condition.operator]} ?)`), conditionParams: SQLInputValue[] = q.conditions.flatMap(condition => [c.generation, condition.metric, condition.value]);
            const where = `${clause} AND ${usable}` + (predicates.length ? " AND " + predicates.join(" AND ") : ""), args = [...params, ...required, ...conditionParams], matched = Number(this.rows(`SELECT COUNT(*) AS n FROM financial_rows r WHERE ${where}`, args)[0].n), usableCount = Number(this.rows(`SELECT COUNT(*) AS n FROM financial_rows r WHERE ${clause} AND ${usable}`, [...params, ...required])[0].n);
            const join = q.sortBy ? " JOIN financial_values ordering ON ordering.generation=r.generation AND ordering.row_id=r.row_id AND ordering.metric_id=?" : "", order = q.sortBy ? `ordering.numeric_value ${q.order === "asc" ? "ASC" : "DESC"},` : "", selected = this.rows(`SELECT r.* FROM financial_rows r${join} WHERE ${where} ORDER BY ${order}r.sec_code ASC,r.doc_id ASC LIMIT ? OFFSET ?`, [...(q.sortBy ? [q.sortBy] : []), ...args, q.limit ?? -1, q.offset]);
            const rows = selected.map(stored => { if (typeof stored.body !== "string" || hash(canonical([rowColumns.map(k => stored[k]), stored.body])) !== stored.sha256)
                throw new Error("返却する財務本文のhash不一致です"); const row = JSON.parse(stored.body) as FinancialIndexRow; const prepared = prepare(c.generation, row); if (canonical(prepared.metadata) !== canonical(rowColumns.map(k => stored[k])) || prepared.digest !== stored.sha256)
                throw new Error("財務本文と索引の対応が不整合です"); return { ...row, snapshot: { ...row.snapshot, selections: Object.fromEntries(q.metrics.map(k => [k, row.snapshot.selections[k]])) } }; });
            return { rows, total: matched, excludedRows: cohortRows.length - usableCount, filteredRows: usableCount - matched, diagnostics, reasonCounts };
        }, false);
    }
}
