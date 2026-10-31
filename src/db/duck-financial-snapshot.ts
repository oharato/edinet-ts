import {constants} from 'node:fs';
import {open,lstat,mkdtemp,rm,chmod} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import type {BigIntStats} from 'node:fs';
import type {DuckFinancialConnection} from './duck-financial-index-build';
type NativeResult={closeSync():void;getRowObjects():Record<string,unknown>[];getColumns():unknown[][];deduplicatedColumnNames():string[];readonly currentRowCount:number;};
interface NativeStatement {clearBindings():void;bind(values:any[]):void;runAndReadAll():Promise<NativeResult>;destroySync():void;}
type NativeDuckConnection=Omit<DuckFinancialConnection,'runAndReadAll'> & {
 runAndReadAll(sql:string,values?:any[]):Promise<NativeResult>;
 prepare(sql:string):Promise<NativeStatement>;
 closeSync():void;
};
interface NativeDuckInstance {connect():Promise<NativeDuckConnection>;closeSync():void;}
import {assertDuckFinancialEngine,duckFinancialBuildKind,duckFinancialBuildSchema} from './duck-financial-index-build';
const identity=(s:BigIntStats)=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':');
const canonical=(v:unknown)=>JSON.stringify(v);
const ddl=(s:string)=>s.replace(/\bTEXT\b/g,'VARCHAR').replace(/\bINTEGER\b/g,'BIGINT').replace(/\bREAL\b/g,'DOUBLE');
async function inspect(path:string){
 const s=await lstat(path,{bigint:true});
 if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n)throw Error('DuckDB snapshot requires a single-link regular file');
 for(const suffix of ['.wal','.tmp']){
  try{await lstat(path+suffix)}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')continue;throw e}
  throw Error('DuckDB sidecar exists; close and checkpoint the source first');
 }
 return s;
}
async function schema(connection:NativeDuckConnection){
 const tables=(await connection.runAndReadAll("SELECT schema_name,table_name,sql FROM duckdb_tables() WHERE NOT internal ORDER BY schema_name,table_name")).getRowObjects();
 const indexes=(await connection.runAndReadAll("SELECT schema_name,index_name,sql FROM duckdb_indexes() ORDER BY schema_name,index_name")).getRowObjects();
 const views=(await connection.runAndReadAll('SELECT schema_name,view_name FROM duckdb_views() WHERE NOT internal ORDER BY schema_name,view_name')).getRowObjects();
 return {tables,indexes,views};
}
let expectedSchema:Promise<string>|undefined;
async function expected(){
 if(!expectedSchema)expectedSchema=(async()=>{
  const {DuckDBInstance}=await import('@duckdb/node-api'),db=await DuckDBInstance.create(':memory:',{threads:'1'});let connection:NativeDuckConnection|undefined;
  try{connection=await db.connect();await assertDuckFinancialEngine(connection);for(const sql of Object.values(duckFinancialBuildSchema))await connection.run(ddl(sql));return canonical(await schema(connection))}finally{connection?.closeSync();db.closeSync()}
 })().catch(error=>{expectedSchema=undefined;throw error});
 return expectedSchema;
}
/** Internal read-only private snapshot. Completion here is not a financial quality/publication gate. */
export class DuckFinancialSnapshot {
 private statements=new Map<string,NativeStatement>();
 private closed=false;
 private closing=false;
 private pending:Promise<unknown>=Promise.resolve();
 private closeTask?:Promise<void>;
 private constructor(private directory:string,private file:string,private fingerprint:string,private digest:string,private instance:NativeDuckInstance,private connection:NativeDuckConnection){}
 static async open(file:string):Promise<DuckFinancialSnapshot>{
  if(typeof file!=='string'||!file.trim()||file!==file.trim()||file===':memory:'||file.includes('\0'))throw Error('A completed DuckDB file is required');
  const source=resolve(file),before=await inspect(source),directory=await mkdtemp(join(tmpdir(),'edinet-duck-snapshot-')),target=join(directory,'snapshot.duckdb');
  let instance:NativeDuckInstance|undefined,connection:NativeDuckConnection|undefined;
  try{
   const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
   try{
    const opened=await input.stat({bigint:true});if(identity(opened)!==identity(before)||!opened.isFile()||opened.nlink!==1n)throw Error('DuckDB source changed before copy');
    const output=await open(target,'wx',0o600),hash=createHash('sha256');let copied=0n;
    try{
     const buffer=Buffer.alloc(1024*1024);
     while(copied<opened.size){const remaining=opened.size-copied,{bytesRead}=await input.read(buffer,0,Number(remaining>BigInt(buffer.length)?BigInt(buffer.length):remaining),null);if(!bytesRead)throw Error('DuckDB source truncated during copy');hash.update(buffer.subarray(0,bytesRead));let written=0;while(written<bytesRead){const result=await output.write(buffer,written,bytesRead-written);if(!result.bytesWritten)throw Error('DuckDB snapshot copy failed');written+=result.bytesWritten}copied+=BigInt(bytesRead)}
     if(identity(await input.stat({bigint:true}))!==identity(opened)||identity(await inspect(source))!==identity(opened))throw Error('DuckDB source changed during copy');
    }finally{await output.close()}
    await chmod(target,0o400);
    const expectedDDL=await expected();
    const {DuckDBInstance}=await import('@duckdb/node-api');instance=await DuckDBInstance.create(target,{access_mode:'READ_ONLY',threads:'1',memory_limit:'256MB',enable_external_access:'false',autoload_known_extensions:'false',autoinstall_known_extensions:'false'});connection=await instance.connect();
    await assertDuckFinancialEngine(connection);
    if(canonical(await schema(connection))!==expectedDDL)throw Error('DuckDB snapshot schema differs');
    const format=(await connection.runAndReadAll('SELECT kind FROM duck_build_format')).getRowObjects(),legacy=(await connection.runAndReadAll('SELECT kind FROM financial_index_format')).getRowObjects();
    if(format.length!==1||format[0].kind!==duckFinancialBuildKind||legacy.length!==1||legacy[0].kind!=='edinet-ts-financial-search-index-v1')throw Error('DuckDB snapshot format differs');
    const generations=(await connection.runAndReadAll('SELECT id FROM financial_generations LIMIT 2')).getRowObjects();if(generations.length!==1)throw Error('DuckDB snapshot is incomplete');
    const saved=await inspect(target);return new DuckFinancialSnapshot(directory,target,identity(saved),hash.digest('hex'),instance,connection);
   }finally{await input.close()}
  }catch(error){try{connection?.closeSync()}finally{try{instance?.closeSync()}finally{await rm(directory,{recursive:true,force:true})}}throw error}
 }
 async snapshotSha256(){if(this.closed)throw Error('DuckDB snapshot is closed');if(identity(await inspect(this.file))!==this.fingerprint)throw Error('DuckDB snapshot changed');return this.digest}
 private async read(sql:string,args?:any[]):Promise<NativeResult>{
  // Bound the retained plans; multi-statement SQL keeps the native execution path.
  if(!args||sql.length>65536||sql.includes(';')||!/^\s*(SELECT|WITH)\b/i.test(sql))return this.connection.runAndReadAll(sql,args);
  let statement=this.statements.get(sql);
  if(!statement){if(this.statements.size>=8)return this.connection.runAndReadAll(sql,args);statement=await this.connection.prepare(sql);this.statements.set(sql,statement)}
  statement.clearBindings();statement.bind(args);return statement.runAndReadAll();
 }
 async rows(sql:string,args?:any[]){
  if(this.closed||this.closing)throw Error('DuckDB snapshot is closed');
  const task=this.pending.then(async()=>{
   await this.snapshotSha256();const result=await this.read(sql,args);try{const columns=result.getColumns(),names=result.deduplicatedColumnNames(),count=result.currentRowCount;await this.snapshotSha256();
   if(columns.length!==names.length||columns.some(column=>column.length!==count))throw Error('DuckDB result columns differ');
   // Read each native column once; preserve native name deduplication and safe integer checks.
   const rows=Array.from({length:count},()=>({} as Record<string,unknown>));
   for(let column=0;column<columns.length;column++)for(let row=0;row<count;row++){let value=columns[column][row];if(typeof value==='bigint'){value=Number(value);if(!Number.isSafeInteger(value))throw Error('Unsafe DuckDB integer')}rows[row][names[column]]=value}
   return rows;
   }finally{result.closeSync()}
  });
  this.pending=task.catch(()=>undefined);return task;
 }
 close(){
  return this.closeTask??=(async()=>{
   this.closing=true;await this.pending;this.closed=true;
   try{for(const statement of this.statements.values())statement.destroySync();this.statements.clear()}finally{try{this.connection.closeSync()}finally{try{this.instance.closeSync()}finally{await rm(this.directory,{recursive:true,force:true})}}}
  })();
 }
}
