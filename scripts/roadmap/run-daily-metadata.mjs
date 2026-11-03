import {readFileSync,writeFileSync,openSync,closeSync,fsyncSync,renameSync,unlinkSync,lstatSync,realpathSync,statfsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {config as loadEnv} from 'dotenv';
import {EdinetRepository} from '../../dist/db/edinet-repository.js';
import {EdinetXbrlDownloader} from '../../dist/index.js';
import {collectDailyMetadata,canStartDailyMetadata} from './daily-metadata-control.mjs';

const sha = file => createHash('sha256').update(readFileSync(file)).digest('hex');
const normalFile = file => {const st=lstatSync(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error();return realpathSync(file)};
const readJSON = file => JSON.parse(readFileSync(normalFile(file),'utf8'));
function atomicJSON(file,value){
    normalFile(file);
    const temporary=file+'.'+randomUUID()+'.tmp';let fd;
    try{fd=openSync(temporary,'wx',0o600);writeFileSync(fd,JSON.stringify(value,null,2)+'\n');fsyncSync(fd);closeSync(fd);fd=undefined;renameSync(temporary,file);const parent=openSync(dirname(file),'r');try{fsyncSync(parent)}finally{closeSync(parent)}}
    finally{if(fd!==undefined)closeSync(fd);try{unlinkSync(temporary)}catch(error){if(error.code!=='ENOENT')throw error}}
}
async function main(){
    if(process.argv.length<3||process.argv.length>4||process.argv[3]!==undefined&&process.argv[3]!=='--locked')throw Error();
    const configPath=normalFile(resolve(process.argv[2])),settings=readJSON(configPath);
    const fields=['version','metadataPath','checkpointPath','envPath','guardSummaryPath','guardUnit','guardPlanSha256','guardWorkerSha256','seedPath','seedSha256','sourceId'];
    if(!settings||typeof settings!=='object'||Array.isArray(settings)||Object.keys(settings).length!==fields.length||Object.keys(settings).some(k=>!fields.includes(k))||settings.version!==1)throw Error();
    for(const key of ['metadataPath','checkpointPath','envPath','guardSummaryPath','seedPath'])if(typeof settings[key]!=='string'||!settings[key].startsWith('/')||resolve(settings[key])!==settings[key])throw Error();
    if(new Set(['metadataPath','checkpointPath','envPath','guardSummaryPath','seedPath'].map(k=>settings[k])).size!==5)throw Error();
    if(!/^edinet-roadmap-[a-z0-9-]+\.service$/.test(settings.guardUnit)||!['guardPlanSha256','guardWorkerSha256','seedSha256'].every(k=>/^[a-f0-9]{64}$/.test(settings[k]))||!/^[A-Za-z0-9_.-]{1,64}$/.test(settings.sourceId))throw Error();
    if(!process.argv[3]){
        const locked=spawnSync('/usr/bin/flock',['-n','-E','75','--close',settings.checkpointPath+'.lock',process.execPath,fileURLToPath(import.meta.url),configPath,'--locked'],{stdio:'inherit'});
        if(locked.error)throw Error();process.exitCode=locked.status??1;return;
    }
    // 既存の有限取得とAPI要求を競合させず、固定計画の完了後だけ起動します。
    const unit=execFileSync('/usr/bin/systemctl',['--user','show',settings.guardUnit,'--property=ActiveState','--value'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
    const summary=readJSON(settings.guardSummaryPath);
    if(!canStartDailyMetadata(summary,unit,{planSha256:settings.guardPlanSha256,workerSha256:settings.guardWorkerSha256})){console.log(JSON.stringify({status:'waiting-for-fixed-acquisition'}));return;}
    const metadata=normalFile(settings.metadataPath),seed=normalFile(settings.seedPath);
    if(metadata===seed||sha(seed)!==settings.seedSha256)throw Error();
    const envelope=readJSON(settings.checkpointPath);
    if(!envelope||envelope.version!==1||envelope.metadataPath!==metadata||envelope.seedSha256!==settings.seedSha256||envelope.sourceId!==settings.sourceId)throw Error();
    // fork前の全観測が残っていることを確認してから新規観測を追加します。
    const original=new EdinetRepository(seed,{readOnly:true}),target=new EdinetRepository(metadata,{readOnly:true});
    try{let cursor=0;const end=original.getLastObservationSequence();while(cursor<end){const page=original.getDocumentObservations({afterSequence:cursor,limit:1000});if(!page.length)throw Error();const existing=target.getDocumentObservations({afterSequence:cursor,limit:page.length});if(JSON.stringify(page)!==JSON.stringify(existing))throw Error();cursor=page.at(-1).sequence}}finally{original.close();target.close()}
    const free=()=>{const s=statfsSync(dirname(metadata),{bigint:true});return s.bavail*s.bsize};
    if(free()<34n*1024n**3n)throw Error();
    loadEnv({path:settings.envPath,quiet:true});if(!process.env.EDINET_API_KEY)throw Error();
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    const repository=new EdinetRepository(metadata),client=new EdinetXbrlDownloader({requestTimeoutMs:60000,maxRetries:0});
    try{
        const result=await collectDailyMetadata(repository,(date,request)=>{if(free()<34n*1024n**3n)throw Error();return client.search(date,undefined,request)},envelope.checkpoint,
            checkpoint=>atomicJSON(settings.checkpointPath,{...envelope,checkpoint}),{signal:controller.signal});
        console.log(JSON.stringify({...result,sourceId:settings.sourceId,requests:envelope.checkpoint.budget.requests}));
        if(['probe-failed','fetch-failed','aborted'].includes(result.status))process.exitCode=1;
    }finally{repository.close();process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
main().catch(()=>{console.error('Daily metadata collection stopped; check pinned inputs, checkpoint, storage and provider readiness (details hidden).');process.exitCode=1});
