import {readFileSync,existsSync,mkdirSync,readdirSync,lstatSync,realpathSync,statSync,statfsSync} from 'node:fs';
import {resolve,dirname,isAbsolute,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {parseArgs} from 'node:util';
import {setImmediate as yieldTurn} from 'node:timers/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {EdinetRepository,ObservedFinancialArchive,FinancialSourceJob,archiveFinancialDocumentObservations} from '../../dist/index.js';
import {normalizeFinancialSourceJobInput} from '../../dist/db/financial-source-job.js';
import {parseDocumentTimestamp} from '../../dist/document-timestamp.js';
import {assertDailyNoticeState} from './daily-metadata-notices.mjs';
import {assertCompletedMetadataRun} from './daily-metadata-control.mjs';
import {canonical,sha256,normalFile,readJSONSnapshot,atomicJSON} from './operational-files.mjs';

const SDK_ROOT=fileURLToPath(new URL('../../',import.meta.url)),RESERVE=32n*1024n**3n,MARGIN=2n*1024n**3n;
const object=(v,fields)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>fields.includes(k));
const jstDate=ms=>new Date(ms+9*3600000).toISOString().slice(0,10);
const chain=(previous,id)=>sha256(previous+':'+id),EMPTY_CHAIN=sha256('financial-cycle-source-ids-v1');
export function financialCycleSoftware(){
    const paths=['package.json','README.md','LICENSE'];
    const visit=relative=>{for(const d of readdirSync(join(SDK_ROOT,relative),{withFileTypes:true}).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
        const p=relative+'/'+d.name;if(d.isDirectory())visit(p);else if(d.isFile())paths.push(p);else throw Error('SDK contains an unsupported file');
    }};visit('dist');
    const db=new DatabaseSync(':memory:');let sqliteVersion;try{sqliteVersion=db.prepare('SELECT sqlite_version() AS version').get().version}finally{db.close()}
    return {nodeVersion:process.version,sqliteVersion,sdkSha256:sha256(canonical(paths.sort().map(p=>[p,sha256(readFileSync(normalFile(join(SDK_ROOT,p))))]))),
        operationsSha256:sha256(canonical(['prepare-financial-cycle.mjs','operational-files.mjs','daily-metadata-notices.mjs','daily-metadata-control.mjs'].map(name=>[name,sha256(readFileSync(fileURLToPath(new URL('./'+name,import.meta.url))))])))};
}
function ensureSpace(directory,additional=0n){for(const path of new Set([directory,tmpdir()])){const s=statfsSync(path,{bigint:true});if(s.bavail*s.bsize<RESERVE+MARGIN+additional)throw Error('Financial cycle preparation disk reserve')}}
async function prefix(repository,throughSequence,cutoff,signal){
    const digest=createHash('sha256');let afterSequence=0,count=0;
    while(afterSequence<throughSequence){
        if(signal?.aborted)return;
        const rows=repository.getDocumentObservations({afterSequence,limit:1000}).filter(o=>o.sequence<=throughSequence);
        if(!rows.length)throw Error('Metadata prefix is missing');
        for(const o of rows){const observed=parseDocumentTimestamp(o.observedAt,true);if(observed===undefined||observed>cutoff||o.listDate>=jstDate(cutoff))throw Error('Metadata prefix exceeds the completed cutoff');digest.update(canonical(o)+'\n');count++}
        afterSequence=rows.at(-1).sequence;await yieldTurn();
    }
    return {sha256:digest.digest('hex'),count};
}
function origin(config,repository,input){
    if(config.metadataCheckpointPath===undefined)return;
    const snapshot=readJSONSnapshot(config.metadataCheckpointPath),envelope=snapshot.value,state=envelope?.checkpoint;
    if(envelope?.version!==1||envelope.metadataPath!==config.metadataPath||envelope.sourceId!==config.sourceId||state?.version!==3
        ||state.active!==undefined||state.completedDay!==jstDate(Date.parse(input.cutoff))
        ||state.throughDate!==new Date(Date.parse(state.completedDay)-86400000).toISOString().slice(0,10))throw Error('Daily metadata run is not complete');
    assertDailyNoticeState(state.notices,repository);
    assertCompletedMetadataRun(state.lastCompletedRun,config.throughSequence,state.throughDate);
    if(state.lastCompletedRun.throughSequence!==config.throughSequence||state.lastCompletedRun.probe.date!==state.completedDay
        ||Date.parse(state.lastCompletedRun.completedAt)>Date.parse(input.cutoff)||state.lastCompletedRun.unresolvedNotices!==state.notices.unresolved.length)throw Error('Daily metadata completion receipt differs');
    if(state.notices.afterSequence!==config.throughSequence||state.notices.pending.length)throw Error('Daily metadata notice cursor is incomplete');
    return {checkpointPath:config.metadataCheckpointPath,checkpointSha256:snapshot.sha256,checkpointText:snapshot.text,completedDay:state.completedDay,throughDate:state.throughDate,completedRun:structuredClone(state.lastCompletedRun),unresolvedNotices:state.notices.unresolved.length};
}
export function readFinancialCycleProgress(path,inputSha256){
    const envelope=readJSONSnapshot(path).value,p=envelope?.body;
    if(!object(envelope,['version','inputSha256','body','sha256'])||envelope.version!==1||envelope.inputSha256!==inputSha256||sha256(canonical([inputSha256,p]))!==envelope.sha256
        ||!object(p,['metadataCursor','sourcesComplete','afterSourceId','sourceCount','sourceChain','receipt'])||!Number.isSafeInteger(p.metadataCursor)||p.metadataCursor<0
        ||typeof p.sourcesComplete!=='boolean'||!Number.isSafeInteger(p.sourceCount)||p.sourceCount<0||!/^[a-f0-9]{64}$/.test(p.sourceChain)
        ||p.afterSourceId!==undefined&&!/^[a-f0-9]{64}$/.test(p.afterSourceId))throw Error('Financial cycle progress is invalid');
    return p;
}

