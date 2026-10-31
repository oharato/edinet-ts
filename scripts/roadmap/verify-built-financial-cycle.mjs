import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {normalFile,readJSONSnapshot} from './operational-files.mjs';
import {verifyBuiltFinancialCycleValues} from './build-financial-cycle.mjs';

async function main(){
    const {values}=parseArgs({options:{config:{type:'string'},locked:{type:'boolean'}},allowPositionals:false});
    if(values.locked!==true||typeof values.config!=='string'||!values.config.trim())throw Error('Locked candidate configuration required');
    const config=readJSONSnapshot(normalFile(resolve(values.config))).value;
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{
        const result=await verifyBuiltFinancialCycleValues(config,{signal:controller.signal});
        console.log(JSON.stringify(result));if(result.status!=='built')process.exitCode=1;
    }finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Financial source verification stopped (details hidden).');process.exitCode=1});
