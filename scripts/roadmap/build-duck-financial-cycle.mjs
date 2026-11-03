import {join,isAbsolute,resolve} from 'node:path';
import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {buildDuckFinancialCycle} from '../../dist/index.js';
import {reconstructAcquiredFinancialCycle} from './reconstruct-financial-cycle.mjs';
import {canonical,sha256,readJSONSnapshot,atomicJSON} from './operational-files.mjs';

/** Caller holds acquisition candidate/metadata locks, then duckdb.lock and parsedStorePath.lock. Never activates. */
export async function buildReconstructedDuckFinancialCycle(config,{parsedStorePath,sourceCommit,signal,maxDocuments=20,maxCompanies=20,maxBatches=1}={}){
 if(typeof parsedStorePath!=='string'||!isAbsolute(parsedStorePath)||resolve(parsedStorePath)!==parsedStorePath||typeof sourceCommit!=='string'||!/^[a-f0-9]{40}$/.test(sourceCommit)||![maxDocuments,maxCompanies,maxBatches].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=100)||signal!==undefined&&!(signal instanceof AbortSignal))throw Error('Invalid acquired DuckDB cycle options');
 const reconstructed=await reconstructAcquiredFinancialCycle(config,{signal});
 if(reconstructed.status!=='reconstructed')return reconstructed;
 if(signal?.aborted)return {status:'aborted',phase:'duck-financial-handoff'};
 const reconstruction=readJSONSnapshot(join(config.outputDirectory,'reconstruction.json'));
 if(canonical({...reconstruction.value.body,reused:undefined})!==canonical({...reconstructed,reused:undefined}))throw Error('Reconstructed DuckDB handoff differs');
 const input={version:1,archivePath:reconstructed.archivePath,parsedStorePath,outputDirectory:join(config.outputDirectory,'duckdb'),build:{...reconstructed.buildInput,options:{...reconstructed.buildInput.options,sourceCommit}}};
 const recipe={version:1,reconstructionSha256:reconstruction.sha256,operationsSha256:sha256(readFileSync(fileURLToPath(import.meta.url))),input},body={version:1,recipe,sha256:sha256(canonical(recipe))},file=join(config.outputDirectory,'duckdb-handoff.json');
 if(existsSync(file)){if(canonical(readJSONSnapshot(file).value)!==canonical(body))throw Error('Acquired DuckDB input or software differs')}
 else atomicJSON(file,body,{createOnly:true});
 const result=await buildDuckFinancialCycle(input,{signal,maxDocuments,maxCompanies,maxBatches});
 if(readJSONSnapshot(join(config.outputDirectory,'reconstruction.json')).sha256!==reconstruction.sha256||canonical(readJSONSnapshot(file).value)!==canonical(body))throw Error('DuckDB handoff changed during build');
 if(result.status!=='built')return {...result,handoffSha256:body.sha256};
 const metadataCurrentForCutoff=reconstructed.metadataCurrentForCutoff===true;
 return {...result,handoffSha256:body.sha256,metadataCurrentForCutoff,publicationBlockers:result.publicationBlockers.filter(reason=>reason!=='metadata-current-unverified'||!metadataCurrentForCutoff),publicationEligible:false,nextStage:'financial-value-verification'};
}
