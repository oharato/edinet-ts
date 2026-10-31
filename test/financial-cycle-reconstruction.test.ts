import {reportingInstance} from './fixtures/financial-reporting-basis';
import {activateBuiltFinancialCycle,buildReconstructedFinancialCycle,verifyBuiltFinancialCycleValues} from '../scripts/roadmap/build-financial-cycle.mjs';
import {it,expect,vi} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {EdinetRepository,ObservedFinancialArchive,FinancialIndexPublication,PublishedFinancialIndex} from '../dist/index.js';
import {prepareFinancialCycle} from '../scripts/roadmap/prepare-financial-cycle.mjs';
import {acquirePreparedFinancialCycle} from '../scripts/roadmap/acquire-financial-cycle.mjs';
import {reconstructAcquiredFinancialCycle} from '../scripts/roadmap/reconstruct-financial-cycle.mjs';
import {sha256,readJSONSnapshot,atomicJSON,canonical} from '../scripts/roadmap/operational-files.mjs';
async function fixture(fn:(s:any)=>Promise<void>,rows=3,withOrigin=false,acquireAt='2026-10-30T03:00:00Z',edinetCodes=['E12345'],storedXml='<stored/>'){
 vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T01:00:00Z'));const dir=mkdtempSync(join(tmpdir(),'cycle-reconstruct-')),metadataPath=join(dir,'metadata.sqlite'),sourceArchivePath=join(dir,'pool.sqlite'),repo=new EdinetRepository(metadataPath),pool=new ObservedFinancialArchive(sourceArchivePath);
 try{repo.saveDocumentList(Array.from({length:rows},(_,i)=>({docID:'A'+i,edinetCode:'E12345',secCode:'10010',docTypeCode:'120',submitDateTime:'2026-09-01 09:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',docInfoEditStatus:'0',disclosureStatus:'0',xbrlFlag:rows>3&&i>0||i===2?'0':'1'})),'2026-09-01');pool.append([],[{docID:'A0',availableAt:'2026-10-01T00:00:00Z',sourceSha256:sha256(storedXml),xml:storedXml}]);pool.close();const ro=new ObservedFinancialArchive(sourceArchivePath,{readOnly:true});const sourceArchiveSha256=ro.snapshotSha256();ro.close();
 const config:any={version:1,metadataPath,sourceArchivePath,sourceArchiveSha256,sourceId:'reconstruction-fixture',throughSequence:rows,availableBy:'2026-10-30T02:00:00Z',outputDirectory:join(dir,'candidate'),input:{id:'reconstruction-fixture',cutoff:'2026-10-30T02:00:00Z',population:{asOf:'2026-10-29',observedAt:'2026-10-29T01:00:00Z',source:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),edinetCodes}}};if(withOrigin){config.metadataCheckpointPath=join(dir,'daily-completion.json');atomicJSON(config.metadataCheckpointPath,{version:1,metadataPath,sourceId:config.sourceId,seedSha256:'b'.repeat(64),checkpoint:{version:3,throughDate:'2026-10-29',completedDay:'2026-10-30',budget:{date:'2026-10-30',requests:8},notices:{afterSequence:rows,seen:[],pending:[],unresolved:[]},lastCompletedRun:{startDate:'2026-10-23',endDate:'2026-10-29',refreshAfter:'2026-10-30T01:00:00.000Z',probe:{date:'2026-10-30',observedAt:'2026-10-30T01:00:00.000Z',documents:0,sha256:'c'.repeat(64)},throughSequence:rows,closedThrough:'2026-10-29',completedAt:'2026-10-30T01:00:00.000Z',unresolvedNotices:0}}},{createOnly:true})}
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

it('再構築から会社別索引と品質集計へ接続し、再実行でも同じ世代を返す',()=>fixture(async s=>{
 const before=readFileSync(s.prepared.archivePath);const result=await buildReconstructedFinancialCycle(s.config,{maxCompanies:1});
 expect(result.status).toBe('built');expect(result.nextStage).toBe('financial-quality');expect(result.financialValuesValidated).toBe(false);
 expect((await buildReconstructedFinancialCycle(s.config)).quality).toEqual(result.quality);expect(readFileSync(s.prepared.archivePath).equals(before)).toBe(true);
}));

it('構築完了記録の破損を上書きして成功扱いにしない',()=>fixture(async s=>{
 await buildReconstructedFinancialCycle(s.config);const path=join(s.config.outputDirectory,'reconstructed','build.json');const saved=readJSONSnapshot(path).value;saved.body.generation='CORRUPTED';writeFileSync(path,JSON.stringify(saved));const before=readFileSync(path);
 await expect(buildReconstructedFinancialCycle(s.config)).rejects.toThrow('receipt');expect(readFileSync(path).equals(before)).toBe(true);
}));
it('構築の処理件数と中断signalを入口で検査する',async()=>{
 for(const maxCompanies of [0,101,1.5])await expect(buildReconstructedFinancialCycle({}, {maxCompanies})).rejects.toThrow('options');
 await expect(buildReconstructedFinancialCycle({}, {signal:{} as any})).rejects.toThrow('options');
});

it('欠損のある候補は厳格な公開条件で不適格となり公開先を切り替えない',()=>fixture(async s=>{
 const result=await buildReconstructedFinancialCycle(s.config);expect(result.publicationEligible).toBe(false);expect(result.publicationBlockers).toEqual(['quality-conditions','metadata-not-current','financial-values-unverified']);expect(result.publicationCandidate.eligible).toBe(false);expect(result.publicationCandidate.violations.length).toBeGreaterThan(0);
 const catalog=new FinancialIndexPublication(join(s.config.outputDirectory,'reconstructed','publication.sqlite'),{readOnly:true});
 try{expect(catalog.current()).toBeUndefined();expect(catalog.candidate(result.generation)).toEqual(result.publicationCandidate)}finally{catalog.close()}
}));

it('会社別の途中構築を完了扱いせず、次の呼出しで同じ計画を完了する',()=>fixture(async s=>{
 const partial=await buildReconstructedFinancialCycle(s.config,{maxCompanies:1});expect(partial).toMatchObject({status:'partial',phase:'financial-build',completed:1,pending:1});
 expect(existsSync(join(s.config.outputDirectory,'reconstructed','build.json'))).toBe(false);
 const complete=await buildReconstructedFinancialCycle(s.config,{maxCompanies:1});expect(complete.status).toBe('built');expect(complete.quality.populationCompanies).toBe(2);
},3,false,'2026-10-30T03:00:00Z',['E12345','E99999']));

it('閉日の鮮度が確認できても品質違反の候補は不適格のままにする',()=>fixture(async s=>{
 const result=await buildReconstructedFinancialCycle(s.config);expect(result.metadataCurrentForCutoff).toBe(true);expect(result.publicationEligible).toBe(false);expect(result.publicationBlockers).toEqual(['quality-conditions','financial-values-unverified']);
},3,true));

it('有効な原本と最新の閉日証跡から品質条件に適合した候補を作る',()=>fixture(async s=>{
 const result=await buildReconstructedFinancialCycle(s.config);expect(result.publicationEligible).toBe(false);expect(result.publicationBlockers).toEqual(['financial-values-unverified']);expect(result.publicationCandidate.violations).toEqual([]);expect(result.quality.values.available).toBe(5);
 const catalog=new FinancialIndexPublication(join(s.config.outputDirectory,'reconstructed','publication.sqlite'),{readOnly:true});try{expect(catalog.current()).toBeUndefined()}finally{catalog.close()}
},1,true,'2026-10-30T03:00:00Z',['E12345'],reportingInstance()));
it('品質条件に適合しても閉日証跡がなければ公開可能としない',()=>fixture(async s=>{
 const result=await buildReconstructedFinancialCycle(s.config);expect(result.publicationCandidate.eligible).toBe(true);expect(result.publicationEligible).toBe(false);expect(result.publicationBlockers).toEqual(['metadata-not-current','financial-values-unverified']);
},1,false,'2026-10-30T03:00:00Z',['E12345'],reportingInstance()));

it('適格候補を期待する公開先から切り替え、不正なCASでは履歴を増やさない',()=>fixture(async s=>{
 const catalogPath=join(s.dir,'active.sqlite');await verifyBuiltFinancialCycleValues(s.config);const result=await activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null});expect(result.status).toBe('published');expect(result.financialValuesValidated).toBe(true);const reader=new PublishedFinancialIndex(catalogPath,result.indexPath);try{expect(reader.snapshot().generation).toBe(result.generation);expect(reader.quality()).toEqual(result.quality)}finally{reader.close()}
 await expect(activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null})).rejects.toThrow('切り替わりました');
 const catalog=new FinancialIndexPublication(catalogPath,{readOnly:true});try{expect(catalog.current()!.id).toBe(result.generation);expect(catalog.history()).toHaveLength(1)}finally{catalog.close()}
},1,true,'2026-10-30T03:00:00Z',['E12345'],reportingInstance()));
it('品質不適格の候補は公開catalogを作らず理由付きで返す',()=>fixture(async s=>{
 const catalogPath=join(s.dir,'active.sqlite');expect((await activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null})).status).toBe('publication-blocked');expect(existsSync(catalogPath)).toBe(false);
}));

