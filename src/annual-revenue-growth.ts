import { MetricId } from "./metric-registry";
import {
    calculateAnnualGrowth,
    screenAnnualGrowth,
    AnnualGrowthUnavailableReason,
    type AnnualCoreMetadata,
    type AnnualCoreDocument,
    type AnnualCorePoint,
    type AnnualCoreResult,
    type AnnualCoreCondition,
    type AnnualCoreScreeningOptions,
    type AnnualCoreScreeningResult,
} from "./annual-growth-core";

export { AnnualGrowthUnavailableReason };
export const AnnualGrowthMetricId = Object.freeze({ NetSalesGrowth: "netSalesGrowth" } as const);
export type AnnualGrowthMetricId = typeof AnnualGrowthMetricId[keyof typeof AnnualGrowthMetricId];
export type AnnualRevenueMetadata = AnnualCoreMetadata;
export interface AnnualRevenueDocument extends AnnualCoreDocument {}
export interface AnnualRevenuePair {
    previous: AnnualRevenueDocument;
    current: AnnualRevenueDocument;
}
export interface AnnualRevenuePoint extends AnnualCorePoint {}
export type AnnualRevenueGrowthResult = AnnualCoreResult<AnnualGrowthMetricId> & {
    previous: AnnualRevenuePoint;
    current: AnnualRevenuePoint;
};
export interface AnnualGrowthCondition extends AnnualCoreCondition<AnnualGrowthMetricId> {}
export interface AnnualGrowthScreeningOptions extends AnnualCoreScreeningOptions<AnnualGrowthMetricId> {
    conditions?: readonly AnnualGrowthCondition[];
}
export interface AnnualGrowthScreeningResult extends AnnualCoreScreeningResult<AnnualGrowthMetricId> {
    rows: Extract<AnnualRevenueGrowthResult, { status: "calculated" }>[];
    excluded: Extract<AnnualRevenueGrowthResult, { status: "unavailable" }>[];
}

const definition = { metricId: AnnualGrowthMetricId.NetSalesGrowth, sourceMetric: MetricId.NetSales };

/** 連続12暦月・正の前年を使い、1=100%で返します。 */
export function calculateAnnualRevenueGrowth(pair: AnnualRevenuePair): AnnualRevenueGrowthResult {
    return calculateAnnualGrowth(pair, definition);
}

export function screenAnnualRevenueGrowth(
    pairs: readonly AnnualRevenuePair[],
    options: AnnualGrowthScreeningOptions = {},
): AnnualGrowthScreeningResult {
    return screenAnnualGrowth(pairs, definition, options);
}
