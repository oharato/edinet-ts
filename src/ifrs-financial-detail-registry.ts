import type {MetricDefinition} from "./metric-registry";
/** IFRSの直接duration値。税金/配当/取得/返済の範囲違いを別IDとし、差引/合算しません。 */
export const IfrsFinancialDetailMetricId=Object.freeze({
 CostOfSales:"costOfSales",GrossProfit:"grossProfit",SellingGeneralAndAdministrativeExpenses:"sellingGeneralAndAdministrativeExpenses",
 ProfitBeforeTax:"profitBeforeTax",IncomeTaxExpense:"incomeTaxExpense",
 DepreciationAndAmortizationCashFlow:"depreciationAndAmortizationCashFlow",DepreciationExpenseCashFlow:"depreciationExpenseCashFlow",
 PropertyPlantEquipmentPurchaseCashFlow:"propertyPlantEquipmentPurchaseCashFlow",PropertyPlantEquipmentAndIntangiblesPurchaseCashFlow:"propertyPlantEquipmentAndIntangiblesPurchaseCashFlow",
 IncomeTaxesPaidCashFlow:"incomeTaxesPaidCashFlow",IncomeTaxesRefundCashFlow:"incomeTaxesRefundCashFlow",NetIncomeTaxesRefundPaidCashFlow:"netIncomeTaxesRefundPaidCashFlow",
 DividendsPaidCashFlow:"dividendsPaidCashFlow",DividendsPaidToOwnersOfParentCashFlow:"dividendsPaidToOwnersOfParentCashFlow",
 LongTermBorrowingsRepaymentCashFlow:"longTermBorrowingsRepaymentCashFlow",BondsAndLongTermBorrowingsRepaymentCashFlow:"bondsAndLongTermBorrowingsRepaymentCashFlow",
 LeaseObligationsRepaymentCashFlow:"leaseObligationsRepaymentCashFlow"
} as const);
export type IfrsFinancialDetailMetricId=typeof IfrsFinancialDetailMetricId[keyof typeof IfrsFinancialDetailMetricId];
const define=(id:IfrsFinancialDetailMetricId,tag:string):MetricDefinition<IfrsFinancialDetailMetricId>=>Object.freeze({id,valueType:"decimal",unit:"JPY",periodType:"duration",candidates:Object.freeze([Object.freeze({key:"jpigp_cor:"+tag,standard:"IFRS" as const,supported:true})]),fallback:"ordered-tags-only-no-scope-period-currency-fallback"});
export const DEFAULT_IFRS_FINANCIAL_DETAIL_METRICS:readonly IfrsFinancialDetailMetricId[]=Object.freeze(["costOfSales","grossProfit","sellingGeneralAndAdministrativeExpenses","profitBeforeTax","incomeTaxExpense"]);
export const IFRS_FINANCIAL_DETAIL_REGISTRY:Readonly<Record<IfrsFinancialDetailMetricId,MetricDefinition<IfrsFinancialDetailMetricId>>>=Object.freeze({
 costOfSales:define("costOfSales","CostOfSalesIFRS"),
 grossProfit:define("grossProfit","GrossProfitIFRS"),
 sellingGeneralAndAdministrativeExpenses:define("sellingGeneralAndAdministrativeExpenses","SellingGeneralAndAdministrativeExpensesIFRS"),
 profitBeforeTax:define("profitBeforeTax","ProfitLossBeforeTaxIFRS"),
 incomeTaxExpense:define("incomeTaxExpense","IncomeTaxExpenseIFRS"),
 depreciationAndAmortizationCashFlow:define("depreciationAndAmortizationCashFlow","DepreciationAndAmortizationOpeCFIFRS"),
 depreciationExpenseCashFlow:define("depreciationExpenseCashFlow","DepreciationExpenseOpeCFIFRS"),
 propertyPlantEquipmentPurchaseCashFlow:define("propertyPlantEquipmentPurchaseCashFlow","PurchaseOfPropertyPlantAndEquipmentInvCFIFRS"),
 propertyPlantEquipmentAndIntangiblesPurchaseCashFlow:define("propertyPlantEquipmentAndIntangiblesPurchaseCashFlow","PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCFIFRS"),
 incomeTaxesPaidCashFlow:define("incomeTaxesPaidCashFlow","IncomeTaxesPaidOpeCFIFRS"),
 incomeTaxesRefundCashFlow:define("incomeTaxesRefundCashFlow","IncomeTaxesRefundOpeCFIFRS"),
 netIncomeTaxesRefundPaidCashFlow:define("netIncomeTaxesRefundPaidCashFlow","IncomeTaxesRefundPaidOpeCFIFRS"),
 dividendsPaidCashFlow:define("dividendsPaidCashFlow","DividendsPaidFinCFIFRS"),
 dividendsPaidToOwnersOfParentCashFlow:define("dividendsPaidToOwnersOfParentCashFlow","DividendsPaidToOwnersOfParentFinCFIFRS"),
 longTermBorrowingsRepaymentCashFlow:define("longTermBorrowingsRepaymentCashFlow","RepaymentsOfLongTermBorrowingsFinCFIFRS"),
 bondsAndLongTermBorrowingsRepaymentCashFlow:define("bondsAndLongTermBorrowingsRepaymentCashFlow","RedemptionOfBondsAndRepaymentsOfLongTermBorrowingsFinCFIFRS"),
 leaseObligationsRepaymentCashFlow:define("leaseObligationsRepaymentCashFlow","RepaymentsOfLeaseObligationsFinCFIFRS")
});
export const IFRS_FINANCIAL_DETAIL_REGISTRY_VERSION="2";