it('公開先とCAS入力が不正なら候補を構築する前に拒否する',async()=>{
 for(const target of [{catalogPath:'relative.sqlite',expectedActive:null},{catalogPath:'/tmp/catalog.sqlite',expectedActive:'bad/id'},{catalogPath:'/tmp/catalog.sqlite'}])await expect(activateBuiltFinancialCycle({},target)).rejects.toThrow('target');
});

it('構築専用CLIは件数上限を増やしても同じ入力指紋とcheckpointを引き継ぐ',()=>fixture(async s=>{
 const partial=await buildReconstructedFinancialCycle(s.config,{maxCompanies:1});expect(partial).toMatchObject({status:'partial',completed:1,pending:1});
 const directory=join(s.config.outputDirectory,'reconstructed'),before=readFileSync(join(directory,'build-input.json')),configPath=join(s.dir,'prepared-config.json');writeFileSync(configPath,JSON.stringify(s.config));
 const result=spawnSync(process.execPath,[resolve('scripts/roadmap/build-prepared-financial-cycle.mjs'),'--config',configPath,'--max-companies','100','--locked'],{encoding:'utf8'});
 expect(result.status,result.stderr).toBe(0);const built=JSON.parse(result.stdout);expect(built.status).toBe('built');expect(built.inputSha256).toBe(partial.inputSha256);expect(built.quality.populationCompanies).toBe(2);expect(readFileSync(join(directory,'build-input.json'))).toEqual(before);
},1,false,'2026-10-30T03:00:00Z',['E12345','E54321'],reportingInstance()));
it('構築専用CLIは排他宣言・上限・再構築receiptがない場合に新候補を作らない',()=>fixture(async s=>{
 const configPath=join(s.dir,'prepared-config.json');writeFileSync(configPath,JSON.stringify(s.config));const worker=resolve('scripts/roadmap/build-prepared-financial-cycle.mjs');
 for(const args of [[],['--locked','--max-companies','0'],['--locked','--max-companies','101'],['--locked','--max-batches','0'],['--locked','--max-batches','101'],['--locked']]){
  const result=spawnSync(process.execPath,[worker,'--config',configPath,...args],{encoding:'utf8'});expect(result.status).toBe(1);expect(result.stderr).toContain('Prepared financial build stopped');expect(result.stdout).toBe('');expect(existsSync(join(s.config.outputDirectory,'reconstructed'))).toBe(false);
 }
}));

