import { XMLValidator } from "fast-xml-parser";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { AccountingStandard } from "./metric-registry";
import type { FactSelectionResult, MetricSelectionOptions } from "./metric-selection";
import { FinancialPeriodType, ConsolidationScope, ComparisonOperator, SortOrder } from "./financial-options";
import { FINANCIAL_DETAIL_REGISTRY, type FinancialDetailMetricId } from "./financial-detail-registry";

type CommonMetadata = { secCode: string; docID: string; scope: ConsolidationScope; accountingStandard: AccountingStandard; currency: "JPY" };
export type FinancialDetailMetadata = CommonMetadata & (
    { period: { instant: string; startDate?: never; endDate?: never }; periodType?: never } |
    { period: { startDate: string; endDate: string; instant?: never }; periodType: FinancialPeriodType }
);
export interface FinancialDetailDocument { xml: string; metadata: FinancialDetailMetadata; }
export interface FinancialDetailSnapshot {
    metadata: FinancialDetailMetadata;
    /** 対象期間型の項目だけを返します（instant3項目、duration2項目）。 */
    selections: Partial<Record<FinancialDetailMetricId, FactSelectionResult<FinancialDetailMetricId>>>;
}
export interface FinancialDetailCondition { metric: FinancialDetailMetricId; operator: ComparisonOperator; value: number; }
export interface FinancialDetailScreeningOptions { conditions?: readonly FinancialDetailCondition[]; sortBy?: FinancialDetailMetricId; order?: SortOrder; offset?: number; limit?: number; }
export interface FinancialDetailDiagnostic { secCode: string; docID: string; metric: FinancialDetailMetricId;
    reason: "missing" | "unsupported" | "ambiguous" | "unsafe-number"; selectionReason: string; required: boolean; }
export interface FinancialDetailScreeningResult {
    rows: FinancialDetailSnapshot[]; total: number; excludedRows: number; filteredRows: number; diagnostics: FinancialDetailDiagnostic[];
    reasonCounts: Record<FinancialDetailDiagnostic["reason"], number>;
}
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
const known = (v: unknown): v is FinancialDetailMetricId => typeof v === "string" && Object.prototype.hasOwnProperty.call(FINANCIAL_DETAIL_REGISTRY, v);
const ids = Object.keys(FINANCIAL_DETAIL_REGISTRY) as FinancialDetailMetricId[];
function normalizeMetadata(value: FinancialDetailMetadata): FinancialDetailMetadata {
    if (!record(value) || Object.keys(value).some(key => !["secCode","docID","scope","accountingStandard","currency","period","periodType"].includes(key)) ||
        typeof value.secCode !== "string" || !/^[0-9A-Z]{4}0?$/.test(value.secCode) || typeof value.docID !== "string" || !value.docID.trim() ||
        !Object.values(ConsolidationScope).includes(value.scope) || !Object.values(AccountingStandard).includes(value.accountingStandard) || value.currency !== "JPY" || !record(value.period)) throw new Error("不正な財務明細metadataです");
    const period = value.period;
    if (Object.keys(period).some(key => !["instant","startDate","endDate"].includes(key)) || (period.instant !== undefined ?
        !validDate(period.instant) || period.startDate !== undefined || period.endDate !== undefined || value.periodType !== undefined :
        !validDate(period.startDate) || !validDate(period.endDate) || period.startDate > period.endDate || !Object.values(FinancialPeriodType).includes(value.periodType!))) throw new Error("明示した正しい時点、または開始/終了日と期間分類が必要です");
    return { ...value, secCode: value.secCode.length === 4 ? value.secCode + "0" : value.secCode, period: { ...period } } as FinancialDetailMetadata;
}
const periodKind = (metadata: FinancialDetailMetadata) => metadata.period.instant === undefined ? "duration" : "instant";
const cohortKey = (metadata: FinancialDetailMetadata) => JSON.stringify([metadata.scope, metadata.accountingStandard, metadata.currency, metadata.periodType,
    metadata.period.instant, metadata.period.startDate, metadata.period.endDate]);
