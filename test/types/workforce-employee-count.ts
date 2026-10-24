import { WorkforceMetricId, WORKFORCE_REGISTRY, createWorkforceSnapshot, screenWorkforceDocuments, EdinetXbrlParser,
    type WorkforceMetadata } from "../../src/index";
const metadata: WorkforceMetadata = { secCode: "1001", docID: "SYNTHETIC1", scope: "NonConsolidated", accountingStandard: "J-GAAP", currency: "JPY", period: { instant: "2025-03-31" } };
const row = createWorkforceSnapshot("", metadata, [WorkforceMetricId.NumberOfEmployees]);
const oldSalaryId: "averageAnnualSalary" = row.selections.averageAnnualSalary.metricId;
const employeeId: "numberOfEmployees" | undefined = row.selections.numberOfEmployees?.metricId;
const yearsId: "averageAgeYears" | undefined = row.selections.averageAgeYears?.metricId;
const people: "people" = WORKFORCE_REGISTRY.numberOfEmployees.valueUnit;
const years: "years" = WORKFORCE_REGISTRY.averageAgeYears.valueUnit;
const tenureYears: "years" = WORKFORCE_REGISTRY.averageLengthOfServiceYears.valueUnit;
const yen: "JPY" = WORKFORCE_REGISTRY.averageAnnualSalary.valueUnit;
const selector = new EdinetXbrlParser().parse("").selectWorkforceMetric(WorkforceMetricId.NumberOfEmployees, metadata);
const selectorId: "numberOfEmployees" = selector.metricId;
screenWorkforceDocuments([], { metricIds: [WorkforceMetricId.NumberOfEmployees], conditions: [{ metric: WorkforceMetricId.NumberOfEmployees, operator: "gte", value: 1 }], sortBy: WorkforceMetricId.NumberOfEmployees });
// @ts-expect-error 追加fieldはoptional。既定返値へ必須追加しません。
const assumedPresent = row.selections.numberOfEmployees.raw;
// @ts-expect-error 人数を年として指定しません。
const notYears: "years" = WORKFORCE_REGISTRY.numberOfEmployees.valueUnit;
// @ts-expect-error 存在しない別タグ名を指標IDとして使いません。
createWorkforceSnapshot("", metadata, ["numberOfEmployeesSummaryOfBusinessResults"]);
