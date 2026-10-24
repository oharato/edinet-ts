import type { MetricDefinition } from "./metric-registry";

/** 一般事業の直接科目。既存18指標・BS3・SQLite形式を拡張しません。 */
export const FinancialDetailMetricId = Object.freeze({
    NoncurrentAssets: "noncurrentAssets", NoncurrentLiabilities: "noncurrentLiabilities", CashAndDeposits: "cashAndDeposits",
    CostOfSales: "costOfSales", SellingGeneralAndAdministrativeExpenses: "sellingGeneralAndAdministrativeExpenses",
    DepreciationOperatingCashFlow: "depreciationOperatingCashFlow",
    PropertyPlantEquipmentPurchaseCashFlow: "propertyPlantEquipmentPurchaseCashFlow",
    PropertyPlantEquipmentAndIntangiblesPurchaseCashFlow: "propertyPlantEquipmentAndIntangiblesPurchaseCashFlow",
    ShortTermLoansPayable: "shortTermLoansPayable",
    CurrentPortionOfLongTermLoansPayable: "currentPortionOfLongTermLoansPayable",
    LongTermLoansPayable: "longTermLoansPayable",
    CurrentPortionOfBonds: "currentPortionOfBonds",
    BondsPayable: "bondsPayable",
    LeaseObligationsCL: "leaseObligationsCL",
    LeaseObligationsNCL: "leaseObligationsNCL"
} as const);
export type FinancialDetailMetricId = typeof FinancialDetailMetricId[keyof typeof FinancialDetailMetricId];
const define = (id: FinancialDetailMetricId, tag: string, periodType: "instant" | "duration"): MetricDefinition<FinancialDetailMetricId> => Object.freeze({
    id, valueType: "decimal", unit: "JPY", periodType,
    candidates: Object.freeze([Object.freeze({ key: `jppfs_cor:${tag}`, standard: "J-GAAP" as const, supported: true })]),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback"
});
/** #37の既定5項目は固定し、registry拡張だけでは返値/除外条件を増やしません。 */
export const DEFAULT_FINANCIAL_DETAIL_METRICS: readonly FinancialDetailMetricId[] = Object.freeze([
    "noncurrentAssets", "noncurrentLiabilities", "cashAndDeposits", "costOfSales", "sellingGeneralAndAdministrativeExpenses"
]);
export const FINANCIAL_DETAIL_REGISTRY: Readonly<Record<FinancialDetailMetricId, MetricDefinition<FinancialDetailMetricId>>> = Object.freeze({
    noncurrentAssets: define("noncurrentAssets", "NoncurrentAssets", "instant"),
    noncurrentLiabilities: define("noncurrentLiabilities", "NoncurrentLiabilities", "instant"),
    cashAndDeposits: define("cashAndDeposits", "CashAndDeposits", "instant"),
    costOfSales: define("costOfSales", "CostOfSales", "duration"),
    sellingGeneralAndAdministrativeExpenses: define("sellingGeneralAndAdministrativeExpenses", "SellingGeneralAndAdministrativeExpenses", "duration"),
    depreciationOperatingCashFlow: define("depreciationOperatingCashFlow", "DepreciationAndAmortizationOpeCF", "duration"),
    propertyPlantEquipmentPurchaseCashFlow: define("propertyPlantEquipmentPurchaseCashFlow", "PurchaseOfPropertyPlantAndEquipmentInvCF", "duration"),
    propertyPlantEquipmentAndIntangiblesPurchaseCashFlow: define("propertyPlantEquipmentAndIntangiblesPurchaseCashFlow", "PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCF", "duration"),
    shortTermLoansPayable: define("shortTermLoansPayable", "ShortTermLoansPayable", "instant"),
    currentPortionOfLongTermLoansPayable: define("currentPortionOfLongTermLoansPayable", "CurrentPortionOfLongTermLoansPayable", "instant"),
    longTermLoansPayable: define("longTermLoansPayable", "LongTermLoansPayable", "instant"),
    currentPortionOfBonds: define("currentPortionOfBonds", "CurrentPortionOfBonds", "instant"),
    bondsPayable: define("bondsPayable", "BondsPayable", "instant"),
    leaseObligationsCL: define("leaseObligationsCL", "LeaseObligationsCL", "instant"),
    leaseObligationsNCL: define("leaseObligationsNCL", "LeaseObligationsNCL", "instant")
});
export const FINANCIAL_DETAIL_REGISTRY_VERSION = "3";
