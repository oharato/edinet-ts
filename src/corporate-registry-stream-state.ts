import {createHash} from 'node:crypto';
import {Database} from './db/node-sqlite';
import {streamCorporateRegistryRecords,type CorporateRegistryStreamReceipt} from './corporate-registry-stream';
import {captureRegistryStateQuery,reconstructRegistryCandidates,type CorporateRegistryCandidate} from './corporate-registry-state-core';
import {parseCorporateRegistryDownloadXml,type CorporateRegistrySource,type CorporateRegistryStateQuery,type CorporateRegistryStateResult,type CorporateRegistryRecordReference} from './corporate-registry';
import {parseCorporateRegistryPublicationCalendar,type CorporateRegistryPublicationCalendarInput} from './corporate-registry-calendar';

export interface CorporateRegistryStreamPart {source:CorporateRegistrySource;sha256:string;chunks:AsyncIterable<Uint8Array>;}
export interface CorporateRegistryStreamDelivery {scope:'national';expectedParts:number;parts:readonly CorporateRegistryStreamPart[];}
export interface CorporateRegistryStreamStateQuery extends Omit<CorporateRegistryStateQuery,'corporateNumber'> {corporateNumbers:readonly string[];}
export interface CorporateRegistryStreamStateResult {
 states:CorporateRegistryStateResult[];
 scan:{version:'1';allPartsCompleted:true;files:CorporateRegistryStreamReceipt[];bytes:number;records:number;selectedRecords:number;unknownProcessRecords:number;deletionExtraFieldRecords:number;fingerprint:'sorted-record-sha256-v1'};
}
function fail():never{throw Error('法人番号の全国全パート・原本hash・状態検索条件を確認してください');}
/** 全原本を最後まで検査し、要求法人の記録だけを保持。原本全件のDB保存とは別の入口です。 */
export async function reconstructCorporateRegistryStreamStates(
 inputs:readonly CorporateRegistryStreamDelivery[],query:CorporateRegistryStreamStateQuery,
 calendarInput?:CorporateRegistryPublicationCalendarInput,options:{signal?:AbortSignal}={},
):Promise<CorporateRegistryStreamStateResult>{
 const captured=structuredClone(query);if(!captured||typeof captured!=='object'||Array.isArray(captured)||!Array.isArray(captured.corporateNumbers)||captured.corporateNumbers.length<1||captured.corporateNumbers.length>10000||new Set(captured.corporateNumbers).size!==captured.corporateNumbers.length)fail();
 const {corporateNumbers,...settings}=captured,queries=Array.from(corporateNumbers,corporateNumber=>captureRegistryStateQuery({...settings,corporateNumber})),requested=new Set(corporateNumbers);
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='signal')||options.signal!==undefined&&!(options.signal instanceof AbortSignal))fail();const signal=options.signal;signal?.throwIfAborted();
 const calendar=calendarInput===undefined?undefined:parseCorporateRegistryPublicationCalendar(structuredClone(calendarInput));
 if(!Array.isArray(inputs)||inputs.length>100)fail();let partCount=0;
 const deliveries=Array.from(inputs,d=>{
  if(!d||typeof d!=='object'||Array.isArray(d)||Object.keys(d).some(k=>!['scope','expectedParts','parts'].includes(k)))fail();const {scope,expectedParts,parts}=d;
  if(scope!=='national'||!Number.isSafeInteger(expectedParts)||expectedParts<1||!Array.isArray(parts)||parts.length!==expectedParts||(partCount+=parts.length)>100)fail();
  return Array.from(parts,p=>{
   if(!p||typeof p!=='object'||Array.isArray(p)||Object.keys(p).some(k=>!['source','sha256','chunks'].includes(k)))fail();const {source:original,sha256,chunks}=p,source=structuredClone(original);parseCorporateRegistryDownloadXml('<corporations/>',source);
   if(typeof sha256!=='string'||!/^[a-f0-9]{64}$/.test(sha256)||!chunks||typeof chunks[Symbol.asyncIterator]!=='function')fail();return {source,sha256,chunks};
  });
 });
 const sources:CorporateRegistryStateResult['sources']=[],files:CorporateRegistryStreamReceipt[]=[],excluded:CorporateRegistryStateResult['excludedDeliveries']=[];
 const candidates:{base:Omit<CorporateRegistryCandidate,'records'>;records:Map<string,CorporateRegistryRecordReference[]>}[]=[];
 let receivedBytes=0,bytes=0,records=0,selectedRecords=0,selectedBytes=0,unknownProcessRecords=0,deletionExtraFieldRecords=0;
 const index=new Database(':memory:'),seen=new Uint8Array(12500000);
 try{
  index.exec('PRAGMA page_size=4096; PRAGMA max_page_count=262144; PRAGMA journal_mode=OFF; PRAGMA temp_store=MEMORY; CREATE TABLE fingerprints(k TEXT PRIMARY KEY,d BLOB NOT NULL) WITHOUT ROWID');
  for(let deliveryIndex=0;deliveryIndex<deliveries.length;deliveryIndex++){
   const parts=deliveries[deliveryIndex],first=parts[0].source;
   if(parts.some(p=>p.source.kind!==first.kind||p.source.dataDate!==first.dataDate||p.source.purpose!==first.purpose))fail();
   index.exec('DELETE FROM fingerprints; BEGIN');const insert=index.prepare('INSERT INTO fingerprints VALUES(?,?)'),sourceIndices:number[]=[],selected=new Map<string,CorporateRegistryRecordReference[]>();
   try{
    for(const part of parts){
     signal?.throwIfAborted();const sourceIndex=sources.length;seen.fill(0);
     async function* bounded(){for await(const chunk of part.chunks){if(!(chunk instanceof Uint8Array)||(receivedBytes+=chunk.byteLength)>8*1024**3)fail();yield chunk;}}
     const iterator=streamCorporateRegistryRecords(bounded(),part.source,{signal});
     let completed=false;
     try{for(;;){
      const step=await iterator.next();signal?.throwIfAborted();
      if(step.done){
       const receipt=step.value;if(receipt.source.inputXmlSha256!==part.sha256||(bytes+=receipt.bytes)>8*1024**3)fail();sources.push(receipt.source);files.push(receipt);sourceIndices.push(sourceIndex);completed=true;break;
      }
      const record=step.value,value=record.values,sequence=Number(value.sequenceNumber)-1,slot=sequence>>3,mask=1<<(sequence&7);
      if(seen[slot]&mask)throw Error('法人番号原本の一連番号が重複しています');seen[slot]|=mask;
      const body=JSON.stringify(value),digest=createHash('sha256').update(body).digest();
      try{insert.run(first.kind==='full'?value.corporateNumber:value.sequenceNumber,digest);}catch{throw Error('法人番号/一連番号が配布内で重複するか、検査用索引1GiBの上限を超えています');}
      records++;if(!record.processKnown)unknownProcessRecords++;if(record.deletionExtraFields.length)deletionExtraFieldRecords++;
      if(requested.has(value.corporateNumber)){
       if(++selectedRecords>10000||(selectedBytes+=Buffer.byteLength(body))>16*1024**2)throw Error('保持する対象法人の記録は合計1万件/16MiB以下です');
       // 部分文字列が元の入力chunk全体を保持しないよう、選択した値だけを複製します。
       const group=selected.get(value.corporateNumber)??[];group.push({sourceIndex,record:{...record,values:JSON.parse(body)}});selected.set(value.corporateNumber,group);
      }
     }}finally{if(!completed)await iterator.return(undefined as never);}
    }
   }finally{insert.close();}
   index.exec('COMMIT');const digest=createHash('sha256'),statement=index.prepare('SELECT d FROM fingerprints ORDER BY k');
   try{for(const row of statement.iterate()){signal?.throwIfAborted();digest.update(row.d as Uint8Array);}}finally{statement.close();}
   for(const group of selected.values())group.sort((a,b)=>Number(a.record.values.sequenceNumber)-Number(b.record.values.sequenceNumber));
   const observed=Math.max(...parts.map(p=>Date.parse(p.source.observedAt))),reason=first.purpose!==settings.registryPurpose?'purpose-mismatch':observed>Date.parse(settings.knownAt)?'source-after-cutoff':first.dataDate>settings.asOf?'data-after-as-of':undefined;
   if(reason)excluded.push({deliveryIndex,reason});
   candidates.push({base:{deliveryIndex,sourceIndices,dataDate:first.dataDate,observedAt:new Date(observed).toISOString(),kind:first.kind,observed,signature:digest.digest('hex'),excluded:!!reason},records:selected});
  }
  signal?.throwIfAborted();const states:CorporateRegistryStateResult[]=[];let resultBytes=0;
  for(const q of queries){
   const state=reconstructRegistryCandidates(q,structuredClone(sources),candidates.map(c=>({...c.base,sourceIndices:[...c.base.sourceIndices],records:structuredClone(c.records.get(q.corporateNumber)??[])})),structuredClone(excluded),calendar===undefined?undefined:structuredClone(calendar));
   if((resultBytes+=Buffer.byteLength(JSON.stringify(state)))>256*1024**2)throw Error('法人状態の応答は合計256MiB以下です。対象番号を分けてください');
   states.push(state);
  }
  return {states,scan:{version:'1',allPartsCompleted:true,files,bytes,records,selectedRecords,unknownProcessRecords,deletionExtraFieldRecords,fingerprint:'sorted-record-sha256-v1'}};
 }finally{index.close();}
}
