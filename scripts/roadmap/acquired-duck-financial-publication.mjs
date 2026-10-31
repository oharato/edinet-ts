import {join,resolve,isAbsolute,relative,sep} from 'node:path';
import {DuckFinancialSearchIndex,FinancialIndexPublication,recordDuckFinancialValueVerification,validateDuckFinancialValueVerification} from '../../dist/index.js';
import {isFinancialIndexGenerationId} from '../../dist/db/financial-search-index.js';
import {buildReconstructedDuckFinancialCycle} from './build-duck-financial-cycle.mjs';
import {readJSONSnapshot,canonical} from './operational-files.mjs';

const boundary=config=>['duckdb-handoff.json','reconstruction.json'].map(name=>[name,readJSONSnapshot(join(config.outputDirectory,name)).sha256]);
function unchanged(config,before){if(canonical(boundary(config))!==canonical(before))throw Error('Publication handoff changed during verification')}
function verificationInput(config,built,reader,catalog,signal){return {reader,catalog,candidateId:built.publicationCandidate.id,inputSha256:built.inputSha256,archivePath:built.archivePath,recordPath:join(config.outputDirectory,'duckdb-value-verification.json'),signal}}
/** Caller holds acquisition/metadata, duckdb and parsed-store locks. No active pointer changes. */
export async function verifyAcquiredDuckFinancialCycle(config,options={}){
 const built=await buildReconstructedDuckFinancialCycle(config,options);
 if(built.status!=='built')return built;
 if(!built.publicationCandidate.eligible)return {...built,status:'verification-blocked'};
 const before=boundary(config),reader=await DuckFinancialSearchIndex.open(built.indexPath);let catalog;
 try{
  catalog=new FinancialIndexPublication(join(config.outputDirectory,'duckdb/publication.sqlite'),{readOnly:true});
  const verification=await recordDuckFinancialValueVerification(verificationInput(config,built,reader,catalog,options.signal));unchanged(config,before);
  return {...built,financialValuesValidated:true,verification,publicationBlockers:built.publicationBlockers.filter(reason=>reason!=='financial-values-unverified'),publicationEligible:false,nextStage:'financial-publication'};
 }finally{try{await reader.close()}finally{catalog?.close()}}
}
/** Caller additionally holds catalogPath.lock; requires an existing verification receipt and explicit CAS. */
export async function activateAcquiredDuckFinancialCycle(config,options={}){
 const {catalogPath,expectedActive,...buildOptions}=options;
 if(typeof catalogPath!=='string'||!isAbsolute(catalogPath)||resolve(catalogPath)!==catalogPath||expectedActive!==null&&!isFinancialIndexGenerationId(expectedActive))throw Error('Explicit publication target and expectedActive required');
 const part=relative(config.outputDirectory,catalogPath);if(!(part==='..'||part.startsWith('..'+sep)||isAbsolute(part))||[buildOptions.parsedStorePath,config.metadataPath,config.sourceArchivePath,config.metadataCheckpointPath].includes(catalogPath))throw Error('Publication catalog must be outside candidate/shared inputs');
 const built=await buildReconstructedDuckFinancialCycle(config,buildOptions);
 if(built.status!=='built')return built;
 if(built.publicationBlockers.some(reason=>reason!=='financial-values-unverified'))return {...built,status:'publication-blocked'};
 const before=boundary(config),reader=await DuckFinancialSearchIndex.open(built.indexPath);let catalog;
 try{
  catalog=new FinancialIndexPublication(catalogPath);
  const candidate=await catalog.prepareAsync(built.publicationCandidate.id,reader,built.generation);
  if(canonical(candidate)!==canonical(built.publicationCandidate))throw Error('Publication candidate differs from built quality');
  const verification=await validateDuckFinancialValueVerification(verificationInput(config,built,reader,catalog,buildOptions.signal));
  if(!verification)return {...built,status:'publication-blocked'};
  buildOptions.signal?.throwIfAborted();unchanged(config,before);
  const publication=await catalog.activateAsync(candidate.id,reader,{expectedActive});
  return {...built,status:'published',catalogPath,publication,verification,financialValuesValidated:true,publicationEligible:true,publicationBlockers:[],nextStage:'financial-reader-reload'};
 }finally{try{await reader.close()}finally{catalog?.close()}}
}
