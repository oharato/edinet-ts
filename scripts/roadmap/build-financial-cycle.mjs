import {readFileSync,existsSync,statSync,statfsSync} from 'node:fs';
import {join,isAbsolute,resolve} from 'node:path';
import {isFinancialIndexGenerationId} from '../../dist/db/financial-search-index.js';
import {tmpdir} from 'node:os';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {FinancialIndexBuild,FinancialSearchIndex,FinancialIndexPublication,ObservedFinancialArchive} from '../../dist/index.js';
import {reconstructAcquiredFinancialCycle} from './reconstruct-financial-cycle.mjs';
import {readJSONSnapshot,atomicJSON,sha256,canonical} from './operational-files.mjs';

/** 呼出元が候補の排他を保持します。品質の集計は公開承認とは別です。 */
export async function buildReconstructedFinancialCycle(config,{signal,maxCompanies=20}={}){
    if(!Number.isSafeInteger(maxCompanies)||maxCompanies<1||maxCompanies>100||signal!==undefined&&!(signal instanceof AbortSignal))throw Error('Invalid financial build options');
    const reconstructed=await reconstructAcquiredFinancialCycle(config,{signal});
    if(reconstructed.status!=='reconstructed')return reconstructed;
    if(signal?.aborted)return {status:'aborted'};
    const directory=join(config.outputDirectory,'reconstructed'),recipe={version:1,reconstructionSha256:readJSONSnapshot(join(config.outputDirectory,'reconstruction.json')).sha256,
        operationsSha256:sha256(readFileSync(fileURLToPath(import.meta.url))),input:reconstructed.buildInput};
    const inputSha256=sha256(canonical(recipe)),manifest=join(directory,'build-input.json');
    if(existsSync(manifest)){const old=readJSONSnapshot(manifest).value;if(old.inputSha256!==inputSha256||canonical(old.recipe)!==canonical(recipe))throw Error('Financial build recipe differs')}
    else atomicJSON(manifest,{version:1,inputSha256,recipe},{createOnly:true});
    const receiptPath=join(directory,'build.json');
    let saved;
    if(existsSync(receiptPath)){
        saved=readJSONSnapshot(receiptPath).value;
        if(saved.version!==1||saved.inputSha256!==inputSha256||saved.body?.status!=='built'||saved.sha256!==sha256(canonical([inputSha256,saved.body])))throw Error('Financial build receipt is invalid');
    }
    const reserve=34n*1024n**3n+BigInt(statSync(reconstructed.archivePath).size);
    for(const path of [directory,tmpdir()]){const space=statfsSync(path,{bigint:true});if(space.bavail*space.bsize<reserve)throw Error('Financial build disk reserve')}
    let archive,state,index,publication;
    try{
        archive=new ObservedFinancialArchive(reconstructed.archivePath,{readOnly:true});
        if(archive.snapshotSha256()!==recipe.input.archiveSha256)throw Error('Financial build archive differs');
        state=new FinancialIndexBuild(join(directory,'build.sqlite'));index=new FinancialSearchIndex(join(directory,'index.sqlite'));
        state.begin(recipe.input);
        let progress=state.progress(recipe.input.id);
        for(let count=0;count<maxCompanies&&(progress.pending||progress.failed);count++){
            if(signal?.aborted)return {status:'aborted',phase:'financial-build',inputSha256,completed:progress.completed};
            progress=state.runNext(recipe.input.id,archive,index,{limit:1});
            await yieldTurn();
        }
        if(signal?.aborted)return {status:'aborted',phase:'financial-build',inputSha256,completed:progress.completed};
        if(progress.pending||progress.failed)return {status:'partial',phase:'financial-build',inputSha256,completed:progress.completed,pending:progress.pending,failed:progress.failed};
        state.finish(recipe.input.id,index);
        publication=new FinancialIndexPublication(join(directory,'publication.sqlite'));
        const candidate=publication.prepare(recipe.input.generation,index,recipe.input.generation);
        const publicationBlockers=[...(!candidate.eligible?['quality-conditions']:[]),...(reconstructed.metadataCurrentForCutoff!==true?['metadata-not-current']:[])];
        const quality=candidate.quality,receipt={status:'built',inputSha256,generation:recipe.input.generation,indexPath:join(directory,'index.sqlite'),quality,
            metadataCurrentForCutoff:reconstructed.metadataCurrentForCutoff,publicationCandidate:candidate,publicationEligible:publicationBlockers.length===0,publicationBlockers,financialValuesValidated:false,nextStage:'financial-quality'};
        if(saved){if(canonical(saved.body)!==canonical(receipt))throw Error('Financial build result differs')}
        else atomicJSON(receiptPath,{version:1,inputSha256,body:receipt,sha256:sha256(canonical([inputSha256,receipt]))},{createOnly:true});
        return receipt;
    }finally{publication?.close();index?.close();state?.close();archive?.close()}
}

/** catalogの排他を呼出元が保持し、直前の公開候補を明示します。 */
export async function activateBuiltFinancialCycle(config,{catalogPath,expectedActive,signal,maxCompanies=20}={}){
    if(typeof catalogPath!=='string'||!isAbsolute(catalogPath)||catalogPath!==resolve(catalogPath)||expectedActive!==null&&!isFinancialIndexGenerationId(expectedActive))throw Error('Invalid financial publication target');
    const built=await buildReconstructedFinancialCycle(config,{signal,maxCompanies});
    if(built.status!=='built')return built;
    if(!built.publicationEligible)return {...built,status:'publication-blocked'};
    if(signal?.aborted)return {status:'aborted',phase:'financial-publication'};
    const index=new FinancialSearchIndex(built.indexPath,{readOnly:true});let catalog;
    try{
        catalog=new FinancialIndexPublication(catalogPath);
        const candidate=catalog.prepare(built.generation,index,built.generation);
        if(canonical(candidate)!==canonical(built.publicationCandidate))throw Error('Publication candidate differs from built quality');
        catalog.activate(candidate.id,index,{expectedActive});
        return {...built,status:'published',catalogPath,publication:candidate.id,nextStage:'financial-reader-reload'};
    }finally{catalog?.close();index.close()}
}
