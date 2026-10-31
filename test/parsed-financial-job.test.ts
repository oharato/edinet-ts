import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ParsedFinancialJob,type ParsedFinancialJobInput} from '../src/db/parsed-financial-job';
import {ParsedFinancialStore,parsedFinancialMappingVersions} from '../src/db/parsed-financial-store';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {Database} from '../src/db/node-sqlite';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
async function fixture(fn:(s:any)=>Promise<void>|void,compression?:'gzip'){
 const dir=mkdtempSync(join(tmpdir(),'edinet-parse-job-')),archivePath=join(dir,'archive.sqlite'),storePath=join(dir,'parsed.sqlite'),jobPath=join(dir,'job.sqlite');
 const sources=['A','B','C'].map((docID,i)=>({docID,availableAt:'2026-07-01T00:00:00.000Z',xml:reportingInstance({standard:i===1?'IFRS':'Japan GAAP',issuer:'E1200'+i,security:'100'+i+'0'})})).map(s=>({...s,sourceSha256:hash(s.xml)}));
 const writer=new ObservedFinancialArchive(archivePath,{compression});writer.append([],sources);writer.close();
 const archive=new ObservedFinancialArchive(archivePath,{readOnly:true});let store=new ParsedFinancialStore(storePath),job=new ParsedFinancialJob(jobPath);
 const input:ParsedFinancialJobInput={id:'parse',archiveSha256:archive.snapshotSha256(),tasks:sources.map(({docID,sourceSha256,availableAt})=>({availableAt,identity:{docID,sourceSha256,extractorVersion:'parser-1',sourceCommit:'a'.repeat(40),mappingVersions:parsedFinancialMappingVersions()}}))};
 const state:any={dir,archivePath,storePath,jobPath,archive,input,sources,get store(){return store},get job(){return job},reopen(){store.close();job.close();store=new ParsedFinancialStore(storePath);job=new ParsedFinancialJob(jobPath)}};
 try{await fn(state)}finally{job.close();store.close();archive.close();rmSync(dir,{recursive:true,force:true})}
}
it.each([undefined,'gzip'] as const)('DB内の%s原本を分割解析し再openで再開、完了後は原本を読まない',compression=>fixture(async s=>{
 const original=readFileSync(s.archivePath);s.job.begin(s.input);expect(s.job.begin({...s.input,tasks:[...s.input.tasks].reverse()})).toEqual(s.job.plan('parse'));
 expect((await s.job.runNext('parse',s.archive,s.store,{limit:1}))).toMatchObject({processed:1,pending:2,completed:1,finished:false});s.reopen();
 expect((await s.job.runNext('parse',s.archive,s.store,{limit:2}))).toMatchObject({processed:2,pending:0,completed:3,failed:0,finished:true});
 const read=s.archive.readSource;s.archive.readSource=function(input:any,options:any){if(options?.includeXml!==false)throw Error('must not read XML');return read.call(this,input,options)};try{expect((await s.job.runNext('parse',s.archive,s.store))).toMatchObject({processed:0,reused:3,finished:true})}finally{s.archive.readSource=read}
 const invalid={...s.input,id:'invalid-cached-source',tasks:s.input.tasks.map((t:any)=>({...t,availableAt:'2026-08-01T00:00:00Z'}))};s.job.begin(invalid);await expect(s.job.runNext(invalid.id,s.archive,s.store)).rejects.toThrow('保存');
 expect(s.store.page().records).toHaveLength(3);expect(readFileSync(s.archivePath)).toEqual(original);
},compression));
it('保存commit後の中断を重複解析せず再開',()=>fixture(async s=>{
 s.job.begin(s.input);const original=s.store.put.bind(s.store);let crash=true;s.store.put=(v:any)=>{const result=original(v);if(crash){crash=false;throw Error('after commit')}return result};
 await expect(s.job.runNext('parse',s.archive,s.store)).rejects.toThrow('after commit');s.reopen();
 expect(s.job.progress('parse',s.store)).toMatchObject({completed:1,pending:2});expect(await s.job.runNext('parse',s.archive,s.store)).toMatchObject({processed:2,reused:1,completed:3});
}));
it('signalで中断し、同じjobで残件を再開',()=>fixture(async s=>{
 s.job.begin(s.input);const controller=new AbortController(),original=s.store.put.bind(s.store);s.store.put=(v:any)=>{const result=original(v);controller.abort();return result};
 expect(await s.job.runNext('parse',s.archive,s.store,{signal:controller.signal})).toMatchObject({processed:1,aborted:true,pending:2});s.reopen();
 expect(await s.job.runNext('parse',s.archive,s.store)).toMatchObject({completed:3,finished:true});
}));
it('失敗・未解決を成功値へせず、同じキーでは再解析しない',()=>fixture(async s=>{
 const tasks=s.input.tasks.map((t:any)=>({...t,identity:{...t.identity,detailMetricIds:['depreciationAndAmortizationCashFlow']}}));s.job.begin({...s.input,tasks});
 const first=await s.job.runNext('parse',s.archive,s.store);expect(first).toMatchObject({completed:1,failed:2,pending:0,finished:true});expect((await s.job.runNext('parse',s.archive,s.store)).processed).toBe(0);
 const next={...s.input,id:'new-version',tasks:s.input.tasks.map((t:any)=>({...t,identity:{...t.identity,extractorVersion:'parser-2'}}))};s.job.begin(next);expect((await s.job.runNext('new-version',s.archive,s.store)).processed).toBe(3);
}));
it('原本読込・Store保存のエラーを解析失敗で隠さない',()=>fixture(async s=>{
 s.job.begin(s.input);const original=s.archive.readSource;s.archive.readSource=()=>{throw Error('storage unavailable')};await expect(s.job.runNext('parse',s.archive,s.store)).rejects.toThrow('storage unavailable');s.archive.readSource=original;
 expect(s.job.progress('parse',s.store)).toMatchObject({pending:3,failed:0});
 const save=s.store.put;s.store.put=()=>{throw Error('disk error')};await expect(s.job.runNext('parse',s.archive,s.store)).rejects.toThrow('disk error');s.store.put=save;expect(s.job.progress('parse',s.store).pending).toBe(3);
}));
it('同じ原本でも取得時刻・hashが違う宣言へ暗黙に戻らない',()=>fixture(s=>{
 const source=s.sources[0],{xml,...declaration}=source;expect(s.archive.readSource(declaration)).toEqual(source);
 expect(s.archive.readSource({...declaration,availableAt:'2026-07-02T00:00:00Z'})).toBeUndefined();expect(s.archive.readSource({...declaration,sourceSha256:'b'.repeat(64)})).toBeUndefined();
 const writer=new ObservedFinancialArchive(s.archivePath);try{expect(()=>writer.readSource(declaration)).toThrow('readOnly')}finally{writer.close()}
}));
it('別入力・版・計画の改変は再開前に拒否',()=>fixture(async s=>{
 s.job.begin(s.input);expect(()=>s.job.begin({...s.input,archiveSha256:'b'.repeat(64)})).toThrow('変更');
 s.job.begin({...s.input,id:'wrong-source',archiveSha256:'b'.repeat(64)});await expect(s.job.runNext('wrong-source',s.archive,s.store)).rejects.toThrow('指紋');
 s.job.begin({...s.input,id:'wrong-map',tasks:s.input.tasks.map((t:any)=>({...t,identity:{...t.identity,mappingVersions:{...t.identity.mappingVersions,details:'future'}}}))});await expect(s.job.runNext('wrong-map',s.archive,s.store)).rejects.toThrow('版');
 s.job.close();const db=new Database(s.jobPath);db.exec("UPDATE parsed_job_plans SET sha256='corrupt'");db.close();s.reopen();expect(()=>s.job.progress('parse',s.store)).toThrow('hash');
}));
it('原本内容の破損を未取得として扱わない',()=>fixture(s=>{
 s.archive.close();const db=new Database(s.archivePath);db.exec("UPDATE archive_contents SET xml=x'00'");db.close();const corrupted=new ObservedFinancialArchive(s.archivePath,{readOnly:true});
 try{const {xml,...source}=s.sources[0];expect(()=>corrupted.readSource(source)).toThrow('不整合')}finally{corrupted.close()}
}));
it('未提供原本・別形式・不正入力・同時実行・readOnly jobを拒否',()=>fixture(async s=>{
 for(const change of [{tasks:[]},{tasks:[s.input.tasks[0],s.input.tasks[0]]},{extra:true}])expect(()=>s.job.begin({...s.input,...change})).toThrow();
 s.job.begin(s.input);const running=s.job.runNext('parse',s.archive,s.store,{limit:1});await expect(s.job.runNext('parse',s.archive,s.store)).rejects.toThrow('実行中');await running;
 await expect(s.job.runNext('parse',s.archive,s.store,{limit:101})).rejects.toThrow();const source={...s.input.tasks[0],availableAt:'2026-08-01T00:00:00Z'};s.job.begin({...s.input,id:'missing',tasks:[{...source,identity:{...source.identity,extractorVersion:'new'}}]});await expect(s.job.runNext('missing',s.archive,s.store)).rejects.toThrow('保存');
 s.job.close();const before=readFileSync(s.jobPath),ro=new ParsedFinancialJob(s.jobPath,{readOnly:true});try{expect(ro.progress('parse',s.store).completed).toBe(1);await expect(ro.runNext('parse',s.archive,s.store)).rejects.toThrow('readOnly')}finally{ro.close()}expect(readFileSync(s.jobPath)).toEqual(before);
}));
it('解析失敗と基準未解決を保存し、未処理へ戻したり0値を作らない',()=>fixture(async s=>{
 s.archive.close();const additions=[{docID:'BROKEN',xml:'<broken>'},{docID:'US',xml:reportingInstance({standard:'US GAAP'})}].map(v=>({...v,sourceSha256:hash(v.xml),availableAt:'2026-07-01T00:00:00.000Z'}));
 const writer=new ObservedFinancialArchive(s.archivePath);writer.append([],additions);writer.close();const archive=new ObservedFinancialArchive(s.archivePath,{readOnly:true});
 try{const input={...s.input,id:'edge',archiveSha256:archive.snapshotSha256(),tasks:additions.map(({docID,sourceSha256,availableAt})=>({availableAt,identity:{...s.input.tasks[0].identity,docID,sourceSha256}}))};s.job.begin(input);
  expect(await s.job.runNext('edge',archive,s.store)).toMatchObject({pending:0,completed:1,failed:1,unresolved:1,finished:true});
  expect((await s.job.runNext('edge',archive,s.store)).processed).toBe(0);expect(s.store.page().records.map((r:any)=>r.outcome.status).sort()).toEqual(['completed','failed']);
 }finally{archive.close()}
}));
