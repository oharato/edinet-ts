import { createHash } from "node:crypto";
import { XMLValidator } from "fast-xml-parser";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { MetricId } from "./metric-registry";
import type { FactSelectionResult } from "./metric-selection";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import { ComparisonOperator, SortOrder } from "./financial-options";
import { decimalFraction, compareFractions, reduceFraction } from "./decimal-fraction";

export const AnnualGrowthMetricId = Object.freeze({ NetSalesGrowth: "netSalesGrowth" } as const);
export type AnnualGrowthMetricId = typeof AnnualGrowthMetricId[keyof typeof AnnualGrowthMetricId];
export type AnnualRevenueMetadata = Omit<FinancialDetailMetadata,"period"|"periodType"|"accountingStandard"> & {
    accountingStandard:"J-GAAP";period:{startDate:string;endDate:string};periodType:"annual";
};
export interface AnnualRevenueDocument { xml:string;metadata:AnnualRevenueMetadata; }
export interface AnnualRevenuePair { previous:AnnualRevenueDocument;current:AnnualRevenueDocument; }
export interface AnnualRevenuePoint { metadata:FinancialDetailMetadata;selection:FactSelectionResult;inputXmlSha256:string; }
export const AnnualGrowthUnavailableReason = Object.freeze({
    UnsupportedStandard:"unsupported-standard",IncompatibleMetadata:"incompatible-metadata",NotAnnual:"not-annual",
    UnsupportedAnnualPeriod:"unsupported-annual-period",NonConsecutivePeriods:"non-consecutive-periods",UnavailableInput:"unavailable-input",
    IncompatibleEntity:"incompatible-entity",UnsafeInput:"unsafe-input",ZeroBase:"zero-base",NegativeBase:"negative-base",UnsafeResult:"unsafe-result"
} as const);
export type AnnualGrowthUnavailableReason = typeof AnnualGrowthUnavailableReason[keyof typeof AnnualGrowthUnavailableReason];
type GrowthBase={metricId:AnnualGrowthMetricId;unit:"ratio";previous:AnnualRevenuePoint;current:AnnualRevenuePoint;};
export type AnnualRevenueGrowthResult = GrowthBase & ({status:"calculated";reason:"calculated";value:number;exact:{numerator:string;denominator:string}}|
    {status:"unavailable";reason:AnnualGrowthUnavailableReason;value?:never;exact?:never});
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
function point(document:AnnualRevenueDocument):AnnualRevenuePoint {
    if(!record(document)||Object.keys(document).some(key=>!["xml","metadata"].includes(key)))throw new Error("原本XMLとmetadataが必要です");
    const metadata=normalizeFinancialDetailMetadata(document.metadata);
    if(typeof document.xml!=="string"||XMLValidator.validate(document.xml)!==true)throw new Error("整形式の原本XMLが必要です");
    const object=new EdinetXbrlParser().parse(document.xml,metadata.docID);
    return {metadata,selection:object.selectMetric(MetricId.NetSales,{accountingStandard:metadata.accountingStandard,scope:metadata.scope,period:metadata.period}),inputXmlSha256:createHash("sha256").update(document.xml).digest("hex")};
}
function twelveMonths(start:string,end:string):boolean {
    const date=new Date(start+"T00:00:00Z");if(date.getUTCDate()!==1)return false;
    date.setUTCFullYear(date.getUTCFullYear()+1);date.setUTCDate(0);
    return date.toISOString().slice(0,10)===end;
}
const nextDay=(date:string)=>new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10);
const fraction=(result:Extract<AnnualRevenueGrowthResult,{status:"calculated"}>)=>({numerator:BigInt(result.exact.numerator),denominator:BigInt(result.exact.denominator)});
/** J-GAAP・JPYの連続する12暦月売上高だけ。(当年-前年)/前年、小数1=100%。 */
export function calculateAnnualRevenueGrowth(pair:AnnualRevenuePair):AnnualRevenueGrowthResult {
    if(!record(pair)||Object.keys(pair).some(key=>!["previous","current"].includes(key)))throw new Error("previous/currentを明示してください");
    const previous=point(pair.previous),current=point(pair.current),base:GrowthBase={metricId:"netSalesGrowth",unit:"ratio",previous,current};
    const unavailable=(reason:AnnualGrowthUnavailableReason):AnnualRevenueGrowthResult=>({...base,status:"unavailable",reason});
    const a=previous.metadata,b=current.metadata;
    if(a.accountingStandard!=="J-GAAP"||b.accountingStandard!=="J-GAAP")return unavailable("unsupported-standard");
    if(a.secCode!==b.secCode||a.scope!==b.scope||a.currency!==b.currency)return unavailable("incompatible-metadata");
    if(a.periodType!=="annual"||b.periodType!=="annual"||!a.period.startDate||!a.period.endDate||!b.period.startDate||!b.period.endDate)return unavailable("not-annual");
    if(!twelveMonths(a.period.startDate,a.period.endDate)||!twelveMonths(b.period.startDate,b.period.endDate))return unavailable("unsupported-annual-period");
    if(nextDay(a.period.endDate)!==b.period.startDate)return unavailable("non-consecutive-periods");
    const x=previous.selection,y=current.selection;
    if(x.status!=="selected"||y.status!=="selected")return unavailable("unavailable-input");
    const xe=x.source.entity,ye=y.source.entity;
    if(!xe||!ye||xe.scheme!==ye.scheme||xe.identifier!==ye.identifier)return unavailable("incompatible-entity");
    if(x.safeNumber===undefined||y.safeNumber===undefined)return unavailable("unsafe-input");
    if(x.safeNumber===0)return unavailable("zero-base");if(x.safeNumber<0)return unavailable("negative-base");
    const prior=decimalFraction(x.safeNumber),now=decimalFraction(y.safeNumber);
    const exact=reduceFraction(now.numerator*prior.denominator-prior.numerator*now.denominator,now.denominator*prior.numerator);
    if(compareFractions({numerator:exact.numerator<0n?-exact.numerator:exact.numerator,denominator:exact.denominator},decimalFraction(Number.MAX_SAFE_INTEGER))>0)return unavailable("unsafe-result");
    let value=Number(exact.numerator)/Number(exact.denominator);
    if(!Number.isFinite(value)||value===0&&exact.numerator!==0n)value=(y.safeNumber-x.safeNumber)/x.safeNumber;
    if(!Number.isFinite(value)||value===0&&exact.numerator!==0n||Math.abs(value)>Number.MAX_SAFE_INTEGER)return unavailable("unsafe-result");
    return {...base,status:"calculated",reason:"calculated",value,exact:{numerator:String(exact.numerator),denominator:String(exact.denominator)}};
}
export interface AnnualGrowthCondition {metric:AnnualGrowthMetricId;operator:ComparisonOperator;value:number;}
export interface AnnualGrowthScreeningOptions {conditions?:readonly AnnualGrowthCondition[];order?:SortOrder;offset?:number;limit?:number;}
export interface AnnualGrowthScreeningResult {rows:Extract<AnnualRevenueGrowthResult,{status:"calculated"}>[];excluded:Extract<AnnualRevenueGrowthResult,{status:"unavailable"}>[];total:number;excludedRows:number;filteredRows:number;reasonCounts:Partial<Record<AnnualGrowthUnavailableReason,number>>;}
/** 各社の両期間を先に揃え、分数で条件/並び/ページを決めます。最新原本を推測しません。 */
export function screenAnnualRevenueGrowth(pairs:readonly AnnualRevenuePair[],options:AnnualGrowthScreeningOptions={}):AnnualGrowthScreeningResult {
    if(!Array.isArray(pairs)||!record(options)||Object.keys(options).some(key=>!["conditions","order","offset","limit"].includes(key)))throw new Error("不正な前年比検索入力です");
    if(options.conditions!==undefined&&!Array.isArray(options.conditions))throw new Error("conditionsは配列です");
    const conditions=Array.from(options.conditions??[]) as AnnualGrowthCondition[];
    for(const c of conditions)if(!record(c)||Object.keys(c).some(key=>!["metric","operator","value"].includes(key))||c.metric!=="netSalesGrowth"||!Object.values(ComparisonOperator).includes(c.operator)||!Number.isFinite(c.value))throw new Error("不正な前年比条件です");
    if(options.order!==undefined&&!Object.values(SortOrder).includes(options.order))throw new Error("不正な並べ替え順です");
    for(const value of [options.offset,options.limit])if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))throw new Error("offset/limitは0以上の安全な整数です");
    const normalized=Array.from(pairs,pair=>{
        if(!record(pair)||!record(pair.previous)||!record(pair.current))throw new Error("previous/currentが必要です");
        return {previous:normalizeFinancialDetailMetadata(pair.previous.metadata),current:normalizeFinancialDetailMetadata(pair.current.metadata)};
    });
    const cohort=(meta:FinancialDetailMetadata)=>[meta.scope,meta.accountingStandard,meta.currency,meta.periodType,meta.period.instant,meta.period.startDate,meta.period.endDate];
    const keys=new Set<string>(),owners=new Map<string,string>();
    for(const meta of normalized){
        if(keys.has(meta.current.secCode))throw new Error("同じ企業の複数pair候補を自動選択しません");keys.add(meta.current.secCode);
        for(const source of [meta.previous,meta.current]){const owner=owners.get(source.docID);if(owner!==undefined&&owner!==source.secCode)throw new Error("同じ書類IDを別の企業へ再使用しません");owners.set(source.docID,source.secCode);}
        if(JSON.stringify([cohort(meta.previous),cohort(meta.current)])!==JSON.stringify([cohort(normalized[0].previous),cohort(normalized[0].current)]))throw new Error("企業間で両期間/分類/範囲/基準/通貨が混在しています");
    }
    const rows:AnnualGrowthScreeningResult["rows"]=[],excluded:AnnualGrowthScreeningResult["excluded"]=[],reasonCounts:AnnualGrowthScreeningResult["reasonCounts"]={};let filteredRows=0;
    for(let i=0;i<pairs.length;i++){const result=calculateAnnualRevenueGrowth({
        previous:{xml:pairs[i].previous.xml,metadata:normalized[i].previous as AnnualRevenueMetadata},
        current:{xml:pairs[i].current.xml,metadata:normalized[i].current as AnnualRevenueMetadata}
    });
        if(result.status==="unavailable"){excluded.push(result);reasonCounts[result.reason]=(reasonCounts[result.reason]??0)+1;continue;}
        const matches=conditions.every(c=>{const difference=compareFractions(fraction(result),decimalFraction(c.value));return c.operator==="gte"?difference>=0:c.operator==="lte"?difference<=0:c.operator==="gt"?difference>0:c.operator==="lt"?difference<0:difference===0;});
        if(matches)rows.push(result);else filteredRows++;
    }
    rows.sort((a,b)=>compareFractions(fraction(a),fraction(b))*(options.order==="asc"?1:-1)||(a.current.metadata.secCode<b.current.metadata.secCode?-1:a.current.metadata.secCode>b.current.metadata.secCode?1:0));
    const offset=options.offset??0;return {rows:rows.slice(offset,options.limit===undefined?undefined:offset+options.limit),excluded,total:rows.length,excludedRows:excluded.length,filteredRows,reasonCounts};
}
