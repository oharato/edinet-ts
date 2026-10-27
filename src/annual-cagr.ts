import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { normalizeFinancialDetailMetadata } from "./financial-detail-metadata";
import { MetricId } from "./metric-registry";
import { ComparisonOperator, SortOrder } from "./financial-options";
import { decimalFraction, compareFractions, reduceFraction } from "./decimal-fraction";
import type { AnnualCoreDocument, AnnualCorePoint } from "./annual-growth-core";

export const CagrMetricId = Object.freeze({ NetSales: "netSalesCagr", OperatingIncome: "operatingIncomeCagr", NetIncome: "netIncomeCagr" } as const);
export type CagrMetricId = typeof CagrMetricId[keyof typeof CagrMetricId];
const sources = { netSalesCagr: MetricId.NetSales, operatingIncomeCagr: MetricId.OperatingIncome, netIncomeCagr: MetricId.NetIncome } as const;
export type CagrUnavailableReason = "unsupported-standard" | "incompatible-metadata" | "not-annual" | "unsupported-annual-period" |
    "non-consecutive-periods" | "unavailable-input" | "incompatible-entity" | "unsafe-input" | "zero-base" | "negative-input" | "unsafe-result";
type CagrBase = { metricId: CagrMetricId; unit: "ratio"; points: readonly AnnualCorePoint[]; years: number };
export type CagrResult = CagrBase & ({ status: "calculated"; reason: "calculated"; value: number;
    /** CAGR=(numerator/denominator)^(1/years)-1。無理数を近似分数として保存しません。 */
    exact: { numerator: string; denominator: string; root: number } } |
    { status: "unavailable"; reason: CagrUnavailableReason; value?: never; exact?: never });
