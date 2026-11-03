import {createHash} from 'node:crypto';
import {parseDocumentTimestamp} from './document-timestamp';
import type {CorporateRegistryStateQuery,CorporateRegistryStateResult,CorporateRegistryDownload,CorporateRegistryRecord,CorporateRegistrySource,CorporateRegistryStateSelection,CorporateRegistryField,CorporateRegistryRecordReference} from './corporate-registry';
import {registryNonPublicationDay,type CorporateRegistryPublicationCalendar} from './corporate-registry-calendar';
export interface CorporateRegistryCandidate {
 deliveryIndex:number;sourceIndices:number[];dataDate:string;observedAt:string;kind:CorporateRegistrySource['kind'];records:CorporateRegistryStateResult['history'];observed:number;signature:string;excluded:boolean;
}
export function captureRegistryStateQuery(input:CorporateRegistryStateQuery):CorporateRegistryStateQuery {
 const q=structuredClone(input);
 if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!['corporateNumber','asOf','knownAt','registryPurpose'].includes(k))||typeof q.corporateNumber!=='string'||!/^\d{13}$/.test(q.corporateNumber)||typeof q.asOf!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(q.asOf)||parseDocumentTimestamp(q.asOf+'T00:00:00Z',true)===undefined||!['sample','download'].includes(q.registryPurpose)||parseDocumentTimestamp(q.knownAt,true)===undefined)throw Error('法人番号状態の番号・対象日・観測cutoff・目的を確認してください');
 return q;
}
/** 内部用。法人番号/一連番号順、リソース定義順の値を同じJSON列として指紋化します。 */
export function registryValuesSignature(values:Iterable<CorporateRegistryRecord['values']>):string {
 const hash=createHash('sha256').update('[');let first=true;
 for(const value of values){if(!first)hash.update(',');first=false;hash.update(JSON.stringify(value));}
 return hash.update(']').digest('hex');
}
const nextRegistryDate=(value:string,days=1)=>new Date(Date.parse(value+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
/** 内部用。XML入口と検査済みStoreで同じ選択規則を共有します。 */
export function reconstructRegistryCandidates(q:CorporateRegistryStateQuery,sources:CorporateRegistryDownload['source'][],candidates:CorporateRegistryCandidate[],excludedDeliveries:CorporateRegistryStateResult['excludedDeliveries'],calendar?:CorporateRegistryPublicationCalendar):CorporateRegistryStateResult {
 const cutoff=parseDocumentTimestamp(q.knownAt,true)!;
    const result:CorporateRegistryStateResult={query:q,sources,deliveries:candidates.map(({observed,signature,excluded,...d})=>d),excludedDeliveries,appliedDeliveries:[],history:[],selection:{status:'unavailable',reason:'no-baseline'}};
    const holidays=new Map(calendar?.holidays.map(h=>[h.date,h.name]));
    if(calendar){const {holidays:_,...metadata}=calendar;result.calendar={...metadata,status:parseDocumentTimestamp(calendar.observedAt,true)!>cutoff?'after-cutoff':'available'};result.nonPublicationDays=[];}
    const nonPublication=(day:string)=>calendar?registryNonPublicationDay(day,holidays):undefined;
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
