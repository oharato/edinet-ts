import { MetricId } from "./metric-registry";
import { calculateAnnualGrowth,screenAnnualGrowth,AnnualGrowthUnavailableReason,
    type AnnualCoreMetadata,type AnnualCoreDocument,type AnnualCorePoint,
    type AnnualCoreCondition } from "./annual-growth-core";
export { AnnualGrowthUnavailableReason };
export const AnnualGrowthMetricId = Object.freeze({ NetSalesGrowth: "netSalesGrowth" } as const);
export type AnnualGrowthMetricId = typeof AnnualGrowthMetricId[keyof typeof AnnualGrowthMetricId];
export type AnnualRevenueMetadata=AnnualCoreMetadata;
export interface AnnualRevenueDocument extends AnnualCoreDocument {}
export interface AnnualRevenuePair { previous:AnnualRevenueDocument;current:AnnualRevenueDocument; }
export interface AnnualRevenuePoint extends AnnualCorePoint {}
type RevenueGrowthBase={metricId:AnnualGrowthMetricId;unit:"ratio";previous:AnnualRevenuePoint;current:AnnualRevenuePoint;};
export type AnnualRevenueGrowthResult=RevenueGrowthBase & ({status:"calculated";reason:"calculated";value:number;exact:{numerator:string;denominator:string}}|{status:"unavailable";reason:AnnualGrowthUnavailableReason;value?:never;exact?:never});
export interface AnnualGrowthCondition extends AnnualCoreCondition<AnnualGrowthMetricId> {}
export interface AnnualGrowthScreeningOptions { conditions?:readonly AnnualGrowthCondition[];order?:import("./financial-options").SortOrder;offset?:number;limit?:number; }
export interface AnnualGrowthScreeningResult {rows:Extract<AnnualRevenueGrowthResult,{status:"calculated"}>[];excluded:Extract<AnnualRevenueGrowthResult,{status:"unavailable"}>[];total:number;excludedRows:number;filteredRows:number;reasonCounts:Partial<Record<AnnualGrowthUnavailableReason,number>>;}
const definition={metricId:AnnualGrowthMetricId.NetSalesGrowth,sourceMetric:MetricId.NetSales};
/** 既存売上高API。連続12暦月・正の前年を使い、1=100%で返します。 */
export function calculateAnnualRevenueGrowth(pair:AnnualRevenuePair):AnnualRevenueGrowthResult {
    return calculateAnnualGrowth(pair,definition);
}
export function screenAnnualRevenueGrowth(pairs:readonly AnnualRevenuePair[],options:AnnualGrowthScreeningOptions={}):AnnualGrowthScreeningResult {
    return screenAnnualGrowth(pairs,definition,options);
}
