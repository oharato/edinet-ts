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
