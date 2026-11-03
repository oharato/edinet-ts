import {readFileSync,existsSync,statSync,statfsSync} from 'node:fs';
import {join,isAbsolute,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {FinancialSourceJob,ObservedFinancialArchive} from '../../dist/index.js';
import {normalizeFinancialSourceJobInput} from '../../dist/db/financial-source-job.js';
import {prepareFinancialCycle,financialCycleSoftware,readFinancialCycleProgress} from './prepare-financial-cycle.mjs';
import {normalFile,readJSONSnapshot,atomicJSON,sha256,canonical} from './operational-files.mjs';

const hash=/^[a-f0-9]{64}$/,RESERVE=34n*1024n**3n;
const code=()=>sha256(readFileSync(fileURLToPath(import.meta.url)));
const jstDate=time=>new Date(time+9*3600000).toISOString().slice(0,10);
function space(directory,additional=0n){for(const path of [directory,tmpdir()]){const s=statfsSync(path,{bigint:true});if(s.bavail*s.bsize<RESERVE+additional)throw Error('Reconstruction disk reserve')}}

/** 候補とmetadataの排他を呼出元が保持します。原本の取得時刻を保って別候補へ再構築します。 */
export async function reconstructAcquiredFinancialCycle(config,{signal,maxObservationPages=100,maxSourcePages=100,onCheckpoint=()=>{}}={}){
    if(!config||typeof config.outputDirectory!=='string'||!isAbsolute(config.outputDirectory)||resolve(config.outputDirectory)!==config.outputDirectory
        ||signal!==undefined&&!(signal instanceof AbortSignal)||typeof onCheckpoint!=='function'||![maxObservationPages,maxSourcePages].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1000))throw Error('Invalid financial reconstruction input');
    const directory=config.outputDirectory,pinned=readJSONSnapshot(join(directory,'input.json')).value,input=normalizeFinancialSourceJobInput(config.input);input.cutoff=new Date(input.cutoff).toISOString();
    const expected={...config,input,availableBy:new Date(config.availableBy).toISOString()};
    if(pinned?.version!==1||!hash.test(pinned.inputSha256)||sha256(canonical(pinned.recipe))!==pinned.inputSha256
        ||canonical(Object.fromEntries(Object.keys(expected).map(k=>[k,pinned.recipe[k]])))!==canonical(expected)
        ||canonical(pinned.recipe.software)!==canonical(financialCycleSoftware()))throw Error('Reconstruction input or software differs');
    const prepared=readFinancialCycleProgress(join(directory,'preparation.json'),pinned.inputSha256).receipt;
    const acquisition=readJSONSnapshot(join(directory,'acquisition.json')),acquired=acquisition.value?.body?.receipt;
    if(acquisition.value?.version!==1||acquisition.value.inputSha256!==pinned.inputSha256||sha256(canonical([pinned.inputSha256,acquisition.value.body]))!==acquisition.value.sha256
        ||prepared?.status!=='prepared'||acquired?.status!=='acquired'||acquired.inputSha256!==pinned.inputSha256||acquired.planSha256!==prepared.planSha256
        ||acquired.archivePath!==join(directory,'archive.sqlite')||acquired.statePath!==join(directory,'source-job.sqlite')||!hash.test(acquired.archiveSha256)
        ||acquired.sourceAudit?.finished!==true||acquired.sourceAudit.planSha256!==prepared.planSha256||acquired.sourceAudit.archiveSha256!==acquired.archiveSha256||!hash.test(acquired.sourceAudit.stateSha256)
        ||typeof acquired.completedAt!=='string'||!Number.isFinite(Date.parse(acquired.completedAt))||Date.parse(acquired.completedAt)>Date.now()||Date.parse(acquired.completedAt)<Date.parse(input.cutoff))throw Error('Financial source acquisition is not complete');
    const id='reconstructed-'+pinned.inputSha256.slice(0,24),canonicalDirectory=join(directory,'reconstructed'),manifestPath=join(directory,'reconstruction-input.json'),receiptPath=join(directory,'reconstruction.json');
    const finalConfig={version:1,metadataPath:config.metadataPath,sourceId:config.sourceId,throughSequence:config.throughSequence,sourceArchivePath:acquired.archivePath,
        sourceArchiveSha256:acquired.archiveSha256,availableBy:acquired.completedAt,outputDirectory:canonicalDirectory,input:{...input,id,cutoff:acquired.completedAt}};
    const recipe={version:1,sourceInputSha256:pinned.inputSha256,sourceAcquisitionSha256:acquisition.sha256,operationsSha256:code(),config:finalConfig,
        ...(pinned.recipe.origin?{metadataOrigin:pinned.recipe.origin}:{})};
    const inputSha256=sha256(canonical(recipe));
    if(signal?.aborted)return {status:'aborted',inputSha256};
    if(existsSync(manifestPath)){const old=readJSONSnapshot(manifestPath).value;if(old.version!==1||old.inputSha256!==inputSha256||canonical(old.recipe)!==canonical(recipe))throw Error('Reconstruction recipe differs')}
    else atomicJSON(manifestPath,{version:1,inputSha256,recipe},{createOnly:true});
    const statePath=normalFile(acquired.statePath),archivePath=join(canonicalDirectory,'archive.sqlite');
    let receipt;
    if(existsSync(receiptPath)){
        const saved=readJSONSnapshot(receiptPath).value;receipt=saved?.body;
        if(saved?.version!==1||saved.inputSha256!==inputSha256||sha256(canonical([inputSha256,receipt]))!==saved.sha256||receipt?.status!=='reconstructed'
            ||receipt.archivePath!==archivePath||!hash.test(receipt.archiveSha256)||receipt.sourcePlanSha256!==acquired.planSha256)throw Error('Reconstruction receipt differs');
    }else{
        const result=await prepareFinancialCycle(finalConfig,{signal,maxObservationPages,maxSourcePages,onCheckpoint});
        if(result.status!=='prepared')return {...result,phase:'financial-reconstruction',reconstructionInputSha256:inputSha256};
        if(result.pendingSources)throw Error('Reconstructed selected sources are incomplete');
        receipt={status:'reconstructed',inputSha256,archivePath,archiveSha256:result.preparationArchiveSha256,sourcePlanSha256:acquired.planSha256,
            metadataThroughSequence:config.throughSequence,selectionCutoff:input.cutoff,cutoff:acquired.completedAt,population:input.population.edinetCodes.length,
            ...(pinned.recipe.origin?{metadataThroughDate:pinned.recipe.origin.throughDate}:{}),
            metadataCurrentForCutoff:pinned.recipe.origin?.throughDate===new Date(Date.parse(jstDate(Date.parse(acquired.completedAt)))-86400000).toISOString().slice(0,10),
            buildInput:{id,generation:id,archiveSha256:result.preparationArchiveSha256,population:input.population,options:{cutoff:acquired.completedAt,extractorVersion:'daily-default-1'}},
            reconstructedAt:new Date().toISOString(),nextStage:'financial-build',financialValuesValidated:false};
    }
    space(directory,BigInt(statSync(normalFile(archivePath)).size)+BigInt(statSync(statePath).size));
    const archive=new ObservedFinancialArchive(archivePath,{readOnly:true});let auditor;
    try{
        auditor=new FinancialSourceJob(statePath,{readOnly:true});
        const audit=auditor.audit(input.id,archive,{planSha256:acquired.planSha256,archiveSha256:receipt.archiveSha256});
        if(audit.stateSha256!==acquired.sourceAudit.stateSha256)throw Error('Source history changed during reconstruction');
        if(receipt.sourceAudit){if(canonical(receipt.sourceAudit)!==canonical(audit))throw Error('Reconstruction source audit differs');return {...receipt,reused:true}}
        receipt.sourceAudit=audit;
        atomicJSON(receiptPath,{version:1,inputSha256,body:receipt,sha256:sha256(canonical([inputSha256,receipt]))},{createOnly:true});await onCheckpoint({receipt:structuredClone(receipt)});
        return receipt;
    }finally{auditor?.close();archive.close()}
}
