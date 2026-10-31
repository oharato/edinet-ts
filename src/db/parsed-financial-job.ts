import {createHash} from 'node:crypto';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {DedicatedSqliteDatabase} from './dedicated-sqlite';
import {ObservedFinancialArchive} from './observed-financial-archive';
import {ParsedFinancialStore,normalizeParsedFinancialIdentity,parsedFinancialExtractionId,parsedFinancialMappingVersions,type ParsedFinancialIdentity,type ParsedFinancialOutcome} from './parsed-financial-store';
import {createAutomaticFinancialSnapshots,AutomaticFinancialProjectionError} from '../automatic-financial-snapshots';
import {parseDocumentTimestamp} from '../document-timestamp';
export interface ParsedFinancialTask {identity:ParsedFinancialIdentity;availableAt:string;}
export interface ParsedFinancialJobInput {id:string;archiveSha256:string;tasks:readonly ParsedFinancialTask[];}
export interface ParsedFinancialJobPlan extends ParsedFinancialJobInput {version:'1';tasks:readonly (ParsedFinancialTask & {extractionId:string})[];}
export interface ParsedFinancialJobProgress {
 id:string;planSha256:string;total:number;pending:number;completed:number;failed:number;unresolved:number;finished:boolean;
}
const schema={
 parsed_job_format:'CREATE TABLE parsed_job_format(kind TEXT NOT NULL)',
 parsed_job_plans:'CREATE TABLE parsed_job_plans(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)'
};
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const isHash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
function object(input:unknown,allowed:string[]):Record<string,unknown>{
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!allowed.includes(k)))throw new Error('解析jobの属性が不正です');return input as Record<string,unknown>;
}
function normalize(input:ParsedFinancialJobInput):ParsedFinancialJobPlan {
 const v=object(input,['id','archiveSha256','tasks']);
 if(typeof v.id!=='string'||!v.id.trim()||v.id!==v.id.trim()||v.id.length>256||/[\x00-\x1f\x7f-\x9f]/.test(v.id)||!isHash(v.archiveSha256)||!Array.isArray(v.tasks)||v.tasks.length<1||v.tasks.length>100000)throw new Error('固定原本・job ID・空でない対象が必要です');
 const tasks=Array.from(v.tasks,(task:ParsedFinancialTask)=>{
  object(task,['identity','availableAt']);const identity=normalizeParsedFinancialIdentity(task.identity),at=parseDocumentTimestamp(task.availableAt,true);
  if(at===undefined)throw new Error('原本の取得日時にはtimezoneが必要です');
  return {identity,availableAt:new Date(at).toISOString(),extractionId:parsedFinancialExtractionId(identity)};
 }).sort((a,b)=>a.extractionId<b.extractionId?-1:a.extractionId>b.extractionId?1:0);
 if(new Set(tasks.map(t=>t.extractionId)).size!==tasks.length)throw new Error('解析対象のキーが重複しています');
 const plan={version:'1' as const,id:v.id,archiveSha256:v.archiveSha256,tasks};
 if(Buffer.byteLength(canonical(plan))>64*1024*1024)throw new Error('解析計画は64MiB以下です');return plan;
}
/** 不変計画だけを保存。解析結果とその完了状態はParsedFinancialStoreの同じtransactionにある。 */
export class ParsedFinancialJob extends DedicatedSqliteDatabase {
 private working=false;
 constructor(file:string,options:{readOnly?:boolean}={}){super(file,options,{table:'parsed_job_format',kind:'edinet-ts-parsed-job-v1',schema})}
 begin(input:ParsedFinancialJobInput):ParsedFinancialJobPlan {
  const plan=normalize(input),body=canonical(plan),digest=hash(canonical([plan.id,body]));
  return this.transaction(()=>{
   const old=this.rows('SELECT * FROM parsed_job_plans WHERE id=?',[plan.id])[0];
   if(old){const stored=this.readPlan(plan.id);if(canonical(stored)!==body)throw new Error('同じjob IDの解析計画は変更できません');return stored}
   this.run('INSERT INTO parsed_job_plans VALUES(?,?,?)',[plan.id,body,digest]);return plan;
  });
 }
 plan(id:string):ParsedFinancialJobPlan {
  if(typeof id!=='string'||!id.trim()||id.length>256)throw new Error('解析job IDが不正です');
  return this.transaction(()=>this.readPlan(id),false);
 }
 private readPlan(id:string):ParsedFinancialJobPlan {
  const size=this.rows('SELECT length(CAST(body AS BLOB)) bytes FROM parsed_job_plans WHERE id=?',[id])[0];
  if(!size||typeof size.bytes!=='number'||size.bytes>64*1024*1024)throw new Error('解析計画が未保存または容量不正です');
  const row=this.rows('SELECT * FROM parsed_job_plans WHERE id=?',[id])[0];
  if(typeof row.body!=='string'||hash(canonical([id,row.body]))!==row.sha256)throw new Error('解析計画のhashが不一致です');
  const decoded=JSON.parse(row.body) as ParsedFinancialJobPlan;
  if(decoded.version!=='1'||decoded.id!==id||canonical(normalize({id:decoded.id,archiveSha256:decoded.archiveSha256,tasks:decoded.tasks.map(({identity,availableAt})=>({identity,availableAt}))}))!==row.body)throw new Error('解析計画が不整合です');
  return decoded;
 }
 progress(id:string,store:ParsedFinancialStore):ParsedFinancialJobProgress {
  if(!(store instanceof ParsedFinancialStore))throw new Error('解析済みStoreが必要です');
  const plan=this.plan(id),progress:ParsedFinancialJobProgress={id,planSha256:hash(canonical(plan)),total:plan.tasks.length,pending:0,completed:0,failed:0,unresolved:0,finished:false};
  for(const task of plan.tasks){
   const cached=store.get(task.extractionId);
   if(!cached){progress.pending++;continue}
   if(canonical(cached.identity)!==canonical(task.identity))throw new Error('保存解析結果とjob計画が不一致です');
   if(cached.outcome.status==='failed')progress.failed++;
   else {progress.completed++;if(cached.outcome.result.status==='unresolved')progress.unresolved++}
  }
  progress.finished=progress.pending===0;return progress;
 }
 async runNext(id:string,archive:ObservedFinancialArchive,store:ParsedFinancialStore,options:{limit?:number;signal?:AbortSignal}={}):Promise<ParsedFinancialJobProgress & {processed:number;reused:number;aborted:boolean}> {
  object(options,['limit','signal']);const {limit=20,signal}=options;
  if(this.closed||this.readOnly||this.working)throw new Error('解析jobはclose済み・readOnly・実行中です');
  if(!(archive instanceof ObservedFinancialArchive)||!(store instanceof ParsedFinancialStore)||!Number.isSafeInteger(limit)||limit<1||limit>100||signal!==undefined&&!(signal instanceof AbortSignal))throw new Error('原本・解析Store・batch指定を確認してください');
  this.working=true;
  try{
   const plan=this.plan(id);
   if(archive.snapshotSha256()!==plan.archiveSha256)throw new Error('原本アーカイブの指紋が計画と異なります');
   if(plan.tasks.some(t=>canonical(t.identity.mappingVersions)!==canonical(parsedFinancialMappingVersions())))throw new Error('解析/対応表版が計画時と異なります');
   for (const task of plan.tasks) {
    if (!archive.readSource({docID:task.identity.docID,availableAt:task.availableAt,sourceSha256:task.identity.sourceSha256},{includeXml:false})) throw new Error('計画した原本が保存されていません');
   }
   let processed=0,reused=0;
   for(const task of plan.tasks){
    if(signal?.aborted||processed===limit)break;
    const cached=store.get(task.extractionId);
    if(cached){if(canonical(cached.identity)!==canonical(task.identity))throw new Error('解析結果のキーが不整合です');reused++;continue}
    const source=archive.readSource({docID:task.identity.docID,availableAt:task.availableAt,sourceSha256:task.identity.sourceSha256});
    if(source?.xml===undefined)throw new Error('計画した原本が保存されていません');
    let outcome:ParsedFinancialOutcome;
    try{outcome={status:'completed',result:createAutomaticFinancialSnapshots(source.xml,{docID:task.identity.docID,detailMetricIds:task.identity.detailMetricIds})}}
    catch(error){outcome={status:'failed',reason:error instanceof AutomaticFinancialProjectionError?'projection-failed':'parse-failed'}}
    store.put({identity:task.identity,parsedAt:new Date().toISOString(),outcome});processed++;
    await yieldTurn();
   }
   if(archive.snapshotSha256()!==plan.archiveSha256)throw new Error('原本snapshotが変化しました');
   return {...this.progress(id,store),processed,reused,aborted:signal?.aborted??false};
  }finally{this.working=false}
 }
}
