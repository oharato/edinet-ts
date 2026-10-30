import type { MetricDefinition } from "./metric-registry";

/** IFRSの直接報告値専用。J-GAAPのBS辞書と保存形式を変更しません。 */
export const IfrsBalanceSheetMetricId = Object.freeze({
    CurrentAssets: "currentAssets", CurrentLiabilities: "currentLiabilities", TotalLiabilities: "totalLiabilities",
    NoncurrentAssets: "noncurrentAssets",
    CurrentInterestBearingLiabilities: "currentInterestBearingLiabilities", NoncurrentInterestBearingLiabilities: "noncurrentInterestBearingLiabilities",
    CurrentLeaseLiabilities: "currentLeaseLiabilities", NoncurrentLeaseLiabilities: "noncurrentLeaseLiabilities"
} as const);
export type IfrsBalanceSheetMetricId = typeof IfrsBalanceSheetMetricId[keyof typeof IfrsBalanceSheetMetricId];
/** 既存の検索・snapshotの既定3項目を維持します。 */
export const DEFAULT_IFRS_BALANCE_SHEET_METRICS = Object.freeze(["currentAssets", "currentLiabilities", "totalLiabilities"] as const);
const define = (id: IfrsBalanceSheetMetricId, tag: string): MetricDefinition<IfrsBalanceSheetMetricId> => Object.freeze({
    id, valueType: "decimal", unit: "JPY", periodType: "instant",
    candidates: Object.freeze([Object.freeze({ key: `jpigp_cor:${tag}`, standard: "IFRS" as const, supported: true })]),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback"
});
/** 公式タクソノミの直接記載。追加5科目は2025-11-01版で確認。合算・差引推計はしません。 */
export const IFRS_BALANCE_SHEET_REGISTRY: Readonly<Record<IfrsBalanceSheetMetricId, MetricDefinition<IfrsBalanceSheetMetricId>>> = Object.freeze({
    currentAssets: define("currentAssets", "CurrentAssetsIFRS"),
    currentLiabilities: define("currentLiabilities", "TotalCurrentLiabilitiesIFRS"),
    totalLiabilities: define("totalLiabilities", "LiabilitiesIFRS"),
    noncurrentAssets: define("noncurrentAssets", "NonCurrentAssetsIFRS"),
    currentInterestBearingLiabilities: define("currentInterestBearingLiabilities", "InterestBearingLiabilitiesCLIFRS"),
    noncurrentInterestBearingLiabilities: define("noncurrentInterestBearingLiabilities", "InterestBearingLiabilitiesNCLIFRS"),
    currentLeaseLiabilities: define("currentLeaseLiabilities", "LeaseLiabilitiesCLIFRS"),
    noncurrentLeaseLiabilities: define("noncurrentLeaseLiabilities", "LeaseLiabilitiesNCLIFRS")
});
export const IFRS_BALANCE_SHEET_REGISTRY_VERSION = "2";
