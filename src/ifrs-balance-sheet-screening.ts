import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { IfrsBalanceSheetMetricId, DEFAULT_IFRS_BALANCE_SHEET_METRICS } from "./ifrs-balance-sheet-registry";
import type { FactSelectionResult, SelectionReason } from "./metric-selection";
import { ComparisonOperator, SortOrder } from "./financial-options";

/** 手元の明示集合向け。全市場の性能・容量を保証する上限ではありません。 */
export const IFRS_BALANCE_SHEET_SCREENING_MAX_DOCUMENTS = 100;
export const IFRS_BALANCE_SHEET_SCREENING_MAX_CONDITIONS = 100;
export interface IfrsBalanceSheetMetadata {
    secCode: string; docID: string; instant: string;
    scope: "Consolidated"; accountingStandard: "IFRS"; currency: "JPY";
}
export interface IfrsBalanceSheetDocument { xml: string; metadata: IfrsBalanceSheetMetadata; }
export interface IfrsBalanceSheetSnapshot {
    metadata: IfrsBalanceSheetMetadata;
    selections: Record<typeof DEFAULT_IFRS_BALANCE_SHEET_METRICS[number], FactSelectionResult<IfrsBalanceSheetMetricId>> &
        Partial<Record<IfrsBalanceSheetMetricId, FactSelectionResult<IfrsBalanceSheetMetricId>>>;
    /** 解析に使ったXML文字列のUTF-8表現。原本真正性や申告docIDとの対応は証明しません。 */
    inputXmlSha256: string;
}
export interface IfrsBalanceSheetCondition { metric: IfrsBalanceSheetMetricId; operator: ComparisonOperator; value: number; }
export interface IfrsBalanceSheetScreeningOptions {
    metricIds?: readonly IfrsBalanceSheetMetricId[]; conditions?: readonly IfrsBalanceSheetCondition[]; sortBy?: IfrsBalanceSheetMetricId; order?: SortOrder; offset?: number; limit?: number;
}
export interface IfrsBalanceSheetDiagnostic {
    secCode: string; docID: string; metric: IfrsBalanceSheetMetricId;
    reason: "missing" | "unsupported" | "ambiguous" | "unsafe-number";
    selectionReason: SelectionReason; required: boolean;
}
export interface IfrsBalanceSheetScreeningResult {
    rows: IfrsBalanceSheetSnapshot[];
    /** ページ指定前の条件一致数。 */
    total: number; excludedRows: number; filteredRows: number;
    diagnostics: IfrsBalanceSheetDiagnostic[];
    /** 除外行数ではなく、指定項目それぞれの診断件数。 */
    reasonCounts: Record<IfrsBalanceSheetDiagnostic["reason"], number>;
}
const ids = Object.values(IfrsBalanceSheetMetricId);
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const known = (value: unknown): value is IfrsBalanceSheetMetricId => typeof value === "string" && ids.includes(value as IfrsBalanceSheetMetricId);
const compare = (left: string | number, right: string | number): number => left < right ? -1 : left > right ? 1 : 0;
function flat(value: unknown, allowed: readonly string[]): Record<string, unknown> {
    if (!record(value)) throw new Error("未知項目または不正なIFRS検索入力です");
    const keys = Object.keys(value);
    if (keys.some(key => !allowed.includes(key))) throw new Error("未知項目または不正なIFRS検索入力です");
    const captured: Record<string, unknown> = {};
    for (const key of keys) captured[key] = value[key];
    return captured;
}
/** 長さと各indexだけを一度読み、独自iteratorや疎配列で検査対象を変えません。 */
function array(value: unknown, limit: number): unknown[] {
    if (!Array.isArray(value)) throw new Error("配列が必要です");
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > limit) throw new Error(`明示集合/条件は${limit}件以下です`);
    return Array.from({ length }, (_, index) => {
        if (!Object.hasOwn(value, index)) throw new Error("疎配列は使えません");
        return value[index];
    });
}
function metadata(value: unknown): IfrsBalanceSheetMetadata {
    const m = flat(value, ["secCode", "docID", "instant", "scope", "accountingStandard", "currency"]);
    if (typeof m.secCode !== "string" || !/^[0-9A-Z]{4}0?$/.test(m.secCode) || typeof m.docID !== "string" || !m.docID.trim() || /[\x00-\x1f\x7f]/.test(m.docID) ||
        typeof m.instant !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(m.instant) || !Number.isFinite(Date.parse(m.instant)) || new Date(m.instant).toISOString().slice(0, 10) !== m.instant ||
        m.scope !== "Consolidated" || m.accountingStandard !== "IFRS" || m.currency !== "JPY") throw new Error("IFRS/連結/JPYと正しい会社・書類・期末を明示してください");
    return { secCode: m.secCode.length === 4 ? m.secCode + "0" : m.secCode, docID: m.docID, instant: m.instant,
        scope: "Consolidated", accountingStandard: "IFRS", currency: "JPY" };
}
function projection(value: unknown): IfrsBalanceSheetMetricId[] {
    const chosen = array(value === undefined ? DEFAULT_IFRS_BALANCE_SHEET_METRICS : value, ids.length);
    if (!chosen.length || chosen.some(id => !known(id)) || new Set(chosen).size !== chosen.length) throw new Error("IFRS貸借対照表は既知の重複しない項目を明示してください");
    return [...new Set<IfrsBalanceSheetMetricId>([...DEFAULT_IFRS_BALANCE_SHEET_METRICS, ...chosen as IfrsBalanceSheetMetricId[]])];
}
function options(value: IfrsBalanceSheetScreeningOptions): Required<Pick<IfrsBalanceSheetScreeningOptions, "conditions" | "metricIds">> & Omit<IfrsBalanceSheetScreeningOptions, "conditions"> {
    const o = flat(value, ["metricIds", "conditions", "sortBy", "order", "offset", "limit"]);
    const conditions = array(o.conditions === undefined ? [] : o.conditions, IFRS_BALANCE_SHEET_SCREENING_MAX_CONDITIONS).map(value => {
        const c = flat(value, ["metric", "operator", "value"]);
        if (!known(c.metric) || !Object.values(ComparisonOperator).includes(c.operator as ComparisonOperator) || typeof c.value !== "number" || !Number.isFinite(c.value) || Math.abs(c.value) > Number.MAX_SAFE_INTEGER) throw new Error("IFRS直接項目の正しい数値条件が必要です");
        return { metric: c.metric, operator: c.operator as ComparisonOperator, value: c.value };
    });
    if (o.sortBy !== undefined && !known(o.sortBy) || o.order !== undefined && !Object.values(SortOrder).includes(o.order as SortOrder)) throw new Error("不正なIFRS並べ替え設定です");
    for (const v of [o.offset, o.limit]) if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    return { conditions, metricIds: projection(o.metricIds), ...(o.sortBy === undefined ? {} : { sortBy: o.sortBy as IfrsBalanceSheetMetricId }), ...(o.order === undefined ? {} : { order: o.order as SortOrder }),
        ...(o.offset === undefined ? {} : { offset: o.offset as number }), ...(o.limit === undefined ? {} : { limit: o.limit as number }) };
}
function createCaptured(xml: string, m: IfrsBalanceSheetMetadata, selectedIds: readonly IfrsBalanceSheetMetricId[]): IfrsBalanceSheetSnapshot {
    if (typeof xml !== "string") throw new Error("XML文字列が必要です");
    // XML構文/DOCTYPE/容量の検査はparserへ集約し、その事前guardより先に再検証しません。
    const object = new EdinetXbrlParser().parse(xml, m.docID);
    const selections = {} as IfrsBalanceSheetSnapshot["selections"];
    for (const id of selectedIds) selections[id] = object.selectIfrsBalanceSheetMetric(id, { accountingStandard: "IFRS", scope: "Consolidated", period: { instant: m.instant } });
    return structuredClone({ metadata: m, selections, inputXmlSha256: createHash("sha256").update(xml).digest("hex") });
}
/** 専用IFRS snapshot。J-GAAP snapshotへ型変換せず、同じXML文字列を解析/hashに使います。 */
export function createIfrsBalanceSheetSnapshot(xml: string, inputMetadata: IfrsBalanceSheetMetadata, metricIds?: readonly IfrsBalanceSheetMetricId[]): IfrsBalanceSheetSnapshot {
    return createCaptured(xml, metadata(inputMetadata), projection(metricIds));
}

