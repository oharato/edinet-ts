import type { MetricDefinition } from "./metric-registry";

/** 財務科目・既存18指標とは独立した人的資本のID。 */
export const WorkforceMetricId = Object.freeze({
    AverageAnnualSalary: "averageAnnualSalary", AverageAgeYears: "averageAgeYears",
    AverageLengthOfServiceYears: "averageLengthOfServiceYears"
} as const);
export type WorkforceMetricId = typeof WorkforceMetricId[keyof typeof WorkforceMetricId];
export const WORKFORCE_REGISTRY_VERSION = "2";
type WorkforceDefinition<Id extends WorkforceMetricId> = MetricDefinition<Id> & {
    /** XBRL measureとは別の、人が読む原値の単位。yearsを月へ自動換算しません。 */
    readonly valueUnit: Id extends "averageAnnualSalary" ? "JPY" : "years";
};
const define = <Id extends WorkforceMetricId>(id: Id, tag: string, unit: "JPY" | "pure", valueUnit: WorkforceDefinition<Id>["valueUnit"]): WorkforceDefinition<Id> => Object.freeze({
    id, valueType: "decimal", unit, valueUnit, periodType: "instant",
    candidates: Object.freeze([Object.freeze({ key: `jpcrp_cor:${tag}`, standard: "J-GAAP" as const, supported: true })]),
    fallback: "ordered-tags-only-no-scope-period-currency-fallback"
});
/** 提出会社単体のみ。集計対象期間・対象社員・注記の範囲はfactだけでは判定しません。 */
export const WORKFORCE_REGISTRY: { readonly [Id in WorkforceMetricId]: WorkforceDefinition<Id> } = Object.freeze({
    averageAnnualSalary: define("averageAnnualSalary", "AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees", "JPY", "JPY"),
    averageAgeYears: define("averageAgeYears", "AverageAgeYearsInformationAboutReportingCompanyInformationAboutEmployees", "pure", "years"),
    averageLengthOfServiceYears: define("averageLengthOfServiceYears", "AverageLengthOfServiceYearsInformationAboutReportingCompanyInformationAboutEmployees", "pure", "years")
});