/** 同一outputの排他は呼出元が取得します。通信/公開は行わず、固定入力から原本取得jobを準備します。 */
export async function prepareFinancialCycle(settings,{signal,maxObservationPages=100,maxSourcePages=100,onCheckpoint=()=>{}}={}){
    const config=structuredClone(settings);
    if(!object(config,['version','metadataPath','metadataCheckpointPath','sourceId','throughSequence','sourceArchivePath','sourceArchiveSha256','availableBy','outputDirectory','input'])||config.version!==1
        ||!/^[A-Za-z0-9_.-]{1,64}$/.test(config.sourceId)||!Number.isSafeInteger(config.throughSequence)||config.throughSequence<0||!/^[a-f0-9]{64}$/.test(config.sourceArchiveSha256)
        ||![maxObservationPages,maxSourcePages].every(n=>Number.isSafeInteger(n)&&n>=1&&n<=1000)||typeof onCheckpoint!=='function'||signal!==undefined&&!(signal instanceof AbortSignal))throw Error('Financial cycle input is invalid');
    for(const key of ['metadataPath','sourceArchivePath','outputDirectory',...(config.metadataCheckpointPath===undefined?[]:['metadataCheckpointPath'])])
        if(typeof config[key]!=='string'||!isAbsolute(config[key])||resolve(config[key])!==config[key])throw Error('Financial cycle requires absolute paths');
    const input=normalizeFinancialSourceJobInput(config.input),cutoff=parseDocumentTimestamp(input.cutoff,true),availableTime=parseDocumentTimestamp(config.availableBy,true);
    if(cutoff>Date.now()||availableTime===undefined||availableTime>cutoff)throw Error('Financial cycle timestamps are invalid');
    input.cutoff=new Date(cutoff).toISOString();config.availableBy=new Date(availableTime).toISOString();
    config.metadataPath=normalFile(config.metadataPath);config.sourceArchivePath=normalFile(config.sourceArchivePath);
    if(config.metadataPath===config.sourceArchivePath||[config.metadataPath,config.sourceArchivePath,config.metadataCheckpointPath].some(p=>p?.startsWith(config.outputDirectory+'/')))throw Error('Cycle output overlaps its inputs');
    if(signal?.aborted)return {status:'aborted'};
    const repository=new EdinetRepository(config.metadataPath,{readOnly:true});let pool,target;
    try{
        if(config.throughSequence>repository.getLastObservationSequence())throw Error('Metadata boundary exceeds the stored prefix');
        const directory=config.outputDirectory,inputPath=join(directory,'input.json'),progressPath=join(directory,'preparation.json'),archivePath=join(directory,'archive.sqlite'),statePath=join(directory,'source-job.sqlite');
        if(existsSync(directory)){const st=lstatSync(directory);if(!st.isDirectory()||st.isSymbolicLink()||realpathSync(directory)!==directory)throw Error('Cycle output must be a normal directory')}
        const prior=existsSync(inputPath)?readJSONSnapshot(inputPath).value:undefined;
        if(prior&&(prior.version!==1||sha256(canonical(prior.recipe))!==prior.inputSha256))throw Error('Financial cycle recipe integrity failed');
        const metadataOrigin=prior?.recipe?.origin??origin(config,repository,input),metadata=await prefix(repository,config.throughSequence,cutoff,signal);if(!metadata)return {status:'aborted'};
        const pinnedSoftware=financialCycleSoftware(),recipe={...config,input,metadataPrefix:metadata,software:pinnedSoftware,...(metadataOrigin?{origin:metadataOrigin}:{})},inputSha256=sha256(canonical(recipe));
        // 容量不足で固定入力だけが残り、次の実行条件を拘束することを避けます。
        if(!prior)ensureSpace(existsSync(directory)?directory:dirname(directory),2n*BigInt(statSync(config.metadataPath).size));
        if(!existsSync(directory))mkdirSync(directory,{mode:0o700});
        const directoryStat=lstatSync(directory);if(!directoryStat.isDirectory()||directoryStat.isSymbolicLink()||realpathSync(directory)!==directory)throw Error('Cycle output must be a normal directory');
        if(!existsSync(inputPath)){
            if(readdirSync(directory).some(name=>!/^input\.json\.[a-f0-9-]{36}\.tmp$/.test(name)))throw Error('Cycle directory is not empty or owned by this preparation');
            atomicJSON(inputPath,{version:1,inputSha256,recipe},{createOnly:true});
        }else{const stored=readJSONSnapshot(inputPath).value;if(stored.version!==1||stored.inputSha256!==inputSha256||canonical(stored.recipe)!==canonical(recipe))throw Error('Financial cycle recipe changed')}
        let progress;
        if(existsSync(progressPath))progress=readFinancialCycleProgress(progressPath,inputSha256);
        else{progress={metadataCursor:0,sourcesComplete:false,sourceCount:0,sourceChain:EMPTY_CHAIN};atomicJSON(progressPath,{version:1,inputSha256,body:progress,sha256:sha256(canonical([inputSha256,progress]))},{createOnly:true})}
        if(progress.metadataCursor>config.throughSequence||progress.sourcesComplete&&progress.metadataCursor!==config.throughSequence)throw Error('Financial cycle cursor is invalid');
        if(progress.receipt){if(!progress.sourcesComplete||progress.receipt.status!=='prepared'||progress.receipt.inputSha256!==inputSha256||progress.receipt.archivePath!==archivePath||progress.receipt.statePath!==statePath)throw Error('Preparation receipt is invalid');normalFile(archivePath);normalFile(statePath);const job=new FinancialSourceJob(statePath,{readOnly:true});try{const current=job.progress(input.id);if(current.planSha256!==progress.receipt.planSha256||current.plan.archiveSha256!==progress.receipt.preparationArchiveSha256)throw Error('Prepared source plan changed')}finally{job.close()}return {...progress.receipt,reused:true}}
        const save=async()=>{atomicJSON(progressPath,{version:1,inputSha256,body:progress,sha256:sha256(canonical([inputSha256,progress]))});await onCheckpoint(structuredClone(progress));await yieldTurn()};
        const remaining=2n*BigInt(statSync(config.metadataPath).size);
        ensureSpace(directory,remaining);
        target=new ObservedFinancialArchive(archivePath);
        for(let page=0;progress.metadataCursor<config.throughSequence&&page<maxObservationPages&&!signal?.aborted;page++){
            ensureSpace(directory);const transferred=archiveFinancialDocumentObservations(repository,target,{sourceId:config.sourceId,throughSequence:config.throughSequence,afterSequence:progress.metadataCursor,pageSize:1000,maxPages:1});progress.metadataCursor=transferred.nextAfterSequence;await save();
        }
        if(progress.metadataCursor===config.throughSequence&&!progress.sourcesComplete){ensureSpace(directory,remaining+2n*BigInt(statSync(config.sourceArchivePath).size));pool=new ObservedFinancialArchive(config.sourceArchivePath,{readOnly:true});if(pool.snapshotSha256()!==config.sourceArchiveSha256)throw Error('Source pool snapshot differs')}
        for(let page=0;progress.metadataCursor===config.throughSequence&&!progress.sourcesComplete&&page<maxSourcePages&&!signal?.aborted;page++){
            ensureSpace(directory);const transferred=pool.transferSourcesTo(target,{sourceArchiveSha256:config.sourceArchiveSha256,availableBy:config.availableBy,afterId:progress.afterSourceId,limit:100});
            for(const id of transferred.transferredIds){progress.sourceChain=chain(progress.sourceChain,id);progress.sourceCount++}
            progress.afterSourceId=transferred.nextAfterId;progress.sourcesComplete=transferred.complete;await save();
        }
        target.close();target=undefined;pool?.close();pool=undefined;
        if(signal?.aborted||progress.metadataCursor<config.throughSequence||!progress.sourcesComplete)return {status:signal?.aborted?'aborted':'partial',inputSha256,metadataCursor:progress.metadataCursor,sourcesComplete:progress.sourcesComplete,sourceCount:progress.sourceCount};
        const again=await prefix(repository,config.throughSequence,cutoff,signal);if(!again)return {status:'aborted'};
        if(canonical(again)!==canonical(metadata)||canonical(financialCycleSoftware())!==canonical(pinnedSoftware))throw Error('Preparation inputs or software changed');
        const inspect=new DatabaseSync(archivePath,{readOnly:true});try{
            if(inspect.prepare('SELECT count(*) AS count FROM archive_observations').get().count!==metadata.count)throw Error('Unexpected prepared observation set');
            let count=0,digest=EMPTY_CHAIN;for(const row of inspect.prepare('SELECT substr(id,1,65) AS id,length(body) AS body_length,substr(body,1,2049) AS body,substr(sha256,1,65) AS sha256 FROM archive_sources ORDER BY id').iterate()){
                if(typeof row.body!=='string'||row.body_length>2048||sha256(row.body)!==row.id||sha256(canonical([row.id,row.body]))!==row.sha256)throw Error('Prepared source record changed');digest=chain(digest,row.id);count++;
            }
            if(count!==progress.sourceCount||digest!==progress.sourceChain)throw Error('Unexpected prepared source set');
        }finally{inspect.close()}
        ensureSpace(directory,BigInt(statSync(archivePath).size)+BigInt(existsSync(statePath)?statSync(statePath).size:0));
        const archive=new ObservedFinancialArchive(archivePath,{readOnly:true}),job=new FinancialSourceJob(statePath);try{
            const plan=job.begin(input,archive);
            progress.receipt={status:'prepared',inputSha256,archivePath,statePath,preparationArchiveSha256:plan.plan.archiveSha256,observationsSha256:plan.plan.observationsSha256,planSha256:plan.planSha256,
                population:input.population.edinetCodes.length,selected:plan.plan.selectionCounts.selected,reusedSources:plan.completed,pendingSources:plan.pending,unavailableSources:plan.unavailable,
                ...(metadataOrigin?{unresolvedNotices:metadataOrigin.unresolvedNotices}:{}),preparedAt:new Date().toISOString(),financialValuesValidated:false};
            job.close();ensureSpace(directory,BigInt(statSync(statePath).size));const auditor=new FinancialSourceJob(statePath,{readOnly:true});
            try{progress.receipt.sourceAudit=auditor.audit(input.id,archive,{planSha256:plan.planSha256,archiveSha256:plan.plan.archiveSha256})}finally{auditor.close()}
            await save();return progress.receipt;
        }finally{job.close();archive.close()}
    }finally{target?.close();pool?.close();repository.close()}
}

