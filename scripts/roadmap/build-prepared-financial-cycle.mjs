import {parseArgs} from 'node:util';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalFile,readJSONSnapshot} from './operational-files.mjs';
import {buildReconstructedFinancialCycle} from './build-financial-cycle.mjs';

// 呼出元が候補とmetadataの排他を保持し、再構築済みの固定入力だけを渡します。
async function main(){
    const {values}=parseArgs({options:{config:{type:'string'},'max-companies':{type:'string',default:'100'},'max-batches':{type:'string',default:'1'},locked:{type:'boolean'}},allowPositionals:false});
    const maxCompanies=Number(values['max-companies']),maxBatches=Number(values['max-batches']);
    if(!values.locked||typeof values.config!=='string'||!values.config.trim()||![maxCompanies,maxBatches].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=100))throw Error('Invalid prepared financial build arguments');
    const config=readJSONSnapshot(normalFile(resolve(values.config))).value;
    normalFile(join(config.outputDirectory,'reconstruction.json'));
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{
        const result=await buildReconstructedFinancialCycle(config,{signal:controller.signal,maxCompanies,maxBatches});
        console.log(JSON.stringify(result));if(result.status==='aborted')process.exitCode=1;
    }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Prepared financial build stopped (details hidden).');process.exitCode=1});
