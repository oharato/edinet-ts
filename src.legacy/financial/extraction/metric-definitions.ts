/** 主要指標とXBRLタグ・単位・採用条件の対応表。XMLやDBの読込みは行わない。 */
import type { KeyMetrics } from "../../xbrl/xbrl-document";

/** 安定IDは既存KeyMetricsの18項目と一致します。 */
export type MetricId = keyof KeyMetrics;
/** 補完可能な値定数。従来の文字列リテラル指定も同じ型で使えます。 */
export const MetricId = Object.freeze({
  NetSales: "netSales",
  OperatingIncome: "operatingIncome",
  OrdinaryIncome: "ordinaryIncome",
  NetIncome: "netIncome",
  NetAssets: "netAssets",
  TotalAssets: "totalAssets",
  OperatingCashFlow: "operatingCashFlow",
  InvestingCashFlow: "investingCashFlow",
  FinancingCashFlow: "financingCashFlow",
  CashAndEquivalents: "cashAndEquivalents",
  EarningsPerShare: "earningsPerShare",
  BookValuePerShare: "bookValuePerShare",
  EquityToTotalAssetsRatio: "equityToTotalAssetsRatio",
  RateOfReturnOnEquity: "rateOfReturnOnEquity",
  PriceEarningsRatio: "priceEarningsRatio",
  PayoutRatio: "payoutRatio",
  NumberOfIssuedShares: "numberOfIssuedShares",
  DividendPaidPerShare: "dividendPaidPerShare",
} as const satisfies Record<string, MetricId>);
export const AccountingStandard = Object.freeze({
  JGAAP: "J-GAAP",
  IFRS: "IFRS",
  USGAAP: "US-GAAP",
} as const);
export type AccountingStandard = (typeof AccountingStandard)[keyof typeof AccountingStandard];
export type MetricUnit = "JPY" | "JPY/share" | "shares" | "pure";
export interface MetricDefinition<Id extends string = MetricId> {
  readonly id: Id;
  readonly valueType: "decimal";
  readonly unit: MetricUnit;
  readonly periodType: "instant" | "duration";
  readonly candidates: readonly {
    readonly key: string;
    readonly standard: AccountingStandard;
    readonly supported: boolean;
  }[];
  readonly fallback: "ordered-tags-only-no-scope-period-currency-fallback";
}
const define = (
  id: MetricId,
  periodType: MetricDefinition["periodType"],
  unit: MetricUnit,
  keys: string[],
): MetricDefinition =>
  Object.freeze({
    id,
    valueType: "decimal",
    unit,
    periodType,
    // IFRSの親会社持分と純資産/BPSの意味差は未解決のため候補だけを記録します。
    candidates: Object.freeze(
      keys.map((key) =>
        Object.freeze({
          key,
          standard: key.includes("USGAAP")
            ? ("US-GAAP" as const)
            : key.includes("IFRS")
              ? ("IFRS" as const)
              : ("J-GAAP" as const),
          supported: !(key.includes("IFRS") && (id === "netAssets" || id === "bookValuePerShare")),
        }),
      ),
    ),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback",
  });
