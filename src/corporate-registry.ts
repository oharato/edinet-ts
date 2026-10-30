import {createHash} from 'node:crypto';
import {parseCorporateRegistryPublicationCalendar,type CorporateRegistryPublicationCalendarInput,type CorporateRegistryPublicationCalendar} from './corporate-registry-calendar';
import {XMLParser} from 'fast-xml-parser';
import {assertXmlInput} from './xml-input';
import {parseDocumentTimestamp} from './document-timestamp';
import {queryCompanyMaster,type CompanyMasterSnapshot,type CompanyMasterQuery,type CompanyMasterRecord} from './company-master';
export interface CorporateRegistryXmlInput {xml:string;source:CorporateRegistrySource;}
export const CORPORATE_REGISTRY_FIELDS = Object.freeze(['sequenceNumber','corporateNumber','process','correct','updateDate','changeDate','name','nameImageId','kind','prefectureName','cityName','streetNumber','addressImageId','prefectureCode','cityCode','postCode','addressOutside','addressOutsideImageId','closeDate','closeCause','successorCorporateNumber','changeCause','assignmentDate','latest','enName','enPrefectureName','enCityName','enAddressOutside','furigana','hihyoji'] as const);
export type CorporateRegistryField = typeof CORPORATE_REGISTRY_FIELDS[number];
export interface CorporateRegistrySource {sourceUrl:string; observedAt:string; dataDate:string; kind:'full'|'diff'; purpose:'sample'|'download';}
export interface CorporateRegistryRecord {recordNumber:number; values:Record<CorporateRegistryField,string>; processKnown:boolean; deletionExtraFields:CorporateRegistryField[];}
export interface CorporateRegistryDownload {source:CorporateRegistrySource & {inputXmlSha256:string; attribution:string}; records:CorporateRegistryRecord[];}
const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&parseDocumentTimestamp(s+'T00:00:00Z',true)!==undefined;
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
function fail():never{throw new Error('法人番号ダウンロードXML/出典が不正です');}
/** 30列の現行ダウンロードXML。訂正/削除/最新履歴フラグを解釈で消さず原値のまま保持します。 */
export function parseCorporateRegistryDownloadXml(xml:string,input:CorporateRegistrySource):CorporateRegistryDownload {
    if(!object(input)||Object.keys(input).some(k=>!['sourceUrl','observedAt','dataDate','kind','purpose'].includes(k)))fail();
    const source={sourceUrl:input.sourceUrl,observedAt:input.observedAt,dataDate:input.dataDate,kind:input.kind,purpose:input.purpose};
    const observed=parseDocumentTimestamp(source.observedAt,true);
    if(observed===undefined||typeof source.sourceUrl!=='string'||typeof source.dataDate!=='string'||!date(source.dataDate)||!['full','diff'].includes(source.kind)||!['sample','download'].includes(source.purpose)||source.dataDate>new Date(observed+9*3600000).toISOString().slice(0,10))fail();
    try{const url=new URL(source.sourceUrl);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash)fail();}catch{fail();}
    assertXmlInput(xml);
    const parsed=new XMLParser({ignoreAttributes:false,parseTagValue:false,parseAttributeValue:false,trimValues:false}).parse(xml);
    if(!object(parsed)||Object.keys(parsed).some(k=>!['?xml','corporations'].includes(k)) )fail();
    const root=typeof parsed.corporations==='string'&&!parsed.corporations.trim()?{}:parsed.corporations;if(!object(root))fail();if(Object.keys(root).some(k=>k!=='corporation'&&!(k==='#text'&&typeof root[k]==='string'&&!root[k].trim())))fail();
    const elements=root.corporation===undefined?[]:Array.isArray(root.corporation)?root.corporation:[root.corporation];
    if(elements.length>100000)fail();const seen=new Set<string>();
    const records=elements.map((element:unknown,i:number):CorporateRegistryRecord=>{
        if(!object(element)||Object.keys(element).some(k=>!CORPORATE_REGISTRY_FIELDS.includes(k as CorporateRegistryField)&&!(k==='#text'&&typeof element[k]==='string'&&!element[k].trim())))fail();
        const values={}as Record<CorporateRegistryField,string>;
        for(const key of CORPORATE_REGISTRY_FIELDS){if(typeof element[key]!=='string')fail();values[key]=element[key];}
        if(!/^[1-9]\d{0,7}$/.test(values.sequenceNumber)||seen.has(values.sequenceNumber)||!/^\d{13}$/.test(values.corporateNumber)||!/^\d{2}$/.test(values.process)||!date(values.updateDate)||values.updateDate>source.dataDate)fail();seen.add(values.sequenceNumber);
        const deletionExtraFields=values.process==='99'?CORPORATE_REGISTRY_FIELDS.filter(k=>!['sequenceNumber','corporateNumber','process','updateDate'].includes(k)&&values[k]!==''):[];
        for(const k of ['changeDate','assignmentDate','closeDate']as const)if(values[k]&&!date(values[k]))fail();
        if(values.process!=='99'){
            if(!['0','1'].includes(values.correct)||!['0','1'].includes(values.latest)||!['0','1'].includes(values.hihyoji)||!/^\d{3}$/.test(values.kind)||!values.name&&!values.nameImageId)fail();
            for(const k of ['changeDate','assignmentDate']as const)if(!date(values[k]))fail();
            if(values.closeDate&&!date(values.closeDate)||values.successorCorporateNumber&&!/^\d{13}$/.test(values.successorCorporateNumber))fail();
        }
        return{recordNumber:i+1,values,processKnown:['01','11','12','13','21','22','71','72','81','99'].includes(values.process),deletionExtraFields};
    });
    return{source:{...source,inputXmlSha256:createHash('sha256').update(xml).digest('hex'),attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成'},records};
}
function captureRegistryInputs(inputs:readonly CorporateRegistryXmlInput[]) {
    if(!Array.isArray(inputs))fail();const length=inputs.length;
    if(!Number.isSafeInteger(length)||length<0||length>100)fail();
    const captured=Array.from({length},(_,i)=>{if(!Object.hasOwn(inputs,i))fail();const d=inputs[i];if(!object(d)||Object.keys(d).some(k=>!['xml','source'].includes(k)))fail();const {xml,source}=d;if(typeof xml!=='string')fail();return{xml,source:structuredClone(source) as CorporateRegistrySource};});
    if(captured.reduce((n,d)=>n+Buffer.byteLength(d.xml),0)>256*1024*1024)fail();
    return captured;
}
/** 法人番号の完全一致で観測済み原記録を返します。diffを最新状態へ合成しません。 */
export function queryCorporateRegistryDownloads(inputs:readonly {xml:string;source:CorporateRegistrySource}[],query:{corporateNumber:string;knownAt:string}) {
    if(!object(query)||Object.keys(query).some(k=>!['corporateNumber','knownAt'].includes(k)))fail();
    const corporateNumber=query.corporateNumber,knownAt=query.knownAt,cutoff=parseDocumentTimestamp(knownAt,true);
    if(typeof corporateNumber!=='string'||!/^\d{13}$/.test(corporateNumber)||cutoff===undefined)fail();
    const captured=captureRegistryInputs(inputs);
    const rows:{sourceIndex:number;record:CorporateRegistryRecord}[]=[],sources:CorporateRegistryDownload['source'][]=[],excludedSources:{sourceIndex:number;reason:'source-after-cutoff'}[]=[];
    for(const d of captured){const parsed=parseCorporateRegistryDownloadXml(d.xml,d.source),sourceIndex=sources.length;sources.push(parsed.source);if(parseDocumentTimestamp(parsed.source.observedAt,true)!>cutoff){excludedSources.push({sourceIndex,reason:'source-after-cutoff'});continue;}for(const record of parsed.records)if(record.values.corporateNumber===corporateNumber)rows.push({sourceIndex,record});}
    return{corporateNumber,knownAt,sources,rows,excludedSources,total:rows.length};
}
export type CorporateRegistryLinkReason='exact-corporate-number'|'corporate-number-missing'|'not-in-supplied-records'|'shared-corporate-number'|'multiple-registry-records'|'deletion-record'|'unknown-process'|'history-or-correction-record';
export interface CorporateRegistryCompanyLink {
    company:CompanyMasterRecord;status:'number-matched'|'unavailable'|'unresolved';reason:CorporateRegistryLinkReason;
    candidates:{sourceIndex:number;record:CorporateRegistryRecord}[];
}
/** 会社IDを維持した原記録への参照。法人の合併・承継や最新状態を認定しません。 */
export function linkCompanyMasterCorporateRecords(snapshots:readonly CompanyMasterSnapshot[],inputs:readonly CorporateRegistryXmlInput[],query:CompanyMasterQuery & {registryPurpose:CorporateRegistrySource['purpose']}) {
    if(!object(query))fail();
    const {registryPurpose,...settings}=structuredClone(query);
    if(!['sample','download'].includes(registryPurpose))fail();
    const captured=structuredClone(snapshots),master=queryCompanyMaster(captured,settings),all=queryCompanyMaster(captured,{asOf:settings.asOf,knownAt:settings.knownAt});
    const cutoff=parseDocumentTimestamp(settings.knownAt,true);if(cutoff===undefined)fail();
    const sources:CorporateRegistryDownload['source'] []=[],excludedSources:{sourceIndex:number;reason:'purpose-mismatch'|'source-after-cutoff'|'data-after-as-of'}[]=[];
    const records=new Map<string,CorporateRegistryCompanyLink['candidates']>();
    for(const input of captureRegistryInputs(inputs)){
        const d=parseCorporateRegistryDownloadXml(input.xml,input.source),sourceIndex=sources.length;sources.push(d.source);
        const reason=d.source.purpose!==registryPurpose?'purpose-mismatch':parseDocumentTimestamp(d.source.observedAt,true)!>cutoff?'source-after-cutoff':d.source.dataDate>settings.asOf?'data-after-as-of':undefined;
        if(reason){excludedSources.push({sourceIndex,reason});continue;}
        for(const record of d.records){const number=record.values.corporateNumber,group=records.get(number)??[];group.push({sourceIndex,record});records.set(number,group);}
    }
    const owners=new Map<string,number>();for(const company of all.rows)if(company.corporateNumber)owners.set(company.corporateNumber,(owners.get(company.corporateNumber)??0)+1);
    const rows:CorporateRegistryCompanyLink[]=master.rows.map(company=>{
        const number=company.corporateNumber,candidates=number?records.get(number)??[]:[];
        let status:CorporateRegistryCompanyLink['status']='unresolved',reason:CorporateRegistryLinkReason;
        if(!number){status='unavailable';reason='corporate-number-missing';}
        else if(!candidates.length){status='unavailable';reason='not-in-supplied-records';}
        else if((owners.get(number)??0)>1)reason='shared-corporate-number';
        else if(candidates.length>1)reason='multiple-registry-records';
        else if(candidates[0].record.values.process==='99')reason='deletion-record';
        else if(!candidates[0].record.processKnown)reason='unknown-process';
        else if(candidates[0].record.values.latest!=='1'||candidates[0].record.values.correct==='1')reason='history-or-correction-record';
        else{status='number-matched';reason='exact-corporate-number';}
        return{company,status,reason,candidates};
    });
    return{query:{...settings,registryPurpose},master,sources,excludedSources,registryPurpose,semantics:'raw-record-number-link' as const,rows,total:rows.length};
}

/** 呼出元が全国・全分割を確認した一日分。ファイル数の宣言だけで真正性を認証しません。 */
export interface CorporateRegistryDelivery {
    scope:'national';expectedParts:number;parts:readonly CorporateRegistryXmlInput[];
}
export interface CorporateRegistryStateQuery {corporateNumber:string;asOf:string;knownAt:string;registryPurpose:CorporateRegistrySource['purpose'];}
export interface CorporateRegistryRecordReference {sourceIndex:number;record:CorporateRegistryRecord;}
export type CorporateRegistryStateSelection =
    {status:'available'|'deleted';record:CorporateRegistryRecordReference} |
    {status:'unavailable';reason:'no-baseline'|'not-in-baseline'} |
    {status:'unresolved';reason:'coverage-gap'|'conflicting-deliveries'|'invalid-baseline-record'|'unknown-process'|'record-after-data-date'|'invalid-latest-flags'|'mixed-deletion-records'|'deletion-extra-fields'|'change-without-base-record'|'duplicate-assignment'|'calendar-after-cutoff'|'calendar-outside-coverage'|'as-of-after-cutoff'|'delivery-on-non-publication-day';deliveryIndex?:number;gap?:{from:string;to:string}};
export interface CorporateRegistryStateResult {
    query:CorporateRegistryStateQuery;sources:CorporateRegistryDownload['source'][];
    deliveries:{deliveryIndex:number;sourceIndices:number[];dataDate:string;observedAt:string;kind:CorporateRegistrySource['kind'];records:CorporateRegistryRecordReference[]}[];
    excludedDeliveries:{deliveryIndex:number;reason:'purpose-mismatch'|'source-after-cutoff'|'data-after-as-of'}[];
    appliedDeliveries:number[];history:CorporateRegistryRecordReference[];
    coverage?:{from:string;through:string};selection:CorporateRegistryStateSelection;
    calendar?:Omit<CorporateRegistryPublicationCalendar,'holidays'>&{status:'available'|'after-cutoff'};
    nonPublicationDays?:{date:string;reason:'year-end'|'weekend'|'holiday';holidayName?:string}[];
}
const nextRegistryDate=(value:string,days=1)=>new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
/** 全国全件を起点に連続日次差分を適用。訂正は法人の全履歴を置換し、承継先は統合しません。 */
export function reconstructCorporateRegistryState(inputs:readonly CorporateRegistryDelivery[],query:CorporateRegistryStateQuery,calendarInput?:CorporateRegistryPublicationCalendarInput):CorporateRegistryStateResult {
    const q=structuredClone(query);
    if(!object(q)||Object.keys(q).some(k=>!['corporateNumber','asOf','knownAt','registryPurpose'].includes(k))||typeof q.corporateNumber!=='string'||!/^\d{13}$/.test(q.corporateNumber)||typeof q.asOf!=='string'||!date(q.asOf)||!['sample','download'].includes(q.registryPurpose)||parseDocumentTimestamp(q.knownAt,true)===undefined||!Array.isArray(inputs))fail();
    const calendar=calendarInput===undefined?undefined:parseCorporateRegistryPublicationCalendar(calendarInput);
    const length=inputs.length;if(!Number.isSafeInteger(length)||length<0||length>100)fail();let bytes=0,files=0;
    const captured=Array.from({length},(_,i)=>{
        if(!Object.hasOwn(inputs,i))fail();const d=inputs[i];if(!object(d)||Object.keys(d).some(k=>!['scope','expectedParts','parts'].includes(k)))fail();
        const {scope,expectedParts,parts}=d;
        if(scope!=='national'||typeof expectedParts!=='number'||!Number.isSafeInteger(expectedParts)||expectedParts<1||expectedParts>100||!Array.isArray(parts))fail();
        const captured=captureRegistryInputs(parts);
        if(captured.length!==expectedParts)fail();files+=captured.length;bytes+=captured.reduce((n,p)=>n+Buffer.byteLength(p.xml),0);
        if(files>100||bytes>256*1024*1024)fail();return captured;
    });
    const sources:CorporateRegistryDownload['source'] []=[],excludedDeliveries:CorporateRegistryStateResult['excludedDeliveries']=[],cutoff=parseDocumentTimestamp(q.knownAt,true)!;
    const candidates=captured.map((parts,deliveryIndex)=>{
        const parsed=parts.map(p=>parseCorporateRegistryDownloadXml(p.xml,p.source)),sourceIndices=parsed.map(p=>{sources.push(p.source);return sources.length-1}),first=parsed[0].source;
        if(parsed.some(p=>p.source.dataDate!==first.dataDate||p.source.kind!==first.kind||p.source.purpose!==first.purpose))fail();
        const observed=Math.max(...parsed.map(p=>parseDocumentTimestamp(p.source.observedAt,true)!)),all=parsed.flatMap((p,i)=>p.records.map(record=>({sourceIndex:sourceIndices[i],record})));
        const keys=all.map(r=>first.kind==='full'?r.record.values.corporateNumber:r.record.values.sequenceNumber);
        if(new Set(keys).size!==keys.length)fail();
        const reason=first.purpose!==q.registryPurpose?'purpose-mismatch':observed>cutoff?'source-after-cutoff':first.dataDate>q.asOf?'data-after-as-of':undefined;
        if(reason)excludedDeliveries.push({deliveryIndex,reason});
        const records=all.filter(r=>r.record.values.corporateNumber===q.corporateNumber).sort((a,b)=>Number(a.record.values.sequenceNumber)-Number(b.record.values.sequenceNumber));
        const signature=JSON.stringify(all.map(r=>r.record.values).sort((a,b)=>a.corporateNumber.localeCompare(b.corporateNumber)||Number(a.sequenceNumber)-Number(b.sequenceNumber)));
        return {deliveryIndex,sourceIndices,dataDate:first.dataDate,observedAt:new Date(observed).toISOString(),kind:first.kind,records,observed,signature,excluded:!!reason};
    });
    const result:CorporateRegistryStateResult={query:q,sources,deliveries:candidates.map(({observed,signature,excluded,...d})=>d),excludedDeliveries,appliedDeliveries:[],history:[],selection:{status:'unavailable',reason:'no-baseline'}};
    const holidays=new Map(calendar?.holidays.map(h=>[h.date,h.name]));
    if(calendar){const {holidays:_,...metadata}=calendar;result.calendar={...metadata,status:parseDocumentTimestamp(calendar.observedAt,true)!>cutoff?'after-cutoff':'available'};result.nonPublicationDays=[];}
    const nonPublication=(day:string):NonNullable<CorporateRegistryStateResult['nonPublicationDays']>[number]|undefined=>{
        if(!calendar)return undefined;
        const monthDay=day.slice(5),weekday=new Date(day+'T00:00:00Z').getUTCDay();
        if(monthDay>='12-29'||monthDay<='01-03')return {date:day,reason:'year-end'};
        if(weekday===0||weekday===6)return {date:day,reason:'weekend'};
        const name=holidays.get(day);return name?{date:day,reason:'holiday',holidayName:name}:undefined;
    };
    const eligible=candidates.filter(d=>!d.excluded),baselines=eligible.filter(d=>d.kind==='full').sort((a,b)=>b.dataDate.localeCompare(a.dataDate)||b.observed-a.observed);
    const base=baselines[0];if(!base)return result;
    const chosen=new Map<string,typeof base>();
    for(const d of eligible.filter(d=>d.dataDate>=base.dataDate).sort((a,b)=>b.observed-a.observed)){
        const key=d.kind+':'+d.dataDate,prior=chosen.get(key);
        if(prior&&prior.observed===d.observed&&prior.signature!==d.signature){result.selection={status:'unresolved',reason:'conflicting-deliveries',deliveryIndex:d.deliveryIndex};return result;}
        if(!prior)chosen.set(key,d);
    }
    if(result.calendar?.status==='after-cutoff'){result.selection={status:'unresolved',reason:'calendar-after-cutoff'};return result;}
    if(calendar&&(Number(base.dataDate.slice(0,4))<calendar.firstYear||Number(q.asOf.slice(0,4))>calendar.lastYear)){result.selection={status:'unresolved',reason:'calendar-outside-coverage'};return result;}
    if(calendar&&q.asOf>new Date(cutoff+9*3600000).toISOString().slice(0,10)){result.selection={status:'unresolved',reason:'as-of-after-cutoff'};return result;}
    result.coverage={from:base.dataDate,through:base.dataDate};
    const advance=(through:string)=>{
        while(result.coverage!.through<through){const day=nextRegistryDate(result.coverage!.through),skip=nonPublication(day);if(!skip)break;result.nonPublicationDays!.push(skip);result.coverage!.through=day;}
    };
    const reject=(reason:Extract<CorporateRegistryStateSelection,{status:'unresolved'}>['reason'],deliveryIndex:number)=>{result.selection={status:'unresolved',reason,deliveryIndex};return result;};
    let current:CorporateRegistryRecordReference|undefined=base.records[0],deleted=false;
    if(current&&(current.record.values.latest!=='1'||current.record.values.process==='99'))return reject('invalid-baseline-record',base.deliveryIndex);
    const check=(records:CorporateRegistryRecordReference[],day:string)=>records.some(r=>!r.record.processKnown)?'unknown-process' as const:records.some(r=>['changeDate','closeDate','assignmentDate'].some(k=>r.record.values[k as CorporateRegistryField]>day))?'record-after-data-date' as const:undefined;
    const baseProblem=check(base.records,base.dataDate);if(baseProblem)return reject(baseProblem,base.deliveryIndex);
    result.history=[...base.records];result.appliedDeliveries.push(base.deliveryIndex);
    const diffs=[...chosen.values()].filter(d=>d.kind==='diff'&&d.dataDate>base.dataDate).sort((a,b)=>a.dataDate.localeCompare(b.dataDate));
    for(const d of diffs){
        advance(nextRegistryDate(d.dataDate,-1));
        const next=nextRegistryDate(result.coverage.through);
        if(d.dataDate!==next){result.selection={status:'unresolved',reason:'coverage-gap',gap:{from:next,to:nextRegistryDate(d.dataDate,-1)}};return result;}
        if(nonPublication(d.dataDate))return reject('delivery-on-non-publication-day',d.deliveryIndex);
        const records=d.records,problem=check(records,d.dataDate);if(problem)return reject(problem,d.deliveryIndex);
        if(records.length){
            const deletions=records.filter(r=>r.record.values.process==='99');
            if(deletions.length){
                if(records.length!==1)return reject('mixed-deletion-records',d.deliveryIndex);
                if(deletions[0].record.deletionExtraFields.length)return reject('deletion-extra-fields',d.deliveryIndex);
                current=deletions[0];deleted=true;result.history=[];
            }else{
                if(records.filter(r=>r.record.values.latest==='1').length!==1||records.at(-1)!.record.values.latest!=='1')return reject('invalid-latest-flags',d.deliveryIndex);
                const corrected=records.some(r=>r.record.values.correct==='1');
                if(!corrected){
                    if((!current||deleted)&&records[0].record.values.process!=='01')return reject('change-without-base-record',d.deliveryIndex);
                    if(records.some((r,i)=>r.record.values.process==='01'&&(i!==0||current&&!deleted)))return reject('duplicate-assignment',d.deliveryIndex);
                }
                result.history=corrected?[...records]:[...result.history,...records];current=records.at(-1)!;deleted=false;
            }
        }
        result.appliedDeliveries.push(d.deliveryIndex);result.coverage.through=d.dataDate;
    }
    advance(q.asOf);
    if(result.coverage.through<q.asOf){result.selection={status:'unresolved',reason:'coverage-gap',gap:{from:nextRegistryDate(result.coverage.through),to:q.asOf}};return result;}
    result.selection=current?{status:deleted?'deleted':'available',record:current}:{status:'unavailable',reason:'not-in-baseline'};
    return result;
}
