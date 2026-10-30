import type { MetricDefinition } from "./metric-registry";

/** 主要18指標とは別のJ-GAAP一般事業BS科目。比率や内訳合算は含めません。 */
export type BalanceSheetMetricId = "currentAssets" | "currentLiabilities" | "totalLiabilities";
const define = (id: BalanceSheetMetricId, tag: string): MetricDefinition<BalanceSheetMetricId> => Object.freeze({
    id, valueType: "decimal", unit: "JPY", periodType: "instant",
    candidates: Object.freeze([Object.freeze({ key: `jppfs_cor:${tag}`, standard: "J-GAAP" as const, supported: true })]),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback"
});
export const BALANCE_SHEET_REGISTRY: Readonly<Record<BalanceSheetMetricId, MetricDefinition<BalanceSheetMetricId>>> = Object.freeze({
    currentAssets: define("currentAssets", "CurrentAssets"),
    currentLiabilities: define("currentLiabilities", "CurrentLiabilities"),
    totalLiabilities: define("totalLiabilities", "Liabilities")
});
export const BALANCE_SHEET_REGISTRY_VERSION = "2";
