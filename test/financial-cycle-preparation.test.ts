import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {EdinetRepository,ObservedFinancialArchive,FinancialSourceJob} from '../dist/index.js';
import {prepareFinancialCycle} from '../scripts/roadmap/prepare-financial-cycle.mjs';
import {atomicJSON,readJSONSnapshot,sha256,canonical} from '../scripts/roadmap/operational-files.mjs';
import {scanDailyMetadataNotices} from '../scripts/roadmap/daily-metadata-notices.mjs';
const doc=(id:string)=>({docID:id,secCode:'10010',edinetCode:'E12345',docDescription:'fixture',docTypeCode:'120',submitDateTime:'2026-09-01 09:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',docInfoEditStatus:0,disclosureStatus:'0',xbrlFlag:'1'});
async function fixture(fn:(s:any)=>Promise<void>,rows=2,sources=2){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T01:00:00Z'));const dir=mkdtempSync(join(tmpdir(),'financial-cycle-')),metadataPath=join(dir,'metadata.sqlite'),sourceArchivePath=join(dir,'pool.sqlite');const metadata=new EdinetRepository(metadataPath),pool=new ObservedFinancialArchive(sourceArchivePath),ids=Array.from({length:rows},(_,i)=>i===0?'A':i===1?'B':'F'+i);
 try{metadata.saveDocumentList(ids.map(doc),'2026-09-01');for(let i=0;i<sources;i+=100)pool.append([],Array.from({length:Math.min(100,sources-i)},(_,j)=>({docID:i+j===0?'A':i+j===1?'B':'F'+(i+j),availableAt:'2026-10-01T00:00:00Z',sourceSha256:sha256('<x>fixture</x>'),xml:'<x>fixture</x>'})));pool.close();const ro=new ObservedFinancialArchive(sourceArchivePath,{readOnly:true});let sourceArchiveSha256;try{sourceArchiveSha256=ro.snapshotSha256()}finally{ro.close()}
 const config={version:1,metadataPath,sourceArchivePath,sourceArchiveSha256,sourceId:'cycle-fixture',throughSequence:rows,availableBy:'2026-10-30T02:00:00Z',outputDirectory:join(dir,'cycle'),input:{id:'cycle-fixture',cutoff:'2026-10-30T02:00:00Z',population:{asOf:'2026-10-29',observedAt:'2026-10-29T01:00:00Z',source:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']}}};vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));await fn({dir,metadata,config});
 }finally{metadata.close();pool.close();rmSync(dir,{recursive:true,force:true});vi.useRealTimers()}
}
it('新しい候補へ固定観測/原本と取得計画を準備し、再投入でも変えない',()=>fixture(async s=>{
 const before=readFileSync(s.config.metadataPath);const result=await prepareFinancialCycle(s.config);expect(result).toMatchObject({status:'prepared',population:1,selected:2,reusedSources:2,pendingSources:0,unavailableSources:0,financialValuesValidated:false});
 const original=readFileSync(result.archivePath);expect((await prepareFinancialCycle(s.config)).reused).toBe(true);expect(readFileSync(result.archivePath).equals(original)).toBe(true);expect(readFileSync(s.config.metadataPath).equals(before)).toBe(true);
}));
it('1000観測の境界で再開し、後続観測が増えても固定末尾を保つ',()=>fixture(async s=>{
 const first=await prepareFinancialCycle(s.config,{maxObservationPages:1});expect(first).toMatchObject({status:'partial',metadataCursor:1000,sourcesComplete:false});s.metadata.saveDocumentList([doc('LATER')],'2026-10-29');
 const result=await prepareFinancialCycle(s.config);expect(result).toMatchObject({status:'prepared',selected:1001,reusedSources:2,pendingSources:999});const archive=new ObservedFinancialArchive(result.archivePath,{readOnly:true});try{expect(archive.observation('metadata:cycle-fixture:1002')).toBeUndefined()}finally{archive.close()}
},1001));
it('原本転送の100件境界で再開し、重複コピーを作らない',()=>fixture(async s=>{
 const first=await prepareFinancialCycle(s.config,{maxSourcePages:1});expect(first).toMatchObject({status:'partial',sourceCount:100,sourcesComplete:false});expect((await prepareFinancialCycle(s.config)).status).toBe('prepared');const p=readJSONSnapshot(join(s.config.outputDirectory,'preparation.json')).value;expect(p.body.sourceCount).toBe(101);
},2,101));
it('原観測commit直後の停止も旧cursorから再投入して回復する',()=>fixture(async s=>{
 const original=ObservedFinancialArchive.prototype.append;let crash=true;const spy=vi.spyOn(ObservedFinancialArchive.prototype,'append').mockImplementation(function(this:any,...args:any[]){const r=original.apply(this,args as any);if(crash&&args[0]?.length){crash=false;throw Error('commit crash')}return r});
 try{await expect(prepareFinancialCycle(s.config)).rejects.toThrow('commit crash')}finally{spy.mockRestore()}
 expect(readJSONSnapshot(join(s.config.outputDirectory,'preparation.json')).value.body.metadataCursor).toBe(0);expect((await prepareFinancialCycle(s.config)).status).toBe('prepared');
}));
it('計画commit後のcheckpoint停止も、同じ計画で重複せず回復する',()=>fixture(async s=>{
 let planSha:string|undefined;await expect(prepareFinancialCycle(s.config,{onCheckpoint(p:any){if(p.receipt){planSha=p.receipt.planSha256;throw Error('after plan')}}})).rejects.toThrow('after plan');const result=await prepareFinancialCycle(s.config);expect(result.planSha256).toBe(planSha);expect(result.reused).toBe(true);
}));
it('入力条件・元prefixの変更とprogress破損を拒否する',()=>fixture(async s=>{
 await prepareFinancialCycle(s.config,{maxObservationPages:1});await expect(prepareFinancialCycle({...s.config,availableBy:'2026-10-29T00:00:00Z'})).rejects.toThrow('recipe changed');
 const progressPath=join(s.config.outputDirectory,'preparation.json'),p=readJSONSnapshot(progressPath).value;p.body.metadataCursor=0;writeFileSync(progressPath,JSON.stringify(p));await expect(prepareFinancialCycle(s.config)).rejects.toThrow('progress');
},1001));
it('中断をpage境界で保存し、再開できる',()=>fixture(async s=>{
 const controller=new AbortController();expect(await prepareFinancialCycle(s.config,{signal:controller.signal,onCheckpoint(){controller.abort()}})).toMatchObject({status:'aborted'});expect((await prepareFinancialCycle(s.config)).status).toBe('prepared');
}));
it('未完了の日次runを拒否し、完了runの不明通知と元checkpoint本文を残す',()=>fixture(async s=>{
 vi.setSystemTime(new Date('2026-10-30T01:30:00Z'));const n={...doc('NOTICE'),docTypeCode:null,withdrawalStatus:'1',parentDocID:'MISSING'};s.metadata.saveDocumentList([n],'2026-10-29');const notices={afterSequence:0,seen:[],pending:[],unresolved:[]};await scanDailyMetadataNotices(s.metadata,notices,()=>{});
 const checkpointPath=join(s.dir,'daily.json'),envelope={version:1,metadataPath:s.config.metadataPath,sourceId:s.config.sourceId,seedSha256:'b'.repeat(64),checkpoint:{version:3,throughDate:'2026-10-29',completedDay:'2026-10-30',budget:{date:'2026-10-30',requests:9},notices,lastCompletedRun:{startDate:'2026-10-23',endDate:'2026-10-29',refreshAfter:'2026-10-30T01:00:00.000Z',probe:{date:'2026-10-30',observedAt:'2026-10-30T01:10:00.000Z',documents:0,sha256:'a'.repeat(64)},throughSequence:3,closedThrough:'2026-10-29',completedAt:'2026-10-30T01:59:00.000Z',unresolvedNotices:1}}};atomicJSON(checkpointPath,envelope,{createOnly:true});const config={...s.config,throughSequence:3,metadataCheckpointPath:checkpointPath};
 vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));const invalid={...envelope,checkpoint:{...envelope.checkpoint,active:{}}};atomicJSON(checkpointPath,invalid);await expect(prepareFinancialCycle(config)).rejects.toThrow('not complete');atomicJSON(checkpointPath,envelope);
 vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));const expected=readJSONSnapshot(checkpointPath);const result=await prepareFinancialCycle(config);expect(result.unresolvedNotices).toBe(1);const stored=readJSONSnapshot(join(config.outputDirectory,'input.json')).value.recipe.origin;expect(sha256(stored.checkpointText)).toBe(expected.sha256);expect(JSON.parse(stored.checkpointText)).toEqual(envelope);
 atomicJSON(checkpointPath,{...envelope,checkpoint:{...envelope.checkpoint,active:{}}});expect((await prepareFinancialCycle(config)).reused).toBe(true);
}));
it('CLIで準備し、誤った入力を秘匿して拒否する',()=>fixture(async s=>{
 // 子processでも過去になる明示日時で原観測を作ります。
 vi.setSystemTime(new Date('2026-10-29T01:00:00Z'));const metadataPath=join(s.dir,'cli-metadata.sqlite'),repo=new EdinetRepository(metadataPath);repo.saveDocumentList([doc('A'),doc('B')],'2026-09-01');repo.close();
 const config={...s.config,metadataPath,availableBy:'2026-10-29T02:00:00Z',input:{...s.config.input,cutoff:'2026-10-29T02:00:00Z',population:{...s.config.input.population,asOf:'2026-10-27',observedAt:'2026-10-27T01:00:00Z'}}};
 const configPath=join(s.dir,'config.json');atomicJSON(configPath,config,{createOnly:true});const run=(args:string[])=>spawnSync(process.execPath,[resolve('scripts/roadmap/prepare-financial-cycle.mjs'),...args],{encoding:'utf8'});
 const result=run([configPath]);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).status).toBe('prepared');const bad=run([configPath,'--max-source-pages','SECRET']);expect(bad.status).toBe(1);expect(bad.stderr).not.toContain('SECRET');
}));
