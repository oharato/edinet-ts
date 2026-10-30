import {createHash} from 'node:crypto';
import {DedicatedSqliteDatabase} from './dedicated-sqlite';
import {parseCorporateRegistryDownloadXml,CORPORATE_REGISTRY_FIELDS,type CorporateRegistrySource,type CorporateRegistryRecord} from '../corporate-registry';
import {readCorporateRegistryFile,CORPORATE_REGISTRY_STREAM_MAX_BYTES,type CorporateRegistryStreamReceipt} from '../corporate-registry-stream';
import {parseDocumentTimestamp} from '../document-timestamp';
const schema={
 registry_format:'CREATE TABLE registry_format(kind TEXT NOT NULL)',
 registry_contents:'CREATE TABLE registry_contents(sha256 TEXT PRIMARY KEY,body TEXT NOT NULL,body_sha256 TEXT NOT NULL)',
 registry_files:'CREATE TABLE registry_files(id TEXT PRIMARY KEY,content_sha256 TEXT NOT NULL,observed_ms INTEGER NOT NULL,purpose TEXT NOT NULL,body TEXT NOT NULL,body_sha256 TEXT NOT NULL)',
 registry_by_time:'CREATE INDEX registry_by_time ON registry_files(purpose,observed_ms,id)',
 registry_records:'CREATE TABLE registry_records(content_sha256 TEXT NOT NULL,record_no INTEGER NOT NULL,corporate_number TEXT NOT NULL,sequence_number INTEGER NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(content_sha256,record_no),UNIQUE(content_sha256,sequence_number))',
 registry_by_number:'CREATE INDEX registry_by_number ON registry_records(corporate_number,content_sha256,record_no)',
};
const textColumn=(name:string,max:number,alias='')=>`CASE WHEN typeof(${alias}${name})='text' AND length(CAST(${alias}${name} AS BLOB))<=${max} THEN ${alias}${name} END AS ${name}`;
const intColumn=(name:string,alias='')=>`CASE WHEN typeof(${alias}${name})='integer' THEN ${alias}${name} END AS ${name}`;
const fileColumns=[textColumn('id',64),textColumn('content_sha256',64),intColumn('observed_ms'),textColumn('purpose',8),textColumn('body',8192),textColumn('body_sha256',64)].join(',');
const recordColumns=(alias='')=>[textColumn('content_sha256',64,alias),intColumn('record_no',alias),textColumn('corporate_number',13,alias),intColumn('sequence_number',alias),textColumn('body',128*1024,alias),textColumn('sha256',64,alias)].join(',');
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const canonical=(value:unknown):string=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function invalid():never{throw Error('法人番号保存DBの来歴・本文・索引を確認してください');}
function normalizeSource(input:CorporateRegistrySource):CorporateRegistrySource{
 const source=structuredClone(input);parseCorporateRegistryDownloadXml('<corporations/>',source);return {...source,sourceUrl:new URL(source.sourceUrl).href,observedAt:new Date(source.observedAt).toISOString()};
}
const validPart=(v:unknown):v is string=>typeof v==='string'&&!!v.trim()&&v===v.trim()&&v.length<=256&&!/[\x00-\x1f\x7f]/.test(v);
const fileId=(source:CorporateRegistrySource,part:string)=>hash(canonical([source,part]));
interface StoredContent {parserVersion:'nta-download-stream-1';sha256:string;bytes:number;records:number;recordsSha256:string;}
export interface CorporateRegistryStoredFile extends StoredContent {id:string;part:string;source:CorporateRegistrySource;attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成';}
export interface CorporateRegistryFileImport {file:string;source:CorporateRegistrySource;part:string;sha256:string;}
export interface CorporateRegistryStoredQuery {corporateNumber:string;knownAt:string;registryPurpose:CorporateRegistrySource['purpose'];offset?:number;limit?:number;}
/** 原記録を専用DBへ原子的に保存。同一byte列は共有し、観測時刻・part・目的は別に保持します。 */
export class CorporateRegistryStore extends DedicatedSqliteDatabase {
 private importing=false;
 private verified=false;
 constructor(file:string,options:{readOnly?:boolean}={}){super(file,options,{table:'registry_format',kind:'edinet-ts-corporate-registry-v1',schema});}
 private idle(){if(this.importing||this.closed)throw Error('法人番号取込中またはclose済みです');}
 private read<T>(fn:()=>T):T{this.idle();const sha=this.readOnly?this.readOnlySnapshotSha256():undefined;const value=this.transaction(fn,false);if(sha!==undefined&&sha!==this.readOnlySnapshotSha256())invalid();return value;}
 private content(sha256:string):StoredContent{
  const row=this.rows("SELECT sha256,CASE WHEN typeof(body)='text' AND length(CAST(body AS BLOB))<=8192 THEN body END body,CASE WHEN length(body_sha256)=64 THEN body_sha256 END body_sha256 FROM registry_contents WHERE sha256=?",[sha256])[0];if(!row||typeof row.body!=='string'||hash(row.body)!==row.body_sha256)invalid();
  const c=JSON.parse(row.body) as StoredContent;
  if(canonical(c)!==row.body||Object.keys(c).some(k=>!['parserVersion','sha256','bytes','records','recordsSha256'].includes(k))||c.parserVersion!=='nta-download-stream-1'||c.sha256!==sha256||!digest(c.sha256)||!digest(c.recordsSha256)||!Number.isSafeInteger(c.bytes)||c.bytes<1||c.bytes>CORPORATE_REGISTRY_STREAM_MAX_BYTES||!Number.isSafeInteger(c.records)||c.records<0)invalid();return c;
 }
 private decodeFile(row:Record<string,unknown>):CorporateRegistryStoredFile{
  if(typeof row.body!=='string'||Buffer.byteLength(row.body)>8192||hash(row.body)!==row.body_sha256)invalid();
  const f=JSON.parse(row.body) as {id:string;part:string;source:CorporateRegistrySource;sha256:string};
  if(canonical(f)!==row.body||Object.keys(f).some(k=>!['id','part','source','sha256'].includes(k))||!validPart(f.part)||canonical(normalizeSource(f.source))!==canonical(f.source)||fileId(f.source,f.part)!==f.id||f.id!==row.id||!digest(f.sha256)||f.sha256!==row.content_sha256||Date.parse(f.source.observedAt)!==row.observed_ms||f.source.purpose!==row.purpose)invalid();return {...f,...this.content(f.sha256),attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成'};
 }
 private decodeRecord(row:Record<string,unknown>,source:CorporateRegistrySource):CorporateRegistryRecord{
  if(typeof row.body!=='string'||Buffer.byteLength(row.body)>128*1024||hash(canonical([row.content_sha256,row.record_no,row.body]))!==row.sha256)invalid();
  const record=JSON.parse(row.body) as CorporateRegistryRecord;
  if(!record||!record.values||Object.keys(record).some(k=>!['recordNumber','values','processKnown','deletionExtraFields'].includes(k))||Object.keys(record.values).length!==CORPORATE_REGISTRY_FIELDS.length||CORPORATE_REGISTRY_FIELDS.some(k=>typeof record.values[k]!=='string'))invalid();
  const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const xml='<corporations><corporation>'+CORPORATE_REGISTRY_FIELDS.map(k=>'<'+k+'>'+escape(record.values[k])+'</'+k+'>').join('')+'</corporation></corporations>',expected=parseCorporateRegistryDownloadXml(xml,source).records[0];
  if(!Number.isSafeInteger(record.recordNumber)||record.recordNumber<1||record.recordNumber!==row.record_no||record.values.corporateNumber!==row.corporate_number||Number(record.values.sequenceNumber)!==row.sequence_number||canonical({...expected,recordNumber:record.recordNumber})!==row.body)invalid();return record;
 }
 async importFile(input:CorporateRegistryFileImport,options:{signal?:AbortSignal}={}):Promise<{status:'inserted'|'unchanged';content:'inserted'|'reused';file:CorporateRegistryStoredFile}>{
  this.idle();if(this.readOnly)throw Error('readOnlyの法人番号DBです');
  if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='signal'))invalid();
  const captured=structuredClone(input),{signal}=options;
  if(!captured||typeof captured!=='object'||Array.isArray(captured)||Object.keys(captured).some(k=>!['file','source','part','sha256'].includes(k))||typeof captured.file!=='string'||!captured.file.trim()||!validPart(captured.part)||!digest(captured.sha256)||!options||Object.keys(options).some(k=>k!=='signal')||signal!==undefined&&!(signal instanceof AbortSignal))invalid();
  const source=normalizeSource(captured.source),id=fileId(source,captured.part);if(Buffer.byteLength(canonical({id,part:captured.part,source,sha256:captured.sha256}))>8192)invalid();this.importing=true;
  try{return await this.transactionAsync(async()=>{
   const previous=this.rows('SELECT '+fileColumns+' FROM registry_files WHERE id=?',[id])[0],previousFile=previous?this.decodeFile(previous):undefined;
   if(previousFile&&previousFile.sha256!==captured.sha256)throw Error('同時点の法人番号原本が競合しています');
   const reused=this.rows('SELECT sha256 FROM registry_contents WHERE sha256=?',[captured.sha256]).length===1,recordsHash=createHash('sha256');
   const iterator=readCorporateRegistryFile(captured.file,source,captured.sha256,{signal});let receipt:CorporateRegistryStreamReceipt;
   try{for(;;){const next=await iterator.next();if(next.done){receipt=next.value;break;}const record=next.value,body=canonical(record),sha=hash(canonical([captured.sha256,record.recordNumber,body]));recordsHash.update(sha+'\n');
    if(reused){const row=this.rows('SELECT '+recordColumns()+' FROM registry_records WHERE content_sha256=? AND record_no=?',[captured.sha256,record.recordNumber])[0];if(!row||canonical(this.decodeRecord(row,source))!==body)invalid();}
    else this.run('INSERT INTO registry_records VALUES(?,?,?,?,?,?)',[captured.sha256,record.recordNumber,record.values.corporateNumber,Number(record.values.sequenceNumber),body,sha]);
   }}finally{await iterator.return(undefined as never);}
   signal?.throwIfAborted();
   const content:StoredContent={parserVersion:receipt!.parserVersion,sha256:captured.sha256,bytes:receipt!.bytes,records:receipt!.records,recordsSha256:recordsHash.digest('hex')};
   if(Number(this.rows('SELECT COUNT(*) n FROM registry_records WHERE content_sha256=?',[captured.sha256])[0].n)!==content.records)invalid();
   if(reused){if(canonical(this.content(captured.sha256))!==canonical(content))invalid();}
   else {const body=canonical(content);this.run('INSERT INTO registry_contents VALUES(?,?,?)',[captured.sha256,body,hash(body)]);}
   if(!previous){const body=canonical({id,part:captured.part,source,sha256:captured.sha256});this.run('INSERT INTO registry_files VALUES(?,?,?,?,?,?)',[id,captured.sha256,Date.parse(source.observedAt),source.purpose,body,hash(body)]);}
   return {status:previous?'unchanged':'inserted',content:reused?'reused':'inserted',file:{...content,id,part:captured.part,source,attribution:'国税庁法人番号公表サイト（国税庁）を加工して作成'}};
  });}finally{this.importing=false;}
 }
 file(id:string):CorporateRegistryStoredFile{if(!digest(id))invalid();return this.read(()=>{this.verifyAll();const row=this.rows('SELECT '+fileColumns+' FROM registry_files WHERE id=?',[id])[0];if(!row)invalid();return this.decodeFile(row);});}
 query(input:CorporateRegistryStoredQuery){
  const q=structuredClone(input);if(!q||typeof q!=='object'||Array.isArray(q)||Object.keys(q).some(k=>!['corporateNumber','knownAt','registryPurpose','offset','limit'].includes(k))||typeof q.corporateNumber!=='string'||!/^\d{13}$/.test(q.corporateNumber)||parseDocumentTimestamp(q.knownAt,true)===undefined||!['sample','download'].includes(q.registryPurpose))invalid();
  const offset=q.offset??0,limit=q.limit??100;if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<0||limit>1000)invalid();
  return this.read(()=>{
   this.verifyAll();
   const args=[q.corporateNumber,Date.parse(q.knownAt),q.registryPurpose],where='r.corporate_number=? AND f.observed_ms<=? AND f.purpose=?';
   const total=Number(this.rows('SELECT COUNT(*) n FROM registry_records r JOIN registry_files f ON f.content_sha256=r.content_sha256 WHERE '+where,args)[0].n);
   const selected=this.rows('SELECT '+recordColumns('r.')+',f.id file_id FROM registry_records r JOIN registry_files f ON f.content_sha256=r.content_sha256 WHERE '+where+' ORDER BY f.observed_ms DESC,f.id,r.record_no LIMIT ? OFFSET ?',[...args,limit,offset]);
   const files=new Map<string,CorporateRegistryStoredFile>();
   const rows=selected.map(row=>{const id=String(row.file_id);let file=files.get(id);if(!file){file=this.decodeFile(this.rows('SELECT '+fileColumns+' FROM registry_files WHERE id=?',[id])[0]);files.set(id,file);}return {file,record:this.decodeRecord(row,file.source)};});
   return {query:{...q,offset,limit},verification:'all-records' as const,total,rows};
  });
 }
 private auditContent(file:CorporateRegistryStoredFile){
  const digest=createHash('sha256');let count=0;
  for(;;){const batch=this.rows('SELECT '+recordColumns()+' FROM registry_records WHERE content_sha256=? AND record_no>? ORDER BY record_no LIMIT 500',[file.sha256,count]);if(!batch.length)break;
   for(const row of batch){const record=this.decodeRecord(row,file.source);if(record.recordNumber!==++count)invalid();digest.update(String(row.sha256)+'\n');}
  }
  if(count!==file.records||digest.digest('hex')!==file.recordsSha256)invalid();return count;
 }
 private verifyAll(){
  if(this.readOnly&&this.verified)return;
  const files=new Map<string,CorporateRegistryStoredFile>();let after='';
  for(;;){const batch=this.rows('SELECT '+fileColumns+' FROM registry_files WHERE id>? ORDER BY id LIMIT 500',[after]);if(!batch.length)break;
   for(const row of batch){const file=this.decodeFile(row),prior=files.get(file.sha256);if(!prior||file.source.dataDate<prior.source.dataDate)files.set(file.sha256,file);after=String(row.id);}
  }
  let contents=0,records=0;after='';
  for(;;){const batch=this.rows('SELECT '+textColumn('sha256',64)+' FROM registry_contents WHERE sha256>? ORDER BY sha256 LIMIT 500',[after]);if(!batch.length)break;
   for(const row of batch){const file=files.get(String(row.sha256));if(!file)invalid();records+=this.auditContent(file);contents++;after=String(row.sha256);}
  }
  if(contents!==files.size||records!==Number(this.rows('SELECT COUNT(*) n FROM registry_records')[0].n))invalid();
  if(this.readOnly)this.verified=true;
 }
 audit(id:string){if(!digest(id))invalid();return this.read(()=>{
  const file=this.decodeFile(this.rows('SELECT '+fileColumns+' FROM registry_files WHERE id=?',[id])[0]);return {verification:'all-records' as const,file,records:this.auditContent(file)};
 });}
 override close(){if(this.importing)throw Error('法人番号取込の完了後にcloseしてください');super.close();}
}
