import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {ObservedFinancialArchive} from '../src/index';
import {Database} from '../src/db/node-sqlite';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const cutoff='2026-07-01T00:00:00Z', xml=reportingInstance({issuer:'E12001',security:'10010'});
const hash=(x:string)=>createHash('sha256').update(x).digest('hex');
function observation(docID:string,parentDocID:string|null=null,edinetCode='E12001'){
 return {observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID,docTypeCode:parentDocID?'130':'120',edinetCode,secCode:'10010',periodStart:parentDocID?null:'2025-04-01',periodEnd:parentDocID?null:'2026-03-31',submitDateTime:parentDocID?'2026-06-25 10:00':'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}};
}
async function fixture(fn:(a:ObservedFinancialArchive,p:string)=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),'financial-acquisition-')),p=join(dir,'archive.sqlite');let a=new ObservedFinancialArchive(p);
 try {a.append([observation('A1'),observation('A2'),observation('A3')]);await fn(a,p);}finally{a.close();rmSync(dir,{recursive:true,force:true});vi.useRealTimers();}
}
it('原本不在・宣言のみ・保存済みをXML解析なしで分離する',()=>fixture(async a=>{
 a.append([],[{docID:'A2',availableAt:'2026-06-27T00:00:00Z',sourceSha256:hash(xml)},{docID:'A3',availableAt:'2026-06-27T00:00:00Z',sourceSha256:hash(xml),xml}]);
 // 内容はhash共用なのでA2も保存済み。宣言だけは別hashで試す。
 const other=xml.replace('>10<','>11<');a.append([],[{docID:'A2',availableAt:'2026-06-28T00:00:00Z',sourceSha256:hash(other)}]);
 const p=a.planSourceAcquisition({cutoff});expect(p.items.map(i=>i.status)).toEqual(['missing','declaration-only','stored']);expect(p.items[2].availableByCutoff).toBe(true);
}));
it('成功を一件ずつ保存し、再openしても取得し直さず、取得日時を過去へ戻さない',()=>fixture(async (a,p)=>{
 const fetcher=vi.fn(async()=>xml);const first=await a.acquireSources({cutoff},fetcher,{limit:1});expect(first).toMatchObject({remaining:2,nextAfterDocID:'A1',aborted:false});expect(first.results[0].status).toBe('stored');expect(Date.parse(first.results[0].availableAt!)).toBeGreaterThan(Date.parse(cutoff));
 a.close();const reopened=new ObservedFinancialArchive(p);try{const second=await reopened.acquireSources({cutoff},fetcher,{limit:2});expect(second.results.map(r=>r.docID)).toEqual(['A2','A3']);expect(fetcher).toHaveBeenCalledTimes(3);expect((await reopened.acquireSources({cutoff},fetcher)).results).toEqual([]);expect(reopened.planSourceAcquisition({cutoff}).items.every(i=>i.status==='stored'&&!i.availableByCutoff)).toBe(true);expect(reopened.createSnapshots({cutoff,extractorVersion:'test'}).records).toHaveLength(0);}finally{reopened.close();}
}));
it('失敗を秘匿し、cursorで後続を処理してから失敗だけ再試行する',()=>fixture(async a=>{
 let failing=true;const f=vi.fn(async(id:string)=>{if(id==='A1'&&failing)throw Error('SECRET-KEY');return xml;});const first=await a.acquireSources({cutoff},f,{limit:1});expect(first.results).toEqual([{docID:'A1',status:'failed',errorCode:'source-acquisition-failed'}]);expect(JSON.stringify(first)).not.toContain('SECRET-KEY');
 const second=await a.acquireSources({cutoff},f,{afterDocID:first.nextAfterDocID});expect(second.results.map(r=>r.docID)).toEqual(['A2','A3']);failing=false;const third=await a.acquireSources({cutoff},f);expect(third.results.map(r=>r.docID)).toEqual(['A1']);
}));
it('訂正leafだけを取得し、親原本へfallbackしない',()=>fixture(async a=>{
 a.append([observation('B1','A1')]);const f=vi.fn(async()=>xml);const r=await a.acquireSources({cutoff},f);expect(r.results.map(r=>r.docID)).toEqual(['A2','A3','B1']);expect(f.mock.calls).toHaveLength(3);expect(r.plan.selection.selected.find(s=>s.rootDocID==='A1')!.observation.document.docID).toBe('B1');
}));
it('会社が異なる訂正系列を取得しない',()=>fixture(async a=>{
 a.append([observation('B1','A1','E12002')]);const r=await a.acquireSources({cutoff,edinetCodes:['E12001']},async()=>xml);expect(r.results.map(r=>r.docID)).toEqual(['A2','A3']);expect(r.plan.selection.decisions.find(d=>d.rootDocID==='A1')!.status).toBe('unresolved');
}));
it('開始前および受信中の中断は未commitの原本を保存せず再開できる',()=>fixture(async a=>{
 const c=new AbortController();c.abort();const f=vi.fn(async()=>xml);expect((await a.acquireSources({cutoff},f,{signal:c.signal})).aborted).toBe(true);expect(f).not.toHaveBeenCalled();
 const c2=new AbortController();const r=await a.acquireSources({cutoff},async()=>{c2.abort();return xml;},{signal:c2.signal});expect(r).toMatchObject({aborted:true,remaining:3,results:[]});expect(a.planSourceAcquisition({cutoff}).items.every(i=>i.status==='missing')).toBe(true);
}));
it.each(['','not xml','<!DOCTYPE x><x/>','<broken>'])('不正なXML %j を成功扱いで保存しない',bad=>fixture(async a=>{
 const r=await a.acquireSources({cutoff},async()=>bad,{limit:1});expect(r.results[0].status).toBe('failed');expect(a.planSourceAcquisition({cutoff}).items[0].status).toBe('missing');
}));
it('同時刻hash競合を保存済みとせず、新しい取得観測で分離する',()=>fixture(async a=>{
 const other=xml.replace('>10<','>11<');for(const body of [xml,other])a.append([],[{docID:'A1',availableAt:'2026-06-27T00:00:00Z',sourceSha256:hash(body),xml:body}]);expect(a.planSourceAcquisition({cutoff}).items[0].status).toBe('conflicting');const r=await a.acquireSources({cutoff},async()=>xml,{limit:1});expect(r.results[0].status).toBe('stored');expect(a.planSourceAcquisition({cutoff}).items[0].status).toBe('stored');expect(a.createSnapshots({cutoff,extractorVersion:'test'}).unavailableSources.find(u=>u.docID==='A1')!.reason).toBe('conflicting-source-observations');
}));
it('readOnlyでの計画は元byteを変更せず、取得を通信前に止める',()=>fixture(async(a,p)=>{
 a.close();const before=readFileSync(p),ro=new ObservedFinancialArchive(p,{readOnly:true}),f=vi.fn(async()=>xml);try{expect(ro.planSourceAcquisition({cutoff}).items).toHaveLength(3);await expect(ro.acquireSources({cutoff},f)).rejects.toThrow('書込');expect(f).not.toHaveBeenCalled();}finally{ro.close();}expect(readFileSync(p)).toEqual(before);
}));
it('保存本文の破損は不足へ変換して上書き取得しない',()=>fixture(async(a,p)=>{
 a.append([],[{docID:'A1',availableAt:'2026-06-27T00:00:00Z',sourceSha256:hash(xml),xml}]);a.close();const db=new Database(p);db.exec("UPDATE archive_contents SET xml=x'31'");db.close();const corrupt=new ObservedFinancialArchive(p);const f=vi.fn(async()=>xml);try{await expect(corrupt.acquireSources({cutoff},f)).rejects.toThrow('hash');expect(f).not.toHaveBeenCalled();}finally{corrupt.close();}
}));
it('不正な入力は通信前に拒否する',()=>fixture(async a=>{
 const f=vi.fn(async()=>xml);for(const batch of [{limit:0},{limit:101},{afterDocID:''},{signal:{}},{other:true}])await expect(a.acquireSources({cutoff},f,batch as never)).rejects.toThrow();for(const input of [{cutoff:'bad'},{cutoff,edinetCodes:[]},{cutoff,unknown:1}])expect(()=>a.planSourceAcquisition(input as never)).toThrow();expect(f).not.toHaveBeenCalled();
}));
it('未来の最新観測より前の取得で成功扱いにしない',()=>fixture(async a=>{
 a.append([],[{docID:'A1',availableAt:'2099-01-01T00:00:00Z',sourceSha256:hash(xml)}]);const r=await a.acquireSources({cutoff},async()=>xml,{limit:1});expect(r.results[0].status).toBe('failed');expect(a.planSourceAcquisition({cutoff}).items[0].status).toBe('declaration-only');
}));
it('原本commitの失敗を成功とせず、再巡回で保存し直す',()=>fixture(async a=>{
 const original=a.append.bind(a);let fail=true;a.append=(...args)=>{if(fail)throw Error('SECRET-storage-error');return original(...args);};const first=await a.acquireSources({cutoff},async()=>xml,{limit:1});expect(first.results[0].status).toBe('failed');expect(JSON.stringify(first)).not.toContain('SECRET');fail=false;const next=await a.acquireSources({cutoff},async()=>xml,{limit:1});expect(next.results[0]).toMatchObject({docID:'A1',status:'stored'});
}));
it('取得途中のclose後に次の原本へ通信を続けない',()=>fixture(async a=>{
 const f=vi.fn(async()=>{a.close();return xml;});await expect(a.acquireSources({cutoff},f)).rejects.toThrow('close');expect(f).toHaveBeenCalledTimes(1);
}));
it('未提供宣言より検査済み原本を優先し、不明宣言は取得する',()=>fixture(async a=>{
 a.append(['A1','A2','A3'].map(docID=>({...observation(docID),observationId:docID+'-format',observedAt:'2026-06-27T00:00:00Z',document:{...observation(docID).document,xbrlFlag:docID==='A3'?'unknown':'0'}})));
 a.append([],[{docID:'A1',availableAt:'2026-06-28T00:00:00Z',sourceSha256:hash(xml),xml}]);
 expect(a.planSourceAcquisition({cutoff}).items.map(i=>i.status)).toEqual(['stored','unavailable','missing']);
 const f=vi.fn(async()=>xml);const result=await a.acquireSources({cutoff},f);expect(result.results.map(r=>r.docID)).toEqual(['A3']);expect(f).toHaveBeenCalledTimes(1);
 expect(a.createSnapshots({cutoff,extractorVersion:'test'}).unavailableSources).toContainEqual(expect.objectContaining({docID:'A2',reason:'xbrl-not-provided'}));
}));
