import type { MetricDefinition } from "./metric-registry";

/** 財務科目・既存18指標とは独立した人的資本のID。 */
export const WorkforceMetricId = Object.freeze({ AverageAnnualSalary: "averageAnnualSalary" } as const);
export type WorkforceMetricId = typeof WorkforceMetricId[keyof typeof WorkforceMetricId];
export const WORKFORCE_REGISTRY_VERSION = "1";
/** 提出会社単体のみ。集計対象期間・対象社員・賞与等の範囲はこのfactだけでは判定しません。 */
export const WORKFORCE_REGISTRY: Readonly<Record<WorkforceMetricId, MetricDefinition<WorkforceMetricId>>> = Object.freeze({
    averageAnnualSalary: Object.freeze({
        id: WorkforceMetricId.AverageAnnualSalary, valueType: "decimal", unit: "JPY", periodType: "instant",
        candidates: Object.freeze([Object.freeze({
            key: "jpcrp_cor:AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees",
            standard: "J-GAAP", supported: true
        } as const)]),
        fallback: "ordered-tags-only-no-scope-period-currency-fallback"
    })
});
