import {readFileSync,existsSync,statSync,statfsSync} from 'node:fs';
import {join,isAbsolute,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {FinancialSourceJob,ObservedFinancialArchive} from '../../dist/index.js';
import {normalizeFinancialSourceJobInput} from '../../dist/db/financial-source-job.js';
import {financialCycleSoftware,readFinancialCycleProgress} from './prepare-financial-cycle.mjs';
import {selectSourceBatch,countStalledBatches,withSourceDiskReserve,ACQUISITION_RESERVE_BYTES,ACQUISITION_MARGIN_BYTES} from './acquisition-batch-control.mjs';
import {normalFile,readJSONSnapshot,atomicJSON,canonical,sha256} from './operational-files.mjs';

const RESERVE=ACQUISITION_RESERVE_BYTES+ACQUISITION_MARGIN_BYTES,hash=/^[a-f0-9]{64}$/;
const own=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>keys.includes(k));
const operations=()=>sha256(canonical(['acquire-financial-cycle.mjs','acquisition-batch-control.mjs'].map(p=>[p,sha256(readFileSync(fileURLToPath(new URL('./'+p,import.meta.url))))])));

/** 呼出元が候補とmetadata通信の排他を保持します。1回は既定で最大100書類です。 */
export async function acquirePreparedFinancialCycle(config,{signal,fetchXbrl,createFetchXbrl,maxBatches=1,free,onCheckpoint=()=>{}}={}){
    if(!config||typeof config.outputDirectory!=='string'||!isAbsolute(config.outputDirectory)||resolve(config.outputDirectory)!==config.outputDirectory
        ||!Number.isSafeInteger(maxBatches)||maxBatches<1||maxBatches>100||signal!==undefined&&!(signal instanceof AbortSignal)
        ||fetchXbrl!==undefined&&typeof fetchXbrl!=='function'||createFetchXbrl!==undefined&&typeof createFetchXbrl!=='function'||typeof onCheckpoint!=='function'||free!==undefined&&typeof free!=='function')throw Error('Invalid financial acquisition input');
    const directory=config.outputDirectory,inputPath=join(directory,'input.json'),progressPath=join(directory,'preparation.json'),statePath=join(directory,'source-job.sqlite'),archivePath=join(directory,'archive.sqlite'),checkpointPath=join(directory,'acquisition.json');
    const pinned=readJSONSnapshot(inputPath).value,input=normalizeFinancialSourceJobInput(config.input);
    input.cutoff=new Date(input.cutoff).toISOString();
    const expected={...config,input,availableBy:new Date(config.availableBy).toISOString()};
    if(pinned?.version!==1||!hash.test(pinned.inputSha256)||sha256(canonical(pinned.recipe))!==pinned.inputSha256
        ||canonical(Object.fromEntries(Object.keys(expected).map(k=>[k,pinned.recipe[k]])))!==canonical(expected)
        ||canonical(pinned.recipe.software)!==canonical(financialCycleSoftware()))throw Error('Financial acquisition recipe or software differs');
    const prepared=readFinancialCycleProgress(progressPath,pinned.inputSha256),receipt=prepared.receipt;
    if(!prepared.sourcesComplete||prepared.metadataCursor!==config.throughSequence||receipt?.status!=='prepared'||receipt.inputSha256!==pinned.inputSha256
        ||receipt.archivePath!==archivePath||receipt.statePath!==statePath||!hash.test(receipt.planSha256)||!hash.test(receipt.preparationArchiveSha256))throw Error('Financial acquisition is not prepared');
    normalFile(statePath);normalFile(archivePath);
    const codeSha256=operations(),inputSha256=pinned.inputSha256;
    let checkpoint;
    if(existsSync(checkpointPath)){
        const stored=readJSONSnapshot(checkpointPath).value;checkpoint=stored?.body;
        if(!own(stored,['version','inputSha256','body','sha256'])||stored.version!==1||stored.inputSha256!==inputSha256||sha256(canonical([inputSha256,checkpoint]))!==stored.sha256
            ||!own(checkpoint,['planSha256','operationsSha256','stalledBatches','completedBatches','activeBatch','receipt'])||checkpoint.planSha256!==receipt.planSha256||checkpoint.operationsSha256!==codeSha256
            ||!Number.isSafeInteger(checkpoint.stalledBatches)||checkpoint.stalledBatches<0||checkpoint.stalledBatches>5||!Number.isSafeInteger(checkpoint.completedBatches)||checkpoint.completedBatches<0
            ||checkpoint.activeBatch!==undefined&&(checkpoint.stalledBatches===5||!Array.isArray(checkpoint.activeBatch)||!checkpoint.activeBatch.length||checkpoint.activeBatch.length>100
                ||new Set(checkpoint.activeBatch.map(t=>t.docID)).size!==checkpoint.activeBatch.length||checkpoint.activeBatch.some(t=>!own(t,['docID','status','attempts'])||typeof t.docID!=='string'||t.docID.length>256
                    ||!['pending','running','failed'].includes(t.status)||!Number.isSafeInteger(t.attempts)||t.attempts<0||t.attempts>=3)))throw Error('Financial acquisition checkpoint differs');
    }else{
        checkpoint={planSha256:receipt.planSha256,operationsSha256:codeSha256,stalledBatches:0,completedBatches:0};
        atomicJSON(checkpointPath,{version:1,inputSha256,body:checkpoint,sha256:sha256(canonical([inputSha256,checkpoint]))},{createOnly:true});
    }
    const save=async()=>{atomicJSON(checkpointPath,{version:1,inputSha256,body:checkpoint,sha256:sha256(canonical([inputSha256,checkpoint]))});await onCheckpoint(structuredClone(checkpoint))};
    free??=()=>[directory,tmpdir()].reduce((minimum,p)=>{const s=statfsSync(p,{bigint:true}),available=s.bavail*s.bsize;return available<minimum?available:minimum},2n**100n);
    const result=(status,p,reason)=>({status,inputSha256,planSha256:receipt.planSha256,archivePath,statePath,completed:p.completed,pending:p.pending,failed:p.failed,running:p.running,unavailable:p.unavailable,
        attempts:p.history.length,stalledBatches:checkpoint.stalledBatches,...(reason?{reason}:{}),financialValuesValidated:false});
    // writable openも形式検査用の私有コピーを作ります。
    if(free()<RESERVE+BigInt(statSync(archivePath).size)+BigInt(statSync(statePath).size))return {status:'acquisition-paused',reason:'disk-reserve',inputSha256,financialValuesValidated:false};
    const controller=new AbortController(),stop=()=>controller.abort();if(signal?.aborted)stop();else signal?.addEventListener('abort',stop,{once:true});
    let job,archive,p,lowSpace=false;
    try{
        job=new FinancialSourceJob(statePath);p=job.progress(input.id);
        if(p.planSha256!==receipt.planSha256||p.plan.archiveSha256!==receipt.preparationArchiveSha256)throw Error('Prepared source plan differs');
        if(checkpoint.receipt){
            if(checkpoint.activeBatch!==undefined||!p.finished||checkpoint.receipt.status!=='acquired'||checkpoint.receipt.inputSha256!==inputSha256||checkpoint.receipt.planSha256!==receipt.planSha256)throw Error('Acquisition receipt differs');
            job.close();job=undefined;
            const frozen=new ObservedFinancialArchive(archivePath,{readOnly:true});let auditor;
            try{auditor=new FinancialSourceJob(statePath,{readOnly:true});const audit=auditor.audit(input.id,frozen,{planSha256:receipt.planSha256,archiveSha256:checkpoint.receipt.archiveSha256});if(audit.stateSha256!==checkpoint.receipt.sourceAudit?.stateSha256)throw Error('Completed source state changed')}finally{auditor?.close();frozen.close()}
            return {...checkpoint.receipt,reused:true};
        }
        if(checkpoint.activeBatch){checkpoint.stalledBatches=countStalledBatches(checkpoint.activeBatch,p.tasks,checkpoint.stalledBatches);delete checkpoint.activeBatch;checkpoint.completedBatches++;await save()}
        if(controller.signal.aborted)return result('aborted',p);
        if(!p.finished)archive=new ObservedFinancialArchive(archivePath);
        for(let batch=0;!p.finished&&batch<maxBatches&&!controller.signal.aborted;batch++){
            if(checkpoint.stalledBatches===5)return result('acquisition-paused',p,'five-batches-without-progress');
            const selected=selectSourceBatch(p.tasks,checkpoint.stalledBatches);if(!selected.length)return result('acquisition-paused',p,'three-attempts-per-remaining-document');
            if(free()<RESERVE)return result('acquisition-paused',p,'disk-reserve');
            checkpoint.activeBatch=selected.map(({docID,status,attempts})=>({docID,status,attempts}));await save();
            if(controller.signal.aborted)break;
            const ids=new Set(selected.map(t=>t.docID)),codes=[...new Set(p.plan.documents.filter(d=>ids.has(d.docID)).map(d=>d.edinetCode))];
            const current=archive.planSourceAcquisition({cutoff:input.cutoff,edinetCodes:codes}).items.filter(d=>ids.has(d.docID));
            if(current.length!==selected.length)throw Error('Selected source availability differs');
            if(current.some(d=>d.status!=='stored')){fetchXbrl??=createFetchXbrl?.();if(typeof fetchXbrl!=='function')throw Error('A source acquisition provider is required')}
            const fetch=withSourceDiskReserve((docID,request)=>fetchXbrl(docID,request),free,controller,()=>{lowSpace=true});
            p=await job.runNext(input.id,archive,fetch,{limit:selected.length,signal:controller.signal});
            checkpoint.stalledBatches=countStalledBatches(checkpoint.activeBatch,p.tasks,checkpoint.stalledBatches);delete checkpoint.activeBatch;checkpoint.completedBatches++;await save();
        }
        archive?.close();archive=undefined;job.close();job=undefined;
        if(lowSpace)return result('acquisition-paused',p,'disk-reserve');
        if(controller.signal.aborted)return result('aborted',p);
        if(!p.finished){
            if(checkpoint.stalledBatches===5)return result('acquisition-paused',p,'five-batches-without-progress');
            if(!selectSourceBatch(p.tasks,checkpoint.stalledBatches).length)return result('acquisition-paused',p,'three-attempts-per-remaining-document');
            return result('acquiring',p);
        }
        if(free()<RESERVE+BigInt(statSync(archivePath).size)+BigInt(statSync(statePath).size))return result('acquisition-paused',p,'completion-audit-disk-reserve');
        const frozen=new ObservedFinancialArchive(archivePath,{readOnly:true});let auditor;
        try{auditor=new FinancialSourceJob(statePath,{readOnly:true});
            const completion=auditor.finish(input.id,frozen),sourceAudit=auditor.audit(input.id,frozen,{planSha256:receipt.planSha256,archiveSha256:completion.archiveSha256});
            checkpoint.receipt={...result('acquired',p),...completion,sourceAudit,completedAt:new Date().toISOString(),nextStage:'financial-reconstruction'};
            await save();return checkpoint.receipt;
        }finally{auditor?.close();frozen.close()}
    }finally{archive?.close();job?.close();signal?.removeEventListener('abort',stop)}
}
