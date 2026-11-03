import {existsSync,readFileSync} from 'node:fs';
import {isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {FinancialSearchIndex} from '../../dist/index.js';
import {atomicJSON,canonical,normalFile,readJSONSnapshot,sha256} from './operational-files.mjs';

const verifier=fileURLToPath(new URL('./verify-financial-values.py',import.meta.url)),execute=promisify(execFile);
const binding=built=>({inputSha256:built.inputSha256,generation:built.generation,generationSha256:built.publicationCandidate.generationSha256,
    archiveSha256:built.publicationCandidate.archiveSha256,buildPlanSha256:built.publicationCandidate.buildPlanSha256,qualitySha256:built.publicationCandidate.qualitySha256});
async function check(built,archivePath,signal){
    if(built?.status!=='built'||!isAbsolute(archivePath)||normalFile(archivePath)!==resolve(archivePath))throw Error('Invalid financial verification input');
    const index=new FinancialSearchIndex(normalFile(built.indexPath),{readOnly:true});
    try{if(canonical(index.quality(built.generation))!==canonical(built.quality))throw Error('Financial verification generation differs')}
    finally{index.close()}
    let stdout;
    try{({stdout}=await execute('python3',['-I',verifier,built.indexPath,archivePath,built.generation,built.publicationCandidate.archiveSha256],{signal,maxBuffer:1024*1024}))}
    catch{throw Error('Independent financial source verification failed')}
    return JSON.parse(stdout);
}
/** A complete direct-fact replay, not a manual approval flag. Caller holds candidate lock. */
export async function recordFinancialValueVerification(built,{archivePath,recordPath,signal}={}){
    if(typeof recordPath!=='string'||!isAbsolute(recordPath)||resolve(recordPath)!==recordPath)throw Error('Absolute verification record path required');
    const checks=await check(built,archivePath,signal),body={version:1,binding:binding(built),verifierSha256:sha256(readFileSync(verifier)),checks,verifiedAt:new Date().toISOString()};
    const record={...body,sha256:sha256(canonical(body))};
    if(existsSync(recordPath)){
        const saved=readJSONSnapshot(recordPath).value,{sha256:digest,...savedBody}=saved;
        if(digest!==sha256(canonical(savedBody))||canonical({...saved,verifiedAt:body.verifiedAt,sha256:record.sha256})!==canonical(record))throw Error('Financial verification record differs');
        return saved;
    }
    atomicJSON(recordPath,record,{createOnly:true});return record;
}
/** Reject stale/fabricated receipts; independently replay the fixed raw facts again before switching. */
export async function validateFinancialValueVerification(built,{archivePath,recordPath,signal}={}){
    if(!existsSync(recordPath))return undefined;
    const record=readJSONSnapshot(recordPath).value,{sha256:digest,...body}=record;
    if(record.version!==1||digest!==sha256(canonical(body))||canonical(record.binding)!==canonical(binding(built))
        ||record.verifierSha256!==sha256(readFileSync(verifier))||typeof record.verifiedAt!=='string'||!Number.isFinite(Date.parse(record.verifiedAt)))throw Error('Financial source verification binding differs');
    const checks=await check(built,archivePath,signal);
    if(canonical(checks)!==canonical(record.checks))throw Error('Financial source verification evidence differs');
    return {recordSha256:digest,...record.binding,checks};
}
