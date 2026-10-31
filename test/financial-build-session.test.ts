import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {ObservedFinancialArchive,FinancialIndexBuild,FinancialSearchIndex} from '../dist/index.js';
import {withFinancialBuildSession} from '../scripts/roadmap/financial-build-session.mjs';
import {reportingInstance} from './fixtures/financial-reporting-basis';

const digest=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');
async function fixture(use:(context:any)=>Promise<void>){
 const directory=fs.mkdtempSync(join(tmpdir(),'financial-session-test-')),archivePath=join(directory,'archive.sqlite');
 try{
  const writer=new ObservedFinancialArchive(archivePath);
  for(let i=1;i<=3;i++){
   const edinetCode='E1200'+i,docID='A'+i,secCode='100'+i+'0',xml=reportingInstance({issuer:edinetCode,security:secCode});
   writer.append([{observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode,secCode,periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID,availableAt:'2026-06-27T00:00:00Z',sourceSha256:digest(xml),xml}]);
  }
  writer.close();
  const archiveSha256=digest(fs.readFileSync(archivePath)),input={id:'session',generation:'session-generation',archiveSha256,population:{asOf:'2026-10-27',observedAt:'2026-10-27T15:30:00Z',source:'session fixture',sourceSha256:'a'.repeat(64),edinetCodes:['E12001','E12002','E12003']},options:{cutoff:'2026-10-28T00:00:00Z',extractorVersion:'session-test-1'}};
  const paths=(name:string)=>({archivePath,statePath:join(directory,name+'-state.sqlite'),indexPath:join(directory,name+'-index.sqlite'),input});
  await use({directory,archivePath,input,paths});
  expect(digest(fs.readFileSync(archivePath))).toBe(archiveSha256);
 }finally{fs.rmSync(directory,{recursive:true,force:true})}
}

it('複数batchで検査コピーを6回から3回へ減らし、readOnly原本を変更しない',()=>fixture(async({paths})=>{
 const separate=paths('separate'),reused=paths('reused');
 for(const settings of [separate,reused]){new FinancialIndexBuild(settings.statePath).close();new FinancialSearchIndex(settings.indexPath).close()}
 const copies=vi.spyOn(fs,'mkdtempSync');syncBuiltinESMExports();
 try{
  const count=()=>copies.mock.calls.filter(([prefix])=>String(prefix).includes('edinet-observed-archive-')).length;
  for(let i=0;i<2;i++)await withFinancialBuildSession(separate,async({runBatch}:any)=>{expect((await runBatch({maxCompanies:1})).progress.completed).toBe(i+1)});
  expect(count()).toBe(6);copies.mockClear();
  await withFinancialBuildSession(reused,async({runBatch}:any)=>{
   expect((await runBatch({maxCompanies:1})).progress.completed).toBe(1);
   expect((await runBatch({maxCompanies:1})).progress.completed).toBe(2);
   expect(count()).toBe(3);
  });
  expect(count()).toBe(3);
 }finally{copies.mockRestore();syncBuiltinESMExports()}
}));

it('会社commit後のabortで接続を閉じ、次sessionで残件だけ再開する',()=>fixture(async({paths})=>{
 const settings=paths('abort'),controller=new AbortController();let archive:any;
 await withFinancialBuildSession(settings,async(session:any)=>{
  archive=session.archive;setImmediate(()=>controller.abort());
  expect(await session.runBatch({maxCompanies:3,signal:controller.signal})).toMatchObject({status:'aborted',progress:{completed:1,pending:2}});
 });
 expect(()=>archive.snapshotSha256()).toThrow();
 await withFinancialBuildSession(settings,async({state,runBatch}:any)=>{
  expect(state.progress('session').completed).toBe(1);
  const result=await runBatch({maxCompanies:3});expect(result).toMatchObject({status:'complete',progress:{completed:3,pending:0}});
  expect(result.progress.tasks.map((task:any)=>task.attempts)).toEqual([1,1,1]);
 });
}));

it('原本指紋や固定計画が変わったsessionを拒否し、失敗後も再開できる',()=>fixture(async({paths,input})=>{
 const settings=paths('integrity');
 await expect(withFinancialBuildSession({...settings,input:{...input,archiveSha256:'0'.repeat(64)}},async()=>{})).rejects.toThrow('archive differs');
 expect(fs.existsSync(settings.statePath)).toBe(false);
 await withFinancialBuildSession(settings,async({runBatch}:any)=>{await runBatch({maxCompanies:1})});
 await expect(withFinancialBuildSession({...settings,input:{...input,generation:'changed'}},async()=>{})).rejects.toThrow();
 await withFinancialBuildSession(settings,async({runBatch}:any)=>{expect((await runBatch({maxCompanies:3})).progress.completed).toBe(3)});
}));