/** 指定した期間の直接科目だけを選択。期間分類は呼出側の宣言で、自動推定しません。 */
export function createFinancialDetailSnapshot(xml: string, metadata: FinancialDetailMetadata): FinancialDetailSnapshot {
    const normalized = normalizeMetadata(metadata);
    if (typeof xml !== "string" || XMLValidator.validate(xml) !== true) throw new Error("整形式の原本XMLが必要です");
    const object = new EdinetXbrlParser().parse(xml, normalized.docID);
    const selections: FinancialDetailSnapshot["selections"] = {};
    for (const id of ids) if (FINANCIAL_DETAIL_REGISTRY[id].periodType === periodKind(normalized)) selections[id] = object.selectFinancialDetail(id, {
        scope: normalized.scope, accountingStandard: normalized.accountingStandard, period: normalized.period as MetricSelectionOptions["period"]
    });
    return { metadata: normalized, selections };
}
/** 明示XML集合のメモリ検索。最新選択・SQL保存・内訳合算は行いません。 */
export function screenFinancialDetailDocuments(documents: readonly FinancialDetailDocument[], options: FinancialDetailScreeningOptions = {}): FinancialDetailScreeningResult {
    if (!Array.isArray(documents) || !record(options) || Object.keys(options).some(key => !["conditions","sortBy","order","offset","limit"].includes(key))) throw new Error("不正な財務明細検索入力です");
    if (options.conditions !== undefined && !Array.isArray(options.conditions)) throw new Error("conditionsは配列です");
    const conditions = Array.from(options.conditions ?? []) as FinancialDetailCondition[];
    for (const condition of conditions) if (!record(condition) || Object.keys(condition).some(key => !["metric","operator","value"].includes(key)) ||
        !known(condition.metric) || !Object.values(ComparisonOperator).includes(condition.operator) || !Number.isFinite(condition.value)) throw new Error("不正な財務明細条件です");
    if (options.sortBy !== undefined && !known(options.sortBy) || options.order !== undefined && !Object.values(SortOrder).includes(options.order)) throw new Error("不正な財務明細の並び指定です");
    for (const value of [options.offset,options.limit]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    const metadata = Array.from(documents, document => {
        if (!record(document) || Object.keys(document).some(key => !["xml","metadata"].includes(key))) throw new Error("xmlとmetadataが必要です");
        return normalizeMetadata(document.metadata);
    });
    const seenCodes = new Set<string>(), seenDocs = new Set<string>();
    for (const meta of metadata) {
        if (seenCodes.has(meta.secCode) || seenDocs.has(meta.docID)) throw new Error("同一企業/書類の複数候補は明示的に1つへ絞ってください");
        seenCodes.add(meta.secCode); seenDocs.add(meta.docID);
        if (cohortKey(meta) !== cohortKey(metadata[0])) throw new Error("範囲・基準・通貨・対象期間・期間分類の混在は比較しません");
    }
    const required = new Set<FinancialDetailMetricId>([...conditions.map(c => c.metric), ...(options.sortBy ? [options.sortBy] : [])]);
    if (new Set([...required].map(id => FINANCIAL_DETAIL_REGISTRY[id].periodType)).size > 1 || metadata[0] && [...required].some(id => FINANCIAL_DETAIL_REGISTRY[id].periodType !== periodKind(metadata[0]))) throw new Error("検索項目の期間型が対象と異なります");
    if (!required.size && metadata[0]) ids.filter(id => FINANCIAL_DETAIL_REGISTRY[id].periodType === periodKind(metadata[0])).forEach(id => required.add(id));
    const diagnostics: FinancialDetailDiagnostic[] = [], reasonCounts: FinancialDetailScreeningResult["reasonCounts"] = { missing:0, unsupported:0, ambiguous:0,"unsafe-number":0 };
    const rows: FinancialDetailSnapshot[] = []; let excludedRows = 0, filteredRows = 0;
    const compare = (a: number, operator: ComparisonOperator, b: number) => operator === "gte" ? a >= b : operator === "lte" ? a <= b : operator === "gt" ? a > b : operator === "lt" ? a < b : a === b;
    for (let i = 0; i < documents.length; i++) {
        const row = createFinancialDetailSnapshot(documents[i].xml, metadata[i]); let unavailable = false;
        for (const id of ids) {
            const selection = row.selections[id]; if (!selection) continue;
            const reason = selection.status !== "selected" ? selection.status : selection.safeNumber === undefined ? "unsafe-number" : undefined;
            if (reason) { diagnostics.push({ secCode:row.metadata.secCode,docID:row.metadata.docID,metric:id,reason,selectionReason:selection.reason,required:required.has(id) }); reasonCounts[reason]++; if (required.has(id)) unavailable = true; }
        }
        if (unavailable) { excludedRows++; continue; }
        if (!conditions.every(c => compare(row.selections[c.metric]!.safeNumber!,c.operator,c.value))) { filteredRows++; continue; }
        rows.push(row);
    }
    rows.sort((a,b) => (options.sortBy ? (a.selections[options.sortBy]!.safeNumber! - b.selections[options.sortBy]!.safeNumber!) * (options.order === "asc" ? 1 : -1) : 0) ||
        (a.metadata.secCode < b.metadata.secCode ? -1 : a.metadata.secCode > b.metadata.secCode ? 1 : a.metadata.docID < b.metadata.docID ? -1 : a.metadata.docID > b.metadata.docID ? 1 : 0));
    diagnostics.sort((a,b)=>a.secCode < b.secCode ? -1 : a.secCode > b.secCode ? 1 : ids.indexOf(a.metric)-ids.indexOf(b.metric));
    const offset=options.offset??0;
    return { rows:rows.slice(offset,options.limit===undefined?undefined:offset+options.limit),total:rows.length,excludedRows,filteredRows,diagnostics,reasonCounts };
}
