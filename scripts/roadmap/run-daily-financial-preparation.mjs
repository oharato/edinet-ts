import {readFileSync,readdirSync,existsSync,mkdirSync,lstatSync,realpathSync,statSync,createReadStream,statfsSync} from 'node:fs';
import {resolve,join,isAbsolute,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {EdinetRepository,queryCompanyMaster} from '../../dist/index.js';
import {canStartDailyMetadata,assertCompletedMetadataRun} from './daily-metadata-control.mjs';
import {assertDailyNoticeState} from './daily-metadata-notices.mjs';
import {prepareFinancialCycle} from './prepare-financial-cycle.mjs';
import {normalFile,readJSONSnapshot,atomicJSON,canonical,sha256} from './operational-files.mjs';

const jstDate=time=>new Date(time+9*3600000).toISOString().slice(0,10);
const hash=/^[a-f0-9]{64}$/;
function settings(input){
    const s=structuredClone(input),fields=['version','metadataConfigPath','sourceArchivePath','populationPath','populationSha256','outputDirectory'];
    if(!s||typeof s!=='object'||Array.isArray(s)||Object.keys(s).length!==fields.length||Object.keys(s).some(k=>!fields.includes(k))||s.version!==1||!hash.test(s.populationSha256))throw Error('Invalid daily financial preparation configuration');
    for(const k of ['metadataConfigPath','sourceArchivePath','populationPath','outputDirectory'])if(typeof s[k]!=='string'||!isAbsolute(s[k])||resolve(s[k])!==s[k])throw Error('Absolute preparation paths are required');
    for(const k of ['metadataConfigPath','sourceArchivePath','populationPath'])if(normalFile(s[k])!==s[k]||s[k].startsWith(s.outputDirectory+'/'))throw Error('Preparation inputs overlap or have aliases');
    if(new Set([s.metadataConfigPath,s.sourceArchivePath,s.populationPath]).size!==3)throw Error('Preparation inputs overlap');
    return s;
}
function directory(path){const s=lstatSync(path);if(!s.isDirectory()||s.isSymbolicLink()||realpathSync(path)!==path)throw Error('Normal preparation directory required')}
async function snapshotHash(path,signal){
    const identity=()=>{const s=statSync(normalFile(path),{bigint:true});return [s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs].join(':')},before=identity(),h=createHash('sha256');
    for await(const bytes of createReadStream(path,{signal}))h.update(bytes);
    if(identity()!==before)throw Error('Source archive changed during fingerprinting');return h.digest('hex');
}
const unitState=unit=>execFileSync('/usr/bin/systemctl',['--user','show',unit,'--property=ActiveState','--value'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();

/** 呼出元はoutputDirectory.lockと実metadata checkpoint.lockをこの順で保持します。 */
export async function runDailyFinancialPreparation(input,{signal,readUnitState=unitState,prepareOptions={}}={}){
    const s=settings(input),dailySnapshot=readJSONSnapshot(s.metadataConfigPath),daily=dailySnapshot.value;
    if(daily?.version!==1||!/^edinet-roadmap-[a-z0-9-]+\.service$/.test(daily.guardUnit)||!hash.test(daily.guardPlanSha256)||!hash.test(daily.guardWorkerSha256)
        ||!hash.test(daily.seedSha256)||!/^[A-Za-z0-9_.-]{1,64}$/.test(daily.sourceId))throw Error('Invalid metadata configuration');
    for(const key of ['checkpointPath','metadataPath','guardSummaryPath'])if(typeof daily[key]!=='string'||!isAbsolute(daily[key])||normalFile(daily[key])!==daily[key]||daily[key].startsWith(s.outputDirectory+'/'))throw Error('Invalid metadata input path');
    if(signal?.aborted)return {status:'aborted'};
    const summary=readJSONSnapshot(daily.guardSummaryPath).value,unit=await readUnitState(daily.guardUnit);
    if(!canStartDailyMetadata(summary,unit,{planSha256:daily.guardPlanSha256,workerSha256:daily.guardWorkerSha256}))return {status:'waiting-for-fixed-acquisition'};
    if(typeof summary.archivePath!=='string'||resolve(summary.archivePath)!==s.sourceArchivePath)throw Error('Completed acquisition archive differs');
    const binding=sha256(canonical([s,dailySnapshot.sha256,sha256(readFileSync(fileURLToPath(import.meta.url)))])),handoffPath=join(s.outputDirectory,'handoff.json');
    let handoff;
    if(existsSync(s.outputDirectory))directory(s.outputDirectory);
    if(existsSync(handoffPath)){
        handoff=readJSONSnapshot(handoffPath).value;
        if(handoff?.version!==1||handoff.settingsSha256!==binding||handoff.sha256!==sha256(canonical([handoff.settingsSha256,handoff.body])))throw Error('Financial handoff integrity or configuration differs');
    }else{
        if(existsSync(s.outputDirectory)&&readdirSync(s.outputDirectory).some(name=>!/^handoff\.json\.[a-f0-9-]{36}\.tmp$/.test(name)))throw Error('Unowned financial preparation directory');
        const observed=readJSONSnapshot(daily.checkpointPath),envelope=observed.value,state=envelope?.checkpoint,today=jstDate(Date.now());
        if(state?.version!==3||state.active!==undefined||state.completedDay!==today)return {status:'waiting-for-daily-metadata'};
        if(envelope.version!==1||envelope.metadataPath!==daily.metadataPath||envelope.sourceId!==daily.sourceId||envelope.seedSha256!==daily.seedSha256
            ||state.throughDate!==new Date(Date.parse(today)-86400000).toISOString().slice(0,10))throw Error('Completed daily metadata differs');
        const repository=new EdinetRepository(daily.metadataPath,{readOnly:true});
        try{assertDailyNoticeState(state.notices,repository);assertCompletedMetadataRun(state.lastCompletedRun,repository.getLastObservationSequence(),state.throughDate);
            if(state.notices.pending.length||state.notices.afterSequence!==repository.getLastObservationSequence()||state.lastCompletedRun.throughSequence!==state.notices.afterSequence
                ||state.lastCompletedRun.probe.date!==today||state.lastCompletedRun.unresolvedNotices!==state.notices.unresolved.length)throw Error('Completed metadata boundary differs');
        }finally{repository.close()}
        const cutoff=state.lastCompletedRun.completedAt,populationSnapshot=readJSONSnapshot(s.populationPath);
        if(populationSnapshot.sha256!==s.populationSha256)throw Error('Population snapshot differs');
        const population=queryCompanyMaster([populationSnapshot.value],{asOf:state.throughDate,knownAt:cutoff,listingStatus:'listed'});
        if(population.status!=='available'||!population.total)throw Error('Listed population is unavailable at cutoff');
        const free=statfsSync(dirname(s.outputDirectory),{bigint:true});if(free.bavail*free.bsize<34n*1024n**3n)throw Error('Daily preparation disk reserve');
        const sourceArchiveSha256=await snapshotHash(s.sourceArchivePath,signal);
        if(signal?.aborted)return {status:'aborted'};
        if(readJSONSnapshot(daily.checkpointPath).sha256!==observed.sha256)throw Error('Daily checkpoint changed before handoff');
        const config={version:1,metadataPath:daily.metadataPath,metadataCheckpointPath:join(s.outputDirectory,'metadata-completion.json'),sourceId:daily.sourceId,
            throughSequence:state.notices.afterSequence,sourceArchivePath:s.sourceArchivePath,sourceArchiveSha256,availableBy:cutoff,outputDirectory:join(s.outputDirectory,'candidate'),
            input:{id:'daily-financial-'+today,cutoff,population:{asOf:population.asOf,observedAt:population.observedAt,source:population.sourceUrl,sourceSha256:population.sourceSha256,edinetCodes:population.rows.map(r=>r.edinetCode)}}};
        const body={day:today,metadataCheckpointSha256:observed.sha256,metadataCheckpointText:observed.text,populationFileSha256:populationSnapshot.sha256,config};
        handoff={version:1,settingsSha256:binding,body,sha256:sha256(canonical([binding,body]))};
        if(!existsSync(s.outputDirectory))mkdirSync(s.outputDirectory,{mode:0o700});directory(s.outputDirectory);
        atomicJSON(handoffPath,handoff,{createOnly:true});
    }
    const {body}=handoff;
    if(!body||body.config?.outputDirectory!==join(s.outputDirectory,'candidate')||body.config.metadataCheckpointPath!==join(s.outputDirectory,'metadata-completion.json')
        ||sha256(body.metadataCheckpointText)!==body.metadataCheckpointSha256)throw Error('Financial handoff paths or metadata differ');
    const frozen=JSON.parse(body.metadataCheckpointText),frozenPath=body.config.metadataCheckpointPath,configPath=join(s.outputDirectory,'preparation-config.json');
    for(const [path,value] of [[frozenPath,frozen],[configPath,body.config]]){
        if(existsSync(path)){if(canonical(readJSONSnapshot(path).value)!==canonical(value))throw Error('Frozen financial preparation input differs')}
        else atomicJSON(path,value,{createOnly:true});
    }
    const result=await prepareFinancialCycle(body.config,{...prepareOptions,signal});
    return {...result,day:body.day,configPath,...(result.status==='prepared'?{nextStage:'source-acquisition'}:{})};
}

async function main(){
    if(process.argv.length<3||process.argv.length>4||process.argv[3]!==undefined&&process.argv[3]!=='--locked')throw Error('Invalid daily preparation arguments');
    const configPath=normalFile(resolve(process.argv[2])),config=settings(readJSONSnapshot(configPath).value),daily=readJSONSnapshot(config.metadataConfigPath).value;
    if(!process.argv[3]){
        if(typeof daily.checkpointPath!=='string'||!isAbsolute(daily.checkpointPath))throw Error('Invalid metadata lock');
        const child=spawnSync('/usr/bin/flock',['-n','-E','75','--close',config.outputDirectory+'.lock','/usr/bin/flock','-n','-E','75','--close',daily.checkpointPath+'.lock',process.execPath,fileURLToPath(import.meta.url),configPath,'--locked'],{stdio:'inherit'});
        if(child.error)throw Error('Financial preparation lock failed');process.exitCode=child.status??1;return;
    }
    const controller=new AbortController(),stop=()=>controller.abort();process.once('SIGINT',stop);process.once('SIGTERM',stop);
    try{const result=await runDailyFinancialPreparation(config,{signal:controller.signal});console.log(JSON.stringify(result));if(result.status==='aborted')process.exitCode=1}
    finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop)}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(()=>{console.error('Daily financial preparation stopped; check fixed acquisition, completed metadata, population and storage (details hidden).');process.exitCode=1});
