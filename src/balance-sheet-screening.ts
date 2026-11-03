import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import type { EdinetXbrlObject } from "./edinet-xbrl-object";
import { BALANCE_SHEET_REGISTRY, BalanceSheetMetricId } from "./balance-sheet-registry";
import { FactSelectionResult, MetricSelectionOptions, identicalMetricFacts, toSafeMetricNumber } from "./metric-selection";
import { compareFractions, decimalFraction, reduceFraction, type DecimalFraction } from "./decimal-fraction";

/** 検索項目の補完用定数。金額3項目の辞書は変更せず、計算値を別項目として扱います。 */
export const BalanceSheetScreeningMetric = Object.freeze({
    CurrentAssets: "currentAssets", CurrentLiabilities: "currentLiabilities",
    TotalLiabilities: "totalLiabilities", CurrentRatio: "currentRatio"
} as const);
export type BalanceSheetScreeningMetric = typeof BalanceSheetScreeningMetric[keyof typeof BalanceSheetScreeningMetric];

export const CURRENT_RATIO_DEFINITION = Object.freeze({
    id: "currentRatio", unit: "ratio", periodType: "instant", formula: "currentAssets / currentLiabilities",
    inputs: Object.freeze(["currentAssets", "currentLiabilities"] as const)
} as const);

export interface BalanceSheetSnapshotMetadata {
    secCode: string;
    docID: string;
    instant: string;
    scope: MetricSelectionOptions["scope"];
    accountingStandard: "J-GAAP";
    currency: "JPY";
}
export interface BalanceSheetSnapshot extends BalanceSheetSnapshotMetadata {
    selections: Record<BalanceSheetMetricId, FactSelectionResult<BalanceSheetMetricId>>;
}
export interface BalanceSheetCondition {
    metric: BalanceSheetScreeningMetric;
    operator: "gte" | "lte" | "gt" | "lt" | "eq";
    value: number;
}
export interface BalanceSheetScreeningOptions {
    conditions?: readonly BalanceSheetCondition[];
    sortBy?: BalanceSheetScreeningMetric;
    order?: "asc" | "desc";
    offset?: number;
    limit?: number;
}
export interface BalanceSheetDiagnostic {
    secCode: string;
    docID: string;
    metric: BalanceSheetScreeningMetric;
    reason: "missing" | "unsupported" | "ambiguous" | "unsafe-number";
    selectionReason: string;
    /** この検索の必要指標かどうか。不要指標の欠損だけでは行を除外しません。 */
    required: boolean;
}
export interface BalanceSheetScreeningResult {
    rows: BalanceSheetScreeningRow[];
    /** 条件一致後・ページング前の件数。 */
    total: number;
    excludedRows: number;
    filteredRows: number;
    diagnostics: BalanceSheetDiagnostic[];
    /** 行数ではなく指標診断の件数。 */
    reasonCounts: Record<BalanceSheetDiagnostic["reason"], number>;
}
export type CurrentRatioUnavailableReason = "missing-input" | "ambiguous-input" | "unsupported-input" |
    "unsafe-input" | "zero-denominator" | "negative-input" | "unsafe-result";
export type CurrentRatioResult = {
    metricId: "currentRatio";
    /** 小数。1=100%、2=200%。元金額の報告精度を高める計算ではありません。 */
    unit: "ratio";
    inputs: Pick<BalanceSheetSnapshot["selections"], "currentAssets" | "currentLiabilities">;
} & ({ status: "calculated"; reason: "calculated"; value: number;
    /** 報告された十進値の商。表示用valueと異なり、検索・並べ替えに使う約分済み分数。 */
    exact: { numerator: string; denominator: string } } |
    { status: "unavailable"; reason: CurrentRatioUnavailableReason; value?: never; exact?: never });
