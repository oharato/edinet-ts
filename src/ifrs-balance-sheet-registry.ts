import type { MetricDefinition } from "./metric-registry";

/** IFRSの直接報告値専用。J-GAAPのBS辞書と保存形式を変更しません。 */
export const IfrsBalanceSheetMetricId = Object.freeze({
    CurrentAssets: "currentAssets", CurrentLiabilities: "currentLiabilities", TotalLiabilities: "totalLiabilities"
} as const);
export type IfrsBalanceSheetMetricId = typeof IfrsBalanceSheetMetricId[keyof typeof IfrsBalanceSheetMetricId];
const define = (id: IfrsBalanceSheetMetricId, tag: string): MetricDefinition<IfrsBalanceSheetMetricId> => Object.freeze({
    id, valueType: "decimal", unit: "JPY", periodType: "instant",
    candidates: Object.freeze([Object.freeze({ key: `jpigp_cor:${tag}`, standard: "IFRS" as const, supported: true })]),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback"
});
/** 公式2018-03-31版・2025-11-01版で確認した3科目。内訳からの推計はしません。 */
export const IFRS_BALANCE_SHEET_REGISTRY: Readonly<Record<IfrsBalanceSheetMetricId, MetricDefinition<IfrsBalanceSheetMetricId>>> = Object.freeze({
    currentAssets: define("currentAssets", "CurrentAssetsIFRS"),
    currentLiabilities: define("currentLiabilities", "TotalCurrentLiabilitiesIFRS"),
    totalLiabilities: define("totalLiabilities", "LiabilitiesIFRS")
});
export const IFRS_BALANCE_SHEET_REGISTRY_VERSION = "1";
