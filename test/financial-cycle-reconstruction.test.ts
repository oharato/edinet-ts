import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EdinetRepository,ObservedFinancialArchive} from '../dist/index.js';
import {prepareFinancialCycle} from '../scripts/roadmap/prepare-financial-cycle.mjs';
import {acquirePreparedFinancialCycle} from '../scripts/roadmap/acquire-financial-cycle.mjs';
import {reconstructAcquiredFinancialCycle} from '../scripts/roadmap/reconstruct-financial-cycle.mjs';
import {sha256,readJSONSnapshot,atomicJSON} from '../scripts/roadmap/operational-files.mjs';
async function fixture(fn:(s:any)=>Promise<void>,rows=3,withOrigin=false,acquireAt='2026-10-30T03:00:00Z'){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T01:00:00Z'));const dir=mkdtempSync(join(tmpdir(),'cycle-reconstruct-')),metadataPath=join(dir,'metadata.sqlite'),sourceArchivePath=join(dir,'pool.sqlite'),repo=new EdinetRepository(metadataPath),pool=new ObservedFinancialArchive(sourceArchivePath);
 try{repo.saveDocumentList(Array.from({length:rows},(_,i)=>({docID:'A'+i,edinetCode:'E12345',secCode:'10010',docTypeCode:'120',submitDateTime:'2026-09-01 09:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',docInfoEditStatus:'0',disclosureStatus:'0',xbrlFlag:rows>3&&i>0||i===2?'0':'1'})),'2026-09-01');pool.append([],[{docID:'A0',availableAt:'2026-10-01T00:00:00Z',sourceSha256:sha256('<stored/>'),xml:'<stored/>'}]);pool.close();const ro=new ObservedFinancialArchive(sourceArchivePath,{readOnly:true});const sourceArchiveSha256=ro.snapshotSha256();ro.close();
 const config:any={version:1,metadataPath,sourceArchivePath,sourceArchiveSha256,sourceId:'reconstruction-fixture',throughSequence:rows,availableBy:'2026-10-30T02:00:00Z',outputDirectory:join(dir,'candidate'),input:{id:'reconstruction-fixture',cutoff:'2026-10-30T02:00:00Z',population:{asOf:'2026-10-29',observedAt:'2026-10-29T01:00:00Z',source:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']}}};if(withOrigin){config.metadataCheckpointPath=join(dir,'daily-completion.json');atomicJSON(config.metadataCheckpointPath,{version:1,metadataPath,sourceId:config.sourceId,seedSha256:'b'.repeat(64),checkpoint:{version:3,throughDate:'2026-10-29',completedDay:'2026-10-30',budget:{date:'2026-10-30',requests:8},notices:{afterSequence:rows,seen:[],pending:[],unresolved:[]},lastCompletedRun:{startDate:'2026-10-23',endDate:'2026-10-29',refreshAfter:'2026-10-30T01:00:00.000Z',probe:{date:'2026-10-30',observedAt:'2026-10-30T01:00:00.000Z',documents:0,sha256:'c'.repeat(64)},throughSequence:rows,closedThrough:'2026-10-29',completedAt:'2026-10-30T01:00:00.000Z',unresolvedNotices:0}}},{createOnly:true})}
 vi.setSystemTime(new Date('2026-10-30T03:00:00Z'));const prepared=await prepareFinancialCycle(config);vi.setSystemTime(new Date(acquireAt));const acquired=await acquirePreparedFinancialCycle(config,{fetchXbrl:async()=>'<downloaded/>'});expect(acquired.status).toBe('acquired');await fn({dir,config,repo,prepared,acquired});
 }finally{repo.close();pool.close();rmSync(dir,{recursive:true,force:true});vi.useRealTimers()}
}
it('取得後のcutoffと原本を固定し、元のtask履歴を別候補で監査する',()=>fixture(async s=>{
 const before=readFileSync(s.prepared.archivePath),meta=readFileSync(s.config.metadataPath),state=readFileSync(s.prepared.statePath),result=await reconstructAcquiredFinancialCycle(s.config);
 expect(result).toMatchObject({status:'reconstructed',selectionCutoff:'2026-10-30T02:00:00.000Z',cutoff:s.acquired.completedAt,population:1,metadataThroughSequence:3,metadataCurrentForCutoff:false,nextStage:'financial-build',financialValuesValidated:false,sourceAudit:{completed:2,unavailable:1,finished:true}});
 expect(result.archivePath).not.toBe(s.prepared.archivePath);expect(result.buildInput.archiveSha256).toBe(result.archiveSha256);expect(result.buildInput.options.cutoff).toBe(s.acquired.completedAt);expect(readFileSync(s.prepared.archivePath).equals(before)).toBe(true);expect(readFileSync(s.config.metadataPath).equals(meta)).toBe(true);expect(readFileSync(s.prepared.statePath).equals(state)).toBe(true);
 expect((await reconstructAcquiredFinancialCycle(s.config)).reused).toBe(true);
}));
it('1000観測の境界で再開し、後続metadataを混ぜない',()=>fixture(async s=>{
 expect(await reconstructAcquiredFinancialCycle(s.config,{maxObservationPages:1})).toMatchObject({status:'partial',phase:'financial-reconstruction',metadataCursor:1000});
 vi.setSystemTime(new Date('2026-10-31T01:00:00Z'));s.repo.saveDocumentList([{docID:'FUTURE',docTypeCode:'120',edinetCode:'E12345'}],'2026-10-30');const result=await reconstructAcquiredFinancialCycle(s.config);expect(result).toMatchObject({status:'reconstructed',metadataThroughSequence:1001,sourceAudit:{unavailable:1000,completed:1}});const archive=new ObservedFinancialArchive(result.archivePath,{readOnly:true});try{expect(archive.observation('metadata:reconstruction-fixture:1002')).toBeUndefined()}finally{archive.close()}
},1001));
it('別候補の準備commit直後の停止も同じ原本指紋で再開する',()=>fixture(async s=>{
 let sha:string|undefined;await expect(reconstructAcquiredFinancialCycle(s.config,{onCheckpoint(p:any){if(p.receipt?.status==='prepared'){sha=p.receipt.preparationArchiveSha256;throw Error('after canonical plan')}}})).rejects.toThrow('after canonical plan');const result=await reconstructAcquiredFinancialCycle(s.config);expect(result.archiveSha256).toBe(sha);expect(result.sourceAudit.finished).toBe(true);
}));
it('再構築receipt保存後の停止からも再監査して再開する',()=>fixture(async s=>{
 await expect(reconstructAcquiredFinancialCycle(s.config,{onCheckpoint(p:any){if(p.receipt?.status==='reconstructed')throw Error('after receipt')}})).rejects.toThrow('after receipt');expect((await reconstructAcquiredFinancialCycle(s.config)).reused).toBe(true);
}));
it('中断時に原本を変更せず、同じ入力で再開する',()=>fixture(async s=>{
 const controller=new AbortController(),before=readFileSync(s.prepared.archivePath);expect((await reconstructAcquiredFinancialCycle(s.config,{signal:controller.signal,onCheckpoint(){controller.abort()}})).status).toBe('aborted');expect(readFileSync(s.prepared.archivePath).equals(before)).toBe(true);expect((await reconstructAcquiredFinancialCycle(s.config)).status).toBe('reconstructed');
}));
it('取得完了証跡の欠落・不正な境界を拒否する',()=>fixture(async s=>{
 const path=join(s.config.outputDirectory,'acquisition.json'),original=readFileSync(path),data=readJSONSnapshot(path).value;delete data.body.receipt;writeFileSync(path,JSON.stringify(data));await expect(reconstructAcquiredFinancialCycle(s.config)).rejects.toThrow('not complete');writeFileSync(path,original);await expect(reconstructAcquiredFinancialCycle({...s.config,throughSequence:0})).rejects.toThrow('input');expect(existsSync(join(s.config.outputDirectory,'reconstruction-input.json'))).toBe(false);
}));
it('再構築後に元の作業原本がなくても、履歴と新候補で再監査できる',()=>fixture(async s=>{
 const result=await reconstructAcquiredFinancialCycle(s.config);rmSync(s.prepared.archivePath);expect((await reconstructAcquiredFinancialCycle(s.config)).reused).toBe(true);expect(existsSync(result.archivePath)).toBe(true);
}));
it('確定後の原本変更と再構築receiptの破損を拒否する',()=>fixture(async s=>{
 const result=await reconstructAcquiredFinancialCycle(s.config),path=join(s.config.outputDirectory,'reconstruction.json'),before=readFileSync(path),data=readJSONSnapshot(path).value;data.body.archiveSha256='f'.repeat(64);writeFileSync(path,JSON.stringify(data));await expect(reconstructAcquiredFinancialCycle(s.config)).rejects.toThrow('receipt');writeFileSync(path,before);
 const archive=new ObservedFinancialArchive(result.archivePath);archive.appendAcquiredSource('EXTRA','<extra/>');archive.close();await expect(reconstructAcquiredFinancialCycle(s.config)).rejects.toThrow();
}));

it('日次完了証跡を保持し、取得完了cutoffに対して閉日の鮮度を確認する',()=>fixture(async s=>{
 const result=await reconstructAcquiredFinancialCycle(s.config);expect(result).toMatchObject({metadataThroughDate:'2026-10-29',metadataCurrentForCutoff:true});const stored=readJSONSnapshot(join(s.config.outputDirectory,'reconstruction-input.json')).value;expect(stored.recipe.metadataOrigin.completedDay).toBe('2026-10-30');
},3,true));
it('取得が翌日に跨いだ場合は閉じた日が最新とは記録しない',()=>fixture(async s=>{
 const result=await reconstructAcquiredFinancialCycle(s.config);expect(result).toMatchObject({metadataThroughDate:'2026-10-29',metadataCurrentForCutoff:false,cutoff:'2026-10-31T03:00:00.000Z'});
},3,true,'2026-10-31T03:00:00Z'));
