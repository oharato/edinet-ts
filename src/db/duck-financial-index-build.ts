import {createHash} from 'node:crypto';
import {ObservedFinancialArchive} from './observed-financial-archive';
import {ParsedFinancialStore} from './parsed-financial-store';
import {createParsedFinancialSnapshots} from './parsed-financial-snapshots';
import {normalizeFinancialIndexBuildInput,type FinancialIndexBuildInput,type FinancialIndexBuildPlan} from './financial-index-build';
import {projectFinancialIndexGeneration,financialIndexSqliteSchema,financialIndexRowColumns,financialIndexValueColumns,financialIndexBuildPartId,financialIndexGenerationSha256,type FinancialIndexGeneration} from './financial-search-index';
/** Official @duckdb/node-api connection subset. The caller owns the connection/file lifetime. */
export interface DuckFinancialConnection {
 run(sql:string,values?:any[]):Promise<unknown>;
 runAndReadAll(sql:string,values?:any[]):Promise<{getRowObjects():Record<string,unknown>[]}>;
}
/** Package versions alone do not isolate native symbols when another DuckDB is already loaded. */
export async function assertDuckFinancialEngine(connection:DuckFinancialConnection){
 const rows=(await connection.runAndReadAll('SELECT version() AS edinet_engine_version')).getRowObjects();
 if(rows.length!==1||rows[0].edinet_engine_version!=='v2.0.0')throw Error('DuckDB 2.0.0 engine required; use a separate process from other native DuckDB versions');
}
interface Plan {version:'1';input:FinancialIndexBuildPlan;parsedSha256:string;}
interface Part {code:string;report:FinancialIndexGeneration;rows:FinancialIndexGeneration['rows'];}
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const compare=(a:string,b:string)=>a<b?-1:a>b?1:0;
const tables={
 ...financialIndexSqliteSchema,
 duck_build_format:'CREATE TABLE duck_build_format(kind TEXT NOT NULL)',
 duck_build_plan:'CREATE TABLE duck_build_plan(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
 duck_build_parts:'CREATE TABLE duck_build_parts(code TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)'
};
const tableNames=Object.entries(tables).filter(([,sql])=>sql.startsWith('CREATE TABLE')).map(([name])=>name).sort();
export const duckFinancialBuildSchema=tables;
export const duckFinancialBuildKind='edinet-ts-duck-financial-build-v1';
const kind=duckFinancialBuildKind;
/** One candidate per database. Company rows and completion receipt commit together. */
export class DuckFinancialIndexBuild {
 private working=false;
 constructor(private connection:DuckFinancialConnection){}
 private async rows(sql:string,args:any[]=[]){
  const result=await this.connection.runAndReadAll(sql,args);
  return result.getRowObjects().map(row=>Object.fromEntries(Object.entries(row).map(([k,v])=>{
   if(typeof v==='bigint'){const n=Number(v);if(!Number.isSafeInteger(n))throw new Error('Unsafe DuckDB integer');return [k,n]}return [k,v];
  })));
 }
 private async transaction<T>(fn:()=>Promise<T>):Promise<T>{
  await this.connection.run('BEGIN');try{const result=await fn();await this.connection.run('COMMIT');return result}catch(e){try{await this.connection.run('ROLLBACK')}catch{}throw e}
 }
 private async format(allowEmpty=false){
  await assertDuckFinancialEngine(this.connection);
  const names=(await this.rows("SELECT table_name FROM information_schema.tables WHERE table_schema='main' ORDER BY table_name")).map(r=>String(r.table_name));
  if(allowEmpty&&!names.length)return false;
  if(canonical(names)!==canonical(tableNames))throw new Error('DuckDB candidate schema is not recognized');
  const format=await this.rows('SELECT kind FROM duck_build_format');if(format.length!==1||format[0].kind!==kind)throw new Error('DuckDB candidate format differs');return true;
 }
 async begin(input:FinancialIndexBuildInput,parsedSha256:string){
  if(this.working)throw new Error('DuckDB build is running');
  this.working=true;try{
  const normalized=normalizeFinancialIndexBuildInput(input);
  if(normalized.indexVersion!=='1')throw new Error('DuckDB build does not support financial version selection');
  await assertDuckFinancialEngine(this.connection);
  if(!normalized.options.sourceCommit||typeof parsedSha256!=='string'||!/^[a-f0-9]{64}$/.test(parsedSha256))throw new Error('Fixed parser source and parsed-store fingerprint required');
  const plan:Plan={version:'1',input:normalized,parsedSha256},body=canonical(plan),digest=hash(body);
  await this.transaction(async()=>{
   if(!await this.format(true)){
    for(const sql of Object.values(tables))await this.connection.run(sql.replace(/\bTEXT\b/g,'VARCHAR').replace(/\bINTEGER\b/g,'BIGINT').replace(/\bREAL\b/g,'DOUBLE'));
    await this.connection.run('INSERT INTO duck_build_format VALUES(?)',[kind]);
    await this.connection.run('INSERT INTO financial_index_format VALUES(?)',['edinet-ts-financial-search-index-v1']);
   }
   const saved=await this.rows('SELECT * FROM duck_build_plan');
   if(saved.length){const prior=await this.plan(normalized.id);if(canonical(prior)!==body)throw new Error('DuckDB build plan cannot be changed');return}
   await this.connection.run('INSERT INTO duck_build_plan VALUES(?,?,?)',[normalized.id,body,digest]);
  });return {planSha256:digest,plan};
  }finally{this.working=false}
 }
 private async plan(id:string):Promise<Plan>{
  await this.format();const rows=await this.rows('SELECT * FROM duck_build_plan WHERE id=?',[id]),row=rows[0];
  if(rows.length!==1||typeof row.body!=='string'||Buffer.byteLength(row.body)>64*1024*1024||hash(row.body)!==row.sha256)throw new Error('DuckDB plan missing or corrupt');
  const p=JSON.parse(row.body) as Plan;
  if(p.version!=='1'||p.input.id!==id||p.input.indexVersion!=='1'||!/^[a-f0-9]{64}$/.test(p.parsedSha256))throw new Error('DuckDB plan differs');
  const {id:inputId,generation,archiveSha256,population,options}=p.input;
  if(canonical(normalizeFinancialIndexBuildInput({id:inputId,generation,archiveSha256,population,options}))!==canonical(p.input))throw new Error('DuckDB plan version differs');return p;
 }
 private async parts(plan:Plan):Promise<Part[]>{
  const parts:Part[]=[],planSha=hash(canonical(plan));
  for(const row of await this.rows('SELECT * FROM duck_build_parts ORDER BY code')){
   if(typeof row.body!=='string'||hash(canonical([row.code,row.body]))!==row.sha256)throw new Error('DuckDB company checkpoint corrupt');
   const part=JSON.parse(row.body) as Part;
   if(part.code!==row.code||!plan.input.population.edinetCodes.includes(part.code)||part.report.id!==financialIndexBuildPartId(planSha,part.code)||canonical(part.report.provenance.edinetCodes)!==canonical([part.code]))throw new Error('DuckDB company checkpoint differs');parts.push(part);
  }return parts;
 }
 async progress(id:string){if(this.working)throw new Error('DuckDB build is running');return this.progressState(id)}
 private async progressState(id:string){
  const plan=await this.plan(id),parts=await this.parts(plan),final=await this.rows('SELECT id FROM financial_generations WHERE id=?',[plan.input.generation]);
  return {id,completed:parts.length,pending:plan.input.population.edinetCodes.length-parts.length,rows:parts.reduce((n,p)=>n+p.rows.length,0),finished:final.length===1};
 }
 async runNext(id:string,archive:ObservedFinancialArchive,parsed:ParsedFinancialStore,options:{limit?:number;signal?:AbortSignal}={}){
  if(this.working)throw new Error('DuckDB build is running');
  if(!options||typeof options!=='object'||Object.keys(options).some(k=>!['limit','signal'].includes(k))||!Number.isSafeInteger(options.limit??20)||(options.limit??20)<1||(options.limit??20)>100||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw new Error('Invalid DuckDB batch');
  this.working=true;
  try{
   const plan=await this.plan(id);
   if(archive.snapshotSha256()!==plan.input.archiveSha256||parsed.snapshotSha256()!==plan.parsedSha256)throw new Error('DuckDB build inputs differ');
   const completed=new Set((await this.parts(plan)).map(p=>p.code)),pending=plan.input.population.edinetCodes.filter(code=>!completed.has(code)).slice(0,options.limit??20);
   for(const code of pending){
    if(options.signal?.aborted)break;
    const source=createParsedFinancialSnapshots(archive,parsed,{...plan.input.options,edinetCodes:[code]}),partId=financialIndexBuildPartId(hash(canonical(plan)),code),partProjection=projectFinancialIndexGeneration(partId,source),projection=projectFinancialIndexGeneration(plan.input.generation,source);
    await this.transaction(async()=>{
     for(const r of projection.rows){
      await this.connection.run(`INSERT INTO financial_rows VALUES(${Array.from({length:14},()=>'?').join(',')})`,[...r.metadata,r.digest,r.body]);
      for(const v of r.values)await this.connection.run(`INSERT INTO financial_values VALUES(${v.map(()=>'?').join(',')})`,v);
     }
     const part:Part={code,report:partProjection.report,rows:projection.report.rows},body=canonical(part);await this.connection.run('INSERT INTO duck_build_parts VALUES(?,?,?)',[code,body,hash(canonical([code,body]))]);
    });
   }
   if(archive.snapshotSha256()!==plan.input.archiveSha256||parsed.snapshotSha256()!==plan.parsedSha256)throw new Error('DuckDB build inputs changed');
   return {...await this.progressState(id),aborted:options.signal?.aborted??false};
  }finally{this.working=false}
 }
 private async *projectionBatches(table:'financial_rows'|'financial_values',generation:string){
  const values=table==='financial_values',payload=values?'raw_text':'body';let afterRow='',afterMetric='';
  for(;;){
   const cursor=values?'(row_id>? OR (row_id=? AND metric_id>?))':'row_id>?',args=values?[generation,afterRow,afterRow,afterMetric]:[generation,afterRow],order=values?'row_id,metric_id':'row_id';
   const headers=await this.rows(`SELECT row_id${values?',metric_id':''},octet_length(encode(coalesce(${payload},''))) AS bytes FROM ${table} WHERE generation=? AND ${cursor} ORDER BY ${order} LIMIT 100`,args);
   if(!headers.length)return;
   const chosen:Record<string,unknown>[]=[];let bytes=0;
   for(const header of headers){if(typeof header.bytes!=='number'||header.bytes>128*1024*1024)throw new Error('DuckDB projection payload too large');if(chosen.length&&bytes+header.bytes>128*1024*1024)break;chosen.push(header);bytes+=header.bytes}
   const terms=chosen.map(()=>values?'(row_id=? AND metric_id=?)':'row_id=?').join(' OR '),keys=chosen.flatMap(h=>values?[h.row_id,h.metric_id]:[h.row_id]);
   const batch=await this.rows(`SELECT * FROM ${table} WHERE generation=? AND (${terms}) ORDER BY ${order}`,[generation,...keys]);
   if(batch.length!==chosen.length)throw new Error('DuckDB projection changed during audit');
   yield batch;const last=chosen.at(-1)!;afterRow=String(last.row_id);afterMetric=String(last.metric_id??'');
  }
 }
 async finish(id:string):Promise<FinancialIndexGeneration>{
  if(this.working)throw new Error('DuckDB build is running');
  this.working=true;try{
  const plan=await this.plan(id),parts=await this.parts(plan),input=plan.input;
  if(parts.length!==input.population.edinetCodes.length)throw new Error('DuckDB population is incomplete');
  const reports=parts.map(p=>p.report),first=reports[0];
  if(first.indexVersion!=='1'||reports.some(r=>r.indexVersion!=='1'))throw new Error('DuckDB assembly does not support financial version selection');
  const merge=<T>(lists:T[][],key:(v:T)=>string):T[]=>{
   const result=new Map<string,T>();for(const list of lists)for(const item of list){const k=key(item),old=result.get(k);if(old!==undefined&&canonical(old)!==canonical(item))throw new Error('DuckDB assembly conflict');result.set(k,item)}
   return [...result].sort(([a],[b])=>compare(a,b)).map(([,v])=>v);
  };
  const report:FinancialIndexGeneration={id:input.generation,indexVersion:first.indexVersion,assembly:{planSha256:hash(canonical(plan)),archiveSha256:input.archiveSha256,population:input.population,parts:reports.map(r=>({id:r.id,sha256:financialIndexGenerationSha256(r)})).sort((a,b)=>compare(a.id,b.id))},
   selection:{cutoff:first.selection.cutoff,decisions:merge(reports.map(r=>r.selection.decisions),r=>r.rootDocID),selected:merge(reports.map(r=>r.selection.selected),r=>r.rootDocID),ignored:merge(reports.map(r=>r.selection.ignored),r=>r.observationId),financialValuesMerged:false,reconstructedUnobservedHistory:false},
   provenance:{...first.provenance,edinetCodes:[...input.population.edinetCodes]},unavailableSources:merge(reports.map(r=>r.unavailableSources),r=>r.docID),unresolvedRecords:merge(reports.map(r=>r.unresolvedRecords),r=>r.docID),unavailableGroups:merge(reports.map(r=>r.unavailableGroups),r=>r.docID+':'+r.group),rows:parts.flatMap(p=>p.rows).sort((a,b)=>compare(a.id,b.id))};
  await this.transaction(async()=>{
   const expectedRows=new Map(report.rows.map(r=>[r.id,r]));let rowCount=0;
   for await(const batch of this.projectionBatches('financial_rows',input.generation))for(const r of batch){const expected=expectedRows.get(String(r.row_id)),metadata=financialIndexRowColumns.map(k=>r[k]);if(!expected||canonical(metadata)!==canonical(expected.metadata)||r.sha256!==expected.sha256||hash(canonical([metadata,r.body]))!==r.sha256)throw new Error('DuckDB row projection corrupt');rowCount++}
   if(rowCount!==expectedRows.size)throw new Error('DuckDB row count differs');
   const expectedValues=new Map(report.rows.flatMap(r=>r.metrics.map(m=>[r.id+':'+m.id,m.sha256] as const)));let valueCount=0;
   for await(const batch of this.projectionBatches('financial_values',input.generation))for(const v of batch){if(hash(canonical(financialIndexValueColumns.map(k=>v[k])))!==expectedValues.get(v.row_id+':'+v.metric_id))throw new Error('DuckDB value projection corrupt');valueCount++}
   if(valueCount!==expectedValues.size)throw new Error('DuckDB value count differs');
   const body=canonical(report),digest=financialIndexGenerationSha256(report),saved=await this.rows('SELECT * FROM financial_generations WHERE id=?',[input.generation]);
   if(saved.length){if(saved[0].body!==body||saved[0].sha256!==digest)throw new Error('Completed DuckDB generation differs')}
   else await this.connection.run('INSERT INTO financial_generations VALUES(?,?,?)',[input.generation,body,digest]);
  });return report;
  }finally{this.working=false}
 }
}
