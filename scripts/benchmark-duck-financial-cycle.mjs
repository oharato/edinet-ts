/** Same-generation SDK comparison: SQLite, DuckDB with per-query audit, DuckDB with verified snapshot reuse. */
import {strict as assert} from 'node:assert';
import {readFileSync,writeFileSync,copyFileSync,mkdirSync,existsSync,statSync,statfsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const sha=value=>createHash('sha256').update(value).digest('hex');
const benchmarkSha256=sha(readFileSync(fileURLToPath(import.meta.url)));
const read=file=>JSON.parse(readFileSync(file,'utf8'));
const load=(sdk,file)=>import(pathToFileURL(join(sdk,'dist',file)).href);
async function worker(sdk,out,mode){
 assert(['sqlite','uncached','cached'].includes(mode));
 const {DuckFinancialSearchIndex,FinancialSearchIndex}=await load(sdk,'index.js'),{FinancialIndexReadQueries}=await load(sdk,'db/financial-search-index.js'),cases=read(join(out,'cases.json')),generation=cases[0].cohort.generation,binding=read(join(out,'input.json'));
 const started=performance.now(),reader=mode==='sqlite'?new FinancialSearchIndex(join(out,'aggregate.sqlite'),{readOnly:true}):await DuckFinancialSearchIndex.open(read(join(out,'input.json')).indexPath),openMs=performance.now()-started;
 try{
  const qualityStart=performance.now();await reader.quality(generation);const qualityEnd=performance.now(),qualityMs=qualityEnd-qualityStart,initialReadMs=qualityEnd-started,samples=[],hashes=[];
  assert.equal(await reader.snapshotSha256(),mode==='sqlite'?binding.sqliteSha256:binding.duckdbSha256,'Benchmark snapshot changed');
  for(let repeat=-1;repeat<5;repeat++)for(const test of cases){
   const start=performance.now(),value=mode==='uncached'?await reader.execute(new FinancialIndexReadQueries().screen(test.cohort,test.options)):await reader.screen(test.cohort,test.options),elapsedMs=performance.now()-start,digest=sha(canonical(value));
   if(repeat>=0){samples.push({repeat,name:test.name,elapsedMs});hashes.push(digest)}
  }
  console.log(JSON.stringify({mode,openMs,qualityMs,initialReadMs,samples,hashes,steadyRssBytes:process.memoryUsage().rss,maxRssBytes:process.resourceUsage().maxRSS*1024}));
 }finally{await reader.close()}
}
async function main(){
 if(process.argv[2]==='--worker')return worker(resolve(process.argv[3]),resolve(process.argv[4]),process.argv[5]);
 const sdk=resolve(process.argv[2]),cycle=resolve(process.argv[3]),out=resolve(process.argv[4]),marker=read(join(cycle,'input.json')),saved=read(join(cycle,'build.json'));
 assert.equal(saved.body?.status,'built');assert.equal(marker.inputSha256,sha(canonical(marker.input)));assert.equal(saved.inputSha256,marker.inputSha256);assert.equal(saved.sha256,sha(canonical([saved.inputSha256,saved.body])));assert.equal(saved.body.indexPath,join(cycle,'index.duckdb'));assert(!existsSync(out));
 const {duckFinancialSdkSha256}=await load(sdk,'duck-financial-cycle.js');assert.equal(duckFinancialSdkSha256(),marker.input.sdkSha256);
 const space=statfsSync(cycle,{bigint:true});assert(space.bavail*space.bsize>=34n*1024n**3n+BigInt(statSync(saved.body.indexPath).size)*4n,'Reader benchmark disk reserve');
 mkdirSync(out,{mode:0o700});writeFileSync(join(out,'input.json'),JSON.stringify({indexPath:saved.body.indexPath,inputSha256:marker.inputSha256,sdkSha256:marker.input.sdkSha256})+'\n');
 const {DuckFinancialSearchIndex}=await load(sdk,'index.js'),reader=await DuckFinancialSearchIndex.open(saved.body.indexPath);let cases=[];
 try{
  const quality=await reader.quality(saved.body.generation),report=await reader.generation(saved.body.generation);
  for(const standard of ['J-GAAP','IFRS'])for(const group of ['balanceSheet','details']){
   const cohorts=quality.cohorts.filter(c=>c.cohort.accountingStandard===standard&&c.cohort.group===group&&c.cohort.scope==='Consolidated').sort((a,b)=>b.companies-a.companies||canonical(a.cohort).localeCompare(canonical(b.cohort)));if(!cohorts.length)continue;
   const selected=cohorts[0],c=selected.cohort,rows=report.rows.filter(r=>{const m=r.metadata;return m[2]===group&&m[3]===standard&&m[4]===c.scope&&m[5]===c.currency&&m[6]===(c.period.startDate??'')&&m[7]===(c.period.endDate??c.period.instant)&&m[8]===(c.periodType??'')}).sort((a,b)=>String(a.metadata[11]).localeCompare(String(b.metadata[11]))),companies=new Set(),securities=new Set(),docIDs=[];
   for(const {metadata:m} of rows){if(companies.has(m[9])||securities.has(m[10]))continue;companies.add(m[9]);securities.add(m[10]);docIDs.push(m[11]);if(docIDs.length===1000)break}
   const cohort={generation:report.id,...c,docIDs},metricIds=[...selected.byMetric].sort((a,b)=>b.values.available-a.values.available||a.metric.localeCompare(b.metric)).slice(0,5).map(m=>m.metric),base={metricIds};assert(metricIds.length&&docIDs.length);
   cases.push({name:standard+'/'+group+'/ranking',cohort,options:{...base,sortBy:metricIds[0],order:'desc',limit:100}},{name:standard+'/'+group+'/compound',cohort,options:{...base,conditions:metricIds.slice(0,2).map(metric=>({metric,operator:'gte',value:0})),limit:100}},{name:standard+'/'+group+'/all',cohort,options:{...base,limit:0}});
  }
  assert(cases.length>0);writeFileSync(join(out,'cases.json'),JSON.stringify(cases,null,2)+'\n');await reader.withVerificationProjection(async file=>copyFileSync(file,join(out,'aggregate.sqlite')));writeFileSync(join(out,'input.json'),JSON.stringify({indexPath:saved.body.indexPath,inputSha256:marker.inputSha256,sdkSha256:marker.input.sdkSha256,duckdbSha256:await reader.snapshotSha256(),sqliteSha256:sha(readFileSync(join(out,'aggregate.sqlite')))})+'\n');
 }finally{await reader.close()}
 const results=[];
 for(const mode of ['sqlite','uncached','cached']){const run=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',sdk,out,mode],{encoding:'utf8',maxBuffer:16*1024*1024});assert.equal(run.status,0,run.stderr);const result=JSON.parse(run.stdout);writeFileSync(join(out,mode+'.json'),JSON.stringify(result,null,2)+'\n');results.push(result)}
 assert.equal(sha(readFileSync(fileURLToPath(import.meta.url))),benchmarkSha256);assert.deepEqual(results[0].hashes,results[1].hashes);assert.deepEqual(results[1].hashes,results[2].hashes);assert.equal(duckFinancialSdkSha256(),marker.input.sdkSha256);
 writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,benchmarkSha256,inputSha256:marker.inputSha256,sdkSha256:marker.input.sdkSha256,cases:cases.length,warmups:1,repeats:5,allResultsEqual:true,fileBytes:{sqlite:statSync(join(out,'aggregate.sqlite')).size,duckdb:statSync(saved.body.indexPath).size},results:results.map(({hashes,...r})=>r),scope:'fixed cohort subsets <=1000 companies; warm cache; sequential isolated workers; no claim about concurrent load'},null,2)+'\n');console.log(JSON.stringify({cases:cases.length,allResultsEqual:true}));
}
main().catch(error=>{console.error(error);process.exitCode=1});