async function main(){
    const {values,positionals}=parseArgs({allowPositionals:true,options:{locked:{type:'boolean'},'max-observation-pages':{type:'string',default:'100'},'max-source-pages':{type:'string',default:'100'}}});
    if(positionals.length!==1||![values['max-observation-pages'],values['max-source-pages']].every(v=>/^\d+$/.test(v)))throw Error('Invalid preparation arguments');
    const configPath=normalFile(resolve(positionals[0])),config=readJSONSnapshot(configPath).value;
    if(!values.locked){
        if(typeof config.outputDirectory!=='string'||!isAbsolute(config.outputDirectory))throw Error('Invalid preparation output');
        const args=['-n','-E','75','--close',config.outputDirectory+'.lock',process.execPath,fileURLToPath(import.meta.url),configPath,'--locked','--max-observation-pages',values['max-observation-pages'],'--max-source-pages',values['max-source-pages']];
        if(config.metadataCheckpointPath!==undefined){if(typeof config.metadataCheckpointPath!=='string'||!isAbsolute(config.metadataCheckpointPath))throw Error('Invalid metadata lock');args.splice(5,0,'/usr/bin/flock','-n','-E','75','--close',config.metadataCheckpointPath+'.lock')}
        const child=spawnSync('/usr/bin/flock',args,{stdio:'inherit'});if(child.error)throw Error('Preparation lock failed');process.exitCode=child.status??1;return;
    }
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{const result=await prepareFinancialCycle(config,{signal:controller.signal,maxObservationPages:Number(values['max-observation-pages']),maxSourcePages:Number(values['max-source-pages'])});console.log(JSON.stringify(result));if(result.status==='aborted')process.exitCode=1}
    finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Financial cycle preparation stopped; check immutable inputs, metadata completion, checkpoint and storage (details hidden).');process.exitCode=1});
