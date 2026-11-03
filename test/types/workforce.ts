import {createWorkforceSnapshot,screenWorkforceDocuments,WorkforceMetricId,ConsolidationScope,AccountingStandard,EdinetXbrlParser,WORKFORCE_REGISTRY,type WorkforceMetadata} from "../../src/index";
const metadata:WorkforceMetadata={secCode:"1001",docID:"SYNTHETIC1",scope:ConsolidationScope.NonConsolidated,accountingStandard:AccountingStandard.JGAAP,currency:"JPY",period:{instant:"2025-03-31"}};
const row=createWorkforceSnapshot("",metadata);const raw:string|undefined=row.selections[WorkforceMetricId.AverageAnnualSalary].raw;
screenWorkforceDocuments([{xml:"",metadata}],{sortBy:WorkforceMetricId.AverageAnnualSalary});
// @ts-expect-error 人的資本IDの綴りを検査
screenWorkforceDocuments([],{sortBy:"averageSalary"});
// @ts-expect-error durationを期末指定に混ぜない
createWorkforceSnapshot("",{...metadata,period:{startDate:"2024-04-01",endDate:"2025-03-31"}});

// 既存の給与fieldは必須でIDも旧literalのままです。
const salaryMetric: "averageAnnualSalary" = row.selections.averageAnnualSalary.metricId;
const ageSelection = row.selections.averageAgeYears;
const ageMetric: "averageAgeYears" | undefined = ageSelection?.metricId;
// @ts-expect-error 新fieldは明示選択時のみ存在するためundefinedを除外する必要があります
const unsafeAge = row.selections.averageAgeYears.raw;
createWorkforceSnapshot("",metadata,[WorkforceMetricId.AverageAgeYears,WorkforceMetricId.AverageLengthOfServiceYears]);
screenWorkforceDocuments([],{metricIds:[WorkforceMetricId.AverageAgeYears],sortBy:WorkforceMetricId.AverageAgeYears});
// @ts-expect-error 未知IDはcompile時にも拒否
createWorkforceSnapshot("",metadata,["averageAge"]);

const object = new EdinetXbrlParser().parse("");
const selectionOptions = { scope: ConsolidationScope.NonConsolidated, accountingStandard: AccountingStandard.JGAAP, period: metadata.period };
const salaryId: "averageAnnualSalary" = object.selectWorkforceMetric(WorkforceMetricId.AverageAnnualSalary, selectionOptions).metricId;
const ageId: "averageAgeYears" = object.selectWorkforceMetric(WorkforceMetricId.AverageAgeYears, selectionOptions).metricId;
const serviceId: "averageLengthOfServiceYears" = object.selectWorkforceMetric(WorkforceMetricId.AverageLengthOfServiceYears, selectionOptions).metricId;
const yenUnit: "JPY" = WORKFORCE_REGISTRY.averageAnnualSalary.valueUnit;
const yearsUnit: "years" = WORKFORCE_REGISTRY.averageAgeYears.valueUnit;

const ratioUnit: "ratio" = WORKFORCE_REGISTRY.femaleManagerRatio.valueUnit;
createWorkforceSnapshot("",metadata,[WorkforceMetricId.FemaleManagerRatio,WorkforceMetricId.GenderWageAllRatio]);
screenWorkforceDocuments([],{metricIds:[WorkforceMetricId.MaleChildcareLeaveOrdinanceItem1AllRatio],sortBy:WorkforceMetricId.MaleChildcareLeaveOrdinanceItem1AllRatio});
