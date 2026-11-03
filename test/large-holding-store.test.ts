import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {LargeHoldingStore} from '../src/db/large-holding-store';
import {searchObservedLargeHoldingReports} from '../src/observed-large-holding';
import {Database} from '../src/db/node-sqlite';
import {largeDocument} from './fixtures/large-holding-report';
import type {LargeHoldingDocument,LargeHoldingSearchOptions} from '../src/large-holding-report';
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const observation=(d:LargeHoldingDocument,id=d.metadata.docID)=>({observationId:id,observedAt:d.metadata.knownAt,document:{...d.metadata}});
const source=(d:LargeHoldingDocument)=>({docID:d.metadata.docID,availableAt:d.metadata.knownAt,sourceSha256:hash(d.xml),coverContextRef:d.metadata.coverContextRef,xml:d.xml});
const options:LargeHoldingSearchOptions={cutoff:'2026-10-29T00:00:00Z',dutyDate:'2025-06-16',scope:'report',metric:'holdingPercent'};
function fixture(use:(file:string)=>void){const dir=mkdtempSync(join(tmpdir(),'holding-store-'));try{use(join(dir,'store.sqlite'))}finally{rmSync(dir,{recursive:true,force:true})}}
const rows=(r:ReturnType<LargeHoldingStore['search']>|ReturnType<typeof searchObservedLargeHoldingReports>)=>r.rows.map(v=>({docID:r.reports[v.sourceIndex].metadata.docID,row:v.row}));

it('保存・再open後も訂正版選択/出典/十進値がXML検索と一致する',()=>fixture(file=>{
 const a=largeDocument({docID:'ORIGINAL'}),b=largeDocument({docID:'CORRECTED',correction:true,two:true}),obs=[observation(a),observation(b)],sources=[source(a),source(b)],writer=new LargeHoldingStore(file);
 expect(writer.append(obs,sources)).toEqual({observations:2,sources:2,materializedSnapshots:2});expect(writer.append(obs,sources)).toEqual({observations:0,sources:0,materializedSnapshots:0});writer.close();
 const before=hash(readFileSync(file)),store=new LargeHoldingStore(file,{readOnly:true});
 try{for(const scope of ['report','holder'] as const){const q={...options,scope},result=store.search(q),legacy=searchObservedLargeHoldingReports(obs,sources,q);expect(result.selection).toEqual(legacy.selection);expect(rows(result)).toEqual(rows(legacy));expect(result.matched).toBe(legacy.matched);expect(result.unavailableSources).toEqual([]);expect(result.storage.originalXmlStored).toBe(false)}expect(store.audit()).toEqual({verification:'all-records',observations:2,sources:2,snapshots:2,originalXmlStored:false});}finally{store.close()}
 expect(hash(readFileSync(file))).toBe(before);
 const db=new Database(file,{readOnly:true});try{expect(db.prepare('SELECT decimal_text,value_unit,multiplier FROM holding_values WHERE metric_id=? ORDER BY doc_id,role').all('holdingPercent')).toContainEqual({decimal_text:'5.0500',value_unit:'percent',multiplier:100})}finally{db.close()}
}));
it.each(['missing','future','unloaded','parse'] as const)('訂正原本が%sでも旧版へ戻らない',kind=>fixture(file=>{
 const a=largeDocument({docID:'ORIGINAL'}),b=largeDocument({docID:'CORRECTED',correction:true}),s=source(b);
 if(kind==='future')s.availableAt='2026-10-30T00:00:00Z';if(kind==='parse'){s.xml='not XML';s.sourceSha256=hash(s.xml)}
 const store=new LargeHoldingStore(file);try{store.append([observation(a),observation(b)],[source(a),...(kind==='missing'?[]:[kind==='unloaded'?{...s,xml:undefined}:s])]);const r=store.search(options);expect(r.matched).toBe(0);expect(r.unavailableSources[0].reason).toBe({missing:'source-missing',future:'not-available-at-cutoff',unloaded:'source-not-loaded',parse:'source-parse-failed'}[kind]);}finally{store.close()}
}));
it('未読込bindingへ後から同じhashの原本を渡すと解析結果を保存する',()=>fixture(file=>{
 const d=largeDocument(),s=source(d),store=new LargeHoldingStore(file);try{store.append([observation(d)],[{...s,xml:undefined}]);expect(store.search(options).unavailableSources[0].reason).toBe('source-not-loaded');expect(store.append([],[s]).materializedSnapshots).toBe(1);expect(store.search(options).matched).toBe(1)}finally{store.close()}
}));
it('原本の競合をcutoffごとに保持し、既存値を上書きしない',()=>fixture(file=>{
 const d=largeDocument(),s=source(d),changed={...s,xml:d.xml.replace('>0.0297<','>0.06<'),availableAt:'2026-10-29T12:00:00Z'};changed.sourceSha256=hash(changed.xml);const store=new LargeHoldingStore(file);try{store.append([observation(d)],[s]);store.append([],[changed]);expect(store.search(options).matched).toBe(1);const r=store.search({...options,cutoff:'2026-10-30T00:00:00Z'});expect(r.matched).toBe(0);expect(r.unavailableSources[0].reason).toBe('conflicting-source-observations');}finally{store.close()}
}));
it('issuer絞込でも別issuerを宣言した訂正辺を読み、親を復活させない',()=>fixture(file=>{
 const a=largeDocument({docID:'ORIGINAL'}),b=largeDocument({docID:'CORRECTED',correction:true});b.metadata.issuerEdinetCode='E99999';const store=new LargeHoldingStore(file);try{store.append([observation(a),observation(b)],[source(a),source(b)]);const r=store.search({...options,issuerEdinetCode:a.metadata.issuerEdinetCode});expect(r.matched).toBe(0);expect(r.selection.decisions.some(d=>d.reason==='issuer-mismatch')).toBe(true)}finally{store.close()}
}));
it('新しいunknown-status/非対応種別で古い観測へ戻らない',()=>fixture(file=>{
 const d=largeDocument(),newer={...observation(d,'later'),observedAt:'2026-10-29T00:00:00Z',document:{...d.metadata,docTypeCode:'999'}};const store=new LargeHoldingStore(file);try{store.append([observation(d)],[source(d)]);store.append([newer]);expect(store.search(options).matched).toBe(0);expect(store.search({...options,cutoff:d.metadata.knownAt}).matched).toBe(1)}finally{store.close()}
}));
it('hash不一致と観測IDの付替えはbatch全体をrollbackする',()=>fixture(file=>{
 const d=largeDocument(),store=new LargeHoldingStore(file);try{store.append([observation(d)],[source(d)]);const before=store.audit();expect(()=>store.append([observation(d,'new')],[{...source(d),sourceSha256:'0'.repeat(64)}])).toThrow();expect(()=>store.append([{...observation(d),document:{...d.metadata,issuerEdinetCode:'E99999'}}])).toThrow();expect(store.audit()).toEqual(before)}finally{store.close()}
}));
it('解析本文と索引の改変を対象外のreportでも拒否する',()=>fixture(file=>{
 const d=largeDocument(),store=new LargeHoldingStore(file);store.append([observation(d)],[source(d)]);store.close();const db=new Database(file);db.exec("UPDATE holding_snapshots SET duty_date='2000-01-01'");db.close();const reader=new LargeHoldingStore(file,{readOnly:true});try{expect(()=>reader.search({...options,dutyDate:'2001-01-01'})).toThrow()}finally{reader.close()}
}));