export interface CagrCondition { operator: ComparisonOperator; value: number; }
export interface CagrScreeningOptions { conditions?: readonly CagrCondition[]; order?: SortOrder; offset?: number; limit?: number; }
const nextDay = (date: string) => new Date(Date.parse(date + "T00:00:00Z") + 86400000).toISOString().slice(0, 10);
function annual(start: string, end: string): boolean {
    const date = new Date(start + "T00:00:00Z");
    if (date.getUTCDate() !== 1) return false;
    date.setUTCFullYear(date.getUTCFullYear() + 1); date.setUTCDate(0);
    return date.toISOString().slice(0, 10) === end;
}
/** 3年CAGRには4つの連続した12暦月原本/列を明示。EPS/配当の分割調整は別APIです。 */
export function calculateCagr(documents: readonly AnnualCoreDocument[], metricId: CagrMetricId): CagrResult {
    if (!Object.hasOwn(sources, metricId) || !Array.isArray(documents) || documents.length < 2 || documents.length > 21)
        throw new Error("既知のCAGR項目と2〜21件の明示年次原本が必要です");
    const captured = Array.from(documents, document => {
        if (!document || typeof document !== "object" || Object.keys(document).some(key => !["xml", "metadata"].includes(key))) throw new Error("xml/metadataが必要です");
        const metadata = normalizeFinancialDetailMetadata(document.metadata), xml = document.xml;
        if (typeof xml !== "string") throw new Error("XML文字列が必要です");
        return { metadata, xml };
    });
    const points = captured.map(({ xml, metadata }): AnnualCorePoint => ({ metadata,
        selection: new EdinetXbrlParser().parse(xml, metadata.docID).selectMetric(sources[metricId], {
            accountingStandard: metadata.accountingStandard, scope: metadata.scope, period: metadata.period }),
        inputXmlSha256: createHash("sha256").update(xml).digest("hex") }));
    const base: CagrBase = { metricId, unit: "ratio", points, years: points.length - 1 };
    const unavailable = (reason: CagrUnavailableReason): CagrResult => ({ ...base, status: "unavailable", reason });
    const first = points[0].metadata;
    for (let i = 0; i < points.length; i++) {
        const { metadata, selection } = points[i];
        if (metadata.accountingStandard !== "J-GAAP") return unavailable("unsupported-standard");
        if (metadata.secCode !== first.secCode || metadata.scope !== first.scope || metadata.currency !== first.currency) return unavailable("incompatible-metadata");
        if (metadata.periodType !== "annual" || !metadata.period.startDate || !metadata.period.endDate) return unavailable("not-annual");
        if (!annual(metadata.period.startDate, metadata.period.endDate)) return unavailable("unsupported-annual-period");
        if (i && nextDay(points[i - 1].metadata.period.endDate!) !== metadata.period.startDate) return unavailable("non-consecutive-periods");
        if (selection.status !== "selected") return unavailable("unavailable-input");
        const original = points[0].selection.source?.entity, entity = selection.source.entity;
        if (!original || !entity || entity.scheme !== original.scheme || entity.identifier !== original.identifier) return unavailable("incompatible-entity");
        if (selection.safeNumber === undefined) return unavailable("unsafe-input");
        if (selection.safeNumber < 0) return unavailable("negative-input");
    }
    const start = points[0].selection.safeNumber!, end = points.at(-1)!.selection.safeNumber!;
    if (start === 0) return unavailable("zero-base");
    const a = decimalFraction(start), b = decimalFraction(end), exact = reduceFraction(b.numerator * a.denominator, b.denominator * a.numerator);
    const change = (end - start) / start;
    const logRatio = Number.isFinite(change) && change > -1 ? Math.log1p(change) : Math.log(end) - Math.log(start);
    const value = end === 0 ? -1 : Math.expm1(logRatio / base.years);
    if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) return unavailable("unsafe-result");
    return { ...base, status: "calculated", reason: "calculated", value,
        exact: { numerator: String(exact.numerator), denominator: String(exact.denominator), root: base.years } };
}
function factor(result: Extract<CagrResult, { status: "calculated" }>) {
    return { numerator: BigInt(result.exact.numerator), denominator: BigInt(result.exact.denominator) };
}
function compareThreshold(result: Extract<CagrResult, { status: "calculated" }>, value: number): number {
    if (value < -1) return 1;
    const threshold = decimalFraction(value), numerator = threshold.numerator + threshold.denominator;
    return compareFractions(factor(result), { numerator: numerator ** BigInt(result.years), denominator: threshold.denominator ** BigInt(result.years) });
}
/** 同じ全期間を持つ明示企業集合。表示近似値でCAGRの条件・並びを決めません。 */
export function screenCagr(series: readonly (readonly AnnualCoreDocument[])[], metricId: CagrMetricId, options: CagrScreeningOptions = {}) {
    if (!Object.hasOwn(sources, metricId) || !Array.isArray(series) || !options || typeof options !== "object" || Object.keys(options).some(key => !["conditions", "order", "offset", "limit"].includes(key))) throw new Error("不正なCAGR検索条件です");
    const { conditions: inputConditions = [], order = "desc", offset = 0, limit } = options;
    if (!Array.isArray(inputConditions)) throw new Error("有限のCAGR条件が必要です");
    const conditions = Array.from(inputConditions, condition => {
        if (!condition || typeof condition !== "object" || Object.keys(condition).some(key => !["operator", "value"].includes(key))) throw new Error("不正なCAGR条件です");
        const { operator, value } = condition;
        if (!Object.values(ComparisonOperator).includes(operator) || !Number.isFinite(value)) throw new Error("有限のCAGR条件が必要です");
        return { operator, value };
    });
    if (!Object.values(SortOrder).includes(order) || [offset, limit].some(v => v !== undefined && (!Number.isSafeInteger(v) || v < 0))) throw new Error("不正なCAGRの順序/ページです");
    const results = Array.from(series, documents => calculateCagr(documents, metricId)), codes = new Set<string>(), docs = new Map<string, string>();
    const cohort = (r: CagrResult) => JSON.stringify(r.points.map(p => [p.metadata.period, p.metadata.periodType, p.metadata.scope, p.metadata.accountingStandard, p.metadata.currency]));
    for (const result of results) {
        const code = result.points[0].metadata.secCode;
        if (codes.has(code) || cohort(result) !== cohort(results[0])) throw new Error("同一企業または企業間の期間/範囲/基準/通貨が混在しています");
        codes.add(code);
        for (const point of result.points) {
            if (docs.has(point.metadata.docID) && docs.get(point.metadata.docID) !== code) throw new Error("別企業で同じ書類IDは使えません");
            docs.set(point.metadata.docID, code);
        }
    }
    const excluded = results.filter((r): r is Extract<CagrResult, { status: "unavailable" }> => r.status === "unavailable");
    const selected = results.filter((r): r is Extract<CagrResult, { status: "calculated" }> => r.status === "calculated");
    const rows = selected.filter(r => conditions.every(c => {
        const d = compareThreshold(r, c.value);
        return c.operator === "gte" ? d >= 0 : c.operator === "lte" ? d <= 0 : c.operator === "gt" ? d > 0 : c.operator === "lt" ? d < 0 : d === 0;
    }));
    rows.sort((a, b) => compareFractions(factor(a), factor(b)) * (order === "asc" ? 1 : -1) ||
        (a.points[0].metadata.secCode < b.points[0].metadata.secCode ? -1 : a.points[0].metadata.secCode > b.points[0].metadata.secCode ? 1 : 0));
    return { rows: rows.slice(offset, limit === undefined ? undefined : offset + limit), excluded, total: rows.length, excludedRows: excluded.length, filteredRows: selected.length - rows.length };
}