/** 同一期末の明示原本集合だけをメモリ検索。最新採用・比率計算・DB保存はしません。 */
export function screenIfrsBalanceSheetDocuments(documents: readonly IfrsBalanceSheetDocument[], inputOptions: IfrsBalanceSheetScreeningOptions = {}): IfrsBalanceSheetScreeningResult {
    const settings = options(inputOptions);
    const required = new Set<IfrsBalanceSheetMetricId>([...settings.conditions.map(c => c.metric), ...(settings.sortBy ? [settings.sortBy] : [])]);
    if ([...required].some(id => !settings.metricIds.includes(id))) throw new Error("条件/並びの項目をmetricIdsへ明示してください");
    if (!required.size) settings.metricIds.forEach(id => required.add(id));
    // 全metadataを先に固定し、XML getterによる他社の範囲変更を持ち込みません。
    const captured = array(documents, IFRS_BALANCE_SHEET_SCREENING_MAX_DOCUMENTS).map(value => {
        if (!record(value) || Object.keys(value).some(key => !["xml", "metadata"].includes(key)) || !Object.hasOwn(value, "xml") || !Object.hasOwn(value, "metadata")) throw new Error("xmlとmetadataを指定してください");
        const m = value.metadata;
        return { document: value, metadata: metadata(m) };
    });
    const codes = new Set<string>(), docs = new Set<string>();
    for (const row of captured) {
        const m = row.metadata;
        if (codes.has(m.secCode) || docs.has(m.docID)) throw new Error("同一企業/書類の複数候補は自動選択しません");
        codes.add(m.secCode); docs.add(m.docID);
        if (m.instant !== captured[0].metadata.instant) throw new Error("企業間で期末が混在しています");
    }
    const snapshots = captured.map(row => { const xml = row.document.xml; return createCaptured(xml as string, row.metadata, settings.metricIds); });
    const entities = new Map<string, string>();
    for (const row of snapshots) for (const selection of Object.values(row.selections)) for (const item of selection.evidence) if (item.entity) {
        const key = JSON.stringify([item.entity.scheme, item.entity.identifier]), previous = entities.get(key);
        if (previous !== undefined && previous !== row.metadata.secCode) throw new Error("同一entityを別企業コードに使用できません");
        entities.set(key, row.metadata.secCode);
    }
    const rows: IfrsBalanceSheetSnapshot[] = [], diagnostics: IfrsBalanceSheetDiagnostic[] = [];
    const reasonCounts: IfrsBalanceSheetScreeningResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
    let excludedRows = 0, filteredRows = 0;
    for (const row of snapshots) {
        let unavailable = false;
        for (const id of settings.metricIds) {
            const selection = row.selections[id]!, reason = selection.status !== "selected" ? selection.status : selection.safeNumber === undefined ? "unsafe-number" : undefined;
            if (reason) {
                diagnostics.push({ secCode: row.metadata.secCode, docID: row.metadata.docID, metric: id, reason, selectionReason: selection.reason, required: required.has(id) });
                reasonCounts[reason]++; if (required.has(id)) unavailable = true;
            }
        }
        if (unavailable) { excludedRows++; continue; }
        const matches = settings.conditions.every(c => {
            const difference = compare(row.selections[c.metric]!.safeNumber!, c.value);
            return c.operator === "gte" ? difference >= 0 : c.operator === "lte" ? difference <= 0 : c.operator === "gt" ? difference > 0 : c.operator === "lt" ? difference < 0 : difference === 0;
        });
        if (matches) rows.push(row); else filteredRows++;
    }
    rows.sort((left, right) => (settings.sortBy ? compare(left.selections[settings.sortBy]!.safeNumber!, right.selections[settings.sortBy]!.safeNumber!) * (settings.order === "asc" ? 1 : -1) : 0) ||
        compare(left.metadata.secCode, right.metadata.secCode) || compare(left.metadata.docID, right.metadata.docID));
    diagnostics.sort((left, right) => compare(left.secCode, right.secCode) || ids.indexOf(left.metric) - ids.indexOf(right.metric));
    const offset = settings.offset ?? 0;
    return structuredClone({ rows: rows.slice(offset, settings.limit === undefined ? undefined : offset + settings.limit), total: rows.length, excludedRows, filteredRows, diagnostics, reasonCounts });
}