export interface BalanceSheetScreeningRow extends BalanceSheetSnapshot {
    /** currentRatioを条件・sortで要求した場合だけ付与。入力の計算済み値は使わず再計算します。 */
    derivedMetrics?: { currentRatio: CurrentRatioResult };
}
const ids = Object.keys(BALANCE_SHEET_REGISTRY) as BalanceSheetMetricId[];
const metricSet = new Set<string>(Object.values(BalanceSheetScreeningMetric));
const operators = new Set(["gte", "lte", "gt", "lt", "eq"]);
const reasons = new Set(["selected", "selected-raw-only", "selected-identical-duplicates", "tag-absent", "context-mismatch", "nil", "unsupported-standard", "unsupported-semantics", "unknown-namespace", "unknown-context", "unsupported-dimensions", "unsupported-context", "unsupported-entity", "unsupported-unit", "invalid-decimal", "invalid-decimals", "raw-unavailable", "duplicate-context", "multiple-facts", "invalid-period"]);
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validDate = (date: unknown): date is string => typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(date)) && new Date(date).toISOString().slice(0, 10) === date;
const code = (value: unknown): string => {
    if (typeof value !== "string" || !/^[0-9A-Z]{4}0?$/.test(value)) throw new Error("不正な証券コードです");
    return value.length === 4 ? `${value}0` : value;
};
function validateMetadata(meta: unknown): asserts meta is BalanceSheetSnapshotMetadata {
    if (!record(meta) || !text(meta.docID) || !validDate(meta.instant) || !["Consolidated", "NonConsolidated"].includes(meta.scope) ||
        meta.accountingStandard !== "J-GAAP" || meta.currency !== "JPY") throw new Error("不正なBS snapshotメタデータです");
    code(meta.secCode);
}

/** XML文字列または解析済みobjectから、3科目を共通の厳密選択器で取得します。 */
export function createBalanceSheetSnapshot(input: string | EdinetXbrlObject, metadata: BalanceSheetSnapshotMetadata): BalanceSheetSnapshot {
    validateMetadata(metadata);
    const object = typeof input === "string" ? new EdinetXbrlParser().parse(input, metadata.docID) : input;
    if (!object || typeof object.selectBalanceSheetMetric !== "function") throw new Error("XMLまたはEdinetXbrlObjectが必要です");
    const knownDocID = object.getCommonMetadata().docID;
    if (knownDocID && knownDocID !== metadata.docID) throw new Error("objectとsnapshotのdocIDが一致しません");
    const selections = Object.fromEntries(ids.map(id => [id, object.selectBalanceSheetMetric(id, {
        accountingStandard: metadata.accountingStandard, scope: metadata.scope, period: { instant: metadata.instant }
    })])) as BalanceSheetSnapshot["selections"];
    return { ...metadata, secCode: code(metadata.secCode), selections };
}

/** QNameのURIはserialized証跡だけでは復元しない。原本helperのstrict検証とは区別します。 */
function dimensionState(e: Record<string, any>): { consistent: boolean; aggregate: boolean } {
    if (!record(e.rawDimensions) || !Array.isArray(e.dimensions)) return { consistent: false, aggregate: false };
    const members: { axis: string; member: string }[] = [];
    let known = Object.keys(e.rawDimensions).every(k => ["scenario", "segment"].includes(k));
    for (const part of [e.rawDimensions.scenario, e.rawDimensions.segment]) {
        if (part === undefined) continue;
        if (!record(part)) { known = false; continue; }
        if (Object.keys(part).some(k => k !== "xbrldi:explicitMember")) known = false;
        const list = part["xbrldi:explicitMember"];
        for (const member of list === undefined ? [] : Array.isArray(list) ? list : [list]) {
            if (!record(member) || typeof member["#text"] !== "string" || typeof member["@_dimension"] !== "string") { known = false; continue; }
            members.push({ axis: member["@_dimension"].split(":").pop()!, member: member["#text"].split(":").pop()! });
        }
    }
    const names = members.map(m => m.member).sort();
    const consistent = JSON.stringify(names) === JSON.stringify([...e.dimensions].sort());
    const aggregate = known && consistent && (e.scope === "Consolidated" ? members.length === 0 : members.length === 1 &&
        members[0].axis === "ConsolidatedOrNonConsolidatedAxis" && members[0].member === "NonConsolidatedMember");
    return { consistent, aggregate };
}
const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => record(item)
    ? Object.fromEntries(Object.keys(item).sort().filter(k => item[k] !== undefined).map(k => [k, item[k]])) : item);

