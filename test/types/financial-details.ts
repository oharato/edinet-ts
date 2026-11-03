import { createFinancialDetailSnapshot,screenFinancialDetailDocuments,FinancialDetailMetricId,FinancialPeriodType,AccountingStandard,ConsolidationScope } from "../../src/index";
const common={secCode:"1001",docID:"SYNTHETIC1",scope:ConsolidationScope.Consolidated,accountingStandard:AccountingStandard.JGAAP,currency:"JPY" as const};
const instant={...common,period:{instant:"2025-03-31"}};
const duration={...common,period:{startDate:"2024-04-01",endDate:"2025-03-31"},periodType:FinancialPeriodType.Annual};
const row=createFinancialDetailSnapshot("",instant);const raw:string|undefined=row.selections.cashAndDeposits?.raw;
screenFinancialDetailDocuments([{xml:"",metadata:duration}],{sortBy:FinancialDetailMetricId.CostOfSales});
// @ts-expect-error durationの分類は必須
createFinancialDetailSnapshot("",{...common,period:{startDate:"2024-04-01",endDate:"2025-03-31"}});
// @ts-expect-error instantへ年次分類を混ぜない
createFinancialDetailSnapshot("",{...instant,periodType:FinancialPeriodType.Annual});
// @ts-expect-error 明細IDの綴りを検査
screenFinancialDetailDocuments([],{sortBy:"cashAndEquivalent"});

const cfIds=[FinancialDetailMetricId.DepreciationOperatingCashFlow,FinancialDetailMetricId.PropertyPlantEquipmentPurchaseCashFlow];
createFinancialDetailSnapshot("",duration,cfIds);
screenFinancialDetailDocuments([{xml:"",metadata:duration}],{metricIds:cfIds,sortBy:FinancialDetailMetricId.DepreciationOperatingCashFlow});
// @ts-expect-error CFの綴りを検査
createFinancialDetailSnapshot("",duration,["depreciationCashFlow"]);

const debtIds=[FinancialDetailMetricId.ShortTermLoansPayable,FinancialDetailMetricId.CurrentPortionOfLongTermLoansPayable,
    FinancialDetailMetricId.LongTermLoansPayable,FinancialDetailMetricId.CurrentPortionOfBonds,FinancialDetailMetricId.BondsPayable,
    FinancialDetailMetricId.LeaseObligationsCL,FinancialDetailMetricId.LeaseObligationsNCL];
createFinancialDetailSnapshot("",instant,debtIds);
screenFinancialDetailDocuments([{xml:"",metadata:instant}],{metricIds:debtIds,sortBy:FinancialDetailMetricId.BondsPayable});
// @ts-expect-error 合算した有利子負債項目を追加したわけではありません
createFinancialDetailSnapshot("",instant,["interestBearingDebt"]);

const paymentIds=[FinancialDetailMetricId.IncomeTaxesPaidCashFlow,FinancialDetailMetricId.CashDividendsPaidCashFlow,FinancialDetailMetricId.LongTermLoansRepaymentCashFlow];
createFinancialDetailSnapshot("",duration,paymentIds);
screenFinancialDetailDocuments([{xml:"",metadata:duration}],{metricIds:paymentIds,sortBy:FinancialDetailMetricId.CashDividendsPaidCashFlow});
// @ts-expect-error 法人税の費用とCF支払額は別のID
createFinancialDetailSnapshot("",duration,["incomeTaxesPaid"]);
