import { validateAnnualBalanceMetadata } from "./annual-balance-return-core";
import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import type { AnnualCoreDocument } from "./annual-growth-core";
import { MetricId } from "./metric-registry";
import type { FactSelectionResult } from "./metric-selection";
import { compareFractions, decimalFraction, reduceFraction } from "./decimal-fraction";
import { ComparisonOperator, SortOrder } from "./financial-options";

export const AverageAssetsReturnMetricId = Object.freeze({ NetIncome: "netIncomeToAverageAssets", OperatingIncome: "operatingIncomeToAverageAssets", OrdinaryIncome: "ordinaryIncomeToAverageAssets" } as const);
export type AverageAssetsReturnMetricId = typeof AverageAssetsReturnMetricId[keyof typeof AverageAssetsReturnMetricId];
const sources = { netIncomeToAverageAssets: MetricId.NetIncome, operatingIncomeToAverageAssets: MetricId.OperatingIncome, ordinaryIncomeToAverageAssets: MetricId.OrdinaryIncome } as const;
export interface AverageAssetsReturnInput {
    income: AnnualCoreDocument;
    opening: { xml: string; metadata: Extract<FinancialDetailMetadata, { period: { instant: string } }> };
    closing: { xml: string; metadata: Extract<FinancialDetailMetadata, { period: { instant: string } }> };
}
interface ReturnPoint { metadata: FinancialDetailMetadata; selection: FactSelectionResult; inputXmlSha256: string; }
export type AverageAssetsReturnUnavailableReason = "incompatible-metadata" | "unsupported-standard" | "not-annual" | "unsupported-annual-period" |
    "balance-date-mismatch" | "unavailable-input" | "incompatible-entity" | "unsafe-input" | "negative-assets" | "zero-average-assets" | "unsafe-result";
type ReturnBase = { metricId: AverageAssetsReturnMetricId; unit: "ratio"; income: ReturnPoint; opening: ReturnPoint; closing: ReturnPoint };
export type AverageAssetsReturnResult = ReturnBase & ({ status: "calculated"; reason: "calculated"; value: number; exact: { numerator: string; denominator: string } } |
    { status: "unavailable"; reason: AverageAssetsReturnUnavailableReason; value?: never; exact?: never });
