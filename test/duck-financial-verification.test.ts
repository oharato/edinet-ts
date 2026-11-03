import {it,expect} from 'vitest';import {join,dirname} from 'node:path';import {existsSync,readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';
import {FinancialIndexPublication,type FinancialIndexPublicationPolicy} from '../src/db/financial-index-publication';
import {FinancialSearchIndex} from '../src/db/financial-search-index';
import {Database} from '../src/db/node-sqlite';
import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
import {recordDuckFinancialValueVerification as record,validateDuckFinancialValueVerification as validate,activateVerifiedDuckFinancialPublication as activate,type DuckFinancialVerificationInput} from '../scripts/roadmap/duck-financial-value-verification';
const policy:FinancialIndexPublicationPolicy={minimumCompaniesWithUsableValues:4,maxUnavailableSources:0,maxUnresolvedSelections:0,maxUnavailableSelections:0,maxUnresolvedRecords:0,maxUnavailableGroups:0,maxDuplicateCohortIdentifiers:0,maxUnavailableValues:100};
const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const gateFixture=(fn:(i:DuckFinancialVerificationInput)=>Promise<void>)=>fixture(async({duck,dir})=>{const catalog=new FinancialIndexPublication(join(dir,'catalog.sqlite'));try{await catalog.prepareAsync('old',duck,'all',policy);await fn({reader:duck,catalog,candidateId:'old',archivePath:join(dir,'a.sqlite'),recordPath:join(dir,'receipt.json'),inputSha256:'a'.repeat(64)})}finally{catalog.close()}});
it('検証用SQLiteはDuckDBの全品質と一致し、成功・失敗時とも削除する',()=>fixture(async({duck})=>{
 let file='';await duck.withVerificationProjection(async path=>{file=path;const sqlite=new FinancialSearchIndex(path,{readOnly:true});try{expect(sqlite.quality('all')).toEqual(await duck.quality('all'))}finally{sqlite.close()}});expect(existsSync(dirname(file))).toBe(false);
 await expect(duck.withVerificationProjection(async path=>{file=path;throw Error('verifier failed')})).rejects.toThrow('verifier failed');expect(existsSync(dirname(file))).toBe(false);
}));
it('独立Pythonで全採用値を原本照合し、記録・再検証・切替・復帰する',()=>gateFixture(async i=>{
 const receipt=await record(i);expect(receipt.checks.documents).toBe(4);expect(receipt.checks.currentStandaloneIfrsRowsChecked).toBe(2);expect(await record(i)).toEqual(receipt);expect(await validate(i)).toMatchObject({candidateId:'old'});await activate(i,{expectedActive:null});
 await i.catalog.prepareAsync('new',i.reader,'all',policy);const next={...i,candidateId:'new',recordPath:join(dirname(i.recordPath),'next.json')};await record(next);await activate(next,{expectedActive:'old'});await activate(i,{expectedActive:'new'});expect(i.catalog.history().map(h=>h.publication)).toEqual(['old','new','old']);
}),30000);
it('記録なし・別候補・別入力の記録では切り替えない',()=>gateFixture(async i=>{
 await expect(activate(i,{expectedActive:null})).rejects.toThrow('unverified');expect(i.catalog.current()).toBeUndefined();await record(i);await expect(validate({...i,inputSha256:'b'.repeat(64)})).rejects.toThrow('binding');await i.catalog.prepareAsync('new',i.reader,'all',policy);await expect(activate({...i,candidateId:'new'},{expectedActive:null})).rejects.toThrow('binding');expect(i.catalog.current()).toBeUndefined();
}));
it.each(['checks','verifierSha256'])('hashを作り直しても改変した%sを受け付けない',field=>gateFixture(async i=>{
 await record(i);const saved=JSON.parse(readFileSync(i.recordPath,'utf8'));if(field==='checks')saved.checks.selectedValues++;else saved.verifierSha256='b'.repeat(64);const {sha256:_,...body}=saved;saved.sha256=hash(canonical(body));writeFileSync(i.recordPath,JSON.stringify(saved));await expect(activate(i,{expectedActive:null})).rejects.toThrow();expect(i.catalog.current()).toBeUndefined();
}));
it('記録後に原本が変わっていたら再照合で拒否する',()=>gateFixture(async i=>{
 await record(i);const db=new Database(i.archivePath);try{db.exec("UPDATE archive_contents SET xml='changed'")}finally{db.close()}
 await expect(activate(i,{expectedActive:null})).rejects.toThrow('verification failed');expect(i.catalog.current()).toBeUndefined();
}));
it('副ファイル・条件未達候補・中断signalを拒否してpointerを保持する',()=>gateFixture(async i=>{
 await i.catalog.prepareAsync('blocked',i.reader,'all');await expect(record({...i,candidateId:'blocked'})).rejects.toThrow('ineligible');writeFileSync(i.archivePath+'-wal','sidecar');await expect(record(i)).rejects.toThrow('sidecars');
}),30000);
it('中断済みsignalでは記録も切替も行わない',()=>gateFixture(async i=>{
 const controller=new AbortController();controller.abort();await expect(record({...i,signal:controller.signal})).rejects.toThrow();expect(existsSync(i.recordPath)).toBe(false);expect(i.catalog.current()).toBeUndefined();
}));
it('closeは検証用projectionのcallback完了を待つ',()=>fixture(async({duck})=>{
 let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>started=r),waiting=new Promise<void>(r=>release=r);let file='';const task=duck.withVerificationProjection(async path=>{file=path;started();await waiting;expect(existsSync(path)).toBe(true)});await ready;const closed=duck.close();await expect(duck.generation('all')).rejects.toThrow('closed');release();await task;await closed;expect(existsSync(dirname(file))).toBe(false);
}));
it('照合中に原本副ファイルが現れたら記録保存前に拒否する',()=>gateFixture(async i=>{
 const reader=i.reader as any,original=reader.withVerificationProjection.bind(reader);reader.withVerificationProjection=(verify:any,options:any)=>original(async(path:string)=>{const result=await verify(path);writeFileSync(i.archivePath+'-wal','concurrent writer');return result},options);
 await expect(record(i)).rejects.toThrow('sidecars');expect(existsSync(i.recordPath)).toBe(false);expect(i.catalog.current()).toBeUndefined();
}));