/** selectedのラベルだけで信用せず、原decimal・来歴・メタデータの整合を確認します。 */
function validateSnapshot(row: BalanceSheetSnapshot): void {
    validateMetadata(row);
    if (!record(row.selections) || Object.keys(row.selections).length !== ids.length || ids.some(id => !record(row.selections[id]))) throw new Error("BS3科目の選択結果が必要です");
    const entities = new Set<string>();
    for (const id of ids) {
        const result = row.selections[id];
        if (result.metricId !== id || !reasons.has(result.reason) || !Array.isArray(result.evidence)) throw new Error("不正なBS選択結果です");
        if (result.status !== "selected") {
            if (!["missing", "unsupported", "ambiguous"].includes(result.status) || result.raw !== undefined || result.safeNumber !== undefined || result.source !== undefined ||
                !({ missing: ["tag-absent", "context-mismatch", "nil"], ambiguous: ["duplicate-context", "multiple-facts"], unsupported: [...reasons].filter(r => !["selected", "selected-raw-only", "selected-identical-duplicates", "tag-absent", "context-mismatch", "nil", "duplicate-context", "multiple-facts"].includes(r)) }[result.status] ?? []).includes(result.reason)) throw new Error("不正な非採用結果です");
            if (result.evidence.some(e => !record(e) || !reasons.has(e.reason))) throw new Error("不正な非採用証跡です");
            const evidence = result.evidence;
            const positive = evidence.filter(e => e.reason === "selected" || e.reason === "selected-raw-only");
            if (result.status !== "ambiguous" && positive.length) throw new Error("採用可能な証跡と非採用statusが矛盾しています");
            if (result.reason === "tag-absent" ? evidence.length !== 0 : result.reason === "context-mismatch" ? !evidence.length || evidence.some(e => e.reason !== "context-mismatch") :
                result.reason === "multiple-facts" ? evidence.filter(e => !["context-mismatch", "unknown-context", "unsupported-dimensions"].includes(e.reason)).length < 2 :
                !evidence.some(e => e.reason === result.reason && (result.reason !== "nil" || e.nil === true))) throw new Error("非採用理由に対応する証跡がありません");
            continue;
        }
        const source = result.source;
        const definition = BALANCE_SHEET_REGISTRY[id];
        const safe = typeof result.raw === "string" ? toSafeMetricNumber(result.raw) : undefined;
        const selectedReason = safe === undefined ? "selected-raw-only" : "selected", duplicates = result.reason === "selected-identical-duplicates";
        if (row.accountingStandard !== "J-GAAP" || typeof result.raw !== "string" || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(result.raw) ||
            result.safeNumber !== safe || (!duplicates && result.reason !== selectedReason) || !record(source) ||
            source.reason !== selectedReason || source.raw !== result.raw || source.key !== definition.candidates[0].key || source.namespace !== "jppfs_cor" ||
            !/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jppfs\/\d{4}-\d{2}-\d{2}\/jppfs_cor$/.test(source.namespaceURI ?? "") ||
            source.unit !== "iso4217:JPY" || !text(source.unitRef) || !text(source.contextRef) || source.nil !== false ||
            source.scope !== row.scope || !record(source.period) || source.period.instant !== row.instant || source.period.startDate !== undefined || source.period.endDate !== undefined ||
            !record(source.entity) || !text(source.entity.identifier) || !text(source.entity.scheme) ||
            !Array.isArray(source.dimensions) || (row.scope === "Consolidated" ? source.dimensions.length !== 0 : source.dimensions.length !== 1 || source.dimensions[0] !== "NonConsolidatedMember") ||
            source.decimals !== undefined && (typeof source.decimals !== "string" || !/^(?:INF|[+-]?\d+)$/.test(source.decimals))) throw new Error(`BS選択値と来歴が不整合です: ${id}`);
        if (!dimensionState(source).aggregate) throw new Error("採用sourceの元次元とscopeが不整合です");
        if (result.evidence.some(e => record(e) && e.key === source.key && ["unsupported-context", "duplicate-context", "unsupported-entity"].includes(e.reason))) throw new Error("採用を停止するcontext/entity証跡があります");
        const applicable = result.evidence.filter(e => {
            if (!record(e)) throw new Error("不正な選択証跡です");
            if (e.key !== source.key || e.scope !== row.scope || e.period?.instant !== row.instant || e.period.startDate !== undefined || e.period.endDate !== undefined) return false;
            const dimensions = dimensionState(e);
            if (!dimensions.consistent) throw new Error("証跡の元次元とdimensionsが不整合です");
            return dimensions.aggregate;
        });
        if ((duplicates ? applicable.length < 2 || !applicable.every(e => e.reason === selectedReason && e.nil === false && e.namespace === source.namespace && text(e.contextRef) && text(e.unitRef) && identicalMetricFacts(e, source)) : applicable.length !== 1) || canonical(applicable[0]) !== canonical(source)) throw new Error("採用sourceと証跡が不一致、または競合する適合factがあります");
        entities.add(JSON.stringify([source.entity.scheme, source.entity.identifier]));
    }
    if (entities.size > 1) throw new Error("同一snapshotの指標間でentityが混在しています");
}

