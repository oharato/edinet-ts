import {resolve,isAbsolute} from 'node:path';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {FinancialIndexBuild,FinancialSearchIndex,ObservedFinancialArchive,verifyFinancialVersionContext} from '../../dist/index.js';

import {captureFinancialVersionEvidenceBundle} from '../../dist/financial-version-selection.js';

/** 呼出元は全バッチ終了まで候補の排他と容量・入力指紋の検査を維持します。 */
export async function withFinancialBuildSession({archivePath,statePath,indexPath,input,financialVersion},useSession){
    const paths=[archivePath,statePath,indexPath];
    if(paths.some(path=>typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)||new Set(paths).size!==paths.length||typeof useSession!=='function')throw Error('Invalid financial build session');
    const fixedInput=structuredClone(input);
    let binding;
    const pin=fixedInput.options?.financialVersion;
    if(pin){
        if(!financialVersion||typeof financialVersion!=='object'||Array.isArray(financialVersion)||Object.keys(financialVersion).some(k=>!['context','bundle'].includes(k)))throw Error('Financial version runtime evidence is required');
        binding={context:financialVersion.context,bundle:captureFinancialVersionEvidenceBundle(financialVersion.bundle)};
        const proof=verifyFinancialVersionContext(binding.context,binding.bundle);
        if(proof.policy!==pin.policy||proof.evidenceManifestSha256!==pin.evidenceManifestSha256||proof.sha256!==pin.proofSha256||proof.cutoff!==fixedInput.options.cutoff)throw Error('Financial version proof differs from build input');
    }else if(financialVersion!==undefined)throw Error('Unexpected financial version runtime for metadata-only build');
    let archive,state,index;
    try{
        archive=new ObservedFinancialArchive(archivePath,{readOnly:true});
        if(archive.snapshotSha256()!==fixedInput.archiveSha256)throw Error('Financial build archive differs');
        state=new FinancialIndexBuild(statePath);index=new FinancialSearchIndex(indexPath);
        state.begin(fixedInput);
        const runBatch=async({signal,maxCompanies=20}={})=>{
            if(!Number.isSafeInteger(maxCompanies)||maxCompanies<1||maxCompanies>100||signal!==undefined&&!(signal instanceof AbortSignal))throw Error('Invalid financial build batch');
            let progress=state.progress(fixedInput.id);
            for(let count=0;count<maxCompanies&&(progress.pending||progress.failed);count++){
                if(signal?.aborted)return {status:'aborted',progress};
                progress=state.runNext(fixedInput.id,archive,index,{limit:1,...binding?{financialVersion:binding}:{}});
                await yieldTurn();
            }
            return {status:signal?.aborted?'aborted':progress.pending||progress.failed?'partial':'complete',progress};
        };
        return await useSession({archive,state,index,runBatch});
    }finally{index?.close();state?.close();archive?.close()}
}
