import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {EdinetRepository,ObservedFinancialArchive} from '../dist/index.js';
import {runDailyFinancialPreparation} from '../scripts/roadmap/run-daily-financial-preparation.mjs';
import {atomicJSON,sha256,readJSONSnapshot} from '../scripts/roadmap/operational-files.mjs';
async function fixture(fn:(s:any)=>Promise<void>,count=1){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T00:30:00Z'));const dir=mkdtempSync(join(tmpdir(),'daily-financial-')),metadataPath=join(dir,'metadata.sqlite'),sourceArchivePath=join(dir,'sources.sqlite'),populationPath=join(dir,'population.json'),metadataConfigPath=join(dir,'daily-config.json'),checkpointPath=join(dir,'daily-checkpoint.json'),guardSummaryPath=join(dir,'summary.json');
 const repo=new EdinetRepository(metadataPath);try{
 repo.saveDocumentList(Array.from({length:count},(_,i)=>({docID:'A'+i,edinetCode:'E12345',secCode:'10010',docTypeCode:'120',submitDateTime:'2026-09-01 09:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',docInfoEditStatus:'0',disclosureStatus:'0',xbrlFlag:'1'})),'2026-09-01');
 const pool=new ObservedFinancialArchive(sourceArchivePath);pool.append([],[{docID:'A0',availableAt:'2026-10-29T01:00:00Z',sourceSha256:sha256('<x/>'),xml:'<x/>'}]);pool.close();
 atomicJSON(populationPath,{asOf:'2026-10-29',observedAt:'2026-10-29T01:00:00Z',sourceUrl:'https://example.test/master.csv',sourceSha256:'d'.repeat(64),records:[{entityId:'edinet:E12345',edinetCode:'E12345',name:'fixture',filerType:'内国法人',listingStatus:'listed',securityCode:'10010'},{entityId:'edinet:E54321',edinetCode:'E54321',name:'unlisted',filerType:'内国法人',listingStatus:'unlisted'}]},{createOnly:true});
 const summary={archivePath:sourceArchivePath,planSha256:'a'.repeat(64),executionScriptSha256:'b'.repeat(64),finished:true,pending:0,failed:0,running:0,completed:1,unavailable:0,documents:1};atomicJSON(guardSummaryPath,summary,{createOnly:true});
 const daily={version:1,metadataPath,checkpointPath,guardSummaryPath,guardUnit:'edinet-roadmap-fixture.service',guardPlanSha256:summary.planSha256,guardWorkerSha256:summary.executionScriptSha256,sourceId:'daily-fixture',seedSha256:'c'.repeat(64)};atomicJSON(metadataConfigPath,daily,{createOnly:true});
 vi.setSystemTime(new Date('2026-10-30T01:00:00Z'));const envelope={version:1,metadataPath,sourceId:daily.sourceId,seedSha256:daily.seedSha256,checkpoint:{version:3,throughDate:'2026-10-29',completedDay:'2026-10-30',budget:{date:'2026-10-30',requests:8},notices:{afterSequence:count,seen:[],pending:[],unresolved:[]},lastCompletedRun:{startDate:'2026-10-23',endDate:'2026-10-29',refreshAfter:'2026-10-30T01:00:00.000Z',probe:{date:'2026-10-30',observedAt:'2026-10-30T01:00:00.000Z',documents:0,sha256:'e'.repeat(64)},throughSequence:count,closedThrough:'2026-10-29',completedAt:'2026-10-30T01:00:00.000Z',unresolvedNotices:0}}};atomicJSON(checkpointPath,envelope,{createOnly:true});
 const config={version:1,metadataConfigPath,sourceArchivePath,populationPath,populationSha256:sha256(readFileSync(populationPath)),outputDirectory:join(dir,'handoff')};await fn({dir,repo,config,daily,envelope,summary});
 }finally{repo.close();rmSync(dir,{recursive:true,force:true});vi.useRealTimers()}
}
const inactive={readUnitState:()=> 'inactive'};
it('固定取得が完了・停止する前はファイルを作らず待機する',()=>fixture(async s=>{
 expect(await runDailyFinancialPreparation(s.config,{readUnitState:()=> 'active'})).toEqual({status:'waiting-for-fixed-acquisition'});atomicJSON(s.daily.guardSummaryPath,{...s.summary,finished:false});expect(await runDailyFinancialPreparation(s.config,inactive)).toEqual({status:'waiting-for-fixed-acquisition'});expect(existsSync(s.config.outputDirectory)).toBe(false);
}));
it('未完了・旧版・前日の日次metadataでは候補を作らない',()=>fixture(async s=>{
 for(const change of [{version:2},{active:{}},{completedDay:'2026-10-29'}]){atomicJSON(s.daily.checkpointPath,{...s.envelope,checkpoint:{...s.envelope.checkpoint,...change}});expect(await runDailyFinancialPreparation(s.config,inactive)).toEqual({status:'waiting-for-daily-metadata'})}expect(existsSync(s.config.outputDirectory)).toBe(false);
}));
it('完了した日次入力から上場母集団と保存原本を使う計画を準備する',()=>fixture(async s=>{
 const before=readFileSync(s.daily.metadataPath),result=await runDailyFinancialPreparation(s.config,inactive);expect(result).toMatchObject({status:'prepared',day:'2026-10-30',population:1,reusedSources:1,pendingSources:0,nextStage:'source-acquisition',financialValuesValidated:false});
 const recipe=readJSONSnapshot(join(s.config.outputDirectory,'handoff.json')).value.body;expect(recipe.config.input.cutoff).toBe(s.envelope.checkpoint.lastCompletedRun.completedAt);expect(recipe.metadataCheckpointSha256).toBe(sha256(readFileSync(s.daily.checkpointPath)));expect(readFileSync(s.daily.metadataPath).equals(before)).toBe(true);
}));
it('途中停止後は翌日のmetadataへ進んでも凍結した前日の候補を再開する',()=>fixture(async s=>{
 expect(await runDailyFinancialPreparation(s.config,{...inactive,prepareOptions:{maxObservationPages:1}})).toMatchObject({status:'partial',metadataCursor:1000});const recipe=readFileSync(join(s.config.outputDirectory,'handoff.json'));
 vi.setSystemTime(new Date('2026-10-31T01:00:00Z'));s.repo.saveDocumentList([{docID:'LATER',edinetCode:'E12345',docTypeCode:'120'}],'2026-10-30');atomicJSON(s.daily.checkpointPath,{...s.envelope,checkpoint:{version:3,active:{}}});
 const result=await runDailyFinancialPreparation(s.config,inactive);expect(result).toMatchObject({status:'prepared',day:'2026-10-30',selected:1001});expect(readFileSync(join(s.config.outputDirectory,'handoff.json')).equals(recipe)).toBe(true);expect((await runDailyFinancialPreparation(s.config,inactive)).reused).toBe(true);
},1001));
it('handoff保存直後の停止からも入力を復元して再開する',()=>fixture(async s=>{
 const original=ObservedFinancialArchive.prototype.append;const spy=vi.spyOn(ObservedFinancialArchive.prototype,'append').mockImplementation(()=>{throw Error('crash')});try{await expect(runDailyFinancialPreparation(s.config,inactive)).rejects.toThrow('crash')}finally{spy.mockRestore()}
 expect(existsSync(join(s.config.outputDirectory,'handoff.json'))).toBe(true);expect((await runDailyFinancialPreparation(s.config,inactive)).status).toBe('prepared');
}));
it('母集団hash・原本の対応・完了末尾が不整合ならhandoffを作らない',()=>fixture(async s=>{
 await expect(runDailyFinancialPreparation({...s.config,populationSha256:'f'.repeat(64)},inactive)).rejects.toThrow('Population');atomicJSON(s.daily.guardSummaryPath,{...s.summary,archivePath:join(s.dir,'other.sqlite')});await expect(runDailyFinancialPreparation(s.config,inactive)).rejects.toThrow('archive differs');atomicJSON(s.daily.guardSummaryPath,s.summary);
 atomicJSON(s.daily.checkpointPath,{...s.envelope,checkpoint:{...s.envelope.checkpoint,lastCompletedRun:{...s.envelope.checkpoint.lastCompletedRun,throughSequence:0}}});await expect(runDailyFinancialPreparation(s.config,inactive)).rejects.toThrow('boundary');expect(existsSync(s.config.outputDirectory)).toBe(false);
}));
it('保存したhandoffの改変と設定差分を拒否する',()=>fixture(async s=>{
 await runDailyFinancialPreparation(s.config,inactive);await expect(runDailyFinancialPreparation({...s.config,populationSha256:'f'.repeat(64)},inactive)).rejects.toThrow('configuration differs');const p=join(s.config.outputDirectory,'handoff.json'),h=readJSONSnapshot(p).value;h.body.config.throughSequence=0;writeFileSync(p,JSON.stringify(h));await expect(runDailyFinancialPreparation(s.config,inactive)).rejects.toThrow('integrity');
}));
it('CLIは不正設定の内容を表示しない',()=>fixture(async s=>{
 const p=join(s.dir,'bad-config.json');atomicJSON(p,{...s.config,populationSha256:'SECRET'},{createOnly:true});const r=spawnSync(process.execPath,[resolve('scripts/roadmap/run-daily-financial-preparation.mjs'),p],{encoding:'utf8'});expect(r.status).toBe(1);expect(r.stderr).not.toContain('SECRET');
}));
