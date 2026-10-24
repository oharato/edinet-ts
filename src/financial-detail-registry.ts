import type { MetricDefinition } from "./metric-registry";

/** 一般事業の直接科目。既存18指標・BS3・SQLite形式を拡張しません。 */
export const FinancialDetailMetricId = Object.freeze({
    NoncurrentAssets: "noncurrentAssets", NoncurrentLiabilities: "noncurrentLiabilities", CashAndDeposits: "cashAndDeposits",
    CostOfSales: "costOfSales", SellingGeneralAndAdministrativeExpenses: "sellingGeneralAndAdministrativeExpenses"
} as const);
export type FinancialDetailMetricId = typeof FinancialDetailMetricId[keyof typeof FinancialDetailMetricId];
const define = (id: FinancialDetailMetricId, tag: string, periodType: "instant" | "duration"): MetricDefinition<FinancialDetailMetricId> => Object.freeze({
    id, valueType: "decimal", unit: "JPY", periodType,
    candidates: Object.freeze([Object.freeze({ key: `jppfs_cor:${tag}`, standard: "J-GAAP" as const, supported: true })]),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback"
});
export const FINANCIAL_DETAIL_REGISTRY: Readonly<Record<FinancialDetailMetricId, MetricDefinition<FinancialDetailMetricId>>> = Object.freeze({
    noncurrentAssets: define("noncurrentAssets", "NoncurrentAssets", "instant"),
    noncurrentLiabilities: define("noncurrentLiabilities", "NoncurrentLiabilities", "instant"),
    cashAndDeposits: define("cashAndDeposits", "CashAndDeposits", "instant"),
    costOfSales: define("costOfSales", "CostOfSales", "duration"),
    sellingGeneralAndAdministrativeExpenses: define("sellingGeneralAndAdministrativeExpenses", "SellingGeneralAndAdministrativeExpenses", "duration")
});
export const FINANCIAL_DETAIL_REGISTRY_VERSION = "1";
