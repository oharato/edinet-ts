import {join,isAbsolute,resolve} from 'node:path';
import {existsSync,readdirSync,lstatSync,realpathSync,mkdirSync} from 'node:fs';
import {runDailyFinancialPreparation} from './run-daily-financial-preparation.mjs';
import {acquirePreparedFinancialCycle} from './acquire-financial-cycle.mjs';
import {buildReconstructedDuckFinancialCycle} from './build-duck-financial-cycle.mjs';
import {canonical,sha256,readJSONSnapshot} from './operational-files.mjs';

export function dailyDuckFinancialDirectory(input){
 if(input.version===1)return input.outputDirectory;
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10);
 if(existsSync(input.outputDirectory)){
  const stat=lstatSync(input.outputDirectory);if(!stat.isDirectory()||stat.isSymbolicLink()||realpathSync(input.outputDirectory)!==input.outputDirectory)throw Error('Invalid daily DuckDB root');
  for(const day of readdirSync(input.outputDirectory).sort()){
   if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(Date.parse(day+'T00:00:00Z'))||new Date(day+'T00:00:00Z').toISOString().slice(0,10)!==day||day>today)throw Error('Invalid daily DuckDB date');
   const directory=join(input.outputDirectory,day),s=lstatSync(directory);if(!s.isDirectory()||s.isSymbolicLink())throw Error('Invalid daily DuckDB directory');
   const handoff=join(directory,'handoff.json');if(existsSync(handoff)&&readJSONSnapshot(handoff).value?.body?.day!==day)throw Error('Daily DuckDB handoff date differs');
   const receipt=join(directory,'candidate/duckdb/build.json');if(!existsSync(receipt))return directory;
   const saved=readJSONSnapshot(receipt).value;if(saved.body?.status!=='built'||saved.body.indexPath!==join(directory,'candidate/duckdb/index.duckdb')||saved.body.archivePath!==join(directory,'candidate/reconstructed/archive.sqlite')||saved.body.inputSha256!==saved.inputSha256||saved.sha256!==sha256(canonical([saved.inputSha256,saved.body])))throw Error('Invalid daily DuckDB completion');
   if(day===today)return undefined;
  }
 }
 return join(input.outputDirectory,today);
}
/** Caller holds daily-root/metadata locks and selected acquisition/duckdb/parsed-store locks throughout. Does not publish. */
export async function runDailyDuckFinancialCycle(input,{signal,readUnitState,prepareOptions={},acquisitionOptions={},parsedStorePath,sourceCommit,maxDocuments=20,maxCompanies=20,maxBatches=1,withBuildLocks=async(_config,work)=>work()}={}){
 if(typeof withBuildLocks!=='function')throw Error('Invalid daily DuckDB lock handler');
 if(!input||![1,2].includes(input.version)||typeof input.outputDirectory!=='string'||!isAbsolute(input.outputDirectory)||resolve(input.outputDirectory)!==input.outputDirectory||typeof parsedStorePath!=='string'||!isAbsolute(parsedStorePath)||resolve(parsedStorePath)!==parsedStorePath||typeof sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(sourceCommit)||![maxDocuments,maxCompanies,maxBatches].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=100)||signal!==undefined&&!(signal instanceof AbortSignal))throw Error('Invalid daily DuckDB configuration');
 if(signal?.aborted)return {status:'aborted',phase:'daily-duck-financial'};
 const outputDirectory=dailyDuckFinancialDirectory(input);
 if(outputDirectory===undefined)return {status:'cycle-complete',day:new Date(Date.now()+9*3600000).toISOString().slice(0,10),searchEngine:'duckdb'};
 if(input.version===2&&!existsSync(input.outputDirectory))mkdirSync(input.outputDirectory,{mode:0o700});
 const prepared=await runDailyFinancialPreparation({...input,version:1,outputDirectory},{signal,readUnitState,prepareOptions});
 if(prepared.status!=='prepared')return prepared;
 if(signal?.aborted)return {status:'aborted',phase:'daily-duck-financial'};
 const snapshot=readJSONSnapshot(prepared.configPath),config=snapshot.value;
 if(config.outputDirectory!==join(outputDirectory,'candidate'))throw Error('Daily DuckDB prepared directory differs');
 return withBuildLocks(config,async()=>{
 const acquired=await acquirePreparedFinancialCycle(config,{...acquisitionOptions,signal});
 if(readJSONSnapshot(prepared.configPath).sha256!==snapshot.sha256)throw Error('Daily DuckDB preparation changed during acquisition');
 if(acquired.status!=='acquired')return {...acquired,day:prepared.day};
 if(signal?.aborted)return {status:'aborted',phase:'daily-duck-financial'};
 const result=await buildReconstructedDuckFinancialCycle(config,{signal,parsedStorePath,sourceCommit,maxDocuments,maxCompanies,maxBatches});
 if(readJSONSnapshot(prepared.configPath).sha256!==snapshot.sha256)throw Error('Daily DuckDB preparation changed during build');
 return {...result,day:prepared.day,configPath:prepared.configPath,searchEngine:'duckdb'};
 });
}
