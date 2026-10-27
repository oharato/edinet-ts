import { calculateAnnualRevenueGrowth,screenAnnualRevenueGrowth,AnnualGrowthMetricId,ComparisonOperator,AnnualRevenuePair } from "../../src/index";
declare const pair:AnnualRevenuePair;
const result=calculateAnnualRevenueGrowth(pair);if(result.status==="calculated"){const n:string=result.exact.numerator;const value:number=result.value;}
screenAnnualRevenueGrowth([pair],{conditions:[{metric:AnnualGrowthMetricId.NetSalesGrowth,operator:ComparisonOperator.GreaterThanOrEqual,value:0.2}]});
// @ts-expect-error EPS等を同じ成長計算へ混ぜない
screenAnnualRevenueGrowth([pair],{conditions:[{metric:"earningsPerShareGrowth",operator:"gte",value:0.2}]});
// @ts-expect-error 年次分類は明示的なannual
const wrong:AnnualRevenuePair={previous:{...pair.previous,metadata:{...pair.previous.metadata,periodType:"ytd"}},current:pair.current};

import {calculateCagr,screenCagr,CagrMetricId} from "../../src/index";
calculateCagr([pair.previous,pair.current],CagrMetricId.NetSales);
screenCagr([[pair.previous,pair.current]],CagrMetricId.OperatingIncome,{conditions:[{operator:"gte",value:0.1}]});
// @ts-expect-error 分割確認のないEPSはCAGRへ混ぜない
calculateCagr([pair.previous,pair.current],"earningsPerShareCagr");

import { calculateAverageEquityReturn, screenAverageEquityReturn, type AverageEquityReturnInput } from "../../src/index";
declare const equityInput: AverageEquityReturnInput;
const equity = calculateAverageEquityReturn(equityInput);
if (equity.status === "calculated") { const numerator: string = equity.openingEquity.numerator; void numerator; }
screenAverageEquityReturn([equityInput], { conditions: [{ operator: "gte", value: 0.1 }] });
