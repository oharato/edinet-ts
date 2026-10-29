import {createHash} from 'node:crypto';
import {EdinetXbrlParser} from './edinet-xbrl-parser';
import {normalizeFinancialDetailMetadata,type FinancialDetailMetadata} from './financial-detail-metadata';
import {MetricId} from './metric-registry';
import {captureShareBasis,assessShareBasis,type ShareBasis,type ShareBasisAssessment} from './share-basis';
import {selectLocalClosingPrice,type LocalPriceRow,type LocalPriceRequest,type LocalClosingPriceResult} from './local-closing-price';
import {parseDocumentTimestamp} from './document-timestamp';
import {decimalFraction,reduceFraction,compareFractions} from './decimal-fraction';
import {ComparisonOperator,SortOrder} from './financial-options';
import type {FactSelectionResult} from './metric-selection';
import type {AverageAssetsReturnOptions} from './average-assets-return';
export const ValuationMetricId=Object.freeze({PriceToAnnualEarnings:'priceToAnnualEarnings',PriceToBookValue:'priceToBookValue',AnnualPaidDividendYield:'annualPaidDividendYield'}as const);
export type ValuationMetricId=typeof ValuationMetricId[keyof typeof ValuationMetricId];
export type PriceShareBasis={state:'unknown'}|{state:'confirmed';shareClass:'ordinary';basisDate:string;reviewedThrough:string;adjustment:'unadjusted'};
export interface ValuationInput {
 financial:{xml:string;metadata:FinancialDetailMetadata;observedAt:string;shareBasis:ShareBasis};
 price:{rows:readonly LocalPriceRow[];request:LocalPriceRequest;shareBasis:PriceShareBasis;maxAgeDays:number};
}
export type ValuationUnavailableReason='unsupported-standard'|'unsupported-period'|'financial-after-cutoff'|'financial-period-after-price'|'financial-period-after-observation'|'price-unavailable'|'stale-price'|'unavailable-input'|'unsafe-input'|'unverified-share-basis'|'invalid-share-basis-evidence'|'unverified-price-basis'|'incompatible-share-basis'|'unpaid-dividend'|'nonpositive-denominator'|'negative-dividend'|'unsafe-result';
interface ValuationBase{metricId:ValuationMetricId;unit:'multiple'|'ratio';financial:{metadata:FinancialDetailMetadata;observedAt:string;inputXmlSha256:string;selection:FactSelectionResult;shareBasis:ShareBasisAssessment};price:LocalClosingPriceResult;priceShareBasis:PriceShareBasis;maxPriceAgeDays:number;}
export type ValuationResult=ValuationBase&({status:'calculated';reason:'calculated';value:number;exact:{numerator:string;denominator:string};declaration:'source-reviewed-by-caller'}|{status:'unavailable';reason:ValuationUnavailableReason});
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const date=(v:unknown):v is string=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
const metrics={priceToAnnualEarnings:MetricId.EarningsPerShare,priceToBookValue:MetricId.BookValuePerShare,annualPaidDividendYield:MetricId.DividendPaidPerShare}as const;
function capture(input:ValuationInput):ValuationInput {
 if(!record(input)||Object.keys(input).some(k=>!['financial','price'].includes(k)))throw Error('財務と価格原本が必要です');
 const {financial:f,price:p}=input;
 if(!record(f)||Object.keys(f).some(k=>!['xml','metadata','observedAt','shareBasis'].includes(k))||!record(p)||Object.keys(p).some(k=>!['rows','request','shareBasis','maxAgeDays'].includes(k)))throw Error('評価指標原本が不正です');
 const {xml,metadata:rawMetadata,observedAt,shareBasis:rawBasis}=f,metadata=normalizeFinancialDetailMetadata(rawMetadata),shareBasis=captureShareBasis(rawBasis);
 if(typeof xml!=='string'||Buffer.byteLength(xml)>64*1024*1024||parseDocumentTimestamp(observedAt,true)===undefined||!shareBasis)throw Error('財務原本/観測時刻/株式基準が不正です');
 const {rows:rawRows,request:rawRequest,shareBasis:rawPriceBasis,maxAgeDays}=p;
 if(!Array.isArray(rawRows)||!record(rawRequest)||!Number.isSafeInteger(maxAgeDays)||maxAgeDays<0||maxAgeDays>3660)throw Error('価格原本/許容日数が不正です');
 const count=rawRows.length;if(!Number.isSafeInteger(count)||count<0||count>10000)throw Error('価格は一社10,000行以下です');
 const rows=Array.from({length:count},(_,i)=>{const r=rawRows[i];if(!Object.hasOwn(rawRows,i)||!record(r))throw Error('価格行が不正です');return{date:r.date,ticker:r.ticker,close:r.close,volume:r.volume};});
 const request=structuredClone(rawRequest);
 if(Object.keys(request).some(k=>!['secCode','asOf','knownAt','source'].includes(k))||!record(request.source)||Object.keys(request.source).some(k=>!['name','sha256','observedAt'].includes(k)))throw Error('価格出典が不正です');
 if(!record(rawPriceBasis)||Object.keys(rawPriceBasis).some(k=>!['state','shareClass','basisDate','reviewedThrough','adjustment'].includes(k)))throw Error('価格の株式基準が不正です');
 const {state}=rawPriceBasis;
 let priceBasis:PriceShareBasis;
 if(state==='unknown')priceBasis={state};else {const {shareClass,basisDate,reviewedThrough,adjustment}=rawPriceBasis as Extract<PriceShareBasis,{state:'confirmed'}>;if(state!=='confirmed'||shareClass!=='ordinary'||!date(basisDate)||!date(reviewedThrough)||adjustment!=='unadjusted')throw Error('価格の株式基準が不正です');priceBasis={state,shareClass,basisDate,reviewedThrough,adjustment};}
 return{financial:{xml,metadata,observedAt,shareBasis},price:{rows,request,shareBasis:priceBasis,maxAgeDays}};
}
/** 実績一株値と未調整終値。同じ株式基準は原本確認済みの呼出元宣言で要求します。 */
export function calculateValuation(input:ValuationInput,metricId:ValuationMetricId):ValuationResult {
 if(!Object.hasOwn(metrics,metricId))throw Error('既知の評価指標が必要です');
 const {financial:f,price:p}=capture(input),object=new EdinetXbrlParser().parse(f.xml,f.metadata.docID),selection=object.selectMetric(metrics[metricId],f.metadata,{collapseIdenticalDuplicates:true}),basis=assessShareBasis(object,f.shareBasis,selection.source?.entity),price=selectLocalClosingPrice(p.rows,p.request);
 if(price.secCode!==f.metadata.secCode)throw Error('価格と財務の証券コードが異なります');
 const base:ValuationBase={metricId,unit:metricId==='annualPaidDividendYield'?'ratio':'multiple',financial:{metadata:f.metadata,observedAt:f.observedAt,inputXmlSha256:createHash('sha256').update(f.xml).digest('hex'),selection,shareBasis:basis},price,priceShareBasis:p.shareBasis,maxPriceAgeDays:p.maxAgeDays},unavailable=(reason:ValuationUnavailableReason):ValuationResult=>({...base,status:'unavailable',reason});
 if(f.metadata.accountingStandard!=='J-GAAP')return unavailable('unsupported-standard');
 const period=f.metadata.period,end=period.instant??period.endDate!;
 if(metricId==='priceToBookValue'?!period.instant:!annual(f.metadata))return unavailable('unsupported-period');
 if(parseDocumentTimestamp(f.observedAt,true)!>parseDocumentTimestamp(p.request.knownAt,true)!)return unavailable('financial-after-cutoff');
 if(end>new Date(parseDocumentTimestamp(f.observedAt,true)!+9*3600000).toISOString().slice(0,10))return unavailable('financial-period-after-observation');
 if(end>p.request.asOf)return unavailable('financial-period-after-price');
 if(price.status!=='available')return unavailable('price-unavailable');
 if(price.ageDays>p.maxAgeDays)return unavailable('stale-price');
 if(selection.status!=='selected')return unavailable('unavailable-input');if(selection.safeNumber===undefined)return unavailable('unsafe-input');
 if(basis.status!=='reference-matched')return unavailable(basis.reason);
 const key=f.metadata.scope==='Consolidated'?'jpcrp_cor:BusinessResultsOfGroupTextBlock':'jpcrp_cor:BusinessResultsOfReportingCompanyTextBlock';
 const proofContext=[...object.findContexts({type:'Instant',scope:'Consolidated'}),...object.findContexts({type:'Instant',scope:'NonConsolidated'})].find(c=>c.id===basis.proof.contextRef);
 if(basis.proof.key!==key||!proofContext?.period.instant||proofContext.period.instant>new Date(parseDocumentTimestamp(f.observedAt,true)!+9*3600000).toISOString().slice(0,10))return unavailable('invalid-share-basis-evidence');
 if(p.shareBasis.state!=='confirmed')return unavailable('unverified-price-basis');
 const knownDate=new Date(parseDocumentTimestamp(p.request.knownAt,true)!+9*3600000).toISOString().slice(0,10);
 if(p.shareBasis.basisDate!==basis.basisDate||basis.basisDate>knownDate||p.shareBasis.reviewedThrough<p.request.asOf||p.shareBasis.reviewedThrough>knownDate)return unavailable('incompatible-share-basis');
 if(metricId==='annualPaidDividendYield'&&basis.dividendStatus!=='paid')return unavailable('unpaid-dividend');
 const value=selection.safeNumber;
 if(metricId!=='annualPaidDividendYield'&&value<=0)return unavailable('nonpositive-denominator');
 if(metricId==='annualPaidDividendYield'&&value<0)return unavailable('negative-dividend');
 const a=decimalFraction(metricId==='annualPaidDividendYield'?value:price.close),b=decimalFraction(metricId==='annualPaidDividendYield'?price.close:value),exact=reduceFraction(a.numerator*b.denominator,a.denominator*b.numerator),approx=Number(exact.numerator)/Number(exact.denominator);
 if(!Number.isFinite(approx)||approx===0&&exact.numerator!==0n||Math.abs(approx)>Number.MAX_SAFE_INTEGER)return unavailable('unsafe-result');
 return{...base,status:'calculated',reason:'calculated',value:approx,exact:{numerator:String(exact.numerator),denominator:String(exact.denominator)},declaration:'source-reviewed-by-caller'};
}
function annual(metadata:FinancialDetailMetadata):boolean {
 if(metadata.periodType!=='annual'||!metadata.period.startDate||!metadata.period.endDate)return false;
 const end=new Date(metadata.period.startDate+'T00:00:00Z');if(end.getUTCDate()!==1)return false;end.setUTCFullYear(end.getUTCFullYear()+1);end.setUTCDate(0);return end.toISOString().slice(0,10)===metadata.period.endDate;
}
export function screenValuation(inputs:readonly ValuationInput[],metricId:ValuationMetricId,options:AverageAssetsReturnOptions={}) {
 if(!Array.isArray(inputs)||!record(options)||Object.keys(options).some(k=>!['conditions','order','offset','limit'].includes(k)))throw Error('評価検索が不正です');
 const count=inputs.length;if(!Number.isSafeInteger(count)||count<0||count>100)throw Error('評価比較は100社以下です');
 const {conditions:raw=[],order='desc',offset=0,limit}=options;
 if(!Array.isArray(raw)||!Object.values(SortOrder).includes(order)||[offset,limit].some(v=>v!==undefined&&(!Number.isSafeInteger(v)||v<0)))throw Error('評価検索条件が不正です');
 const conditionCount=raw.length;if(!Number.isSafeInteger(conditionCount)||conditionCount<0||conditionCount>100)throw Error('評価比較条件は100件以下です');
 const conditions=Array.from({length:conditionCount},(_,i)=>{const c=raw[i];if(!record(c)||Object.keys(c).some(k=>!['operator','value'].includes(k)))throw Error('評価比較が不正です');const {operator,value}=c;if(!Object.values(ComparisonOperator).includes(operator)||!Number.isFinite(value))throw Error('評価比較が不正です');return{operator,value};});
 const captured=Array.from({length:count},(_,i)=>{if(!Object.hasOwn(inputs,i))throw Error('評価入力が欠落しています');return capture(inputs[i]);});
 if(captured.reduce((n,i)=>n+Buffer.byteLength(i.financial.xml),0)>256*1024*1024||captured.reduce((n,i)=>n+i.price.rows.length,0)>100000)throw Error('評価比較の原本上限を超えました');
 if(!Object.hasOwn(metrics,metricId))throw Error('既知の評価指標が必要です');
 const results=captured.map(i=>calculateValuation(i,metricId)),codes=new Set<string>(),docs=new Map<string,string>();
 const cohort=(r:ValuationResult)=>JSON.stringify([r.financial.metadata.accountingStandard,r.financial.metadata.scope,r.financial.metadata.currency,r.financial.metadata.periodType,r.financial.metadata.period,r.price.asOf,parseDocumentTimestamp(r.price.knownAt,true),r.maxPriceAgeDays]);
 for(const r of results){const code=r.financial.metadata.secCode;if(codes.has(code)||cohort(r)!==cohort(results[0]))throw Error('評価比較の会社/期間/価格条件が混在しています');codes.add(code);const doc=r.financial.metadata.docID;if(docs.has(doc)&&docs.get(doc)!==code)throw Error('別会社の書類IDです');docs.set(doc,code);}
 const selected=results.filter((r):r is Extract<ValuationResult,{status:'calculated'}>=>r.status==='calculated'),excluded=results.filter((r):r is Extract<ValuationResult,{status:'unavailable'}>=>r.status==='unavailable');
 const fraction=(r:typeof selected[number])=>({numerator:BigInt(r.exact.numerator),denominator:BigInt(r.exact.denominator)}),rows=selected.filter(r=>conditions.every(c=>{const d=compareFractions(fraction(r),decimalFraction(c.value));return c.operator==='gte'?d>=0:c.operator==='lte'?d<=0:c.operator==='gt'?d>0:c.operator==='lt'?d<0:d===0;}));
 rows.sort((a,b)=>compareFractions(fraction(a),fraction(b))*(order==='asc'?1:-1)||a.financial.metadata.secCode.localeCompare(b.financial.metadata.secCode));
 return{rows:rows.slice(offset,limit===undefined?undefined:offset+limit),excluded,total:rows.length,excludedRows:excluded.length,filteredRows:selected.length-rows.length};
}
