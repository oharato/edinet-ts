import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import { validateAnnualBalanceMetadata, type AnnualBalanceMetadataReason } from "./annual-balance-return-core";
import type { AverageAssetsReturnInput, AverageAssetsReturnOptions } from "./average-assets-return";
import { MetricId } from "./metric-registry";
import { FinancialDetailMetricId } from "./financial-detail-registry";
import type { FactSelectionResult } from "./metric-selection";
import { compareFractions, decimalFraction, reduceFraction } from "./decimal-fraction";
import { ComparisonOperator, SortOrder } from "./financial-options";
export type AverageEquityReturnInput = AverageAssetsReturnInput;
interface IncomePoint { metadata: FinancialDetailMetadata; selection: FactSelectionResult; inputXmlSha256: string; }
interface EquityPoint { metadata: FinancialDetailMetadata; shareholdersEquity: FactSelectionResult<FinancialDetailMetricId>;
    valuationAndTranslationAdjustments: FactSelectionResult<FinancialDetailMetricId>; inputXmlSha256: string; }
interface ExactRatio { numerator: string; denominator: string; }
interface EquityReturnBase { metricId: "netIncomeToAverageEquity"; unit: "ratio"; income: IncomePoint; opening: EquityPoint; closing: EquityPoint; }
export type AverageEquityReturnReason = AnnualBalanceMetadataReason | "unavailable-input" | "unsafe-input" | "incompatible-entity" | "nonpositive-average-equity" | "unsafe-result";
export type AverageEquityReturnResult = EquityReturnBase & ({ status: "calculated"; reason: "calculated"; value: number; exact: ExactRatio; openingEquity: ExactRatio; closingEquity: ExactRatio } |
    { status: "unavailable"; reason: AverageEquityReturnReason });
