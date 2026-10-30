import {queryCompanyMaster,type CompanyMasterSnapshot,type CompanyMasterQuery,type CompanyMasterRecord} from './company-master';
import type {CorporateRegistryStore,CorporateRegistryStoredDelivery,CorporateRegistryStoredStateResult} from './db/corporate-registry-store';
import {reconstructCorporateRegistryStreamStates,type CorporateRegistryStreamDelivery,type CorporateRegistryStreamStateResult} from './corporate-registry-stream-state';
import type {CorporateRegistryStateResult,CorporateRegistrySource} from './corporate-registry';
import type {CorporateRegistryPublicationCalendarInput} from './corporate-registry-calendar';

export interface CompanyCorporateStateQuery extends CompanyMasterQuery {
 edinetCodes:readonly string[];
 registryPurpose:CorporateRegistrySource['purpose'];
}
export type CompanyCorporateStateLinkReason='exact-number-and-name'|'corporate-number-missing'|'shared-corporate-number'|'registry-state-unavailable'|'registry-state-unresolved'|'registry-record-deleted'|'closed-corporation'|'registry-name-missing'|'registry-name-mismatch';
export interface CompanyCorporateStateLink<State=CorporateRegistryStoredStateResult> {
 company:CompanyMasterRecord;
 status:'number-and-name-matched'|'unavailable'|'unresolved';
 reason:CompanyCorporateStateLinkReason;
 nameComparison:'exact'|'different'|'not-compared';
 state?:State;
}
export interface CompanyCorporateStateResult<State=CorporateRegistryStoredStateResult> {
 query:CompanyCorporateStateQuery;
 master:ReturnType<typeof queryCompanyMaster>;
 rows:CompanyCorporateStateLink<State>[];
 absentEdinetCodes:string[];
 total:number;
 semantics:'reconstructed-registry-number-and-name-link';
 entityIdentity:'not-established';
 mergedEntities:false;
 followedSuccessor:false;
}
/** 原記録の候補参照と異なり、全件/連続差分から再構成できた状態だけへ結合します。 */
export function linkCompanyMasterCorporateStates(
 snapshots:readonly CompanyMasterSnapshot[],registry:CorporateRegistryStore,
 deliveries:readonly CorporateRegistryStoredDelivery[],query:CompanyCorporateStateQuery,
 calendar?:CorporateRegistryPublicationCalendarInput,
):CompanyCorporateStateResult {
 const prepared=prepareCompanyStates(snapshots,query,100),inputs=structuredClone(deliveries),calendarInput=calendar===undefined?undefined:structuredClone(calendar);
 return resolveCompanyStates(prepared,number=>registry.reconstruct(inputs,{corporateNumber:number,asOf:prepared.settings.asOf,knownAt:prepared.settings.knownAt,registryPurpose:prepared.registryPurpose},calendarInput));
}

export type CompanyCorporateStreamStateResult=CompanyCorporateStateResult<CorporateRegistryStateResult>&{scan?:CorporateRegistryStreamStateResult['scan']};
/** 対象の全国原本を一度検査し、元のEDINET IDを保って番号・名称を照合します。 */
export async function linkCompanyMasterCorporateStreamStates(
 snapshots:readonly CompanyMasterSnapshot[],deliveries:readonly CorporateRegistryStreamDelivery[],query:CompanyCorporateStateQuery,
 calendar?:CorporateRegistryPublicationCalendarInput,options:{signal?:AbortSignal}={},
):Promise<CompanyCorporateStreamStateResult>{
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='signal')||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw Error('中断条件を確認してください');
 options.signal?.throwIfAborted();
 const prepared=prepareCompanyStates(snapshots,query,20000),{companies,owners,settings,registryPurpose}=prepared;
 const corporateNumbers=[...new Set(companies.flatMap(c=>c.corporateNumber&&(owners.get(c.corporateNumber)??0)===1?[c.corporateNumber]:[]))];
 // 番号なし・共有番号だけの集合では原本へ結合しないため、scanも返しません。
 if(!corporateNumbers.length){options.signal?.throwIfAborted();return resolveCompanyStates(prepared,()=>{throw Error('法人番号がありません')});}
 const result=await reconstructCorporateRegistryStreamStates(deliveries,{corporateNumbers,asOf:settings.asOf,knownAt:settings.knownAt,registryPurpose},calendar,options);
 const states=new Map(result.states.map(s=>[s.query.corporateNumber,s]));
 return {...resolveCompanyStates(prepared,number=>states.get(number)!),scan:result.scan};
}

