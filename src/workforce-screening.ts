import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import type { FactSelectionResult } from "./metric-selection";
import { ComparisonOperator, SortOrder } from "./financial-options";
import { WorkforceMetricId, WORKFORCE_REGISTRY } from "./workforce-registry";

/** 基準は元書類を確認した呼出側の宣言。自動推定しません。 */
export type WorkforceMetadata = Extract<FinancialDetailMetadata, { period: { instant: string } }>;
export interface WorkforceDocument { xml: string; metadata: WorkforceMetadata; }
export interface WorkforceSnapshot {
    metadata: WorkforceMetadata;
    /** 従来の給与fieldは必須固定。追加項目は明示された場合だけ返します。 */
    selections: { averageAnnualSalary: FactSelectionResult<"averageAnnualSalary"> } &
        Partial<{ [Id in Exclude<WorkforceMetricId, "averageAnnualSalary">]: FactSelectionResult<Id> }>;
}
export interface WorkforceCondition { metric: WorkforceMetricId; operator: ComparisonOperator; value: number; }
export interface WorkforceScreeningOptions { metricIds?: readonly WorkforceMetricId[]; conditions?: readonly WorkforceCondition[]; sortBy?: WorkforceMetricId; order?: SortOrder; offset?: number; limit?: number; }
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
function projection(metricIds?: readonly WorkforceMetricId[]): WorkforceMetricId[] {
    if (metricIds === undefined) return [WorkforceMetricId.AverageAnnualSalary];
    if (!Array.isArray(metricIds)) throw new Error("metricIdsは配列です");
    // 疎配列のholeもundefinedとして検査し、検査対象と返却配列を一致させます。
    const requested: WorkforceMetricId[] = Array.from(metricIds);
    if (!requested.length || requested.some(id => !known(id)) || new Set(requested).size !== requested.length)
        throw new Error("metricIdsに空・未知・重複項目があります");
    return requested;
}
function normalizeMetadata(metadata: WorkforceMetadata): WorkforceMetadata {
    const result = normalizeFinancialDetailMetadata(metadata);
    if (result.period.instant === undefined) throw new Error("人的資本には明示instantが必要です");
    return result as WorkforceMetadata;
}
/** 指定原本のみを厳格に解析。給与の集計期間や注記は補完しません。 */
export function createWorkforceSnapshot(xml: string, metadata: WorkforceMetadata, metricIds?: readonly WorkforceMetricId[]): WorkforceSnapshot {
    const normalized = normalizeMetadata(metadata), requested = projection(metricIds);
    const object = new EdinetXbrlParser().parse(xml, normalized.docID);
    const options = { scope: normalized.scope, accountingStandard: normalized.accountingStandard, period: normalized.period };
    const selections: WorkforceSnapshot["selections"] = {
        averageAnnualSalary: object.selectWorkforceMetric(WorkforceMetricId.AverageAnnualSalary, options)
    };
    if (requested.includes(WorkforceMetricId.AverageAgeYears)) selections.averageAgeYears = object.selectWorkforceMetric(WorkforceMetricId.AverageAgeYears, options);
    if (requested.includes(WorkforceMetricId.AverageLengthOfServiceYears)) selections.averageLengthOfServiceYears = object.selectWorkforceMetric(WorkforceMetricId.AverageLengthOfServiceYears, options);
    if (requested.includes(WorkforceMetricId.NumberOfEmployees)) selections.numberOfEmployees = object.selectWorkforceMetric(WorkforceMetricId.NumberOfEmployees, options);
    return { metadata: normalized, selections };
}
/** 明示した複数社をメモリ検索。各社のentity整合を確認し、同一entityの別コード使用を拒否します。 */
export function screenWorkforceDocuments(documents: readonly WorkforceDocument[], options: WorkforceScreeningOptions = {}): WorkforceScreeningResult {
    if (!Array.isArray(documents) || !record(options) || Object.keys(options).some(k => !["metricIds","conditions","sortBy","order","offset","limit"].includes(k))) throw new Error("不正な人的資本検索入力です");
    if (options.conditions !== undefined && !Array.isArray(options.conditions)) throw new Error("conditionsは配列です");
    const conditions: WorkforceCondition[] = Array.from(options.conditions ?? []);
    for (const c of conditions) if (!record(c) || Object.keys(c).some(k => !["metric","operator","value"].includes(k)) || !known(c.metric) ||
        !Object.values(ComparisonOperator).includes(c.operator) || typeof c.value !== "number" || !Number.isFinite(c.value) || Math.abs(c.value) > Number.MAX_SAFE_INTEGER) throw new Error("不正な人的資本条件です");
    if (options.sortBy !== undefined && !known(options.sortBy) || options.order !== undefined && !Object.values(SortOrder).includes(options.order)) throw new Error("不正な人的資本の並び指定です");
    for (const v of [options.offset, options.limit]) if (v !== undefined && (!Number.isSafeInteger(v) || v < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    const requested = projection(options.metricIds);
    const required = new Set<WorkforceMetricId>([...conditions.map(c => c.metric), ...(options.sortBy ? [options.sortBy] : [])]);
    if ([...required].some(id => !requested.includes(id))) throw new Error("条件/並び項目をmetricIdsへ明示してください（既定の給与は変更しません）");
    if (!required.size) requested.forEach(id => required.add(id));
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
    const snapshots = documents.map((document, i) => createWorkforceSnapshot(document.xml, metadata[i], requested));
    const entities = new Map<string, string>();
    for (const row of snapshots) {
        const evidence = Object.values(row.selections).flatMap(selection => selection.evidence);
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
        let unavailable = false;
        for (const selection of Object.values(row.selections)) {
            const reason = selection.status !== "selected" ? selection.status : selection.safeNumber === undefined ? "unsafe-number" : undefined;
            if (reason) {
                const needed = required.has(selection.metricId);
                diagnostics.push({ secCode: row.metadata.secCode, docID: row.metadata.docID, metric: selection.metricId, reason, selectionReason: selection.reason, required: needed });
                reasonCounts[reason]++; if (needed) unavailable = true;
            }
        }
        if (unavailable) { excludedRows++; continue; }
        if (!conditions.every(c => compare(row.selections[c.metric]!.safeNumber!, c.operator, c.value))) { filteredRows++; continue; }
        rows.push(row);
    }
    const stable = (a: WorkforceSnapshot, b: WorkforceSnapshot) => a.metadata.secCode < b.metadata.secCode ? -1 : a.metadata.secCode > b.metadata.secCode ? 1 : a.metadata.docID < b.metadata.docID ? -1 : a.metadata.docID > b.metadata.docID ? 1 : 0;
    rows.sort((a, b) => (options.sortBy ? (a.selections[options.sortBy]!.safeNumber! - b.selections[options.sortBy]!.safeNumber!) * (options.order === "asc" ? 1 : -1) : 0) || stable(a, b));
    const ids = Object.values(WorkforceMetricId);
    diagnostics.sort((a,b) => a.secCode < b.secCode ? -1 : a.secCode > b.secCode ? 1 : ids.indexOf(a.metric) - ids.indexOf(b.metric));
    const offset = options.offset ?? 0;
    return { rows: rows.slice(offset, options.limit === undefined ? undefined : offset + options.limit), total: rows.length, excludedRows, filteredRows, diagnostics, reasonCounts };
}