/** 親会社利益÷平均(株主資本+評価換算差額等)。掲載ROEや純資産を分母にした率とは別IDです。 */
export function calculateAverageEquityReturn(input: AverageEquityReturnInput): AverageEquityReturnResult {
    if (!input || typeof input !== "object" || Object.keys(input).some(k => !["income", "opening", "closing"].includes(k))) throw new Error("利益・期首/期末原本が必要です");
    const capture = (document: { xml: string; metadata: FinancialDetailMetadata }) => {
        if (!document || typeof document !== "object" || Object.keys(document).some(k => !["xml", "metadata"].includes(k))) throw new Error("xml/metadataが必要です");
        const metadata = normalizeFinancialDetailMetadata(document.metadata), xml = document.xml;
        if (typeof xml !== "string") throw new Error("XML文字列が必要です");
        return { metadata, object: new EdinetXbrlParser().parse(xml, metadata.docID), inputXmlSha256: createHash("sha256").update(xml).digest("hex") };
    };
    const a = capture(input.income), b = capture(input.opening), c = capture(input.closing);
    const income: IncomePoint = { metadata: a.metadata, inputXmlSha256: a.inputXmlSha256, selection: a.object.selectMetric(MetricId.NetIncome, a.metadata, { collapseIdenticalDuplicates: true }) };
    const balance = (p: typeof a): EquityPoint => ({ metadata: p.metadata, inputXmlSha256: p.inputXmlSha256,
        shareholdersEquity: p.object.selectFinancialDetail(FinancialDetailMetricId.ShareholdersEquity, p.metadata),
        valuationAndTranslationAdjustments: p.object.selectFinancialDetail(FinancialDetailMetricId.ValuationAndTranslationAdjustments, p.metadata) });
    const opening = balance(b), closing = balance(c), base: EquityReturnBase = { metricId: "netIncomeToAverageEquity", unit: "ratio", income, opening, closing };
    const unavailable = (reason: AverageEquityReturnReason): AverageEquityReturnResult => ({ ...base, status: "unavailable", reason });
    const metadataReason = validateAnnualBalanceMetadata(income.metadata, opening.metadata, closing.metadata);
    if (metadataReason) return unavailable(metadataReason);
    const selections: FactSelectionResult<string>[] = [income.selection, opening.shareholdersEquity, opening.valuationAndTranslationAdjustments, closing.shareholdersEquity, closing.valuationAndTranslationAdjustments];
    for (const selection of selections) {
        if (selection.status !== "selected") return unavailable("unavailable-input");
        if (selection.safeNumber === undefined) return unavailable("unsafe-input");
        const entity = income.selection.source?.entity, other = selection.source.entity;
        if (!entity || !other || entity.scheme !== other.scheme || entity.identifier !== other.identifier) return unavailable("incompatible-entity");
    }
    const equity = (point: EquityPoint) => {
        const x = decimalFraction(point.shareholdersEquity.safeNumber!), y = decimalFraction(point.valuationAndTranslationAdjustments.safeNumber!);
        return reduceFraction(x.numerator * y.denominator + y.numerator * x.denominator, x.denominator * y.denominator);
    };
    const x = equity(opening), y = equity(closing), sum = x.numerator * y.denominator + y.numerator * x.denominator;
    if (sum <= 0n) return unavailable("nonpositive-average-equity");
    const p = decimalFraction(income.selection.safeNumber!), exact = reduceFraction(2n * p.numerator * x.denominator * y.denominator, p.denominator * sum);
    const value = Number(exact.numerator) / Number(exact.denominator);
    if (!Number.isFinite(value) || value === 0 && exact.numerator !== 0n || Math.abs(value) > Number.MAX_SAFE_INTEGER) return unavailable("unsafe-result");
    const serialize = (f: typeof exact): ExactRatio => ({ numerator: String(f.numerator), denominator: String(f.denominator) });
    return { ...base, status: "calculated", reason: "calculated", value, exact: serialize(exact), openingEquity: serialize(x), closingEquity: serialize(y) };
}
export function screenAverageEquityReturn(inputs: readonly AverageEquityReturnInput[], options: AverageAssetsReturnOptions = {}) {
    if (!Array.isArray(inputs) || !options || typeof options !== "object" || Object.keys(options).some(k => !["conditions", "order", "offset", "limit"].includes(k))) throw new Error("不正な自己資本利益率検索です");
    const { conditions: raw = [], order = "desc", offset = 0, limit } = options;
    if (!Array.isArray(raw) || !Object.values(SortOrder).includes(order) || [offset, limit].some(v => v !== undefined && (!Number.isSafeInteger(v) || v < 0))) throw new Error("不正な条件/順序/ページです");
    const conditions = Array.from(raw, condition => {
        if (!condition || typeof condition !== "object" || Object.keys(condition).some(k => !["operator", "value"].includes(k))) throw new Error("不正な条件です");
        const { operator, value } = condition;
        if (!Object.values(ComparisonOperator).includes(operator) || !Number.isFinite(value)) throw new Error("有限の比較値が必要です");
        return { operator, value };
    });
    const results = Array.from(inputs, input => calculateAverageEquityReturn(input)), codes = new Set<string>(), docs = new Map<string, string>();
    const cohort = (r: AverageEquityReturnResult) => JSON.stringify([r.income, r.opening, r.closing].map(p => [p.metadata.scope, p.metadata.accountingStandard, p.metadata.currency, p.metadata.periodType, p.metadata.period]));
    for (const r of results) {
        const code = r.income.metadata.secCode;
        if (codes.has(code) || cohort(r) !== cohort(results[0])) throw new Error("会社/比較範囲が混在しています");
        codes.add(code);
        for (const point of [r.income, r.opening, r.closing]) { if (docs.has(point.metadata.docID) && docs.get(point.metadata.docID) !== code) throw new Error("別会社の書類IDを使えません"); docs.set(point.metadata.docID, code); }
    }
    const excluded = results.filter((r): r is Extract<AverageEquityReturnResult, { status: "unavailable" }> => r.status === "unavailable");
    const selected = results.filter((r): r is Extract<AverageEquityReturnResult, { status: "calculated" }> => r.status === "calculated");
    const fraction = (r: typeof selected[number]) => ({ numerator: BigInt(r.exact.numerator), denominator: BigInt(r.exact.denominator) });
    const rows = selected.filter(r => conditions.every(c => { const d = compareFractions(fraction(r), decimalFraction(c.value)); return c.operator === "gte" ? d >= 0 : c.operator === "lte" ? d <= 0 : c.operator === "gt" ? d > 0 : c.operator === "lt" ? d < 0 : d === 0; }));
    rows.sort((a, b) => compareFractions(fraction(a), fraction(b)) * (order === "asc" ? 1 : -1) || (a.income.metadata.secCode < b.income.metadata.secCode ? -1 : a.income.metadata.secCode > b.income.metadata.secCode ? 1 : 0));
    return { rows: rows.slice(offset, limit === undefined ? undefined : offset + limit), excluded, total: rows.length, excludedRows: excluded.length, filteredRows: selected.length - rows.length };
}
