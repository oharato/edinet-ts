/** DuckDB counterpart of the formal daily source-verification gate. No raw XML is interpreted by the SDK here. */
import {readFileSync,existsSync,lstatSync} from 'node:fs';import {resolve,isAbsolute} from 'node:path';import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {DuckFinancialSearchIndex} from './db/duck-financial-search-index';
import {isFinancialIndexGenerationId} from './db/financial-search-index';
import {FinancialIndexPublication} from './db/financial-index-publication';
import {atomicJSON,canonical,normalFile,readJSONSnapshot,sha256} from './verification-files';
const verifier=fileURLToPath(new URL('./assets/verify-financial-values.py',import.meta.url)),execute=promisify(execFile);
export interface DuckFinancialVerificationInput {reader:DuckFinancialSearchIndex;catalog:FinancialIndexPublication;candidateId:string;inputSha256:string;archivePath:string;recordPath:string;signal?:AbortSignal;}
export interface DuckFinancialVerificationChecks {
 version:1;method:string;generation:string;rows:number;selectedValues:number;documents:number;checkedFacts:number;lineageRowsChecked:number;currentStandaloneIfrsRowsChecked:number;explicitTargetDocumentsChecked:number;legacyCorrectionDocumentsWithoutTarget:number;valuesSha256:string;
}
export type DuckFinancialVerificationBinding=Awaited<ReturnType<typeof context>>['binding'];
export interface DuckFinancialVerificationRecord {version:2;engine:'duckdb';binding:DuckFinancialVerificationBinding;verifierSha256:string;checks:DuckFinancialVerificationChecks;verifiedAt:string;sha256:string;}
const verifiedAt=(v:unknown):v is string=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
function capture(input:DuckFinancialVerificationInput){
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid verification input');input={...input};
 if(!input||typeof input!=='object'||!(input.reader instanceof DuckFinancialSearchIndex)||!(input.catalog instanceof FinancialIndexPublication)||typeof input.inputSha256!=='string'||!/^([a-f0-9]{64})$/.test(input.inputSha256)||!isAbsolute(input.archivePath)||normalFile(input.archivePath)!==resolve(input.archivePath)||!isAbsolute(input.recordPath)||resolve(input.recordPath)!==input.recordPath||input.signal!==undefined&&!(input.signal instanceof AbortSignal))throw Error('Invalid DuckDB source verification input');
 for(const file of [input.recordPath,...['-wal','-shm','-journal'].map(s=>input.archivePath+s)]){try{const stat=lstatSync(file);if(file!==input.recordPath||!stat.isFile()||stat.isSymbolicLink()||stat.nlink!==1)throw Error('Archive sidecars or invalid receipt file')}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error}}
 const stat=lstatSync(input.archivePath);if(!stat.isFile()||stat.nlink!==1)throw Error('A single-link source archive is required');
 return {...input};
}
async function context(input:DuckFinancialVerificationInput){
 const candidate=input.catalog.candidate(input.candidateId),quality=await input.reader.quality(candidate.generation),generation=await input.reader.generation(candidate.generation);
 if(!candidate.eligible||canonical(candidate.quality)!==canonical(quality)||generation.assembly?.archiveSha256!==candidate.archiveSha256||generation.assembly.planSha256!==candidate.buildPlanSha256)throw Error('Candidate is ineligible or differs from DuckDB');
 return {candidate,binding:{candidateSha256:sha256(canonical(candidate)),candidateId:candidate.id,inputSha256:input.inputSha256,duckdbSha256:await input.reader.snapshotSha256(),generation:candidate.generation,generationSha256:candidate.generationSha256,archiveSha256:candidate.archiveSha256,buildPlanSha256:candidate.buildPlanSha256,qualitySha256:candidate.qualitySha256}};
}
async function check(input:DuckFinancialVerificationInput,binding:Awaited<ReturnType<typeof context>>['binding']){
 input.signal?.throwIfAborted();const before=sha256(readFileSync(verifier));
 const checks=await input.reader.withVerificationProjection(async projection=>{
  let stdout:string;try{({stdout}=await execute('python3',['-I',verifier,projection,input.archivePath,binding.generation,binding.archiveSha256],{signal:input.signal,maxBuffer:1024*1024}))}catch(error){if(input.signal?.aborted)throw error;throw Error('Independent DuckDB financial source verification failed')}
  const result=JSON.parse(stdout);if(!result||typeof result!=='object'||Array.isArray(result)||result.version!==1||result.generation!==binding.generation||typeof result.method!=='string'||result.method.length<1||result.method.length>256||!['rows','selectedValues','documents','checkedFacts','lineageRowsChecked','currentStandaloneIfrsRowsChecked','explicitTargetDocumentsChecked','legacyCorrectionDocumentsWithoutTarget'].every(key=>Number.isSafeInteger(result[key])&&result[key]>=0)||result.selectedValues<1||typeof result.valuesSha256!=='string'||!/^([a-f0-9]{64})$/.test(result.valuesSha256))throw Error('Independent source verification result differs');return result as DuckFinancialVerificationChecks;
 },{signal:input.signal});
 input.signal?.throwIfAborted();capture(input);if(before!==sha256(readFileSync(verifier))||binding.duckdbSha256!==await input.reader.snapshotSha256())throw Error('Verifier or DuckDB snapshot changed');
 if(canonical((await context(input)).binding)!==canonical(binding))throw Error('Candidate changed during verification');return {checks,verifierSha256:before};
}
export async function recordDuckFinancialValueVerification(raw:DuckFinancialVerificationInput):Promise<DuckFinancialVerificationRecord>{
 const input=capture(raw),{binding}=await context(input),{checks,verifierSha256}=await check(input,binding),body={version:2 as const,engine:'duckdb' as const,binding,verifierSha256,checks,verifiedAt:new Date().toISOString()},record={...body,sha256:sha256(canonical(body))};
 if(existsSync(input.recordPath)){
  const saved=readJSONSnapshot(input.recordPath).value,{sha256:digest,...old}=saved;
  if(!verifiedAt(saved.verifiedAt))throw Error('Invalid verification timestamp');
  if(digest!==sha256(canonical(old))||canonical({...saved,verifiedAt:body.verifiedAt,sha256:record.sha256})!==canonical(record))throw Error('DuckDB financial verification record differs');return saved;
 }
 atomicJSON(input.recordPath,record,{createOnly:true});return record;
}
export async function validateDuckFinancialValueVerification(raw:DuckFinancialVerificationInput){
 const input=capture(raw);if(!existsSync(input.recordPath))return undefined;
 const record=readJSONSnapshot(input.recordPath).value,{sha256:digest,...body}=record,{binding}=await context(input);
 if(record.version!==2||record.engine!=='duckdb'||digest!==sha256(canonical(body))||canonical(record.binding)!==canonical(binding)||record.verifierSha256!==sha256(readFileSync(verifier))||!verifiedAt(record.verifiedAt))throw Error('DuckDB financial source verification binding differs');
 const {checks}=await check(input,binding);if(canonical(checks)!==canonical(record.checks))throw Error('DuckDB financial source verification evidence differs');return {recordSha256:digest as string,...binding,checks};
}
/** Gate for explicit activation/rollback; validates receipt and replays every selected raw fact again. */
export async function activateVerifiedDuckFinancialPublication(raw:DuckFinancialVerificationInput,options:{expectedActive:string|null}){
 if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).length!==1||!Object.hasOwn(options,'expectedActive')||options.expectedActive!==null&&!isFinancialIndexGenerationId(options.expectedActive))throw Error('Explicit expectedActive required');
 const input=capture(raw),expectedActive=options.expectedActive,verification=await validateDuckFinancialValueVerification(input);if(!verification)throw Error('DuckDB financial values are unverified');input.signal?.throwIfAborted();
 const publication=await input.catalog.activateAsync(input.candidateId,input.reader,{expectedActive});return {publication,verification};
}