/** 明示した利益÷(期首総資産+期末総資産)/2。期末だけで補完せず、掲載ROA/ROEと混同しません。 */
export function calculateAverageAssetsReturn(input: AverageAssetsReturnInput, metricId: AverageAssetsReturnMetricId): AverageAssetsReturnResult {
    if (!Object.hasOwn(sources, metricId) || !input || typeof input !== "object" || Object.keys(input).some(key => !["income", "opening", "closing"].includes(key))) throw new Error("利益・期首/期末資産と既知の算式を指定してください");
    const capture = (document: { xml: string; metadata: FinancialDetailMetadata }) => {
        if (!document || typeof document !== "object" || Object.keys(document).some(key => !["xml", "metadata"].includes(key))) throw new Error("xml/metadataが必要です");
        const metadata = normalizeFinancialDetailMetadata(document.metadata), xml = document.xml;
        if (typeof xml !== "string") throw new Error("XML文字列が必要です");
        return { metadata, xml };
    };
    const captured = { income: capture(input.income), opening: capture(input.opening), closing: capture(input.closing) };
    const point = (document: typeof captured.income, metric: MetricId): ReturnPoint => ({ metadata: document.metadata,
        selection: new EdinetXbrlParser().parse(document.xml, document.metadata.docID).selectMetric(metric, {
            accountingStandard: document.metadata.accountingStandard, scope: document.metadata.scope, period: document.metadata.period }),
        inputXmlSha256: createHash("sha256").update(document.xml).digest("hex") });
    const income = point(captured.income, sources[metricId]), opening = point(captured.opening, MetricId.TotalAssets), closing = point(captured.closing, MetricId.TotalAssets);
    const base: ReturnBase = { metricId, unit: "ratio", income, opening, closing };
    const unavailable = (reason: AverageAssetsReturnUnavailableReason): AverageAssetsReturnResult => ({ ...base, status: "unavailable", reason });
    const metadataReason = validateAnnualBalanceMetadata(income.metadata, opening.metadata, closing.metadata);
    if (metadataReason) return unavailable(metadataReason);
    for (const p of [income, opening, closing]) {
        if (p.selection.status !== "selected") return unavailable("unavailable-input");
        const entity = income.selection.source?.entity, other = p.selection.source.entity;
        if (!entity || !other || entity.scheme !== other.scheme || entity.identifier !== other.identifier) return unavailable("incompatible-entity");
        if (p.selection.safeNumber === undefined) return unavailable("unsafe-input");
    }
    const profit = income.selection.safeNumber!, a = opening.selection.safeNumber!, b = closing.selection.safeNumber!;
    if (a < 0 || b < 0) return unavailable("negative-assets");
    if (a === 0 && b === 0) return unavailable("zero-average-assets");
    const p = decimalFraction(profit), x = decimalFraction(a), y = decimalFraction(b);
    const exact = reduceFraction(2n * p.numerator * x.denominator * y.denominator, p.denominator * (x.numerator * y.denominator + y.numerator * x.denominator));
    const value = Number(exact.numerator) / Number(exact.denominator);
    if (!Number.isFinite(value) || value === 0 && exact.numerator !== 0n || Math.abs(value) > Number.MAX_SAFE_INTEGER) return unavailable("unsafe-result");
    return { ...base, status: "calculated", reason: "calculated", value, exact: { numerator: String(exact.numerator), denominator: String(exact.denominator) } };
}
export interface AverageAssetsReturnOptions { conditions?: readonly { operator: ComparisonOperator; value: number }[]; order?: SortOrder; offset?: number; limit?: number; }
export function screenAverageAssetsReturn(inputs: readonly AverageAssetsReturnInput[], metricId: AverageAssetsReturnMetricId, options: AverageAssetsReturnOptions = {}) {
    if (!Array.isArray(inputs) || !Object.hasOwn(sources, metricId) || !options || typeof options !== "object" || Object.keys(options).some(key => !["conditions", "order", "offset", "limit"].includes(key))) throw new Error("不正な平均資産利益率検索です");
    const { conditions: raw = [], order = "desc", offset = 0, limit } = options;
    if (!Array.isArray(raw) || !Object.values(SortOrder).includes(order) || [offset, limit].some(v => v !== undefined && (!Number.isSafeInteger(v) || v < 0))) throw new Error("不正な検索条件/ページです");
    const conditions = Array.from(raw, c => {
        if (!c || typeof c !== "object" || Object.keys(c).some(key => !["operator", "value"].includes(key))) throw new Error("不正な比較条件です");
        const { operator, value } = c;
        if (!Object.values(ComparisonOperator).includes(operator) || !Number.isFinite(value)) throw new Error("有限の比較値が必要です");
        return { operator, value };
    });
    const results = Array.from(inputs, input => calculateAverageAssetsReturn(input, metricId)), codes = new Set<string>(), documents = new Map<string, string>();
    const cohort = (r: AverageAssetsReturnResult) => JSON.stringify([r.income, r.opening, r.closing].map(p => [p.metadata.scope, p.metadata.currency, p.metadata.accountingStandard, p.metadata.periodType, p.metadata.period]));
    for (const r of results) {
        const code = r.income.metadata.secCode;
        if (codes.has(code) || cohort(r) !== cohort(results[0])) throw new Error("企業/期間/基準/範囲が混在しています");
        codes.add(code);
        for (const p of [r.income, r.opening, r.closing]) {
            if (documents.has(p.metadata.docID) && documents.get(p.metadata.docID) !== code) throw new Error("別企業の書類IDを再使用できません");
            documents.set(p.metadata.docID, code);
        }
    }
    const excluded = results.filter((r): r is Extract<AverageAssetsReturnResult, { status: "unavailable" }> => r.status === "unavailable");
    const selected = results.filter((r): r is Extract<AverageAssetsReturnResult, { status: "calculated" }> => r.status === "calculated");
    const fraction = (r: typeof selected[number]) => ({ numerator: BigInt(r.exact.numerator), denominator: BigInt(r.exact.denominator) });
    const rows = selected.filter(r => conditions.every(c => { const d = compareFractions(fraction(r), decimalFraction(c.value)); return c.operator === "gte" ? d >= 0 : c.operator === "lte" ? d <= 0 : c.operator === "gt" ? d > 0 : c.operator === "lt" ? d < 0 : d === 0; }));
    rows.sort((a, b) => compareFractions(fraction(a), fraction(b)) * (order === "asc" ? 1 : -1) ||
        (a.income.metadata.secCode < b.income.metadata.secCode ? -1 : a.income.metadata.secCode > b.income.metadata.secCode ? 1 : 0));
    return { rows: rows.slice(offset, limit === undefined ? undefined : offset + limit), excluded, total: rows.length, excludedRows: excluded.length, filteredRows: selected.length - rows.length };
}
