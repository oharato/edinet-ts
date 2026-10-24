import { calculateAnnualOperatingIncomeGrowth,screenAnnualOperatingIncomeGrowth,AnnualOperatingIncomeGrowthMetricId,
 calculateAnnualRevenueGrowth,screenAnnualRevenueGrowth,AnnualGrowthMetricId,ComparisonOperator,
 type AnnualOperatingIncomePair,type AnnualOperatingIncomeGrowthResult,type AnnualRevenueGrowthResult } from "../../src/index";
declare const pair:AnnualOperatingIncomePair;
const result:AnnualOperatingIncomeGrowthResult=calculateAnnualOperatingIncomeGrowth(pair);
const literal:"operatingIncomeGrowth"=result.metricId;
if(result.status==="calculated"){const n:string=result.exact.numerator;const value:number=result.value;}
if(result.status==="unavailable"){
 // @ts-expect-error 未計算値をnumberとして使えない
 const value:number=result.value;
}
screenAnnualOperatingIncomeGrowth([pair],{conditions:[{metric:AnnualOperatingIncomeGrowthMetricId.OperatingIncomeGrowth,operator:ComparisonOperator.GreaterThanOrEqual,value:0.2}]});
// @ts-expect-error 新APIの条件へ旧売上IDを混ぜない
screenAnnualOperatingIncomeGrowth([pair],{conditions:[{metric:AnnualGrowthMetricId.NetSalesGrowth,operator:"eq",value:0}]});
// @ts-expect-error 旧売上APIの条件集合を広げない
screenAnnualRevenueGrowth([pair],{conditions:[{metric:AnnualOperatingIncomeGrowthMetricId.OperatingIncomeGrowth,operator:"eq",value:0}]});
const old:AnnualRevenueGrowthResult=calculateAnnualRevenueGrowth(pair);const oldLiteral:"netSalesGrowth"=old.metricId;
if(old.status==="calculated"){const n:string=old.exact.numerator;const value:number=old.value;}
// @ts-expect-error 年次分類はannualだけ
const wrong:AnnualOperatingIncomePair={previous:{...pair.previous,metadata:{...pair.previous.metadata,periodType:"ytd"}},current:pair.current};