function currentRatio(row: BalanceSheetSnapshot): CurrentRatioResult {
    const inputs = structuredClone({ currentAssets: row.selections.currentAssets, currentLiabilities: row.selections.currentLiabilities });
    const base = { metricId: "currentRatio" as const, unit: "ratio" as const, inputs };
    const unavailable = (reason: CurrentRatioUnavailableReason): CurrentRatioResult => ({ ...base, status: "unavailable", reason });
    const a = inputs.currentAssets, b = inputs.currentLiabilities;
    for (const input of [a, b]) {
        if (input.status !== "selected") return unavailable(input.status === "missing" ? "missing-input" : input.status === "ambiguous" ? "ambiguous-input" : "unsupported-input");
        if (input.safeNumber === undefined) return unavailable("unsafe-input");
    }
    // 上のループの条件を型にも伝えます。計算前にvalidateSnapshotで来歴を検証済みです。
    if (a.status !== "selected" || b.status !== "selected" || a.safeNumber === undefined || b.safeNumber === undefined) return unavailable("unsafe-input");
    if (a.safeNumber < 0 || b.safeNumber < 0) return unavailable("negative-input");
    if (b.safeNumber === 0) return unavailable("zero-denominator");
    // rawとの十進往復が確認できた短いnumber表記を使い、巨大な0埋め文字列をBigIntへ渡しません。
    const x = decimalFraction(a.safeNumber), y = decimalFraction(b.safeNumber);
    const exact = reduceFraction(x.numerator * y.denominator, x.denominator * y.numerator);
    if (compareFractions(exact, decimalFraction(Number.MAX_SAFE_INTEGER)) > 0) return unavailable("unsafe-result");
    let value = Number(exact.numerator) / Number(exact.denominator);
    // 極端な指数では分数の片側がnumber範囲を超えることがあるため、表示値だけ別経路で近似します。
    if (!Number.isFinite(value) || value === 0 && exact.numerator !== 0n) value = a.safeNumber / b.safeNumber;
    if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER || value === 0 && exact.numerator !== 0n) return unavailable("unsafe-result");
    return { ...base, status: "calculated", reason: "calculated", value,
        exact: { numerator: String(exact.numerator), denominator: String(exact.denominator) } };
}

/** 同一企業・時点・範囲・JPY・J-GAAPの選択済み値だけから計算。2=200%。 */
export function calculateCurrentRatio(row: BalanceSheetSnapshot): CurrentRatioResult {
    validateSnapshot(row);
    return currentRatio(row);
}

const fractionOfRatio = (result: Extract<CurrentRatioResult, { status: "calculated" }>): DecimalFraction =>
    ({ numerator: BigInt(result.exact.numerator), denominator: BigInt(result.exact.denominator) });
const ratioDiagnostic = (reason: CurrentRatioUnavailableReason): BalanceSheetDiagnostic["reason"] =>
    reason === "missing-input" ? "missing" : reason === "ambiguous-input" ? "ambiguous" :
        reason === "unsafe-input" || reason === "unsafe-result" ? "unsafe-number" : "unsupported";

