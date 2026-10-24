import {createWorkforceSnapshot,screenWorkforceDocuments,WorkforceMetricId,ConsolidationScope,AccountingStandard,type WorkforceMetadata} from "../../src/index";
const metadata:WorkforceMetadata={secCode:"1001",docID:"SYNTHETIC1",scope:ConsolidationScope.NonConsolidated,accountingStandard:AccountingStandard.JGAAP,currency:"JPY",period:{instant:"2025-03-31"}};
const row=createWorkforceSnapshot("",metadata);const raw:string|undefined=row.selections[WorkforceMetricId.AverageAnnualSalary].raw;
screenWorkforceDocuments([{xml:"",metadata}],{sortBy:WorkforceMetricId.AverageAnnualSalary});
// @ts-expect-error 人的資本IDの綴りを検査
screenWorkforceDocuments([],{sortBy:"averageSalary"});
// @ts-expect-error durationを期末指定に混ぜない
createWorkforceSnapshot("",{...metadata,period:{startDate:"2024-04-01",endDate:"2025-03-31"}});