/** 既存の候補タグを独立API向けに宣言。US-GAAPは意味が一致する要約指標のみ。企業拡張タグは未対応です。 */
export const METRIC_REGISTRY: Readonly<Record<MetricId, MetricDefinition>> = Object.freeze({
  netSales: define("netSales", "duration", "JPY", [
    "jppfs_cor:NetSales",
    "jpcrp_cor:NetSales",
    "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults",
    "jpcrp_cor:RevenuesUSGAAPSummaryOfBusinessResults",
  ]),
  operatingIncome: define("operatingIncome", "duration", "JPY", [
    "jppfs_cor:OperatingIncome",
    "jpcrp_cor:OperatingIncomeIFRSSummaryOfBusinessResults",
    "jpcrp_cor:OperatingIncomeLossUSGAAPSummaryOfBusinessResults",
  ]),
  ordinaryIncome: define("ordinaryIncome", "duration", "JPY", ["jppfs_cor:OrdinaryIncome"]),
  netIncome: define("netIncome", "duration", "JPY", [
    "jppfs_cor:ProfitLossAttributableToOwnersOfParent",
    "jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
  ]),
  netAssets: define("netAssets", "instant", "JPY", [
    "jppfs_cor:NetAssets",
    "jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults",
    "jpcrp_cor:EquityIncludingPortionAttributableToNonControllingInterestUSGAAPSummaryOfBusinessResults",
  ]),
  totalAssets: define("totalAssets", "instant", "JPY", [
    "jppfs_cor:Assets",
    "jpcrp_cor:TotalAssetsIFRSSummaryOfBusinessResults",
    "jpcrp_cor:TotalAssetsUSGAAPSummaryOfBusinessResults",
  ]),
  operatingCashFlow: define("operatingCashFlow", "duration", "JPY", [
    "jppfs_cor:NetCashProvidedByUsedInOperatingActivities",
    "jpcrp_cor:NetCashProvidedByUsedInOperatingActivitiesSummaryOfBusinessResults",
    "jpcrp_cor:CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults",
    "jpcrp_cor:CashFlowsFromUsedInOperatingActivitiesUSGAAPSummaryOfBusinessResults",
  ]),
  investingCashFlow: define("investingCashFlow", "duration", "JPY", [
    "jppfs_cor:NetCashProvidedByUsedInInvestmentActivities",
    "jppfs_cor:NetCashProvidedByUsedInInvestingActivities",
    "jpcrp_cor:NetCashProvidedByUsedInInvestingActivitiesSummaryOfBusinessResults",
    "jpcrp_cor:CashFlowsFromUsedInInvestingActivitiesIFRSSummaryOfBusinessResults",
    "jpcrp_cor:CashFlowsFromUsedInInvestingActivitiesUSGAAPSummaryOfBusinessResults",
  ]),
  financingCashFlow: define("financingCashFlow", "duration", "JPY", [
    "jppfs_cor:NetCashProvidedByUsedInFinancingActivities",
    "jpcrp_cor:NetCashProvidedByUsedInFinancingActivitiesSummaryOfBusinessResults",
    "jpcrp_cor:CashFlowsFromUsedInFinancingActivitiesIFRSSummaryOfBusinessResults",
    "jpcrp_cor:CashFlowsFromUsedInFinancingActivitiesUSGAAPSummaryOfBusinessResults",
  ]),
  cashAndEquivalents: define("cashAndEquivalents", "instant", "JPY", [
    "jppfs_cor:CashAndCashEquivalents",
    "jppfs_cor:CashAndCashEquivalentsEndOfPeriod",
    "jpcrp_cor:CashAndCashEquivalentsIFRSSummaryOfBusinessResults",
    "jpcrp_cor:CashAndCashEquivalentsUSGAAPSummaryOfBusinessResults",
  ]),
  earningsPerShare: define("earningsPerShare", "duration", "JPY/share", [
    "jppfs_cor:BasicEarningsLossPerShare",
    "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults",
    "jpcrp_cor:BasicEarningsLossPerShareIFRSSummaryOfBusinessResults",
  ]),
  bookValuePerShare: define("bookValuePerShare", "instant", "JPY/share", [
    "jppfs_cor:NetAssetsPerShare",
    "jpcrp_cor:NetAssetsPerShareSummaryOfBusinessResults",
    "jpcrp_cor:EquityAttributableToOwnersOfParentPerShareIFRSSummaryOfBusinessResults",
  ]),
  equityToTotalAssetsRatio: define("equityToTotalAssetsRatio", "instant", "pure", [
    "jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults",
    "jpcrp_cor:EquityToTotalAssetsRatioSummaryOfBusinessResults",
    "jppfs_cor:EquityToTotalAssetsRatio",
    "jpcrp_cor:RatioOfOwnersEquityToGrossAssetsIFRSSummaryOfBusinessResults",
  ]),
  rateOfReturnOnEquity: define("rateOfReturnOnEquity", "duration", "pure", [
    "jpcrp_cor:RateOfReturnOnEquitySummaryOfBusinessResults",
    "jpcrp_cor:RateOfReturnOnEquityIFRSSummaryOfBusinessResults",
    "jppfs_cor:RateOfReturnOnEquity",
  ]),
  priceEarningsRatio: define("priceEarningsRatio", "duration", "pure", [
    "jpcrp_cor:PriceEarningsRatioSummaryOfBusinessResults",
    "jpcrp_cor:PriceEarningsRatioIFRSSummaryOfBusinessResults",
  ]),
  payoutRatio: define("payoutRatio", "duration", "pure", [
    "jpcrp_cor:PayoutRatioSummaryOfBusinessResults",
    "jpcrp_cor:PayoutRatioIFRSSummaryOfBusinessResults",
  ]),
  numberOfIssuedShares: define("numberOfIssuedShares", "instant", "shares", [
    "jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults",
    "jppfs_cor:TotalNumberOfIssuedShares",
  ]),
  dividendPaidPerShare: define("dividendPaidPerShare", "duration", "JPY/share", [
    "jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults",
  ]),
});
export const METRIC_REGISTRY_VERSION = "2";