function prepareCompanyStates(snapshots:readonly CompanyMasterSnapshot[],query:CompanyCorporateStateQuery,limit:number){
 const q=structuredClone(query);
 if(!q||typeof q!=='object'||Array.isArray(q)||!Array.isArray(q.edinetCodes)||q.edinetCodes.length>limit||Array.from(q.edinetCodes).some(code=>typeof code!=='string'||!/^E\d{5}$/.test(code))||new Set(q.edinetCodes).size!==q.edinetCodes.length||!['sample','download'].includes(q.registryPurpose))throw Error(`${limit}件以下のEDINETコード・法人情報の目的を指定してください`);
 const {edinetCodes,registryPurpose,...settings}=q,captured=structuredClone(snapshots),master=queryCompanyMaster(captured,settings),all=queryCompanyMaster(captured,{asOf:settings.asOf,knownAt:settings.knownAt});
 const selected=new Set(edinetCodes),companies=master.rows.filter(company=>selected.has(company.edinetCode));
 const owners=new Map<string,number>();for(const company of all.rows)if(company.corporateNumber)owners.set(company.corporateNumber,(owners.get(company.corporateNumber)??0)+1);
 return {q,settings,registryPurpose,edinetCodes,master,companies,owners};
}

function resolveCompanyStates<State extends CorporateRegistryStateResult>(prepared:ReturnType<typeof prepareCompanyStates>,resolve:(number:string)=>State):CompanyCorporateStateResult<State>{
 const {q,edinetCodes,master,companies,owners}=prepared;
 const rows:CompanyCorporateStateLink<State>[]=[];let bytes=0,records=0;
 for(const company of companies){
  const link:CompanyCorporateStateLink<State>={company,status:'unresolved',reason:'registry-state-unresolved',nameComparison:'not-compared'},number=company.corporateNumber;
  if(!number){link.status='unavailable';link.reason='corporate-number-missing';}
  else if((owners.get(number)??0)>1)link.reason='shared-corporate-number';
  else{
   const state=resolve(number);link.state=state;
   records+=state.deliveries.reduce((n,d)=>n+d.records.length,0);bytes+=Buffer.byteLength(JSON.stringify(state));
   if(records>10000||bytes>256*1024**2)throw Error('法人状態の一結合は合計1万原記録/256MiB以下です。企業集合を分けてください');
   const selection=state.selection;
   if(selection.status==='unavailable'){link.status='unavailable';link.reason='registry-state-unavailable';}
   else if(selection.status==='deleted'){link.status='unavailable';link.reason='registry-record-deleted';}
   else if(selection.status==='available'){
    const value=selection.record.record.values;
    link.nameComparison=value.name===company.name?'exact':value.name?'different':'not-compared';
    if(value.closeDate)link.reason='closed-corporation';
    else if(!value.name)link.reason='registry-name-missing';
    else if(value.name!==company.name)link.reason='registry-name-mismatch';
    else{link.status='number-and-name-matched';link.reason='exact-number-and-name';}
   }
  }
  rows.push(link);
 }
 const found=new Set(companies.map(c=>c.edinetCode));
 return {query:q,master:master.status==='available'?{...master,rows:companies,total:companies.length}:master,rows,absentEdinetCodes:edinetCodes.filter(code=>!found.has(code)),total:rows.length,semantics:'reconstructed-registry-number-and-name-link',entityIdentity:'not-established',mergedEntities:false,followedSuccessor:false};
}
