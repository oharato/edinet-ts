import type { KeyMetrics } from "./edinet-xbrl-object";

/** 安定IDは既存KeyMetricsの18項目と一致します。 */
export type MetricId = keyof KeyMetrics;
export type AccountingStandard = "J-GAAP" | "IFRS" | "US-GAAP";
export type MetricUnit = "JPY" | "JPY/share" | "shares" | "pure";
export interface MetricDefinition {
    readonly id: MetricId;
    readonly valueType: "decimal";
    readonly unit: MetricUnit;
    readonly periodType: "instant" | "duration";
    readonly candidates: readonly { readonly key: string; readonly standard: AccountingStandard; readonly supported: boolean }[];
    readonly fallback: "ordered-tags-only-no-scope-period-currency-fallback";
}
const define = (id: MetricId, periodType: MetricDefinition["periodType"], unit: MetricUnit, keys: string[]): MetricDefinition => Object.freeze({
    id, valueType: "decimal", unit, periodType,
    // IFRSの親会社持分と純資産/BPSの意味差は未解決のため候補だけを記録します。
    candidates: Object.freeze(keys.map(key => Object.freeze({ key, standard: key.includes("IFRS") ? "IFRS" as const : "J-GAAP" as const,
        supported: !(key.includes("IFRS") && (id === "netAssets" || id === "bookValuePerShare")) }))),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback"
});
/** 既存の候補タグを独立API向けに宣言。US-GAAP・企業拡張タグは未対応です。 */
export const METRIC_REGISTRY: Readonly<Record<MetricId, MetricDefinition>> = Object.freeze({
    netSales: define("netSales", "duration", "JPY", ["jppfs_cor:NetSales", "jpcrp_cor:NetSales", "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults"]),
    operatingIncome: define("operatingIncome", "duration", "JPY", ["jppfs_cor:OperatingIncome", "jpcrp_cor:OperatingIncomeIFRSSummaryOfBusinessResults"]),
    ordinaryIncome: define("ordinaryIncome", "duration", "JPY", ["jppfs_cor:OrdinaryIncome"]),
    netIncome: define("netIncome", "duration", "JPY", ["jppfs_cor:ProfitLossAttributableToOwnersOfParent", "jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults"]),
    netAssets: define("netAssets", "instant", "JPY", ["jppfs_cor:NetAssets", "jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults"]),
    totalAssets: define("totalAssets", "instant", "JPY", ["jppfs_cor:Assets", "jpcrp_cor:TotalAssetsIFRSSummaryOfBusinessResults"]),
    operatingCashFlow: define("operatingCashFlow", "duration", "JPY", ["jppfs_cor:NetCashProvidedByUsedInOperatingActivities", "jpcrp_cor:NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults", "jpcrp_cor:CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults"]),
    investingCashFlow: define("investingCashFlow", "duration", "JPY", ["jppfs_cor:NetCashProvidedByUsedInInvestmentActivities", "jppfs_cor:NetCashProvidedByUsedInInvestingActivities", "jpcrp_cor:NetCashProvidedByUsedInInvestingActivitiesSummaryOfBusinessResults", "jpcrp_cor:CashFlowsFromUsedInInvestingActivitiesIFRSSummaryOfBusinessResults"]),
    financingCashFlow: define("financingCashFlow", "duration", "JPY", ["jppfs_cor:NetCashProvidedByUsedInFinancingActivities", "jpcrp_cor:NetCashProvidedByUsedInFinancingActivitiesSummaryOfBusinessResults", "jpcrp_cor:CashFlowsFromUsedInFinancingActivitiesIFRSSummaryOfBusinessResults"]),
    cashAndEquivalents: define("cashAndEquivalents", "instant", "JPY", ["jppfs_cor:CashAndCashEquivalents", "jppfs_cor:CashAndCashEquivalentsEndOfPeriod", "jpcrp_cor:CashAndCashEquivalentsIFRSSummaryOfBusinessResults"]),
    earningsPerShare: define("earningsPerShare", "duration", "JPY/share", ["jppfs_cor:BasicEarningsLossPerShare", "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults", "jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults"]),
    bookValuePerShare: define("bookValuePerShare", "instant", "JPY/share", ["jppfs_cor:NetAssetsPerShare", "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults", "jpcrp_cor:EquityAttributableToOwnersOfParentPerShareIFRSSummaryOfBusinessResults"]),
    equityToTotalAssetsRatio: define("equityToTotalAssetsRatio", "instant", "pure", ["jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults", "jpcrp_cor:EquityToTotalAssetsRatioSummaryOfBusinessResults", "jppfs_cor:EquityToTotalAssetsRatio", "jpcrp_cor:RatioOfOwnersEquityToGrossAssetsIFRSSummaryOfBusinessResults"]),
    rateOfReturnOnEquity: define("rateOfReturnOnEquity", "duration", "pure", ["jpcrp_cor:RateOfReturnOnEquitySummaryOfBusinessResults", "jpcrp_cor:RateOfReturnOnEquityIFRSSummaryOfBusinessResults", "jppfs_cor:RateOfReturnOnEquity"]),
    priceEarningsRatio: define("priceEarningsRatio", "duration", "pure", ["jpcrp_cor:PriceEarningsRatioSummaryOfBusinessResults", "jpcrp_cor:PriceEarningsRatioIFRSSummaryOfBusinessResults"]),
    payoutRatio: define("payoutRatio", "duration", "pure", ["jpcrp_cor:PayoutRatioSummaryOfBusinessResults", "jpcrp_cor:PayoutRatioIFRSSummaryOfBusinessResults"]),
    numberOfIssuedShares: define("numberOfIssuedShares", "instant", "shares", ["jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults", "jppfs_cor:TotalNumberOfIssuedShares"]),
    dividendPaidPerShare: define("dividendPaidPerShare", "duration", "JPY/share", ["jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults"]),
});
export const METRIC_REGISTRY_VERSION = "1";