it('品質適合だけの未検証候補はcatalogを作らず、単なる検証フラグも受け入れない',()=>fixture(async s=>{
 const catalogPath=join(s.dir,'active.sqlite');
 const blocked=await activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null});
 expect(blocked).toMatchObject({status:'publication-blocked',financialValuesValidated:false,publicationBlockers:['financial-values-unverified']});
 expect(existsSync(catalogPath)).toBe(false);
 writeFileSync(join(s.config.outputDirectory,'reconstructed','value-verification.json'),JSON.stringify({financialValuesValidated:true}));
 await expect(activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null})).rejects.toThrow('binding');
 expect(existsSync(catalogPath)).toBe(false);
},1,true,'2026-10-30T03:00:00Z',['E12345'],reportingInstance()));

it('別候補の指紋や改変した原本照合記録はhashを付け直しても拒否する',()=>fixture(async s=>{
 const prior=process.env.PYTHONOPTIMIZE;let verified:any;
 try{process.env.PYTHONOPTIMIZE='1';verified=await verifyBuiltFinancialCycleValues(s.config)}finally{if(prior===undefined)delete process.env.PYTHONOPTIMIZE;else process.env.PYTHONOPTIMIZE=prior}
 const catalogPath=join(s.dir,'active.sqlite'),recordPath=join(s.config.outputDirectory,'reconstructed','value-verification.json');
 expect(verified.verification.checks).toMatchObject({selectedValues:5,documents:1});
 const original=readFileSync(recordPath);
 for(const field of ['inputSha256','generationSha256','archiveSha256','buildPlanSha256','qualitySha256']){
  const record=JSON.parse(original.toString());record.binding[field]='a'.repeat(64);delete record.sha256;record.sha256=sha256(canonical(record));writeFileSync(recordPath,JSON.stringify(record));
  await expect(activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null})).rejects.toThrow('binding');
 }
 const forged=JSON.parse(original.toString());forged.checks.valuesSha256='f'.repeat(64);delete forged.sha256;forged.sha256=sha256(canonical(forged));writeFileSync(recordPath,JSON.stringify(forged));
 await expect(activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null})).rejects.toThrow('evidence');
 expect(existsSync(catalogPath)).toBe(false);
 writeFileSync(recordPath,original);expect((await activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null})).status).toBe('published');
 expect((await verifyBuiltFinancialCycleValues(s.config)).verification).toEqual(verified.verification);
},1,true,'2026-10-30T03:00:00Z',['E12345'],reportingInstance()));

