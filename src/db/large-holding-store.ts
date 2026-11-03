import {createHash} from 'node:crypto';
import {DedicatedSqliteDatabase} from './dedicated-sqlite';
import {analyzeDocumentRelations} from '../document-relations';
import {parseDocumentTimestamp as timestamp} from '../document-timestamp';
import {parseReportedTableNumber} from '../reported-table-number';
import {LARGE_HOLDING_REPORT_VERSION,LargeHoldingMetric,extractLargeHoldingReport,searchParsedLargeHoldingReports,type LargeHoldingMetadata,type LargeHoldingReport,type LargeHoldingSearchOptions} from '../large-holding-report';
import {LARGE_HOLDING_VERSION_FIELDS,LARGE_HOLDING_VERSIONS_VERSION,selectLargeHoldingReportVersions,type LargeHoldingVersionObservation} from '../large-holding-versions';
import type {ObservedLargeHoldingSource} from '../observed-large-holding';
import {extractLargeHoldingTransactions,searchParsedLargeHoldingTransactions,validateStoredLargeHoldingTransactions,type LargeHoldingTransactions,type LargeHoldingTransactionSearchOptions} from '../large-holding-transactions';
export const LARGE_HOLDING_STORE_VERSION='1';
const format=`edinet-ts-large-holding-${LARGE_HOLDING_REPORT_VERSION}-${LARGE_HOLDING_VERSIONS_VERSION}-v1`;
const schema={
 holding_format:'CREATE TABLE holding_format(kind TEXT NOT NULL)',
 holding_observations:'CREATE TABLE holding_observations(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,observed_ms INTEGER NOT NULL,issuer_code TEXT,parent_id TEXT,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
 holding_obs_doc:'CREATE INDEX holding_obs_doc ON holding_observations(doc_id,observed_ms,id)',
 holding_obs_issuer:'CREATE INDEX holding_obs_issuer ON holding_observations(issuer_code,observed_ms,doc_id)',
 holding_obs_parent:'CREATE INDEX holding_obs_parent ON holding_observations(parent_id,observed_ms,doc_id)',
 holding_sources:'CREATE TABLE holding_sources(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,available_ms INTEGER NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
 holding_src_doc:'CREATE INDEX holding_src_doc ON holding_sources(doc_id,available_ms,id)',
 holding_snapshots:'CREATE TABLE holding_snapshots(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,source_sha256 TEXT NOT NULL,metadata_body TEXT NOT NULL,body_status TEXT NOT NULL,duty_date TEXT,issuer_code TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
 holding_snapshot_doc:'CREATE INDEX holding_snapshot_doc ON holding_snapshots(doc_id,duty_date,issuer_code,id)',
 holding_values:`CREATE VIEW holding_values AS SELECT s.id snapshot_id,s.doc_id,s.source_sha256,s.duty_date,s.issuer_code,json_extract(r.value,'$.rowKey') row_key,json_extract(r.value,'$.role') role,json_extract(r.value,'$.contextRef') context_ref,v.key metric_id,json_extract(v.value,'$.status') status,json_extract(v.value,'$.reason') reason,json_extract(v.value,'$.raw') raw_text,json_extract(v.value,'$.decimal') decimal_text,json_extract(v.value,'$.valueUnit') value_unit,json_extract(v.value,'$.multiplier') multiplier FROM holding_snapshots s,json_each(s.body,'$.report.rows') r,json_each(r.value,'$.values') v WHERE s.body_status='parsed'`,
};
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const digest=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
const text=(column:string,max:number)=>`CASE WHEN typeof(${column})='text' AND length(CAST(${column} AS BLOB))<=${max} THEN ${column} END AS ${column}`;
const obsColumns=['id','doc_id','observed_ms','issuer_code','parent_id',text('body',32768),'sha256'].join(',');
const srcColumns=['id','doc_id','available_ms',text('body',8192),'sha256'].join(',');
const snapshotColumns=['id','doc_id','source_sha256',text('metadata_body',16384),'body_status','duty_date','issuer_code',text('body',32*1024**2),'sha256'].join(',');
function invalid():never{throw Error('大量保有Storeの観測・原本宣言・解析結果・索引を確認してください');}
type Declaration=Omit<ObservedLargeHoldingSource,'xml'>;
type TransactionBody={status:'parsed';report:Omit<LargeHoldingTransactions,'metadata'>}|{status:'source-too-large'|'source-parse-failed'};
type ParsedBody={status:'parsed';report:Omit<LargeHoldingReport,'metadata'>;transactions?:TransactionBody}|{status:'source-not-loaded'|'source-parse-failed'};
type Metadata=Omit<LargeHoldingMetadata,'knownAt'>;
const sourceId=(s:Declaration)=>hash(canonical(s));
const snapshotId=(m:Metadata,sha:string)=>hash(canonical([LARGE_HOLDING_REPORT_VERSION,m,sha]));
function observations(input:readonly LargeHoldingVersionObservation[]):LargeHoldingVersionObservation[]{
 const data=structuredClone(input);if(!Array.isArray(data)||data.length>10000)invalid();
 const out=Array.from({length:data.length},(_,i)=>{const o=data[i];if(!o||Object.keys(o).some(k=>!['observationId','observedAt','listDate','document'].includes(k))||!o.document||typeof o.document!=='object'||Array.isArray(o.document)||timestamp(o.observedAt,true)===undefined)invalid();
  const document=Object.fromEntries(LARGE_HOLDING_VERSION_FIELDS.filter(k=>Object.hasOwn(o.document,k)).map(k=>[k,o.document[k]])) as LargeHoldingVersionObservation['document'];
  return {observationId:o.observationId,observedAt:new Date(timestamp(o.observedAt,true)!).toISOString(),...(o.listDate===undefined?{}:{listDate:o.listDate}),document};});
 if(out.length)selectLargeHoldingReportVersions(out,new Date(Math.max(...out.map(o=>timestamp(o.observedAt,true)!))).toISOString());
 if(out.some(o=>Buffer.byteLength(canonical(o))>32768))invalid();return out;
}
function declaration(value:ObservedLargeHoldingSource):{source:Declaration;xml?:string}{
 const s=structuredClone(value);if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).some(k=>!['docID','availableAt','sourceSha256','coverContextRef','xml'].includes(k))||!id(s.docID)||timestamp(s.availableAt,true)===undefined||!digest(s.sourceSha256)||typeof s.coverContextRef!=='string'||!s.coverContextRef.trim()||s.coverContextRef.length>1000||s.xml!==undefined&&typeof s.xml!=='string')invalid();
 if(s.xml!==undefined&&(Buffer.byteLength(s.xml)>64*1024**2||Buffer.from(s.xml).toString('utf8')!==s.xml||hash(s.xml)!==s.sourceSha256))invalid();
 return {source:{docID:s.docID,availableAt:new Date(timestamp(s.availableAt,true)!).toISOString(),sourceSha256:s.sourceSha256,coverContextRef:s.coverContextRef},...(s.xml===undefined?{}:{xml:s.xml})};
}
function metadata(o:LargeHoldingVersionObservation,s:Declaration):LargeHoldingMetadata|undefined{
 const d=o.document;if(!['350','360'].includes(d.docTypeCode??'')||!/^E\d{5}$/.test(d.edinetCode??'')||!/^E\d{5}$/.test(d.issuerEdinetCode??'')||typeof d.formCode!=='string'||timestamp(d.submitDateTime,false)===undefined)return;
 const {issuerEdinetCode:_,formCode:__,...base}=d;
 const normalized=analyzeDocumentRelations([{observationId:o.observationId,document:{...base,...(d.docTypeCode==='350'?{parentDocID:null}:{})}}]).observations[0];
 if(Object.values(normalized.statuses).some(v=>v.presence!=='known'||v.code!=='0'))return;
 return {docID:d.docID,docTypeCode:d.docTypeCode as '350'|'360',formCode:d.formCode,edinetCode:d.edinetCode!,issuerEdinetCode:d.issuerEdinetCode!,parentDocID:d.parentDocID??undefined,submitDateTime:d.submitDateTime!,knownAt:new Date(Math.max(timestamp(o.observedAt,true)!,timestamp(s.availableAt,true)!)).toISOString(),coverContextRef:s.coverContextRef,withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'};
}
function projection(m:Metadata,body:ParsedBody){return {status:body.status,date:body.status==='parsed'&&body.report.cover.dutyDate.status==='selected'?body.report.cover.dutyDate.raw:null,issuer:m.issuerEdinetCode};}
function validateReport(body:ParsedBody,sha:string,m:Metadata){
 if(!body||!['parsed','source-not-loaded','source-parse-failed'].includes(body.status))invalid();
 if(body.status!=='parsed'){if(Object.keys(body).length!==1)invalid();return;}
 if(body.transactions!==undefined){const t=body.transactions;if(!t||!['parsed','source-too-large','source-parse-failed'].includes(t.status))invalid();if(t.status==='parsed'){validateStoredLargeHoldingTransactions(t.report,m.docID,sha,body.report.rows.filter(r=>r.role!=='reported-aggregate').map(r=>r.contextRef));if(t.report.status!==body.report.status)invalid();}else if(Object.keys(t).length!==1)invalid();}
 const r=body.report;if(!r||Object.hasOwn(r,'metadata')||r.version!==LARGE_HOLDING_REPORT_VERSION||r.inputXmlSha256!==sha||r.reconstruction!=='not-performed'||!['selected','unsupported'].includes(r.status)||!Array.isArray(r.rows)||r.rows.length>1000)invalid();
 if(r.issuer.declaredEdinetCode!==m.issuerEdinetCode||r.issuer.identity!=='not-established'||!['selected','unavailable'].includes(r.reportTotal.status)||new Set(r.rows.map(r=>r.rowKey)).size!==r.rows.length)invalid();
 if(r.reportTotal.status==='selected'){const key=r.reportTotal.rowKey,selected=r.rows.find(row=>row.rowKey===key);if(!selected||!['explicit-aggregate','single-holder-report'].includes(r.reportTotal.basis)||r.reportTotal.basis==='explicit-aggregate'&&selected.role!=='reported-aggregate'||r.reportTotal.basis==='single-holder-report'&&(r.rows.length!==1||r.cover.filerCount.status!=='selected'||r.cover.filerCount.safeNumber!==1))invalid();}
 for(const row of r.rows){if(!digest(row.rowKey)||!['filer','joint-holder','reported-aggregate'].includes(row.role)||row.identity!=='not-established')invalid();
  const member=row.member?{namespaceURI:row.member.namespaceURI,localName:row.member.localName}:undefined;
  if(typeof row.contextRef!=='string'||row.rowKey!==hash(JSON.stringify([m.docID,row.contextRef,member]))||!row.values||canonical(Object.keys(row.values).sort())!==canonical(Object.values(LargeHoldingMetric).sort()))invalid();
  for(const v of Object.values(row.values))if(!['selected','missing','unsupported','ambiguous'].includes(v.status)||typeof v.reason!=='string'||!Array.isArray(v.evidence))invalid();
  for(const [metric,v] of Object.entries(row.values))if(v.status==='selected'){
   if(typeof v.raw!=='string'||v.source?.raw!==v.raw||![1,100].includes(v.multiplier!)||!v.evidence.some(e=>canonical(e)===canonical(v.source)))invalid();
   let raw=v.raw.replace(/^\+/, '');if(raw.startsWith('.'))raw='0'+raw;if(raw.endsWith('.'))raw+='0';const n=parseReportedTableNumber(raw,v.multiplier!);if(n.status!=='numeric'||n.decimal!==v.decimal||n.safeNumber!==v.safeNumber||!/^\d+(?:\.\d+)?$/.test(n.decimal))invalid();
   const percent=metric.endsWith('Percent'),[integer,fraction='']=n.decimal.split('.');
   if(percent?(v.valueUnit!=='percent'||v.multiplier!==100||BigInt(integer)>100n||BigInt(integer)===100n&&/[1-9]/.test(fraction)):(v.valueUnit!=='share-or-unit-equivalents'||v.multiplier!==1||/[1-9]/.test(fraction)))invalid();
  }
 }
}
export interface LargeHoldingStoreAppendResult {observations:number;sources:number;materializedSnapshots:number;}
export type LargeHoldingStoreSearchResult=ReturnType<typeof searchParsedLargeHoldingReports>&{
 selection:ReturnType<typeof selectLargeHoldingReportVersions>;
 unavailableSources:{rootDocID:string;docID:string;reason:'source-missing'|'not-available-at-cutoff'|'source-not-loaded'|'source-parse-failed'|'conflicting-source-observations'}[];
 storage:{verification:'all-records';originalXmlStored:false;observationCount:number;snapshotIds:string[];sources:(Declaration&{id:string})[];filteredReports:{docID:string;reason:'duty-date-mismatch'|'issuer-mismatch'}[]};
};
/** 観測と原本hash付き解析結果を専用DBへ保存。原XMLは既存の原本保管先へ保持します。 */
export class LargeHoldingStore extends DedicatedSqliteDatabase {
 private verified=false;
 constructor(file:string,options:{readOnly?:boolean}={}){super(file,options,{table:'holding_format',kind:format,schema});}
 private read<T>(fn:()=>T):T{if(this.closed)invalid();const before=this.readOnly?this.readOnlySnapshotSha256():undefined;const value=this.transaction(fn,false);if(before!==undefined&&before!==this.readOnlySnapshotSha256())invalid();return value;}
 private decodeObservation(row:Record<string,unknown>):LargeHoldingVersionObservation{
  if(typeof row.body!=='string'||hash(row.body)!==row.sha256)invalid();const o=observations([JSON.parse(row.body)])[0],d=o.document;
  if(canonical(o)!==row.body||o.observationId!==row.id||d.docID!==row.doc_id||timestamp(o.observedAt,true)!==row.observed_ms||(d.issuerEdinetCode??null)!==row.issuer_code||(d.docTypeCode==='350'?null:d.parentDocID??null)!==row.parent_id)invalid();return o;
 }
 private decodeSource(row:Record<string,unknown>):Declaration{
  if(typeof row.body!=='string'||hash(row.body)!==row.sha256)invalid();const s=declaration(JSON.parse(row.body)).source;
  if(canonical(s)!==row.body||sourceId(s)!==row.id||s.docID!==row.doc_id||timestamp(s.availableAt,true)!==row.available_ms)invalid();return s;
 }
 private sources(docID:string){const rows=this.rows('SELECT '+srcColumns+' FROM holding_sources WHERE doc_id=? ORDER BY available_ms,id LIMIT 10001',[docID]);if(rows.length>10000)invalid();return rows.map(r=>this.decodeSource(r));}
 private observed(docID:string){const rows=this.rows('SELECT '+obsColumns+' FROM holding_observations WHERE doc_id=? ORDER BY observed_ms,id LIMIT 10001',[docID]);if(rows.length>10000)invalid();return rows.map(r=>this.decodeObservation(r));}
 private *plans(docID:string){
  const obs=this.observed(docID),groups=new Map<string,Declaration>();for(const s of this.sources(docID)){const key=canonical([s.sourceSha256,s.coverContextRef]);if(!groups.has(key))groups.set(key,s);}
  const seen=new Set<string>();let steps=0;
  for(const s of groups.values())for(const o of obs){if(++steps>100000)invalid();const m=metadata(o,s);if(!m)continue;const {knownAt:_,...identity}=m,key=snapshotId(identity,s.sourceSha256);if(seen.has(key))continue;if(seen.size>=10000)invalid();seen.add(key);yield {id:key,metadata:m,identity,source:s};}
 }
 private decodeSnapshot(row:Record<string,unknown>){
  if(typeof row.body!=='string'||typeof row.metadata_body!=='string'||!digest(row.source_sha256))invalid();const m=JSON.parse(row.metadata_body) as Metadata,body=JSON.parse(row.body) as ParsedBody,p=projection(m,body);
  if(canonical(m)!==row.metadata_body||canonical(body)!==row.body||snapshotId(m,row.source_sha256)!==row.id||m.docID!==row.doc_id||p.status!==row.body_status||p.date!==row.duty_date||p.issuer!==row.issuer_code||hash(canonical([row.id,row.doc_id,row.source_sha256,row.metadata_body,row.body_status,row.duty_date,row.issuer_code,row.body]))!==row.sha256)invalid();validateReport(body,row.source_sha256,m);return {metadata:m,body};
 }
 private build(docID:string,raws?:Map<string,string>){let count=0,materialized=0;
  for(const plan of this.plans(docID)){
   count++;const existing=this.rows('SELECT '+snapshotColumns+' FROM holding_snapshots WHERE id=?',[plan.id])[0],previous=existing?this.decodeSnapshot(existing):undefined;
   if(previous&&canonical(previous.metadata)!==canonical(plan.identity))invalid();
   if(raws===undefined){if(!previous)invalid();continue;}
   const xml=raws.get(plan.source.sourceSha256);if(previous&&previous.body.status!=='source-not-loaded'&&(previous.body.status!=='parsed'||previous.body.transactions!==undefined||xml===undefined))continue;
   let body:ParsedBody={status:'source-not-loaded'};
   if(xml!==undefined){try{const {metadata:_,...report}=extractLargeHoldingReport({xml,metadata:plan.metadata});body={status:'parsed',report};}catch{body={status:'source-parse-failed'};}materialized++;}
   if(body.status==='parsed'&&xml!==undefined){
    let transactions:TransactionBody={status:'source-too-large'};
    if(Buffer.byteLength(xml)<=2*1024**2){try{const {metadata:_,...report}=extractLargeHoldingTransactions({xml,metadata:plan.metadata});transactions={status:'parsed',report};}catch{transactions={status:'source-parse-failed'};}}
    if(previous?.body.status==='parsed'&&canonical(previous.body.report)!==canonical(body.report))invalid();
    body={...body,transactions};
   }
   if(previous&&body.status==='source-not-loaded')continue;
   if(Buffer.byteLength(canonical(body))>32*1024**2)invalid();
   validateReport(body,plan.source.sourceSha256,plan.identity);const p=projection(plan.identity,body),values=[plan.id,docID,plan.source.sourceSha256,canonical(plan.identity),p.status,p.date,p.issuer,canonical(body)];
   this.run('INSERT INTO holding_snapshots VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET body_status=excluded.body_status,duty_date=excluded.duty_date,body=excluded.body,sha256=excluded.sha256',[...values,hash(canonical(values))]);
  }return {count,materialized};
 }
 private verifyAll(){
  if(this.readOnly&&this.verified)return;let snapshots=0;
  for(const [table,columns,decode] of [['holding_observations',obsColumns,(r:Record<string,unknown>)=>this.decodeObservation(r)],['holding_sources',srcColumns,(r:Record<string,unknown>)=>this.decodeSource(r)]] as const){const statement=this.db.prepare('SELECT '+columns+' FROM '+table+' ORDER BY id');try{for(const row of statement.iterate())decode(row);}finally{statement.close();}}
  const statement=this.db.prepare('SELECT DISTINCT doc_id FROM holding_observations ORDER BY doc_id');try{for(const row of statement.iterate())snapshots+=this.build(String(row.doc_id)).count;}finally{statement.close();}
  if(snapshots!==Number(this.rows('SELECT COUNT(*) n FROM holding_snapshots')[0].n))invalid();if(this.readOnly)this.verified=true;
 }
 append(inputObservations:readonly LargeHoldingVersionObservation[],inputSources:readonly ObservedLargeHoldingSource[]=[]):LargeHoldingStoreAppendResult {
  const obs=observations(inputObservations),sources=structuredClone(inputSources);if(!Array.isArray(sources)||sources.length>100)invalid();const captured=Array.from({length:sources.length},(_,i)=>declaration(sources[i]));if(captured.reduce((n,s)=>n+Buffer.byteLength(s.xml??''),0)>256*1024**2)invalid();
  return this.transaction(()=>{
   this.verifyAll();const affected=new Set<string>(),raws=new Map<string,string>();let insertedObservations=0,insertedSources=0,materializedSnapshots=0;
   for(const o of obs){const body=canonical(o),d=o.document,existing=this.rows('SELECT '+obsColumns+' FROM holding_observations WHERE id=?',[o.observationId])[0];if(existing){if(canonical(this.decodeObservation(existing))!==body)throw Error('大量保有の観測IDを別内容で上書きできません');}else{this.run('INSERT INTO holding_observations VALUES(?,?,?,?,?,?,?)',[o.observationId,d.docID,timestamp(o.observedAt,true)!,d.issuerEdinetCode??null,d.docTypeCode==='350'?null:d.parentDocID??null,body,hash(body)]);insertedObservations++;}affected.add(d.docID);}
   for(const {source:s,xml} of captured){const key=sourceId(s),body=canonical(s),existing=this.rows('SELECT '+srcColumns+' FROM holding_sources WHERE id=?',[key])[0];if(existing){if(canonical(this.decodeSource(existing))!==body)invalid();}else{this.run('INSERT INTO holding_sources VALUES(?,?,?,?,?)',[key,s.docID,timestamp(s.availableAt,true)!,body,hash(body)]);insertedSources++;}if(xml!==undefined)raws.set(s.sourceSha256,xml);affected.add(s.docID);}
   for(const docID of affected)materializedSnapshots+=this.build(docID,raws).materialized;
   return {observations:insertedObservations,sources:insertedSources,materializedSnapshots};
  });
 }
 private cohort(issuer:string|undefined,cutoff:number){
  const seeds=this.rows('SELECT DISTINCT doc_id FROM holding_observations'+(issuer?' WHERE issuer_code=? AND observed_ms<=?':'')+' ORDER BY doc_id LIMIT 10001',issuer?[issuer,cutoff]:[]).map(r=>String(r.doc_id));if(seeds.length>10000)invalid();
  const ids=new Set(seeds),queue=[...seeds];for(let i=0;i<queue.length;i++){
   const current=queue[i];for(const row of this.rows('SELECT parent_id related FROM holding_observations WHERE doc_id=? AND observed_ms<=? AND parent_id IS NOT NULL UNION SELECT doc_id related FROM holding_observations WHERE parent_id=? AND observed_ms<=?',[current,cutoff,current,cutoff])){const next=String(row.related);if(!ids.has(next)){if(ids.size>=10000)invalid();ids.add(next);queue.push(next);}}
  }
  const obs:LargeHoldingVersionObservation[]=[];for(const docID of [...ids].sort()){obs.push(...this.observed(docID));if(obs.length>10000)throw Error('大量保有の一検索集合は10000観測以下です。発行者等で集合を分けてください');}return obs;
 }
 search(input:LargeHoldingSearchOptions):LargeHoldingStoreSearchResult {
  const q=structuredClone(input);searchParsedLargeHoldingReports([],q);
  return this.read(()=>{
   this.verifyAll();const obs=this.cohort(q.issuerEdinetCode,timestamp(q.cutoff,true)!),selection=selectLargeHoldingReportVersions(obs,q.cutoff),reports:LargeHoldingReport[]=[],unavailableSources:LargeHoldingStoreSearchResult['unavailableSources']=[],filteredReports:LargeHoldingStoreSearchResult['storage']['filteredReports']=[],snapshotIds:string[]=[],sourceDeclarations:(Declaration&{id:string})[]=[];let bytes=0;
   for(const chosen of selection.selected){const docID=chosen.observation.document.docID,all=this.sources(docID),eligible=all.filter(s=>timestamp(s.availableAt,true)!<=timestamp(q.cutoff,true)!),failed=(reason:LargeHoldingStoreSearchResult['unavailableSources'][number]['reason'])=>unavailableSources.push({rootDocID:chosen.rootDocID,docID,reason});
    sourceDeclarations.push(...all.map(s=>({id:sourceId(s),...s})));
    if(!eligible.length){failed(all.length?'not-available-at-cutoff':'source-missing');continue;}
    if(new Set(eligible.map(s=>canonical([s.sourceSha256,s.coverContextRef]))).size!==1){failed('conflicting-source-observations');continue;}
    const source=eligible[0],o={observationId:chosen.observation.observationId,observedAt:chosen.observedAt,document:chosen.observation.document},m=metadata(o,source);if(!m)invalid();const {knownAt:_,...identity}=m,key=snapshotId(identity,source.sourceSha256),header=this.rows("SELECT body_status,duty_date,issuer_code,json_extract(body,'$.report.status') report_status FROM holding_snapshots WHERE id=?",[key])[0];if(!header)invalid();
    if(header.body_status!=='parsed'){failed(header.body_status==='source-parse-failed'?'source-parse-failed':'source-not-loaded');continue;}
    if(header.report_status==='selected'&&(header.duty_date!==q.dutyDate||q.issuerEdinetCode&&header.issuer_code!==q.issuerEdinetCode)){filteredReports.push({docID,reason:header.duty_date!==q.dutyDate?'duty-date-mismatch':'issuer-mismatch'});continue;}
    const row=this.rows('SELECT '+snapshotColumns+' FROM holding_snapshots WHERE id=?',[key])[0];if((bytes+=Buffer.byteLength(String(row.body)))>256*1024**2)throw Error('大量保有の一検索の解析結果は256MiB以下です');const stored=this.decodeSnapshot(row);if(stored.body.status!=='parsed')invalid();
    const r=stored.body.report;
    reports.push({...structuredClone(r),metadata:m});snapshotIds.push(key);
   }
   const result=searchParsedLargeHoldingReports(reports,q);return {...result,filtered:result.filtered+filteredReports.length,selection,unavailableSources,storage:{verification:'all-records',originalXmlStored:false,observationCount:obs.length,snapshotIds,sources:sourceDeclarations,filteredReports}};
  });
 }
 searchTransactions(input:LargeHoldingTransactionSearchOptions){
  const q=structuredClone(input);searchParsedLargeHoldingTransactions([],q);
  return this.read(()=>{
   this.verifyAll();const cutoff=timestamp(q.cutoff,true)!,obs=this.cohort(q.issuerEdinetCode,cutoff),selection=selectLargeHoldingReportVersions(obs,q.cutoff),reports:LargeHoldingTransactions[]=[],unavailableSources:{rootDocID:string;docID:string;reason:string}[]=[],snapshotIds:string[]=[];let bytes=0;
   for(const chosen of selection.selected){
    const docID=chosen.observation.document.docID,all=this.sources(docID),eligible=all.filter(s=>timestamp(s.availableAt,true)!<=cutoff),failed=(reason:string)=>unavailableSources.push({rootDocID:chosen.rootDocID,docID,reason});
    if(!eligible.length){failed(all.length?'not-available-at-cutoff':'source-missing');continue;}
    if(new Set(eligible.map(s=>canonical([s.sourceSha256,s.coverContextRef]))).size!==1){failed('conflicting-source-observations');continue;}
    const source=eligible[0],m=metadata({observationId:chosen.observation.observationId,observedAt:chosen.observedAt,document:chosen.observation.document},source);if(!m)invalid();
    const {knownAt:_,...identity}=m,key=snapshotId(identity,source.sourceSha256),row=this.rows('SELECT '+snapshotColumns+' FROM holding_snapshots WHERE id=?',[key])[0];if(!row)invalid();
    if((bytes+=Buffer.byteLength(String(row.body)))>32*1024**2)throw Error('取引検索の解析結果は32MiB以下です');
    const stored=this.decodeSnapshot(row);
    if(stored.body.status!=='parsed'){failed(stored.body.status);continue;}
    const transactions=stored.body.transactions;
    if(!transactions){failed('transactions-not-materialized');continue;}
    if(transactions.status!=='parsed'){failed(transactions.status);continue;}
    reports.push({...structuredClone(transactions.report),metadata:m});snapshotIds.push(key);
    if(reports.length>100)throw Error('取引検索は100原本以下です。発行者等で集合を分けてください');
   }
   return {...searchParsedLargeHoldingTransactions(reports,q),selection,unavailableSources,storage:{verification:'all-records' as const,originalXmlStored:false as const,observationCount:obs.length,snapshotIds}};
  });
 }
 audit(){return this.read(()=>{this.verifyAll();return {verification:'all-records' as const,observations:Number(this.rows('SELECT COUNT(*) n FROM holding_observations')[0].n),sources:Number(this.rows('SELECT COUNT(*) n FROM holding_sources')[0].n),snapshots:Number(this.rows('SELECT COUNT(*) n FROM holding_snapshots')[0].n),originalXmlStored:false as const};});}
}
