import {parseArgs} from 'node:util';
import {resolve,join,isAbsolute} from 'node:path';
import {existsSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {config as loadEnv} from 'dotenv';
import {EdinetXbrlDownloader} from '../../dist/index.js';
import {normalFile,readJSONSnapshot} from './operational-files.mjs';
import {withOperationalLocks} from './with-operational-locks.mjs';
import {runDailyDuckFinancialCycle,dailyDuckFinancialDirectory} from './daily-duck-financial-cycle.mjs';

async function main(){
 const {values}=parseArgs({options:{config:{type:'string'},'parsed-store':{type:'string'},'source-commit':{type:'string'},'max-documents':{type:'string',default:'20'},'max-companies':{type:'string',default:'20'},'max-batches':{type:'string',default:'1'},'max-acquisition-batches':{type:'string',default:'1'}},allowPositionals:false});
 if(!values.config||!values['parsed-store']||!/^[a-f0-9]{40}$/.test(values['source-commit']??'')||!['max-documents','max-companies','max-batches','max-acquisition-batches'].every(k=>/^[1-9]\d*$/.test(values[k])&&Number(values[k])<=100))throw Error('Invalid daily DuckDB arguments');
 const file=normalFile(resolve(values.config)),snapshot=readJSONSnapshot(file),input=snapshot.value,metadata=readJSONSnapshot(normalFile(input.metadataConfigPath));
 for(const path of [input.outputDirectory,metadata.value.checkpointPath])if(typeof path!=='string'||!isAbsolute(path)||resolve(path)!==path)throw Error('Invalid daily DuckDB lock paths');
 const parsedStorePath=resolve(values['parsed-store']),controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{
  await withOperationalLocks([input.outputDirectory+'.lock',metadata.value.checkpointPath+'.lock'],async()=>{
   if(readJSONSnapshot(file).sha256!==snapshot.sha256||readJSONSnapshot(input.metadataConfigPath).sha256!==metadata.sha256)throw Error('Daily configuration changed before lock');
   const directory=dailyDuckFinancialDirectory(input),candidateAlreadyOwned=directory!==undefined&&existsSync(join(directory,'handoff.json'));
   const run=()=>runDailyDuckFinancialCycle(input,{signal:controller.signal,parsedStorePath,sourceCommit:values['source-commit'],maxDocuments:Number(values['max-documents']),maxCompanies:Number(values['max-companies']),maxBatches:Number(values['max-batches']),
    acquisitionOptions:{maxBatches:Number(values['max-acquisition-batches']),createFetchXbrl:()=>{
     normalFile(metadata.value.envPath);loadEnv({path:metadata.value.envPath,quiet:true});if(!process.env.EDINET_API_KEY)throw Error('Missing acquisition credentials');
     const client=new EdinetXbrlDownloader({rootDir:join(directory,'provider-cache'),requestTimeoutMs:60000,maxRetries:0});return (docID,request)=>client.fetchXbrl(docID,request);
    }},
    withBuildLocks:(config,work)=>withOperationalLocks([...candidateAlreadyOwned?[]:[config.outputDirectory+'.lock'],join(config.outputDirectory,'duckdb.lock'),parsedStorePath+'.lock'],work)
   });
   // Before the first handoff no standalone acquisition/build can use this candidate. On resume lock it before preparation too.
   const result=candidateAlreadyOwned?await withOperationalLocks([join(directory,'candidate.lock')],run):await run();
   console.log(JSON.stringify(result));if(result.status==='aborted')process.exitCode=2;
  });
 }finally{process.off('SIGINT',stop);process.off('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('日次完了記録・固定取得・provider設定・排他・容量・SDKを確認してください（入力内容は非表示）');process.exitCode=error?.exitCode===75?75:error?.name==='AbortError'?2:1});
