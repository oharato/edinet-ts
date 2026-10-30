import {createHash} from 'node:crypto';
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {DedicatedSqliteDatabase} from './dedicated-sqlite';
import {Database,type NativeDatabase} from './node-sqlite';
import {CORPORATE_REGISTRY_FIELDS as fields,parseCorporateRegistryDownloadXml,parseCorporateRegistryStreamRecord,type CorporateRegistrySource,type CorporateRegistryRecord,type CorporateRegistryStateQuery,type CorporateRegistryStateResult} from '../corporate-registry';
import {readCorporateRegistryFile,streamCorporateRegistryRecords,CORPORATE_REGISTRY_STREAM_MAX_BYTES,type CorporateRegistryStreamReceipt} from '../corporate-registry-stream';
import {captureRegistryStateQuery,reconstructRegistryCandidates,type CorporateRegistryCandidate} from '../corporate-registry-state-core';
import {parseCorporateRegistryPublicationCalendar,type CorporateRegistryPublicationCalendarInput} from '../corporate-registry-calendar';
import {parseDocumentTimestamp} from '../document-timestamp';
import type {CorporateRegistryFileImport,CorporateRegistryStoredFile,CorporateRegistryStoredQuery,CorporateRegistryStoredDelivery,CorporateRegistryStoredStateResult} from './corporate-registry-store';
export const CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES=640*1024**2;
export interface CorporateRegistryChunkImport {source:CorporateRegistrySource;part:string;sha256:string;chunks:AsyncIterable<Uint8Array>;}
const schema={
 block_format:'CREATE TABLE block_format(kind TEXT NOT NULL)',
 block_contents:'CREATE TABLE block_contents(id INTEGER PRIMARY KEY,sha TEXT NOT NULL UNIQUE,body TEXT NOT NULL,body_sha TEXT NOT NULL)',
 block_files:'CREATE TABLE block_files(id TEXT PRIMARY KEY,content INTEGER NOT NULL,observed_ms INTEGER NOT NULL,purpose TEXT NOT NULL,body TEXT NOT NULL,body_sha TEXT NOT NULL)',
 block_by_time:'CREATE INDEX block_by_time ON block_files(purpose,observed_ms,id)',
 block_positions:'CREATE TABLE block_positions(number TEXT NOT NULL,content INTEGER NOT NULL,record INTEGER NOT NULL,first INTEGER NOT NULL,PRIMARY KEY(number,content,record)) WITHOUT ROWID',
 block_payloads:'CREATE TABLE block_payloads(content INTEGER NOT NULL,first INTEGER NOT NULL,count INTEGER NOT NULL,payload BLOB NOT NULL,sha TEXT NOT NULL,PRIMARY KEY(content,first)) WITHOUT ROWID',
};
const canonical=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const hash=(v:string|Uint8Array)=>createHash('sha256').update(v).digest('hex');
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const integer=(v:unknown,min=0):v is number=>typeof v==='number'&&Number.isSafeInteger(v)&&v>=min;
const text=(column:string,max:number)=>`CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${max} THEN ${column} END`;
const int=(column:string)=>`CASE WHEN typeof(${column})='integer' THEN ${column} END`;
function invalid():never{throw Error('圧縮法人番号DBの形式・原本hash・全記録・容量を確認してください');}
function source(input:CorporateRegistrySource):CorporateRegistrySource {const value=structuredClone(input);parseCorporateRegistryDownloadXml('<corporations/>',value);return {...value,sourceUrl:new URL(value.sourceUrl).href,observedAt:new Date(value.observedAt).toISOString()};}
function capture(input:Omit<CorporateRegistryFileImport,'file'>){const value=structuredClone(input);if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!['source','part','sha256'].includes(k))||!digest(value.sha256)||typeof value.part!=='string'||!value.part||value.part!==value.part.trim()||value.part.length>256||/[\x00-\x1f\x7f]/.test(value.part))invalid();value.source=source(value.source);const id=hash(canonical([value.source,value.part]));if(Buffer.byteLength(canonical({...value,id}))>8192)invalid();return {...value,id};}
function signalOf(options:{signal?:AbortSignal}){if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='signal'))invalid();const {signal}=options;if(signal!==undefined&&!(signal instanceof AbortSignal))invalid();signal?.throwIfAborted();return signal;}
type Content=Pick<CorporateRegistryStoredFile,'parserVersion'|'sha256'|'bytes'|'records'|'recordsSha256'>;
type Block={records:CorporateRegistryRecord[]};
/** 旧形式は変更せず、30原値を圧縮ブロックと位置索引へ保存します。 */
export class CorporateRegistryBlockStore extends DedicatedSqliteDatabase {
 private importing=false;private verified=false;private fingerprints?:NativeDatabase;
 private blocks=new Map<string,Block>();private signatures=new Map<string,string>();
 constructor(file:string,options:{readOnly?:boolean}={}){
  super(file,options,{table:'block_format',kind:'edinet-ts-corporate-registry-block-v1',schema,rollbackOnly:true,maxBytes:CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES});
  try{const size=Number(this.rows('PRAGMA page_size')[0].page_size);if(!integer(size,512)||size>65536||(size&(size-1))||this.rows('PRAGMA encoding')[0].encoding!=='UTF-8')invalid();const pages=Math.floor(CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES/size);if(Number(this.rows('PRAGMA page_count')[0].page_count)>pages)invalid();if(!this.readOnly)this.db.exec(`PRAGMA max_page_count=${pages}`);}catch(error){super.close();throw error;}
 }
 private idle(){if(this.importing||this.closed)throw Error('法人番号取込中またはclose済みです');}
 private read<T>(fn:()=>T):T {this.idle();const before=this.readOnly?this.readOnlySnapshotSha256():undefined;return this.transaction(()=>{this.verifyAll();const value=fn();if(before!==undefined&&before!==this.readOnlySnapshotSha256())invalid();return value;},false);}
 private content(id:number):Content{
  if(!integer(id,1))invalid();const row=this.rows(`SELECT ${text('sha',64)} sha,${text('body',8192)} body,${text('body_sha',64)} body_sha FROM block_contents WHERE id=?`,[id])[0];
  if(!row||typeof row.body!=='string'||hash(row.body)!==row.body_sha)invalid();const c=JSON.parse(row.body) as Content;
  if(canonical(c)!==row.body||Object.keys(c).some(k=>!['parserVersion','sha256','bytes','records','recordsSha256'].includes(k))||c.parserVersion!=='nta-download-stream-1'||!digest(c.sha256)||c.sha256!==row.sha||!digest(c.recordsSha256)||!integer(c.bytes,1)||c.bytes>CORPORATE_REGISTRY_STREAM_MAX_BYTES||!integer(c.records))invalid();return c;
 }
 private storedFile(id:string):{content:number;file:CorporateRegistryStoredFile}{
  if(!digest(id))invalid();const row=this.rows(`SELECT ${int('content')} content,${int('observed_ms')} observed_ms,${text('purpose',8)} purpose,${text('body',8192)} body,${text('body_sha',64)} body_sha FROM block_files WHERE id=?`,[id])[0];
  if(!row||!integer(row.content,1)||typeof row.body!=='string'||hash(row.body)!==row.body_sha)invalid();const f=JSON.parse(row.body) as ReturnType<typeof capture>;if(!f||typeof f!=='object'||Array.isArray(f))invalid();const {id:_,...input}=f,expected=capture(input),c=this.content(row.content);
  if(canonical(f)!==row.body||canonical(expected)!==row.body||expected.id!==id||Date.parse(f.source.observedAt)!==row.observed_ms||f.source.purpose!==row.purpose||c.sha256!==f.sha256)invalid();return {content:row.content,file:{...c,id,part:f.part,source:f.source,attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成'}};
 }
 private block(content:number,first:number,src:CorporateRegistrySource):Block {
  const key=content+':'+first,cached=this.blocks.get(key);if(cached)return cached;
  const row=this.rows(`SELECT ${int('count')} count,CASE WHEN typeof(payload)='blob' AND length(payload)<=2097152 THEN payload END payload,${text('sha',64)} sha FROM block_payloads WHERE content=? AND first=?`,[content,first])[0];
  if(!row||!integer(first,1)||!integer(row.count,1)||row.count>1024||!(row.payload instanceof Uint8Array)||!digest(row.sha))invalid();const raw=inflateRawSync(row.payload,{maxOutputLength:1024**2});if(hash(raw)!==row.sha)invalid();
  const body=new TextDecoder('utf-8',{fatal:true}).decode(raw),values=JSON.parse(body) as unknown;
  if(!Array.isArray(values)||values.length!==row.count)invalid();const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const records=values.map((v,i)=>{if(!Array.isArray(v)||v.length!==30||v.some(x=>typeof x!=='string')||Buffer.byteLength(JSON.stringify(v))>128*1024)invalid();const xml='<corporation>'+fields.map((f,j)=>'<'+f+'>'+escape(v[j])+'</'+f+'>').join('')+'</corporation>';return {...parseCorporateRegistryStreamRecord(xml,src),recordNumber:first+i};});
  if(JSON.stringify(values)!==body)invalid();const result={records};if(this.blocks.size>=8)this.blocks.delete(this.blocks.keys().next().value!);this.blocks.set(key,result);return result;
 }
 private reset(){this.verified=false;this.blocks.clear();this.signatures.clear();this.fingerprints?.close();this.fingerprints=undefined;}
 private async importingRecords(meta:ReturnType<typeof capture>,iterator:AsyncGenerator<CorporateRegistryRecord,CorporateRegistryStreamReceipt>,signal?:AbortSignal){
  this.idle();if(this.readOnly)throw Error('readOnlyの圧縮法人番号DBです');signal?.throwIfAborted();this.importing=true;this.reset();
  try{return await this.transactionAsync(async()=>{
   const prior=this.rows('SELECT id FROM block_files WHERE id=?',[meta.id])[0];if(prior&&this.storedFile(meta.id).file.sha256!==meta.sha256)throw Error('同時点の法人番号原本が競合しています');
   const exists=this.rows('SELECT id FROM block_contents WHERE sha=?',[meta.sha256])[0];let content:number;
   if(exists){if(!integer(exists.id,1))invalid();content=exists.id;}else{
    if(Number(this.rows('SELECT COUNT(*) n FROM block_contents')[0].n)>=10000)invalid();content=Number(this.rows('SELECT COALESCE(MAX(id),0)+1 id FROM block_contents')[0].id);if(!integer(content,1))invalid();
   }
   if(!prior&&Number(this.rows('SELECT COUNT(*) n FROM block_files')[0].n)>=10000)invalid();
   const seen=new Uint8Array(12500000),recordsHash=createHash('sha256');let count=0,batch:string[][]=[],batchBytes=2,first=1;
   const insertPosition=this.db.prepare('INSERT INTO block_positions VALUES(?,?,?,?)'),insertBlock=this.db.prepare('INSERT INTO block_payloads VALUES(?,?,?,?,?)'),lookup=this.db.prepare('SELECT first FROM block_positions WHERE number=? AND content=? AND record=?');
   const flush=()=>{if(!batch.length)return;const raw=Buffer.from(JSON.stringify(batch));if(raw.length>1024**2)invalid();insertBlock.run(content,first,batch.length,deflateRawSync(raw,{level:6}),hash(raw));batch=[];batchBytes=2;};
   let receipt:CorporateRegistryStreamReceipt;
   try{for(;;){const next=await iterator.next();signal?.throwIfAborted();if(next.done){receipt=next.value;break;}const record=next.value;if(record.recordNumber!==++count)invalid();const sequence=Number(record.values.sequenceNumber)-1,slot=sequence>>3,mask=1<<(sequence&7);if(seen[slot]&mask)throw Error('一連番号が原本内で重複しています');seen[slot]|=mask;
    const body=canonical(record);recordsHash.update(hash(canonical([meta.sha256,count,body]))+'\n');
    if(exists){const position=lookup.get(record.values.corporateNumber,content,count);if(!position||!integer(position.first,1)||canonical(this.block(content,position.first,meta.source).records[count-position.first])!==body)invalid();}
    else{
     // 部分文字列が元の入力chunk全体を保持しないよう、保存する30値だけを複製します。
     const encoded=JSON.stringify(fields.map(f=>record.values[f])),size=Buffer.byteLength(encoded),values=JSON.parse(encoded) as string[];if(size>128*1024)invalid();if(batch.length&&(batch.length>=1024||batchBytes+size+1>1024**2))flush();if(!batch.length)first=count;batch.push(values);batchBytes+=size+1;insertPosition.run(record.values.corporateNumber,content,count,first);}
   }flush();}finally{insertPosition.close();insertBlock.close();lookup.close();await iterator.return(undefined as never);}
   if(receipt!.source.inputXmlSha256!==meta.sha256||receipt!.records!==count)invalid();const value:Content={parserVersion:receipt!.parserVersion,sha256:meta.sha256,bytes:receipt!.bytes,records:count,recordsSha256:recordsHash.digest('hex')};
   if(Number(this.rows('SELECT COUNT(*) n FROM block_positions WHERE content=?',[content])[0].n)!==count)invalid();
   if(exists){if(canonical(this.content(content))!==canonical(value))invalid();}else{const body=canonical(value);this.run('INSERT INTO block_contents VALUES(?,?,?,?)',[content,meta.sha256,body,hash(body)]);}
   if(!prior){const body=canonical(meta);this.run('INSERT INTO block_files VALUES(?,?,?,?,?,?)',[meta.id,content,Date.parse(meta.source.observedAt),meta.source.purpose,body,hash(body)]);}
   signal?.throwIfAborted();return {status:prior?'unchanged' as const:'inserted' as const,content:exists?'reused' as const:'inserted' as const,file:{...value,id:meta.id,part:meta.part,source:meta.source,attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成' as const}};
  });}finally{this.importing=false;this.reset();}
 }
 async importFile(input:CorporateRegistryFileImport,options:{signal?:AbortSignal}={}){
  const captured=structuredClone(input);if(!captured||typeof captured!=='object'||Array.isArray(captured)||Object.keys(captured).some(k=>!['file','source','part','sha256'].includes(k))||typeof captured.file!=='string'||!captured.file.trim())invalid();const {file,...rest}=captured,meta=capture(rest),signal=signalOf(options);return this.importingRecords(meta,readCorporateRegistryFile(file,meta.source,meta.sha256,{signal}),signal);
 }
 async importChunks(input:CorporateRegistryChunkImport,options:{signal?:AbortSignal}={}){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['chunks','source','part','sha256'].includes(k)))invalid();const {chunks,...rest}=input,meta=capture(rest);if(!chunks||typeof chunks[Symbol.asyncIterator]!=='function')invalid();const signal=signalOf(options);return this.importingRecords(meta,streamCorporateRegistryRecords(chunks,meta.source,{signal}),signal);
 }
 private verifyAll(){
  if(this.readOnly&&this.verified)return;this.reset();const integrity=this.rows('PRAGMA integrity_check(1)');if(integrity.length!==1||integrity[0].integrity_check!=='ok')invalid();if(Number(this.rows('SELECT COUNT(*) n FROM block_files')[0].n)>10000)invalid();const contents=new Map<number,CorporateRegistryStoredFile>();
  for(const row of this.rows(`SELECT ${text('id',64)} id FROM block_files`)){if(!digest(row.id))invalid();const f=this.storedFile(row.id),prior=contents.get(f.content);if(!prior||f.file.source.dataDate<prior.source.dataDate)contents.set(f.content,f.file);}
  if(Number(this.rows('SELECT COUNT(*) n FROM block_contents')[0].n)!==contents.size)invalid();const fingerprints=new Database(':memory:');
  try{
   fingerprints.exec('PRAGMA page_size=4096; PRAGMA max_page_count=262144; PRAGMA journal_mode=OFF; PRAGMA temp_store=MEMORY; CREATE TABLE records(content INTEGER,number TEXT,sequence INTEGER,record INTEGER,d BLOB,PRIMARY KEY(content,record)) WITHOUT ROWID; BEGIN');const insert=fingerprints.prepare('INSERT INTO records VALUES(?,?,?,?,?)'),lookup=this.db.prepare('SELECT first FROM block_positions WHERE number=? AND content=? AND record=?');let total=0,blocks=0;
   try{for(const [id,file] of contents){let count=0,after=0;const seen=new Uint8Array(12500000),recordsHash=createHash('sha256');for(;;){const batch=this.rows(`SELECT ${int('first')} first FROM block_payloads WHERE content=? AND first>? ORDER BY first LIMIT 500`,[id,after]);if(!batch.length)break;
    for(const row of batch){if(!integer(row.first,1)||row.first!==count+1)invalid();const block=this.block(id,row.first,file.source);blocks++;for(const record of block.records){if(record.recordNumber!==++count)invalid();const position=lookup.get(record.values.corporateNumber,id,count);if(position?.first!==row.first)invalid();const seq=Number(record.values.sequenceNumber)-1,slot=seq>>3,mask=1<<(seq&7);if(seen[slot]&mask)invalid();seen[slot]|=mask;const body=canonical(record);recordsHash.update(hash(canonical([file.sha256,count,body]))+'\n');insert.run(id,record.values.corporateNumber,seq+1,count,createHash('sha256').update(JSON.stringify(record.values)).digest());}after=row.first;}
   }if(count!==file.records||recordsHash.digest('hex')!==file.recordsSha256)invalid();total+=count;}}finally{insert.close();lookup.close();}
   if(total!==Number(this.rows('SELECT COUNT(*) n FROM block_positions')[0].n)||blocks!==Number(this.rows('SELECT COUNT(*) n FROM block_payloads')[0].n))invalid();fingerprints.exec('COMMIT');this.fingerprints=fingerprints;this.verified=this.readOnly;
  }catch(error){fingerprints.close();this.blocks.clear();throw error;}
 }
 file(id:string):CorporateRegistryStoredFile{return this.read(()=>structuredClone(this.storedFile(id).file));}
 audit(id:string){return this.read(()=>{const file=this.storedFile(id).file;return {verification:'all-records' as const,file,records:file.records};});}
 private selected(ids:readonly string[],number:string,paging?:{offset:number;limit:number}){
  const selected=this.rows(`SELECT ${int('p.content')} content,${int('p.record')} record,${int('p.first')} first,${text('f.id',64)} file_id FROM block_positions p JOIN block_files f ON p.content=f.content WHERE p.number=? AND f.id IN (${ids.map(()=>'?').join(',')}) ORDER BY f.observed_ms DESC,f.id,p.record LIMIT ? OFFSET ?`,[number,...ids,paging?.limit??10001,paging?.offset??0]);
  if(selected.length>10000)invalid();let bytes=0;const files=new Map<string,{content:number;file:CorporateRegistryStoredFile}>();return selected.map(row=>{if(!digest(row.file_id)||!integer(row.content,1)||!integer(row.record,1)||!integer(row.first,1))invalid();let stored=files.get(row.file_id);if(!stored){stored=this.storedFile(row.file_id);files.set(row.file_id,stored);}if(stored.content!==row.content)invalid();const file=stored.file,record=this.block(row.content,row.first,file.source).records[row.record-row.first];if(!record||record.values.corporateNumber!==number||(bytes+=Buffer.byteLength(canonical(record)))>(paging?128:16)*1024**2)invalid();return {file,record:structuredClone(record)};});
 }
 query(input:CorporateRegistryStoredQuery){
  const q=structuredClone(input),offset=q?.offset??0,limit=q?.limit??100;if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!['corporateNumber','knownAt','registryPurpose','offset','limit'].includes(k))||typeof q.corporateNumber!=='string'||!/^\d{13}$/.test(q.corporateNumber)||parseDocumentTimestamp(q.knownAt,true)===undefined||!['sample','download'].includes(q.registryPurpose)||!integer(offset)||!integer(limit)||limit>1000)invalid();
  return this.read(()=>{const rows=this.rows(`SELECT ${text('id',64)} id FROM block_files WHERE observed_ms<=? AND purpose=?`,[Date.parse(q.knownAt),q.registryPurpose]),ids=rows.map(row=>{if(!digest(row.id))invalid();return row.id;});
   const total=Number(this.rows('SELECT COUNT(*) n FROM block_positions p JOIN block_files f ON p.content=f.content WHERE p.number=? AND f.observed_ms<=? AND f.purpose=?',[q.corporateNumber,Date.parse(q.knownAt),q.registryPurpose])[0].n);
   return {query:{...q,offset,limit},verification:'all-records' as const,total,rows:ids.length?this.selected(ids,q.corporateNumber,{offset,limit}):[]};});
 }
 private signature(files:{content:number;file:CorporateRegistryStoredFile}[]){
  const key=JSON.stringify(files.map(f=>f.file.id).sort()),cached=this.signatures.get(key);if(cached)return cached;const ids=files.map(f=>f.content),kind=files[0].file.source.kind,seen=new Set<number>();for(const f of files){if(seen.has(f.content)&&f.file.records)invalid();seen.add(f.content);}const placeholders=ids.map(()=>'?').join(','),unique=kind==='full'?'number':'sequence';
  const duplicate=this.fingerprints!.prepare(`SELECT 1 bad FROM records WHERE content IN (${placeholders}) GROUP BY ${unique} HAVING COUNT(*)>1 LIMIT 1`);try{if(duplicate.get(...ids))throw Error('全国配布の法人番号または一連番号が分割間で重複しています');}finally{duplicate.close();}
  const rows=this.fingerprints!.prepare(`SELECT d FROM records WHERE content IN (${placeholders}) ORDER BY number,sequence`),digest=createHash('sha256');try{for(const row of rows.iterate(...ids))digest.update(row.d as Uint8Array);}finally{rows.close();}const value=digest.digest('hex');if(this.signatures.size>=1024)this.signatures.clear();this.signatures.set(key,value);return value;
 }
 reconstruct(inputs:readonly CorporateRegistryStoredDelivery[],query:CorporateRegistryStateQuery,calendarInput?:CorporateRegistryPublicationCalendarInput):CorporateRegistryStoredStateResult {
  const q=captureRegistryStateQuery(query),calendar=calendarInput===undefined?undefined:parseCorporateRegistryPublicationCalendar(structuredClone(calendarInput)),manifests=structuredClone(inputs);if(!Array.isArray(manifests)||manifests.length>100)invalid();let parts=0;
  for(const m of Array.from(manifests)){if(!m||typeof m!=='object'||Array.isArray(m)||Object.keys(m).some(k=>!['scope','expectedParts','fileIds'].includes(k))||m.scope!=='national'||!integer(m.expectedParts,1)||!Array.isArray(m.fileIds)||m.fileIds.length!==m.expectedParts||(parts+=m.fileIds.length)>100||Array.from(m.fileIds).some(id=>!digest(id))||new Set(m.fileIds).size!==m.fileIds.length)invalid();}
  return this.read(()=>{const files:CorporateRegistryStoredFile[]=[],sources:CorporateRegistryStateResult['sources']=[],excluded:CorporateRegistryStateResult['excludedDeliveries']=[];let count=0,bytes=0;
   const candidates:CorporateRegistryCandidate[]=manifests.map((m:CorporateRegistryStoredDelivery,deliveryIndex)=>{const stored=m.fileIds.map(id=>this.storedFile(id)),first=stored[0].file.source;if(stored.some(f=>f.file.source.kind!==first.kind||f.file.source.dataDate!==first.dataDate||f.file.source.purpose!==first.purpose))invalid();const indices=new Map<string,number>(),sourceIndices=stored.map(({file})=>{const index=files.length;indices.set(file.id,index);files.push(file);sources.push({...file.source,inputXmlSha256:file.sha256,attribution:file.attribution});return index;});const observed=Math.max(...stored.map(f=>Date.parse(f.file.source.observedAt))),reason=first.purpose!==q.registryPurpose?'purpose-mismatch':observed>Date.parse(q.knownAt)?'source-after-cutoff':first.dataDate>q.asOf?'data-after-as-of':undefined;if(reason)excluded.push({deliveryIndex,reason});
    const records=this.selected(m.fileIds,q.corporateNumber).map(({file,record})=>{if(++count>10000||(bytes+=Buffer.byteLength(canonical(record)))>16*1024**2)invalid();return {sourceIndex:indices.get(file.id)!,record};}).sort((a,b)=>Number(a.record.values.sequenceNumber)-Number(b.record.values.sequenceNumber));return {deliveryIndex,sourceIndices,dataDate:first.dataDate,observedAt:new Date(observed).toISOString(),kind:first.kind,records,observed,signature:this.signature(stored),excluded:!!reason};});
   return {...reconstructRegistryCandidates(q,sources,candidates,excluded,calendar),storage:{verification:'all-records',files}};
  });
 }
 override close(){if(this.importing)throw Error('法人番号取込の完了後にcloseしてください');if(this.closed)return;this.reset();super.close();}
}