/** 同じ時点/通貨/scope/基準の明示集合を検索。企業ごとのentityの違いは許容します。 */
export function screenBalanceSheetSnapshots(snapshots: readonly BalanceSheetSnapshot[], options: BalanceSheetScreeningOptions = {}): BalanceSheetScreeningResult {
    if (!Array.isArray(snapshots) || !record(options)) throw new Error("snapshots配列と検索optionsが必要です");
    const conditions = options.conditions === undefined ? [] : options.conditions;
    if (!Array.isArray(conditions)) throw new Error("conditionsは配列です");
    for (const c of conditions) if (!record(c) || !metricSet.has(c.metric) || !operators.has(c.operator) || typeof c.value !== "number" || !Number.isFinite(c.value) || Math.abs(c.value) > Number.MAX_SAFE_INTEGER) throw new Error("不正なBS検索条件です");
    if (options.sortBy !== undefined && !metricSet.has(options.sortBy) || options.order !== undefined && !["asc", "desc"].includes(options.order)) throw new Error("不正なBS並べ替えです");
    for (const v of [options.offset, options.limit]) if (v !== undefined && (!Number.isSafeInteger(v) || v < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    const required = new Set<BalanceSheetScreeningMetric>([...conditions.map(c => c.metric), ...(options.sortBy ? [options.sortBy] : [])]);
    if (!required.size) ids.forEach(id => required.add(id));
    const needsRatio = required.has(BalanceSheetScreeningMetric.CurrentRatio);
    if (needsRatio) CURRENT_RATIO_DEFINITION.inputs.forEach(id => required.add(id));
    const seen = new Set<string>(), documents = new Set<string>(), criteria = new Set<string>();
    for (const row of snapshots) {
        validateSnapshot(row);
        const secCode = code(row.secCode);
        if (seen.has(secCode)) throw new Error("同一企業の複数snapshotは指定できません");
        seen.add(secCode);
        if (documents.has(row.docID)) throw new Error("同一docIDの重複snapshotは指定できません");
        documents.add(row.docID);
        criteria.add(JSON.stringify([row.instant, row.currency, row.scope, row.accountingStandard]));
    }
    if (criteria.size > 1) throw new Error("時点・通貨・scope・会計基準が混在しています");
    const diagnostics: BalanceSheetDiagnostic[] = [];
    const reasonCounts: BalanceSheetScreeningResult["reasonCounts"] = { missing: 0, unsupported: 0, ambiguous: 0, "unsafe-number": 0 };
    let excludedRows = 0, filteredRows = 0;
    const rows: BalanceSheetScreeningRow[] = [];
    for (const row of snapshots) {
        let exclude = false;
        for (const id of ids) {
            const selected = row.selections[id];
            const reason: BalanceSheetDiagnostic["reason"] | undefined = selected.status === "selected" ? selected.safeNumber === undefined ? "unsafe-number" : undefined : selected.status;
            if (!reason) continue;
            diagnostics.push({ secCode: code(row.secCode), docID: row.docID, metric: id, reason, selectionReason: selected.reason, required: required.has(id) });
            reasonCounts[reason]++;
            if (required.has(id)) exclude = true;
        }
        const ratio = needsRatio ? currentRatio(row) : undefined;
        if (ratio?.status === "unavailable") {
            const reason = ratioDiagnostic(ratio.reason);
            diagnostics.push({ secCode: code(row.secCode), docID: row.docID, metric: "currentRatio", reason, selectionReason: ratio.reason, required: true });
            reasonCounts[reason]++;
            exclude = true;
        }
        if (exclude) { excludedRows++; continue; }
        if (!conditions.every(c => {
            const comparison = c.metric === "currentRatio"
                ? compareFractions(fractionOfRatio(ratio as Extract<CurrentRatioResult, { status: "calculated" }>), decimalFraction(c.value))
                : row.selections[c.metric].safeNumber! < c.value ? -1 : row.selections[c.metric].safeNumber! > c.value ? 1 : 0;
            return c.operator === "gte" ? comparison >= 0 : c.operator === "lte" ? comparison <= 0 : c.operator === "gt" ? comparison > 0 : c.operator === "lt" ? comparison < 0 : comparison === 0;
        })) { filteredRows++; continue; }
        // 以前の検索結果を再入力しても、古い/改変済みの計算値を返しません。
        const { derivedMetrics: _ignored, ...snapshot } = row as BalanceSheetScreeningRow;
        rows.push(ratio ? { ...snapshot, derivedMetrics: { currentRatio: ratio } } : snapshot);
    }
    rows.sort((a, b) => {
        if (options.sortBy) {
            const comparison = options.sortBy === "currentRatio"
                ? compareFractions(fractionOfRatio(a.derivedMetrics!.currentRatio as Extract<CurrentRatioResult, { status: "calculated" }>), fractionOfRatio(b.derivedMetrics!.currentRatio as Extract<CurrentRatioResult, { status: "calculated" }>))
                : a.selections[options.sortBy].safeNumber! < b.selections[options.sortBy].safeNumber! ? -1 : a.selections[options.sortBy].safeNumber! > b.selections[options.sortBy].safeNumber! ? 1 : 0;
            if (comparison) return comparison * (options.order === "asc" ? 1 : -1);
        }
        return code(a.secCode) < code(b.secCode) ? -1 : code(a.secCode) > code(b.secCode) ? 1 : a.docID < b.docID ? -1 : a.docID > b.docID ? 1 : 0;
    });
    const diagnosticOrder = Object.values(BalanceSheetScreeningMetric) as BalanceSheetScreeningMetric[];
    diagnostics.sort((a, b) => a.secCode < b.secCode ? -1 : a.secCode > b.secCode ? 1 : diagnosticOrder.indexOf(a.metric) - diagnosticOrder.indexOf(b.metric));
    const offset = options.offset ?? 0;
    return { rows: rows.slice(offset, options.limit === undefined ? undefined : offset + options.limit).map(row => ({ ...structuredClone(row), secCode: code(row.secCode) })), total: rows.length, excludedRows, filteredRows, diagnostics, reasonCounts };
}