it('原本照合CLIは候補排他を必須とし、有効記録で公開後に旧世代へ切り戻せる',()=>fixture(async s=>{
 const built=await buildReconstructedFinancialCycle(s.config),configPath=join(s.dir,'config.json'),catalogPath=join(s.dir,'active.sqlite');writeFileSync(configPath,JSON.stringify(s.config));
 const worker=resolve('scripts/roadmap/verify-built-financial-cycle.mjs');
 expect(spawnSync(process.execPath,[worker,'--config',configPath],{encoding:'utf8'}).status).toBe(1);
 const result=spawnSync(process.execPath,[worker,'--config',configPath,'--locked'],{encoding:'utf8'});expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).verification.checks.selectedValues).toBe(5);
 const first=await activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:null});
 const {FinancialSearchIndex}=await import('../dist/index.js');const index=new FinancialSearchIndex(built.indexPath,{readOnly:true}),catalog=new FinancialIndexPublication(catalogPath);
 try{
  catalog.prepare('next',index,built.generation);catalog.activate('next',index,{expectedActive:first.publication});
  expect((await activateBuiltFinancialCycle(s.config,{catalogPath,expectedActive:'next'})).publication).toBe(first.publication);
  expect(catalog.current()?.id).toBe(first.publication);expect(catalog.history()).toHaveLength(3);
 }finally{catalog.close();index.close()}
},1,true,'2026-10-30T03:00:00Z',['E12345'],reportingInstance()));

it('異なる原本と検証記録を持つ2世代を切り替え、旧世代の検証を再確認して戻す',()=>fixture(async first=>{
 await fixture(async second=>{
  const old=await verifyBuiltFinancialCycleValues(first.config),next=await verifyBuiltFinancialCycleValues(second.config),catalogPath=join(first.dir,'active.sqlite');
  expect(old.generation).not.toBe(next.generation);expect(old.verification.binding.archiveSha256).not.toBe(next.verification.binding.archiveSha256);
  const a=await activateBuiltFinancialCycle(first.config,{catalogPath,expectedActive:null});
  const b=await activateBuiltFinancialCycle(second.config,{catalogPath,expectedActive:a.publication});
  expect(b.verification.recordSha256).not.toBe(a.verification.recordSha256);
  const reader=new PublishedFinancialIndex(catalogPath,b.indexPath);try{expect(reader.snapshot().generation).toBe(next.generation)}finally{reader.close()}
  const back=await activateBuiltFinancialCycle(first.config,{catalogPath,expectedActive:b.publication});expect(back.publication).toBe(old.generation);
  const restored=new PublishedFinancialIndex(catalogPath,back.indexPath),catalog=new FinancialIndexPublication(catalogPath,{readOnly:true});
  try{expect(restored.snapshot().generation).toBe(old.generation);expect(catalog.history().map(t=>t.publication)).toEqual([a.publication,b.publication,a.publication])}
  finally{catalog.close();restored.close()}
 },1,true,'2026-10-30T03:00:00Z',['E12345'],reportingInstance().replace('>100<','>200<'));
},1,true,'2026-10-30T03:00:00Z',['E12345'],reportingInstance()));
