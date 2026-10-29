import {createHash} from 'node:crypto';
import {EdinetXbrlParser} from './edinet-xbrl-parser';
import {normalizeFinancialDetailMetadata,type FinancialDetailMetadata} from './financial-detail-metadata';
import {validateAnnualBalanceMetadata,type AnnualBalanceMetadataReason} from './annual-balance-return-core';
import {FinancialDetailMetricId} from './financial-detail-registry';
import {MetricId} from './metric-registry';
import {parseDocumentTimestamp} from './document-timestamp';
import {ComparisonOperator,SortOrder} from './financial-options';
import {compareFractions} from './decimal-fraction';
import type {AverageAssetsReturnOptions} from './average-assets-return';
import type {FactSelectionResult} from './metric-selection';
import type {AnnualCoreDocument} from './annual-growth-core';
import {decimalFraction,reduceFraction,type DecimalFraction} from './decimal-fraction';
export const ROIC_DEBT_METRICS=Object.freeze(['shortTermLoansPayable','currentPortionOfLongTermLoansPayable','longTermLoansPayable','currentPortionOfBonds','bondsPayable','leaseObligationsCL','leaseObligationsNCL','commercialPapers','shortTermBondsPayable'] as const);
export type RoicDebtMetricId=typeof ROIC_DEBT_METRICS[number];
export type RoicCapitalDeclaration={state:'unknown'}|{state:'confirmed';debtMetricIds:readonly RoicDebtMetricId[];proof:{key:'jpcrp_cor:ConsolidatedBalanceSheetTextBlock'|'jpcrp_cor:BalanceSheetTextBlock';contextRef:string;rawSha256:string}};
export interface RoicCapitalDocument{xml:string;metadata:FinancialDetailMetadata;capitalDeclaration:RoicCapitalDeclaration;}
export interface RoicInput{income:AnnualCoreDocument;opening:RoicCapitalDocument;closing:RoicCapitalDocument;}
interface RoicIncomePoint{metadata:FinancialDetailMetadata;inputXmlSha256:string;operatingIncome:FactSelectionResult;incomeBeforeIncomeTaxes:FactSelectionResult<string>;incomeTaxes:FactSelectionResult<string>;}
interface RoicCapitalPoint{metadata:FinancialDetailMetadata;inputXmlSha256:string;equity:FactSelectionResult<string>;debts:{metricId:RoicDebtMetricId;selection:FactSelectionResult<string>}[];capitalDeclaration:RoicCapitalDeclaration;}
interface Exact{numerator:string;denominator:string;}
export type RoicUnavailableReason=AnnualBalanceMetadataReason|'unverified-capital-definition'|'invalid-capital-reference'|'unavailable-input'|'unsafe-input'|'incompatible-entity'|'negative-debt'|'nonpositive-pretax-income'|'tax-rate-out-of-range'|'nonpositive-invested-capital'|'unsafe-result';
interface RoicBase{metricId:'effectiveTaxOperatingIncomeToAverageDeclaredCapital';unit:'ratio';income:RoicIncomePoint;opening:RoicCapitalPoint;closing:RoicCapitalPoint;}
export type RoicResult=RoicBase&({status:'calculated';reason:'calculated';value:number;exact:Exact;effectiveTaxRate:Exact;afterTaxOperatingIncome:Exact;openingCapital:Exact;closingCapital:Exact;declaration:'source-reviewed-by-caller'}|{status:'unavailable';reason:RoicUnavailableReason});
const record=(v:unknown):v is Record<string,any>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function declaration(value:unknown):RoicCapitalDeclaration{
 if(!record(value)||Object.keys(value).some(k=>!['state','debtMetricIds','proof'].includes(k)))throw Error('投下資本の確認宣言が不正です');
 const {state,debtMetricIds,proof}=value;
 if(state==='unknown')return{state:'unknown'};
 if(state!=='confirmed'||!Array.isArray(debtMetricIds)||!record(proof)||Object.keys(proof).some(k=>!['key','contextRef','rawSha256'].includes(k)))throw Error('投下資本の確認宣言が不正です');
 const count=debtMetricIds.length;if(!Number.isSafeInteger(count)||count<0||count>ROIC_DEBT_METRICS.length)throw Error('負債科目数が不正です');
 const ids=Array.from({length:count},(_,i)=>{const id=debtMetricIds[i];if(!Object.hasOwn(debtMetricIds,i)||!ROIC_DEBT_METRICS.includes(id))throw Error('未対応/欠落する負債科目です');return id as RoicDebtMetricId;});
 const p={key:proof.key,contextRef:proof.contextRef,rawSha256:proof.rawSha256};
 if(new Set(ids).size!==ids.length||!['jpcrp_cor:ConsolidatedBalanceSheetTextBlock','jpcrp_cor:BalanceSheetTextBlock'].includes(p.key)||typeof p.contextRef!=='string'||!p.contextRef.trim()||typeof p.rawSha256!=='string'||!/^[a-f0-9]{64}$/.test(p.rawSha256))throw Error('投下資本の確認参照が不正です');
 return{state:'confirmed',debtMetricIds:ids.sort(),proof:p};
}
const serialize=(f:DecimalFraction):Exact=>({numerator:String(f.numerator),denominator:String(f.denominator)});
const add=(a:DecimalFraction,b:DecimalFraction)=>reduceFraction(a.numerator*b.denominator+b.numerator*a.denominator,a.denominator*b.denominator);
/** 営業利益×(1−法人税等/税引前利益)÷平均(株主資本+確認済み負債集合)。 */
export function calculateRoic(input:RoicInput):RoicResult{
 if(!record(input)||Object.keys(input).some(k=>!['income','opening','closing'].includes(k)))throw Error('利益と期首/期末の原本が必要です');
 const capture=(d:unknown,capital:boolean)=>{if(!record(d)||Object.keys(d).some(k=>!(capital?['xml','metadata','capitalDeclaration']:['xml','metadata']).includes(k)))throw Error('ROIC原本が不正です');const {xml,metadata}=d;if(typeof xml!=='string')throw Error('XML文字列が必要です');return{xml,metadata:normalizeFinancialDetailMetadata(metadata),capitalDeclaration:capital?declaration(d.capitalDeclaration):{state:'unknown'}as RoicCapitalDeclaration};};
 const {income:rawIncome,opening:rawOpening,closing:rawClosing}=input,documents=[capture(rawIncome,false),capture(rawOpening,true),capture(rawClosing,true)];
 const points=documents.map(d=>({...d,object:new EdinetXbrlParser().parse(d.xml,d.metadata.docID),inputXmlSha256:createHash('sha256').update(d.xml).digest('hex')})),[a,b,c]=points;
 const income:RoicIncomePoint={metadata:a.metadata,inputXmlSha256:a.inputXmlSha256,operatingIncome:a.object.selectMetric(MetricId.OperatingIncome,a.metadata,{collapseIdenticalDuplicates:true}),incomeBeforeIncomeTaxes:a.object.selectFinancialDetail(FinancialDetailMetricId.IncomeBeforeIncomeTaxes,a.metadata),incomeTaxes:a.object.selectFinancialDetail(FinancialDetailMetricId.IncomeTaxes,a.metadata)};
 const capital=(p:typeof a):RoicCapitalPoint=>({metadata:p.metadata,inputXmlSha256:p.inputXmlSha256,capitalDeclaration:p.capitalDeclaration,equity:p.object.selectFinancialDetail(FinancialDetailMetricId.ShareholdersEquity,p.metadata),debts:p.capitalDeclaration.state==='confirmed'?p.capitalDeclaration.debtMetricIds.map(metricId=>({metricId,selection:p.object.selectFinancialDetail(metricId,p.metadata)})):[]});
 const opening=capital(b),closing=capital(c),base:RoicBase={metricId:'effectiveTaxOperatingIncomeToAverageDeclaredCapital',unit:'ratio',income,opening,closing},unavailable=(reason:RoicUnavailableReason):RoicResult=>({...base,status:'unavailable',reason});
 const metadataReason=validateAnnualBalanceMetadata(income.metadata,opening.metadata,closing.metadata);if(metadataReason)return unavailable(metadataReason);
 for(const [p,point]of[[b,opening],[c,closing]]as const){const d=point.capitalDeclaration;if(d.state!=='confirmed')return unavailable('unverified-capital-definition');
  const expected=point.metadata.scope==='Consolidated'?'jpcrp_cor:ConsolidatedBalanceSheetTextBlock':'jpcrp_cor:BalanceSheetTextBlock';
  const facts=p.object.getDataList(d.proof.key).filter(f=>f.contextRef===d.proof.contextRef),f=facts[0],context=[...p.object.findContexts({type:'Instant',scope:point.metadata.scope}),...p.object.findContexts({type:'Duration',scope:point.metadata.scope})].find(x=>x.id===d.proof.contextRef),entity=point.equity.source?.entity;
  const nsDate=/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpcrp\/(\d{4}-\d{2}-\d{2})\/jpcrp_cor$/.exec(f?.namespaceURI??'')?.[1];
  if(!nsDate||parseDocumentTimestamp(nsDate+'T00:00:00Z',true)===undefined||d.proof.key!==expected||facts.length!==1||f.nil||typeof f.rawValue!=='string'||createHash('sha256').update(f.rawValue).digest('hex')!==d.proof.rawSha256||!/^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpcrp\/\d{4}-\d{2}-\d{2}\/jpcrp_cor$/.test(f.namespaceURI??'')||!context?.namespaceVerified||!context.periodValid||p.object.traceContextDimensions(d.proof.contextRef).status!=='resolved'||!entity||context.entity?.scheme!==entity.scheme||context.entity.identifier!==entity.identifier||(context.period.instant??context.period.endDate??'')<(point.metadata.period.instant??''))return unavailable('invalid-capital-reference');
 }
 const selections=[income.operatingIncome,income.incomeBeforeIncomeTaxes,income.incomeTaxes,opening.equity,closing.equity,...opening.debts.map(d=>d.selection),...closing.debts.map(d=>d.selection)],entity=income.operatingIncome.source?.entity;
 for(const s of selections){if(s.status!=='selected')return unavailable('unavailable-input');if(s.safeNumber===undefined)return unavailable('unsafe-input');if(!entity||!s.source.entity||s.source.entity.scheme!==entity.scheme||s.source.entity.identifier!==entity.identifier)return unavailable('incompatible-entity');}
 const pretax=decimalFraction(income.incomeBeforeIncomeTaxes.safeNumber!),tax=decimalFraction(income.incomeTaxes.safeNumber!);
 if(pretax.numerator<=0n)return unavailable('nonpositive-pretax-income');
 const rate=reduceFraction(tax.numerator*pretax.denominator,tax.denominator*pretax.numerator);if(rate.numerator<0n||rate.numerator>rate.denominator)return unavailable('tax-rate-out-of-range');
 const op=decimalFraction(income.operatingIncome.safeNumber!),nopat=reduceFraction(op.numerator*(rate.denominator-rate.numerator),op.denominator*rate.denominator);
 const balances:DecimalFraction[]=[];for(const p of [opening,closing]){let sum=decimalFraction(p.equity.safeNumber!);for(const d of p.debts){if(d.selection.safeNumber!<0)return unavailable('negative-debt');sum=add(sum,decimalFraction(d.selection.safeNumber!));}if(sum.numerator<=0n)return unavailable('nonpositive-invested-capital');balances.push(sum);}
 const total=add(balances[0],balances[1]),exact=reduceFraction(2n*nopat.numerator*total.denominator,nopat.denominator*total.numerator),value=Number(exact.numerator)/Number(exact.denominator);
 if(!Number.isFinite(value)||value===0&&exact.numerator!==0n||Math.abs(value)>Number.MAX_SAFE_INTEGER)return unavailable('unsafe-result');
 return{...base,status:'calculated',reason:'calculated',value,exact:serialize(exact),effectiveTaxRate:serialize(rate),afterTaxOperatingIncome:serialize(nopat),openingCapital:serialize(balances[0]),closingCapital:serialize(balances[1]),declaration:'source-reviewed-by-caller'};
}
export function screenRoic(inputs:readonly RoicInput[],options:AverageAssetsReturnOptions={}){
 if(!Array.isArray(inputs)||!record(options)||Object.keys(options).some(k=>!['conditions','order','offset','limit'].includes(k)))throw Error('ROIC検索条件が不正です');
 const {conditions:raw=[],order='desc',offset=0,limit}=options;if(!Array.isArray(raw)||!Object.values(SortOrder).includes(order)||[offset,limit].some(x=>x!==undefined&&(!Number.isSafeInteger(x)||x<0)))throw Error('ROIC検索条件が不正です');
 const conditionCount=raw.length;if(!Number.isSafeInteger(conditionCount)||conditionCount<0||conditionCount>100)throw Error('ROIC条件は100件以下です');
 const conditions=Array.from({length:conditionCount},(_,i)=>{const c=raw[i];if(!record(c)||Object.keys(c).some(k=>!['operator','value'].includes(k)))throw Error('ROIC比較条件が不正です');const {operator,value}=c;if(!Object.values(ComparisonOperator).includes(operator)||!Number.isFinite(value))throw Error('ROIC比較条件が不正です');return{operator,value};});
 const count=inputs.length;if(!Number.isSafeInteger(count)||count<0||count>100)throw Error('ROIC比較は100社以下です');
 const captured=Array.from({length:count},(_,i)=>{if(!Object.hasOwn(inputs,i))throw Error('ROIC原本に欠落があります');return structuredClone(inputs[i]);});
 let bytes=0;for(const input of captured)for(const key of ['income','opening','closing']as const){const xml=input?.[key]?.xml;if(typeof xml!=='string')throw Error('XML文字列が必要です');bytes+=Buffer.byteLength(xml);}if(bytes>256*1024*1024)throw Error('ROIC比較原本は合計256MiB以下です');
 const results=captured.map(calculateRoic),codes=new Set<string>(),docs=new Map<string,string>();
 const cohort=(r:RoicResult)=>JSON.stringify([r.income,r.opening,r.closing].map(p=>[p.metadata.accountingStandard,p.metadata.scope,p.metadata.currency,p.metadata.periodType,p.metadata.period]));
 for(const r of results){const code=r.income.metadata.secCode;if(codes.has(code)||cohort(r)!==cohort(results[0]))throw Error('ROICの会社/比較範囲が混在しています');codes.add(code);for(const p of [r.income,r.opening,r.closing]){if(docs.has(p.metadata.docID)&&docs.get(p.metadata.docID)!==code)throw Error('別会社の書類IDです');docs.set(p.metadata.docID,code);}}
 const selected=results.filter((r):r is Extract<RoicResult,{status:'calculated'}>=>r.status==='calculated'),excluded=results.filter((r):r is Extract<RoicResult,{status:'unavailable'}>=>r.status==='unavailable');
 const fraction=(r:typeof selected[number])=>({numerator:BigInt(r.exact.numerator),denominator:BigInt(r.exact.denominator)});
 const rows=selected.filter(r=>conditions.every(c=>{const d=compareFractions(fraction(r),decimalFraction(c.value));return c.operator==='gte'?d>=0:c.operator==='lte'?d<=0:c.operator==='gt'?d>0:c.operator==='lt'?d<0:d===0;}));rows.sort((a,b)=>compareFractions(fraction(a),fraction(b))*(order==='asc'?1:-1)||a.income.metadata.secCode.localeCompare(b.income.metadata.secCode));
 return{rows:rows.slice(offset,limit===undefined?undefined:offset+limit),excluded,total:rows.length,excludedRows:excluded.length,filteredRows:selected.length-rows.length};
}
