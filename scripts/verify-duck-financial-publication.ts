import {strict as assert} from 'node:assert';import {readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';import {createHash} from 'node:crypto';
import {DuckFinancialSearchIndex} from '../src/db/duck-financial-search-index';
import {FinancialIndexPublication} from '../src/db/financial-index-publication';
const hash=(p:string)=>createHash('sha256').update(readFileSync(p)).digest('hex');
async function main(){
 const input=resolve(process.argv[2]),out=resolve(process.argv[3]);assert(!existsSync(out));mkdirSync(out,{recursive:true});const proof=JSON.parse(readFileSync(join(input,'summary.json'),'utf8')),file=join(input,'index.duckdb'),before=hash(file),index=await DuckFinancialSearchIndex.open(file),catalogPath=join(out,'catalog.sqlite'),catalog=new FinancialIndexPublication(catalogPath);let first,blocked,history;
 try{
  const quality=await index.quality(proof.input.generation),policy={minimumCompaniesWithUsableValues:quality.companiesWithUsableValues,maxUnavailableSources:0,maxUnresolvedSelections:0,maxUnavailableSelections:0,maxUnresolvedRecords:0,maxUnavailableGroups:0,maxDuplicateCohortIdentifiers:0,maxUnavailableValues:quality.values.missing+quality.values.unsupported+quality.values.ambiguous+quality.values['unsafe-number']};
  blocked=await catalog.prepareAsync('default-policy',index,proof.input.generation);first=await catalog.prepareAsync('old',index,proof.input.generation,policy);assert.equal(first.eligible,true);await catalog.activateAsync('old',index,{expectedActive:null});await catalog.prepareAsync('new',index,proof.input.generation,policy);await catalog.activateAsync('new',index,{expectedActive:'old'});await catalog.activateAsync('old',index,{expectedActive:'new'});assert.deepEqual(await catalog.resolveAsync(index),first);history=catalog.history();assert.equal(history.length,3);
 }finally{catalog.close()}
 const reopened=new FinancialIndexPublication(catalogPath,{readOnly:true});try{assert.deepEqual(await reopened.resolveAsync(index),first)}finally{reopened.close();await index.close()}
 assert.equal(hash(file),before);const files=['src/db/financial-index-publication.ts','src/db/duck-financial-search-index.ts','scripts/verify-duck-financial-publication.ts'];writeFileSync(join(out,'summary.json'),JSON.stringify({node:process.version,input,inputUnchanged:true,scope:'isolated quality-only catalog test; policy admits observed unavailable values; not formal daily publication',independentSourceGate:false,defaultEligible:blocked!.eligible,first,history,sourceSha256:Object.fromEntries(files.map(f=>[f,hash(f)]))},null,2));console.log({defaultEligible:blocked!.eligible,history});
}
main().catch(error=>{console.error(error);process.exitCode=1});
