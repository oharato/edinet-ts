import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {Database} from './node-sqlite';
import type {SQLInputValue} from 'node:sqlite';
import {DuckFinancialSnapshot} from './duck-financial-snapshot';
import {FinancialSearchIndex,financialIndexRowColumns,financialIndexValueColumns,financialIndexGenerationSha256,FinancialIndexReadQueries,type FinancialIndexGeneration,type FinancialIndexQuality,type FinancialReadQuery,type FinancialIndexCohort,type FinancialIndexSearchOptions} from './financial-search-index';
class VerifiedReadQueries extends FinancialIndexReadQueries {
 constructor(private report:FinancialIndexGeneration){super(16000)}
 *audit(id:string):FinancialReadQuery<FinancialIndexGeneration>{if(id!==this.report.id)throw new Error("世代が未収録です");return this.report}
}
/** Internal async reader. Public exports and catalog integration follow after parity verification. */
export class DuckFinancialSearchIndex {
 private queries!:VerifiedReadQueries;
 private verifiedQuality!:FinancialIndexQuality;
 private closing=false;
 private active=new Set<Promise<unknown>>();
 private closeTask?:Promise<void>;
 private constructor(private snapshot:DuckFinancialSnapshot){}
 static async open(file:string){
  const snapshot=await DuckFinancialSnapshot.open(file),reader=new DuckFinancialSearchIndex(snapshot);
  try{
   const ids=await snapshot.rows('SELECT id FROM financial_generations'),id=String(ids[0].id);
   for(const table of ['financial_rows','financial_values'])if((await snapshot.rows(`SELECT generation FROM ${table} WHERE generation<>? LIMIT 1`,[id])).length)throw Error('DuckDB contains rows outside its generation');
   const verified=await reader.execute(new FinancialIndexReadQueries(16000).auditSnapshot(id));reader.queries=new VerifiedReadQueries(verified.generation);
   reader.verifiedQuality=verified.quality;return reader;
  }catch(error){await reader.close();throw error}
 }
 private read<T>(query:FinancialReadQuery<T>):Promise<T>{
  if(this.closing)return Promise.reject(new Error("DuckDB reader is closed"));
  return this.track(()=>this.execute(query));
 }
 private track<T>(run:()=>Promise<T>):Promise<T>{
  if(this.closing)return Promise.reject(new Error("DuckDB reader is closed"));
  const task=run();this.active.add(task);task.then(()=>this.active.delete(task),()=>this.active.delete(task));return task;
 }
 private async execute<T>(query:FinancialReadQuery<T>):Promise<T>{
  let step=query.next();await this.snapshot.snapshotSha256();
  while(!step.done){
   const request=step.value;let sql=request.sql.replace(/ INDEXED BY financial_metric_range/g,'').replace(/edinet_text_bytes\((\w+)\)/g,"strlen(coalesce($1,''))"),args:any[]=[...request.args];
   // Exact projection keys use lists to avoid thousands of native parameter bindings per batch.
   const projection=sql.match(/^SELECT ([a-z_,]+) FROM (financial_rows|financial_values) WHERE generation=\? AND (row_id|\(row_id,metric_id\)) IN \([?,()]+\) ORDER BY (row_id(?:,metric_id)?)$/);
   if(projection){
    const values=projection[2]==='financial_values',keys=args.slice(1),generation=args[0];
    if(projection[3]!== (values?'(row_id,metric_id)':'row_id')||projection[4]!== (values?'row_id,metric_id':'row_id')||!keys.length||keys.some(key=>typeof key!=='string')||values&&keys.length%2)throw Error('Invalid DuckDB projection keys');
    const {listValue}=await import('@duckdb/node-api'),ids=values?keys.filter((_key,i)=>i%2===0):keys,metrics=values?keys.filter((_key,i)=>i%2===1):[];
    sql=`WITH wanted AS (SELECT unnest(?::VARCHAR[]) AS row_id${values?',unnest(?::VARCHAR[]) AS metric_id':''}) SELECT ${projection[1].split(',').map(column=>'r.'+column).join(',')} FROM ${projection[2]} r JOIN wanted k ON r.row_id=k.row_id${values?' AND r.metric_id=k.metric_id':''} WHERE r.generation=? ORDER BY ${projection[4].split(',').map(column=>'r.'+column).join(',')}`;
    args=[listValue(ids),...values?[listValue(metrics)]:[],generation];
   }
   // DuckDB uses LIMIT NULL for unlimited; SQLite uses -1.
   if(sql.endsWith('LIMIT ? OFFSET ?')&&args.at(-2)===-1)args[args.length-2]=null;
   step=query.next(await this.snapshot.rows(sql,args as Parameters<DuckFinancialSnapshot['rows']>[1]));
  }
  await this.snapshot.snapshotSha256();return step.value;
 }
 generation(id:string){return this.read(this.queries.generation(id)).then(report=>structuredClone(report))}
 private *qualityResult(id:string):FinancialReadQuery<FinancialIndexQuality>{yield* this.queries.generation(id);return structuredClone(this.verifiedQuality)}
 quality(id:string){return this.read(this.qualityResult(id))}
 screen(cohort:FinancialIndexCohort,options:FinancialIndexSearchOptions){return this.read(this.queries.screen(cohort,options))}
 /** Internal bridge to the existing independent SQLite/XML verifier. The private projection is always removed. */
 withVerificationProjection<T>(verify:(path:string)=>Promise<T>,options:{signal?:AbortSignal}={}):Promise<T>{return this.track(async()=>{
  if(typeof verify!=='function'||!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>k!=='signal')||options.signal!==undefined&&!(options.signal instanceof AbortSignal))throw Error('A verification callback and optional signal are required');
  options.signal?.throwIfAborted();
  const directory=await mkdtemp(join(tmpdir(),'edinet-duck-verification-')),file=join(directory,'projection.sqlite');
  try{
   const report=await this.execute(this.queries.generation(this.verifiedQuality.generation)),canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
   const empty=new FinancialSearchIndex(file);empty.close();const db=new Database(file);
   try{
    db.exec('BEGIN');
    const generation=db.prepare('INSERT INTO financial_generations VALUES(?,?,?)');try{generation.run(report.id,canonical(report),financialIndexGenerationSha256(report))}finally{generation.close()}
    for(const table of ['financial_rows','financial_values'] as const){
     const columns=table==='financial_rows'?[...financialIndexRowColumns,'sha256','body']:[...financialIndexValueColumns],insert=db.prepare(`INSERT INTO ${table} VALUES(${columns.map(()=>'?').join(',')})`);let after='',metric='';
     try{for(;;){options.signal?.throwIfAborted();const rows=await this.execute(new FinancialIndexReadQueries(16000).projectionBatch(table,report.id,columns,after,metric));if(!rows.length)break;for(const row of rows)insert.run(...columns.map(c=>row[c]) as SQLInputValue[]);const last=rows.at(-1)!;after=String(last.row_id);metric=String(last.metric_id??'')}}finally{insert.close()}
    }
    db.exec('COMMIT');
   }catch(error){try{db.exec('ROLLBACK')}catch{}throw error}finally{db.close()}
   const check=new FinancialSearchIndex(file,{readOnly:true});try{if(canonical(check.quality(report.id))!==canonical(this.verifiedQuality))throw Error('Verification projection differs from DuckDB')}finally{check.close()}
   options.signal?.throwIfAborted();await this.snapshot.snapshotSha256();const result=await verify(file);await this.snapshot.snapshotSha256();return result;
  }finally{await rm(directory,{recursive:true,force:true})}
 })}
 snapshotSha256(){return this.snapshot.snapshotSha256()}
 close(){return this.closeTask??=(async()=>{this.closing=true;await Promise.allSettled([...this.active]);await this.snapshot.close()})()}
}
