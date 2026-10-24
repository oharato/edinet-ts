import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { MetricId } from "./metric-registry";
import type { FactSelectionResult } from "./metric-selection";
import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import { ComparisonOperator, SortOrder } from "./financial-options";
import { decimalFraction, compareFractions, reduceFraction } from "./decimal-fraction";

export type AnnualCoreMetadata = Omit<FinancialDetailMetadata,"period"|"periodType"|"accountingStandard"> & {
    accountingStandard:"J-GAAP";period:{startDate:string;endDate:string};periodType:"annual";
};
export interface AnnualCoreDocument { xml:string;metadata:AnnualCoreMetadata; }
export interface AnnualCorePair { previous:AnnualCoreDocument;current:AnnualCoreDocument; }
export interface AnnualCorePoint { metadata:FinancialDetailMetadata;selection:FactSelectionResult;inputXmlSha256:string; }
export const AnnualGrowthUnavailableReason = Object.freeze({
    UnsupportedStandard:"unsupported-standard",IncompatibleMetadata:"incompatible-metadata",NotAnnual:"not-annual",
    UnsupportedAnnualPeriod:"unsupported-annual-period",NonConsecutivePeriods:"non-consecutive-periods",UnavailableInput:"unavailable-input",
    IncompatibleEntity:"incompatible-entity",UnsafeInput:"unsafe-input",ZeroBase:"zero-base",NegativeBase:"negative-base",UnsafeResult:"unsafe-result"
} as const);
export type AnnualGrowthUnavailableReason = typeof AnnualGrowthUnavailableReason[keyof typeof AnnualGrowthUnavailableReason];
type GrowthBase<Id extends string>={metricId:Id;unit:"ratio";previous:AnnualCorePoint;current:AnnualCorePoint;};
export type AnnualCoreResult<Id extends string> = GrowthBase<Id> & ({status:"calculated";reason:"calculated";value:number;exact:{numerator:string;denominator:string}}|
    {status:"unavailable";reason:AnnualGrowthUnavailableReason;value?:never;exact?:never});
