import {strict as assert} from 'node:assert';
import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';import {createHash} from 'node:crypto';
import {DuckFinancialSearchIndex} from '../src/db/duck-financial-search-index';
import {FinancialSearchIndex,financialIndexGenerationSha256,type FinancialIndexCohort,type FinancialIndexSearchOptions} from '../src/db/financial-search-index';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function main(){
 const input=resolve(process.argv[2]),out=resolve(process.argv[3]);assert(!existsSync(out));mkdirSync(out,{recursive:true});
 const proof=JSON.parse(readFileSync(join(input,'summary.json'),'utf8')),generation=proof.input.generation,duckPath=join(input,'index.duckdb'),sqlitePath=join(input,'aggregate.sqlite'),before={duck:hash(duckPath),sqlite:hash(sqlitePath)};
 const started=performance.now(),duck=await DuckFinancialSearchIndex.open(duckPath),openMs=performance.now()-started,sqlite=new FinancialSearchIndex(sqlitePath,{readOnly:true});let comparisons=0,qualityMs=0;
 try{
  const actual=await duck.generation(generation),expected=sqlite.generation(generation);assert.deepEqual({...actual,assembly:undefined},{...expected,assembly:undefined});assert.deepEqual(actual.assembly?.population,expected.assembly?.population);assert.equal(actual.assembly?.archiveSha256,expected.assembly?.archiveSha256);
  const start=performance.now(),quality=await duck.quality(generation);qualityMs=performance.now()-start;const baseline=sqlite.quality(generation);assert.equal(quality.generationSha256,financialIndexGenerationSha256(actual));assert.equal(baseline.generationSha256,financialIndexGenerationSha256(expected));assert.deepEqual({...quality,generationSha256:undefined},{...baseline,generationSha256:undefined});
  for(const group of quality.cohorts){const cohort={generation,...group.cohort} as FinancialIndexCohort,metrics=group.byMetric.map(v=>v.metric).slice(0,5);const queries:FinancialIndexSearchOptions[]=[{metricIds:metrics},{metricIds:metrics,limit:0},{metricIds:metrics,limit:1},{metricIds:metrics,offset:1},{metricIds:metrics,sortBy:metrics[0],order:'desc'},{metricIds:metrics,conditions:[{metric:metrics[0],operator:'gte',value:0}]}];for(const query of queries){assert.deepEqual(await duck.screen(cohort,query),sqlite.screen(cohort,query));comparisons++}}
 }finally{await duck.close();sqlite.close()}
 assert.equal(hash(duckPath),before.duck);assert.equal(hash(sqlitePath),before.sqlite);
 const files=['src/db/duck-financial-search-index.ts','src/db/duck-financial-snapshot.ts','src/db/financial-search-index.ts','scripts/verify-duck-financial-reader.ts'];
 writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,generation,input,before,comparisons,allResultsEqual:true,qualityEqualExceptBuildIdentity:true,inputUnchanged:true,openMs,qualityMs,elapsedMs:performance.now()-started,sourceSha256:Object.fromEntries(files.map(f=>[f,hash(f)]))},null,2));console.log({comparisons,openMs,qualityMs});
}
main().catch(error=>{console.error(error);process.exitCode=1});
