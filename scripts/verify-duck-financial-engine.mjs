/** Exercise real native engine collisions in separate processes, without changing the candidate. */
import {strict as assert} from 'node:assert';import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';import {resolve,join} from 'node:path';import {pathToFileURL,fileURLToPath} from 'node:url';import {createRequire} from 'node:module';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
const sha=file=>createHash('sha256').update(readFileSync(file)).digest('hex');
async function worker(mode,sdk,legacy,candidate){
 let legacyEngine;
 if(mode==='mixed'){const {DuckDBInstance}=await import(pathToFileURL(legacy).href),db=await DuckDBInstance.create(':memory:'),c=await db.connect();try{legacyEngine=(await c.runAndReadAll('SELECT version() AS v')).getRowObjects()[0].v;assert.equal(legacyEngine,'v1.5.3')}finally{c.closeSync();db.closeSync()}}
 const require=createRequire(pathToFileURL(join(sdk,'dist/index.js'))),{DuckDBInstance}=require('@duckdb/node-api'),{DuckFinancialIndexBuild,assertDuckFinancialEngine}=await import(pathToFileURL(join(sdk,'dist/db/duck-financial-index-build.js')).href),{DuckFinancialSearchIndex}=await import(pathToFileURL(join(sdk,'dist/index.js')).href),db=await DuckDBInstance.create(':memory:'),c=await db.connect(),before=sha(candidate);
 try{
  const engine=(await c.runAndReadAll('SELECT version() AS v')).getRowObjects()[0].v;
  if(mode==='mixed'){
   assert.equal(engine,'v1.5.3');await assert.rejects(new DuckFinancialIndexBuild(c).begin({},'a'.repeat(64)),/engine required/);await assert.rejects(new DuckFinancialIndexBuild(c).progress('existing'),/engine required/);await assert.rejects(DuckFinancialSearchIndex.open(candidate),/engine required/);assert.equal((await c.runAndReadAll("SELECT count(*) AS n FROM duckdb_tables() WHERE NOT internal")).getRowObjects()[0].n,0n);
  }else{assert.equal(engine,'v2.0.0');await assertDuckFinancialEngine(c);const reader=await DuckFinancialSearchIndex.open(candidate);await reader.close()}
  assert.equal(sha(candidate),before);console.log(JSON.stringify({mode,legacyEngine,actualSdkEngine:engine,buildAndResumeRejected:mode==='mixed',readRejected:mode==='mixed',candidateUnchanged:true}));
 }finally{c.closeSync();db.closeSync()}
}
async function main(){
 if(process.argv[2]==='--worker')return worker(process.argv[3],resolve(process.argv[4]),resolve(process.argv[5]),resolve(process.argv[6]));
 const sdk=resolve(process.argv[2]),legacy=resolve(process.argv[3]),candidate=resolve(process.argv[4]),out=resolve(process.argv[5]);assert(!existsSync(out));mkdirSync(out,{recursive:true});const results=[];
 for(const mode of ['isolated','mixed']){const child=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',mode,sdk,legacy,candidate],{encoding:'utf8',maxBuffer:1024*1024});assert.equal(child.status,0,child.stderr);results.push(JSON.parse(child.stdout))}
 writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,sdk,legacy,candidate,results,verifierSha256:sha(fileURLToPath(import.meta.url)),sourceSha256:Object.fromEntries(['duck-financial-index-build','duck-financial-snapshot'].map(name=>[name,sha(join(sdk,'dist/db',name+'.js'))]))},null,2)+'\n');console.log(JSON.stringify(results));
}
main().catch(error=>{console.error(error);process.exitCode=1});
