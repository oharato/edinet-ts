/** Small fixed-generation comparison: current shared audit SQL with/without snapshot reuse. */
import {strict as assert} from 'node:assert';import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {DuckFinancialSearchIndex} from '../src/db/duck-financial-search-index';
import {FinancialSearchIndex,FinancialIndexReadQueries,type FinancialIndexCohort} from '../src/db/financial-search-index';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
async function main(){
 if(process.argv[2]==='--worker'){
  const mode=process.argv[3],input=resolve(process.argv[4]),proof=JSON.parse(readFileSync(join(input,'summary.json'),'utf8')),id=proof.input.generation,start=performance.now(),reader=mode==='sqlite'?new FinancialSearchIndex(join(input,'aggregate.sqlite'),{readOnly:true}):await DuckFinancialSearchIndex.open(join(input,'index.duckdb')),openMs=performance.now()-start,initialRss=process.memoryUsage().rss;
  try{
   const quality=await reader.quality(id),queries=quality.cohorts.flatMap(g=>{const cohort={generation:id,...g.cohort} as FinancialIndexCohort,metrics=g.byMetric.map(m=>m.metric).slice(0,5);return [{cohort,options:{metricIds:metrics}},{cohort,options:{metricIds:metrics,limit:1}},{cohort,options:{metricIds:metrics,sortBy:metrics[0],order:'desc' as const}}]}),times:number[]=[],outputs:string[]=[];
   for(let repeat=0;repeat<5;repeat++){const before=performance.now();for(const q of queries){const result=mode==='uncached'?(await (reader as any).execute(new FinancialIndexReadQueries().screen(q.cohort,q.options))):await reader.screen(q.cohort,q.options);outputs.push(hash(JSON.stringify(result)))}times.push(performance.now()-before)}
   console.log(JSON.stringify({mode,openMs,initialRss,steadyRss:process.memoryUsage().rss,peakRss:process.resourceUsage().maxRSS*1024,queriesPerRepeat:queries.length,repeats:5,repeatMs:times,outputs}));
  }finally{await reader.close()}
  return;
 }
 const input=resolve(process.argv[2]),out=resolve(process.argv[3]);assert(!existsSync(out));mkdirSync(out,{recursive:true});const results:any[]=[];
 for(const mode of ['sqlite','uncached','cached']){const run=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/benchmark-duck-financial-reader.ts','--worker',mode,input],{encoding:'utf8',maxBuffer:4*1024*1024});assert.equal(run.status,0,run.stderr);results.push(JSON.parse(run.stdout))}
 assert.deepEqual(results[0].outputs,results[1].outputs);assert.deepEqual(results[1].outputs,results[2].outputs);const files=['src/db/duck-financial-search-index.ts','src/db/financial-search-index.ts','scripts/benchmark-duck-financial-reader.ts'];writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,input,scope:'two-company retained sample; uncached mode executes current shared bounded audit per search, not historical code; process RSS includes driver/parser modules',allResultsEqual:true,results:results.map(({outputs,...r})=>r),sourceSha256:Object.fromEntries(files.map(p=>[p,hash(readFileSync(p,'utf8'))]))},null,2));console.log(results.map(({mode,openMs,repeatMs,peakRss})=>({mode,openMs,repeatMs,peakRss})));
}
main().catch(error=>{console.error(error);process.exitCode=1});