export interface AnnualCoreDefinition<Id extends string> { metricId:Id;sourceMetric:MetricId; }
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==="object"&&!Array.isArray(v);
/** metadataとperiodの属性を一度だけ取得して既存検査へ渡します。 */
function copyMetadata(value:FinancialDetailMetadata):FinancialDetailMetadata {
    if(!record(value)||Object.keys(value).some(key=>!["secCode","docID","scope","accountingStandard","currency","period","periodType"].includes(key)))throw new Error("不正な財務明細metadataです");
    const captured:Record<string,unknown>={};
    for(const key of Object.keys(value))captured[key]=(value as Record<string,unknown>)[key];
    const period=captured.period;
    if(!record(period)||Object.keys(period).some(key=>!["instant","startDate","endDate"].includes(key)))throw new Error("正しい期間が必要です");
    const dates:Record<string,unknown>={};for(const key of Object.keys(period))dates[key]=period[key];
    captured.period=dates;
    return normalizeFinancialDetailMetadata(captured as FinancialDetailMetadata);
}
/** 全metadataの固定後にXMLを取得し、cohort検査後も同じ入力だけを使います。 */
function capturePairs(pairs:readonly AnnualCorePair[]):AnnualCorePair[] {
    const metadataPairs=Array.from(pairs,pair=>{
        if(!record(pair)||Object.keys(pair).some(key=>!["previous","current"].includes(key)))throw new Error("previous/currentを明示してください");
        const previous=pair.previous,current=pair.current;
        const capture=(document:AnnualCoreDocument)=>{
            if(!record(document)||Object.keys(document).some(key=>!["xml","metadata"].includes(key)))throw new Error("原本XMLとmetadataが必要です");
            const sourceMetadata=document.metadata;
            return {document,metadata:copyMetadata(sourceMetadata)};
        };
        return {previous:capture(previous),current:capture(current)};
    });
    return metadataPairs.map(pair=>{
        const capture=(point:typeof pair.previous):AnnualCoreDocument=>{
            const xml=point.document.xml;
            if(typeof xml!=="string")throw new Error("原本XML文字列が必要です");
            return {xml,metadata:point.metadata as AnnualCoreMetadata};
        };
        return {previous:capture(pair.previous),current:capture(pair.current)};
    });
}
function point(document:AnnualCoreDocument,sourceMetric:MetricId):AnnualCorePoint {
    const {xml,metadata}=document;
    const object=new EdinetXbrlParser().parse(xml,metadata.docID);
    return {metadata,selection:object.selectMetric(sourceMetric,{accountingStandard:metadata.accountingStandard,scope:metadata.scope,period:metadata.period}),inputXmlSha256:createHash("sha256").update(xml).digest("hex")};
}
function twelveMonths(start:string,end:string):boolean {
    const date=new Date(start+"T00:00:00Z");if(date.getUTCDate()!==1)return false;
    date.setUTCFullYear(date.getUTCFullYear()+1);date.setUTCDate(0);
    return date.toISOString().slice(0,10)===end;
}
const nextDay=(date:string)=>new Date(Date.parse(date+"T00:00:00Z")+86400000).toISOString().slice(0,10);
const fraction=(result:Extract<AnnualCoreResult<string>,{status:"calculated"}>)=>({numerator:BigInt(result.exact.numerator),denominator:BigInt(result.exact.denominator)});
/** J-GAAP・JPYの連続12暦月。表示値と検索用の正確な分数を分けます。 */
export function calculateAnnualGrowth<Id extends string>(pair:AnnualCorePair,definition:AnnualCoreDefinition<Id>):AnnualCoreResult<Id> {
    return calculateCaptured(capturePairs([pair])[0],definition);
}
function calculateCaptured<Id extends string>(pair:AnnualCorePair,definition:AnnualCoreDefinition<Id>):AnnualCoreResult<Id> {
    const previous=point(pair.previous,definition.sourceMetric),current=point(pair.current,definition.sourceMetric),base:GrowthBase<Id>={metricId:definition.metricId,unit:"ratio",previous,current};
    const unavailable=(reason:AnnualGrowthUnavailableReason):AnnualCoreResult<Id>=>({...base,status:"unavailable",reason});
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
export interface AnnualCoreCondition<Id extends string> {metric:Id;operator:ComparisonOperator;value:number;}
export interface AnnualCoreScreeningOptions<Id extends string> {conditions?:readonly AnnualCoreCondition<Id>[];order?:SortOrder;offset?:number;limit?:number;}
export interface AnnualCoreScreeningResult<Id extends string> {rows:Extract<AnnualCoreResult<Id>,{status:"calculated"}>[];excluded:Extract<AnnualCoreResult<Id>,{status:"unavailable"}>[];total:number;excludedRows:number;filteredRows:number;reasonCounts:Partial<Record<AnnualGrowthUnavailableReason,number>>;}
/** 各社の両期間を先に揃え、分数で条件/並び/ページを決めます。最新原本を推測しません。 */
export function screenAnnualGrowth<Id extends string>(pairs:readonly AnnualCorePair[],definition:AnnualCoreDefinition<Id>,options:AnnualCoreScreeningOptions<Id>={}):AnnualCoreScreeningResult<Id> {
    if(!Array.isArray(pairs)||!record(options)||Object.keys(options).some(key=>!["conditions","order","offset","limit"].includes(key)))throw new Error("不正な前年比検索入力です");
    // getterを評価するのは各属性一度だけ。検査・比較・順序・ページで同じ設定を使います。
    const settings:Record<string,any>={};for(const key of Object.keys(options))settings[key]=(options as Record<string,unknown>)[key];
    if(settings.conditions!==undefined&&!Array.isArray(settings.conditions))throw new Error("conditionsは配列です");
    const conditions=Array.from(settings.conditions??[],(condition:AnnualCoreCondition<Id>)=>{
        if(!record(condition)||Object.keys(condition).some(key=>!["metric","operator","value"].includes(key)))throw new Error("不正な前年比条件です");
        const captured:Record<string,any>={};for(const key of Object.keys(condition))captured[key]=(condition as unknown as Record<string,unknown>)[key];
        return captured as AnnualCoreCondition<Id>;
    });
    for(const c of conditions)if(!record(c)||Object.keys(c).some(key=>!["metric","operator","value"].includes(key))||c.metric!==definition.metricId||!Object.values(ComparisonOperator).includes(c.operator)||!Number.isFinite(c.value))throw new Error("不正な前年比条件です");
    if(settings.order!==undefined&&!Object.values(SortOrder).includes(settings.order))throw new Error("不正な並べ替え順です");
    for(const value of [settings.offset,settings.limit])if(value!==undefined&&(!Number.isSafeInteger(value)||value<0))throw new Error("offset/limitは0以上の安全な整数です");
    const captured=capturePairs(pairs);
    const normalized=captured.map(pair=>({previous:pair.previous.metadata,current:pair.current.metadata}));
    const cohort=(meta:FinancialDetailMetadata)=>[meta.scope,meta.accountingStandard,meta.currency,meta.periodType,meta.period.instant,meta.period.startDate,meta.period.endDate];
    const keys=new Set<string>(),owners=new Map<string,string>();
    for(const meta of normalized){
        if(keys.has(meta.current.secCode))throw new Error("同じ企業の複数pair候補を自動選択しません");keys.add(meta.current.secCode);
        for(const source of [meta.previous,meta.current]){const owner=owners.get(source.docID);if(owner!==undefined&&owner!==source.secCode)throw new Error("同じ書類IDを別の企業へ再使用しません");owners.set(source.docID,source.secCode);}
        if(JSON.stringify([cohort(meta.previous),cohort(meta.current)])!==JSON.stringify([cohort(normalized[0].previous),cohort(normalized[0].current)]))throw new Error("企業間で両期間/分類/範囲/基準/通貨が混在しています");
    }
    const rows:AnnualCoreScreeningResult<Id>["rows"]=[],excluded:AnnualCoreScreeningResult<Id>["excluded"]=[],reasonCounts:AnnualCoreScreeningResult<Id>["reasonCounts"]={};let filteredRows=0;
    for(const pair of captured){const result=calculateCaptured(pair,definition);
        if(result.status==="unavailable"){excluded.push(result);reasonCounts[result.reason]=(reasonCounts[result.reason]??0)+1;continue;}
        const matches=conditions.every(c=>{const difference=compareFractions(fraction(result),decimalFraction(c.value));return c.operator==="gte"?difference>=0:c.operator==="lte"?difference<=0:c.operator==="gt"?difference>0:c.operator==="lt"?difference<0:difference===0;});
        if(matches)rows.push(result);else filteredRows++;
    }
    rows.sort((a,b)=>compareFractions(fraction(a),fraction(b))*(settings.order==="asc"?1:-1)||(a.current.metadata.secCode<b.current.metadata.secCode?-1:a.current.metadata.secCode>b.current.metadata.secCode?1:0));
    const offset=settings.offset??0;return {rows:rows.slice(offset,settings.limit===undefined?undefined:offset+settings.limit),excluded,total:rows.length,excludedRows:excluded.length,filteredRows,reasonCounts};
}
