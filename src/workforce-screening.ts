import { XMLValidator } from "fast-xml-parser";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import type { FactSelectionResult } from "./metric-selection";
import { ComparisonOperator, SortOrder } from "./financial-options";
import { WorkforceMetricId, WORKFORCE_REGISTRY } from "./workforce-registry";

/** 基準は元書類を確認した呼出側の宣言。自動推定しません。 */
export type WorkforceMetadata = Extract<FinancialDetailMetadata, { period: { instant: string } }>;
export interface WorkforceDocument { xml: string; metadata: WorkforceMetadata; }
export interface WorkforceSnapshot { metadata: WorkforceMetadata; selections: Record<WorkforceMetricId, FactSelectionResult<WorkforceMetricId>>; }
export interface WorkforceCondition { metric: WorkforceMetricId; operator: ComparisonOperator; value: number; }
export interface WorkforceScreeningOptions { conditions?: readonly WorkforceCondition[]; sortBy?: WorkforceMetricId; order?: SortOrder; offset?: number; limit?: number; }
export interface WorkforceDiagnostic {
    secCode: string; docID: string; metric: WorkforceMetricId;
    reason: "missing" | "unsupported" | "ambiguous" | "unsafe-number"; selectionReason: string; required: boolean;
}
export interface WorkforceScreeningResult {
    rows: WorkforceSnapshot[]; total: number; excludedRows: number; filteredRows: number; diagnostics: WorkforceDiagnostic[];
    reasonCounts: Record<WorkforceDiagnostic["reason"], number>;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const known = (id: unknown): id is WorkforceMetricId => typeof id === "string" && Object.prototype.hasOwnProperty.call(WORKFORCE_REGISTRY, id);
function normalizeMetadata(metadata: WorkforceMetadata): WorkforceMetadata {
    const result = normalizeFinancialDetailMetadata(metadata);
    if (result.period.instant === undefined) throw new Error("人的資本には明示instantが必要です");
    return result as WorkforceMetadata;
}
/** 指定原本のみを厳格に解析。給与の集計期間や注記は補完しません。 */
export function createWorkforceSnapshot(xml: string, metadata: WorkforceMetadata): WorkforceSnapshot {
    const normalized = normalizeMetadata(metadata);
    if (typeof xml !== "string" || /<!DOCTYPE\b/i.test(xml) || XMLValidator.validate(xml) !== true) throw new Error("整形式の原本XMLが必要です（DOCTYPE非対応）");
    const object = new EdinetXbrlParser().parse(xml, normalized.docID);
    return { metadata: normalized, selections: { averageAnnualSalary: object.selectWorkforceMetric(WorkforceMetricId.AverageAnnualSalary, {
        scope: normalized.scope, accountingStandard: normalized.accountingStandard, period: normalized.period
    }) } };
}
/** 明示した複数社をメモリ検索。各社のentity整合を確認し、同一entityの別コード使用を拒否します。 */
export function screenWorkforceDocuments(documents: readonly WorkforceDocument[], options: WorkforceScreeningOptions = {}): WorkforceScreeningResult {
    if (!Array.isArray(documents) || !record(options) || Object.keys(options).some(k => !["conditions","sortBy","order","offset","limit"].includes(k))) throw new Error("不正な人的資本検索入力です");
    if (options.conditions !== undefined && !Array.isArray(options.conditions)) throw new Error("conditionsは配列です");
    const conditions = Array.from(options.conditions ?? []);
    for (const c of conditions) if (!record(c) || Object.keys(c).some(k => !["metric","operator","value"].includes(k)) || !known(c.metric) ||
        !Object.values(ComparisonOperator).includes(c.operator) || typeof c.value !== "number" || !Number.isFinite(c.value) || Math.abs(c.value) > Number.MAX_SAFE_INTEGER) throw new Error("不正な人的資本条件です");
    if (options.sortBy !== undefined && !known(options.sortBy) || options.order !== undefined && !Object.values(SortOrder).includes(options.order)) throw new Error("不正な人的資本の並び指定です");
    for (const v of [options.offset, options.limit]) if (v !== undefined && (!Number.isSafeInteger(v) || v < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    const metadata = Array.from(documents, document => {
        if (!record(document) || Object.keys(document).some(k => !["xml","metadata"].includes(k))) throw new Error("xmlとmetadataが必要です");
        return normalizeMetadata(document.metadata);
    });
    const codes = new Set<string>(), docs = new Set<string>();
    const cohort = (m: WorkforceMetadata) => JSON.stringify([m.scope, m.accountingStandard, m.currency, m.period.instant]);
    for (const meta of metadata) {
        if (codes.has(meta.secCode) || docs.has(meta.docID)) throw new Error("同一企業/書類の複数候補は明示的に1つへ絞ってください");
        codes.add(meta.secCode); docs.add(meta.docID);
        if (cohort(meta) !== cohort(metadata[0])) throw new Error("範囲・基準・通貨・対象時点の混在は比較しません");
    }
    // 絞り込みで消える候補も先に検証し、重複entityを隠しません。
    const snapshots = documents.map((document, i) => createWorkforceSnapshot(document.xml, metadata[i]));
    const entities = new Map<string, string>();
    for (const row of snapshots) {
        const evidence = row.selections.averageAnnualSalary.evidence;
        for (const item of evidence) if (item.entity) {
            const key = JSON.stringify([item.entity.scheme, item.entity.identifier]), previous = entities.get(key);
            if (previous !== undefined && previous !== row.metadata.secCode) throw new Error("同一entityを別企業コードへ使用できません");
            entities.set(key, row.metadata.secCode);
        }
    }
    const diagnostics: WorkforceDiagnostic[] = [], reasonCounts: WorkforceScreeningResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
    const rows: WorkforceSnapshot[] = []; let excludedRows = 0, filteredRows = 0;
    const compare = (a: number, op: ComparisonOperator, b: number) => op === "gte" ? a >= b : op === "lte" ? a <= b : op === "gt" ? a > b : op === "lt" ? a < b : a === b;
    for (const row of snapshots) {
        const selection = row.selections.averageAnnualSalary;
        const reason = selection.status !== "selected" ? selection.status : selection.safeNumber === undefined ? "unsafe-number" : undefined;
        if (reason) {
            diagnostics.push({ secCode: row.metadata.secCode, docID: row.metadata.docID, metric: WorkforceMetricId.AverageAnnualSalary, reason, selectionReason: selection.reason, required: true });
            reasonCounts[reason]++; excludedRows++; continue;
        }
        if (!conditions.every(c => compare(selection.safeNumber!, c.operator, c.value))) { filteredRows++; continue; }
        rows.push(row);
    }
    const stable = (a: WorkforceSnapshot, b: WorkforceSnapshot) => a.metadata.secCode < b.metadata.secCode ? -1 : a.metadata.secCode > b.metadata.secCode ? 1 : a.metadata.docID < b.metadata.docID ? -1 : a.metadata.docID > b.metadata.docID ? 1 : 0;
    rows.sort((a, b) => (options.sortBy ? (a.selections.averageAnnualSalary.safeNumber! - b.selections.averageAnnualSalary.safeNumber!) * (options.order === "asc" ? 1 : -1) : 0) || stable(a, b));
    diagnostics.sort((a,b) => a.secCode < b.secCode ? -1 : a.secCode > b.secCode ? 1 : 0);
    const offset = options.offset ?? 0;
    return { rows: rows.slice(offset, options.limit === undefined ? undefined : offset + options.limit), total: rows.length, excludedRows, filteredRows, diagnostics, reasonCounts };
}
