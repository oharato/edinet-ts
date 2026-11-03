import {parseArgs} from 'node:util';
import {spawn} from 'node:child_process';
import {resolve,join,isAbsolute,dirname} from 'node:path';
import {lstatSync,realpathSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {normalFile,readJSONSnapshot} from './operational-files.mjs';
import {verifyAcquiredDuckFinancialCycle,activateAcquiredDuckFinancialCycle} from './acquired-duck-financial-publication.mjs';
import {buildReconstructedDuckFinancialCycle} from './build-duck-financial-cycle.mjs';

async function main(){
 const {values}=parseArgs({options:{config:{type:'string'},'parsed-store':{type:'string'},'source-commit':{type:'string'},'max-documents':{type:'string',default:'20'},'max-companies':{type:'string',default:'20'},'max-batches':{type:'string',default:'1'},verify:{type:'boolean'},publish:{type:'boolean'},catalog:{type:'string'},'expected-active':{type:'string'},locked:{type:'boolean'},'config-sha256':{type:'string'}},allowPositionals:false});
 if(!values.config||!values['parsed-store']||!/^[a-f0-9]{40}$/.test(values['source-commit']??'')||!['max-documents','max-companies','max-batches'].every(key=>/^[1-9]\d*$/.test(values[key])&&Number(values[key])<=100))throw Error('Invalid acquired DuckDB command');
 if(values.verify&&values.publish||(values.publish?(!values.catalog||values['expected-active']===undefined):values.catalog!==undefined||values['expected-active']!==undefined))throw Error('Invalid publication mode');
 const file=normalFile(resolve(values.config)),snapshot=readJSONSnapshot(file),config=snapshot.value,parsedStorePath=resolve(values['parsed-store']);
 if(typeof config.outputDirectory!=='string'||!isAbsolute(config.outputDirectory)||resolve(config.outputDirectory)!==config.outputDirectory||realpathSync(config.outputDirectory)!==config.outputDirectory||realpathSync(dirname(parsedStorePath))!==dirname(parsedStorePath))throw Error('Invalid DuckDB lock paths');
 if(!values.locked){
  if(values['config-sha256']!==undefined)throw Error('Unexpected lock binding');
  const locks=[config.outputDirectory+'.lock'];
  if(config.metadataCheckpointPath!==undefined){if(typeof config.metadataCheckpointPath!=='string'||!isAbsolute(config.metadataCheckpointPath)||resolve(config.metadataCheckpointPath)!==config.metadataCheckpointPath)throw Error('Invalid metadata lock');locks.push(config.metadataCheckpointPath+'.lock')}
  locks.push(join(config.outputDirectory,'duckdb.lock'),parsedStorePath+'.lock');
  if(values.publish)locks.push(resolve(values.catalog)+'.lock');
  if(new Set(locks).size!==locks.length)throw Error('Duplicate lock');
  for(const lock of locks){if(realpathSync(dirname(lock))!==dirname(lock))throw Error('Noncanonical lock parent');try{const s=lstatSync(lock);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('Invalid lock file')}catch(error){if(error.code!=='ENOENT')throw error}}
  const args=locks.flatMap(lock=>['--no-fork','-n','-E','75',lock,'/usr/bin/flock']);args.pop();
  args.push(process.execPath,fileURLToPath(import.meta.url),'--config',file,'--parsed-store',parsedStorePath,'--source-commit',values['source-commit'],'--max-documents',values['max-documents'],'--max-companies',values['max-companies'],'--max-batches',values['max-batches'],'--locked','--config-sha256',snapshot.sha256,...values.verify?['--verify']:[],...values.publish?['--publish','--catalog',resolve(values.catalog),'--expected-active',values['expected-active']]:[]);
  const child=spawn('/usr/bin/flock',args,{stdio:'inherit'}),onInt=()=>child.kill('SIGINT'),onTerm=()=>child.kill('SIGTERM');process.on('SIGINT',onInt);process.on('SIGTERM',onTerm);
  try{process.exitCode=await new Promise((done,reject)=>{child.once('error',reject);child.once('close',code=>done(code??1))})}finally{process.off('SIGINT',onInt);process.off('SIGTERM',onTerm)}return;
 }
 if(values['config-sha256']!==snapshot.sha256)throw Error('Configuration changed before lock');
 const controller=new AbortController(),stop=()=>controller.abort();process.on('SIGINT',stop);process.on('SIGTERM',stop);
 try{const options={parsedStorePath,sourceCommit:values['source-commit'],maxDocuments:Number(values['max-documents']),maxCompanies:Number(values['max-companies']),maxBatches:Number(values['max-batches']),signal:controller.signal},result=values.publish?await activateAcquiredDuckFinancialCycle(config,{...options,catalogPath:resolve(values.catalog),expectedActive:values['expected-active']==='null'?null:values['expected-active']}):values.verify?await verifyAcquiredDuckFinancialCycle(config,options):await buildReconstructedDuckFinancialCycle(config,options);console.log(JSON.stringify(result));if(result.status==='aborted')process.exitCode=2;else if(result.status==='publication-blocked'||result.status==='verification-blocked')process.exitCode=1}finally{process.off('SIGINT',stop);process.off('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{console.error('取得完了記録・固定入力・排他・容量・SDKを確認してください（入力内容は非表示）');process.exitCode=error?.name==='AbortError'?2:1});
