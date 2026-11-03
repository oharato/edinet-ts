import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {EdinetRepository,ObservedFinancialArchive,FinancialSourceJob} from '../dist/index.js';
import {prepareFinancialCycle} from '../scripts/roadmap/prepare-financial-cycle.mjs';
import {acquirePreparedFinancialCycle} from '../scripts/roadmap/acquire-financial-cycle.mjs';
import {readJSONSnapshot,sha256} from '../scripts/roadmap/operational-files.mjs';
async function fixture(fn:(s:any)=>Promise<void>,rows=3,stored=1,unprovided=1){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T01:00:00Z'));const dir=mkdtempSync(join(tmpdir(),'cycle-acquisition-')),metadataPath=join(dir,'metadata.sqlite'),sourceArchivePath=join(dir,'pool.sqlite'),repo=new EdinetRepository(metadataPath),pool=new ObservedFinancialArchive(sourceArchivePath);
 try{repo.saveDocumentList(Array.from({length:rows},(_,i)=>({docID:'A'+String(i).padStart(4,'0'),edinetCode:'E12345',secCode:'10010',docTypeCode:'120',submitDateTime:'2026-09-01 09:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',docInfoEditStatus:'0',disclosureStatus:'0',xbrlFlag:i>=rows-unprovided?'0':'1'})),'2026-09-01');
 pool.append([],Array.from({length:stored},(_,i)=>({docID:'A'+String(i).padStart(4,'0'),availableAt:'2026-10-01T00:00:00Z',sourceSha256:sha256('<stored/>'),xml:'<stored/>'})));pool.close();const ro=new ObservedFinancialArchive(sourceArchivePath,{readOnly:true});const sourceArchiveSha256=ro.snapshotSha256();ro.close();
 const config={version:1,metadataPath,sourceArchivePath,sourceArchiveSha256,sourceId:'acquisition-fixture',throughSequence:rows,availableBy:'2026-10-30T02:00:00Z',outputDirectory:join(dir,'candidate'),input:{id:'acquisition-fixture',cutoff:'2026-10-30T02:00:00Z',population:{asOf:'2026-10-29',observedAt:'2026-10-29T01:00:00Z',source:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']}}};vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));const prepared=await prepareFinancialCycle(config);await fn({config,prepared,dir});
 }finally{repo.close();pool.close();rmSync(dir,{recursive:true,force:true});vi.useRealTimers()}
}
const progress=(s:any)=>{const job=new FinancialSourceJob(s.prepared.statePath,{readOnly:true});try{return job.progress(s.config.input.id)}finally{job.close()}};
it('保存済み/未提供原本を通信せず、不足原本だけ取得して完了監査へ渡す',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>'<downloaded/>');const result=await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch});expect(result).toMatchObject({status:'acquired',completed:2,unavailable:1,attempts:1,nextStage:'financial-reconstruction',financialValuesValidated:false,sourceAudit:{completed:2,unavailable:1,pending:0,finished:true}});expect(fetch.mock.calls.map((a:any)=>a[0])).toEqual(['A0001']);
 const before=readFileSync(s.prepared.archivePath);expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).reused).toBe(true);expect(fetch).toHaveBeenCalledTimes(1);expect(readFileSync(s.prepared.archivePath).equals(before)).toBe(true);
}));
// 102原本の実SQLite commitを伴う統合確認に、単体テストの既定5秒は使いません。
it('100件の境界で再開して、残りだけ取得する',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>'<downloaded/>');expect(await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).toMatchObject({status:'acquiring',completed:100,pending:2});expect(await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).toMatchObject({status:'acquired',completed:102});expect(fetch).toHaveBeenCalledTimes(102);
},102,0,0),30_000);
it('再起動しても各書類3試行の上限を超えない',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>{throw Error('SECRET')});for(let i=0;i<2;i++)expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).status).toBe('acquiring');
 expect(await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).toMatchObject({status:'acquisition-paused',reason:'three-attempts-per-remaining-document',attempts:3});expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).status).toBe('acquisition-paused');expect(fetch).toHaveBeenCalledTimes(3);expect(progress(s).history.every((a:any)=>a.errorCode==='source-acquisition-failed')).toBe(true);
},1,0,0));
it('連続5単位の停止判定を永続化し、再起動で追加通信しない',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>{throw Error('provider')});expect(await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).toMatchObject({status:'acquisition-paused',reason:'five-batches-without-progress',failed:100,pending:1,stalledBatches:5});expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).stalledBatches).toBe(5);expect(fetch).toHaveBeenCalledTimes(100);
},101,0,0),30_000);
it('DBのbatch commit後に停止しても、完了済み原本を再取得しない',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>'<downloaded/>'),original=FinancialSourceJob.prototype.runNext,spy=vi.spyOn(FinancialSourceJob.prototype,'runNext').mockImplementation(async function(this:any,...args:any[]){await original.apply(this,args as any);throw Error('after db commit')});
 try{await expect(acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).rejects.toThrow('after db commit')}finally{spy.mockRestore()}
 expect(readJSONSnapshot(join(s.config.outputDirectory,'acquisition.json')).value.body.activeBatch).toHaveLength(1);expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).status).toBe('acquired');expect(fetch).toHaveBeenCalledTimes(1);
}));
it('未保存の停止判定もDB履歴から復元し、通信を続けない',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>{throw Error('provider')}),original=FinancialSourceJob.prototype.runNext,spy=vi.spyOn(FinancialSourceJob.prototype,'runNext').mockImplementation(async function(this:any,...args:any[]){await original.apply(this,args as any);throw Error('after failure commits')});
 try{await expect(acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).rejects.toThrow('after failure commits')}finally{spy.mockRestore()}
 expect(await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).toMatchObject({status:'acquisition-paused',stalledBatches:5});expect(fetch).toHaveBeenCalledTimes(100);
},101,0,0),30_000);
it('原本commit後にtaskが失敗しても、保存原本を使って再開する',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>'<downloaded/>'),original=ObservedFinancialArchive.prototype.appendAcquiredSource,spy=vi.spyOn(ObservedFinancialArchive.prototype,'appendAcquiredSource').mockImplementation(function(this:any,...args:any[]){original.apply(this,args as any);throw Error('after source commit')});
 try{expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).status).toBe('acquiring')}finally{spy.mockRestore()}
 const factory=vi.fn(()=>{throw Error('must not initialize')});expect((await acquirePreparedFinancialCycle(s.config,{createFetchXbrl:factory})).status).toBe('acquired');expect(factory).not.toHaveBeenCalled();expect(fetch).toHaveBeenCalledTimes(1);expect(progress(s).history.at(-1).outcome).toBe('reused');
}));
it('通信前の中断と容量不足でネット取得せず、再開できる',()=>fixture(async s=>{
 const fetch=vi.fn(async()=>'<downloaded/>'),controller=new AbortController();expect(await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch,free:()=>0n})).toMatchObject({status:'acquisition-paused',reason:'disk-reserve'});expect(fetch).not.toHaveBeenCalled();
 expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch,signal:controller.signal,onCheckpoint(p:any){if(p.activeBatch)controller.abort()}})).status).toBe('aborted');expect(fetch).not.toHaveBeenCalled();expect(progress(s).history).toHaveLength(0);expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:fetch})).status).toBe('acquired');
}));
it('全件未提供なら認証/通信を初期化せず完了する',()=>fixture(async s=>{
 const factory=vi.fn(()=>{throw Error('must not initialize')});expect(await acquirePreparedFinancialCycle(s.config,{createFetchXbrl:factory})).toMatchObject({status:'acquired',completed:0,unavailable:1,attempts:0});expect(factory).not.toHaveBeenCalled();
},1,0,1));
it('取得checkpoint破損・設定差分・完了後の原本変更を拒否する',()=>fixture(async s=>{
 await expect(acquirePreparedFinancialCycle({...s.config,availableBy:'2026-10-29T00:00:00Z'})).rejects.toThrow('recipe');await acquirePreparedFinancialCycle(s.config,{fetchXbrl:async()=>'<downloaded/>'});
 const path=join(s.config.outputDirectory,'acquisition.json'),original=readFileSync(path),json=readJSONSnapshot(path).value;json.body.stalledBatches=4;writeFileSync(path,JSON.stringify(json));await expect(acquirePreparedFinancialCycle(s.config)).rejects.toThrow('checkpoint');writeFileSync(path,original);
 const archive=new ObservedFinancialArchive(s.prepared.archivePath);archive.appendAcquiredSource('EXTRA','<extra/>');archive.close();await expect(acquirePreparedFinancialCycle(s.config)).rejects.toThrow();
}));

it('認証/提供元の初期化失敗は取得試行を消費せず、修正後に再開する',()=>fixture(async s=>{
 await expect(acquirePreparedFinancialCycle(s.config,{createFetchXbrl:()=>{throw Error('provider configuration')}})).rejects.toThrow('provider configuration');expect(progress(s).history).toHaveLength(0);
 expect((await acquirePreparedFinancialCycle(s.config,{fetchXbrl:async()=>'<downloaded/>'})).status).toBe('acquired');expect(progress(s).history).toHaveLength(1);
}));
