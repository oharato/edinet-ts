import { MetricId } from "./metric-registry";
import { calculateAnnualGrowth,screenAnnualGrowth,
    type AnnualCoreMetadata,type AnnualCoreDocument,type AnnualCorePair,type AnnualCorePoint,type AnnualCoreResult,
    type AnnualCoreCondition,type AnnualCoreScreeningOptions,type AnnualCoreScreeningResult } from "./annual-growth-core";

/** 売上高前年比のID集合とは独立した営業利益前年比。 */
export const AnnualOperatingIncomeGrowthMetricId=Object.freeze({OperatingIncomeGrowth:"operatingIncomeGrowth"} as const);
export type AnnualOperatingIncomeGrowthMetricId=typeof AnnualOperatingIncomeGrowthMetricId[keyof typeof AnnualOperatingIncomeGrowthMetricId];
export type AnnualOperatingIncomeMetadata=AnnualCoreMetadata;
export type AnnualOperatingIncomeDocument=AnnualCoreDocument;
export type AnnualOperatingIncomePair=AnnualCorePair;
export type AnnualOperatingIncomePoint=AnnualCorePoint;
export type AnnualOperatingIncomeGrowthResult=AnnualCoreResult<AnnualOperatingIncomeGrowthMetricId>;
export type AnnualOperatingIncomeGrowthCondition=AnnualCoreCondition<AnnualOperatingIncomeGrowthMetricId>;
export type AnnualOperatingIncomeGrowthScreeningOptions=AnnualCoreScreeningOptions<AnnualOperatingIncomeGrowthMetricId>;
export type AnnualOperatingIncomeGrowthScreeningResult=AnnualCoreScreeningResult<AnnualOperatingIncomeGrowthMetricId>;
const definition={metricId:AnnualOperatingIncomeGrowthMetricId.OperatingIncomeGrowth,sourceMetric:MetricId.OperatingIncome};
/** J-GAAPの直接営業利益。(当年-前年)/前年、1=100%。前年が0/負数なら算出しません。 */
export function calculateAnnualOperatingIncomeGrowth(pair:AnnualOperatingIncomePair):AnnualOperatingIncomeGrowthResult {
    return calculateAnnualGrowth(pair,definition);
}
export function screenAnnualOperatingIncomeGrowth(pairs:readonly AnnualOperatingIncomePair[],options:AnnualOperatingIncomeGrowthScreeningOptions={}):AnnualOperatingIncomeGrowthScreeningResult {
    return screenAnnualGrowth(pairs,definition,options);
}
