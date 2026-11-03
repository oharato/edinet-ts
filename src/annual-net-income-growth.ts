import { MetricId } from "./metric-registry";
import { calculateAnnualGrowth,screenAnnualGrowth,
    type AnnualCoreMetadata,type AnnualCoreDocument,type AnnualCorePair,type AnnualCorePoint,type AnnualCoreResult,
    type AnnualCoreCondition,type AnnualCoreScreeningOptions,type AnnualCoreScreeningResult } from "./annual-growth-core";

/** 既存の売上高/営業利益前年比とは別IDの親会社株主利益前年比。 */
export const AnnualNetIncomeGrowthMetricId=Object.freeze({NetIncomeGrowth:"netIncomeGrowth"} as const);
export type AnnualNetIncomeGrowthMetricId=typeof AnnualNetIncomeGrowthMetricId[keyof typeof AnnualNetIncomeGrowthMetricId];
export type AnnualNetIncomeMetadata=AnnualCoreMetadata;
export type AnnualNetIncomeDocument=AnnualCoreDocument;
export type AnnualNetIncomePair=AnnualCorePair;
export type AnnualNetIncomePoint=AnnualCorePoint;
export type AnnualNetIncomeGrowthResult=AnnualCoreResult<AnnualNetIncomeGrowthMetricId>;
export type AnnualNetIncomeGrowthCondition=AnnualCoreCondition<AnnualNetIncomeGrowthMetricId>;
export type AnnualNetIncomeGrowthScreeningOptions=AnnualCoreScreeningOptions<AnnualNetIncomeGrowthMetricId>;
export type AnnualNetIncomeGrowthScreeningResult=AnnualCoreScreeningResult<AnnualNetIncomeGrowthMetricId>;
const definition={metricId:AnnualNetIncomeGrowthMetricId.NetIncomeGrowth,sourceMetric:MetricId.NetIncome};
/** J-GAAPの親会社株主利益。(当年-前年)/前年、1=100%。前年が0/負数なら算出しません。 */
export function calculateAnnualNetIncomeGrowth(pair:AnnualNetIncomePair):AnnualNetIncomeGrowthResult {
    return calculateAnnualGrowth(pair,definition);
}
export function screenAnnualNetIncomeGrowth(pairs:readonly AnnualNetIncomePair[],options:AnnualNetIncomeGrowthScreeningOptions={}):AnnualNetIncomeGrowthScreeningResult {
    return screenAnnualGrowth(pairs,definition,options);
}
