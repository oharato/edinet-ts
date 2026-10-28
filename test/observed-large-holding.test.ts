import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {searchObservedLargeHoldingReports as search,type LargeHoldingSearchOptions,type LargeHoldingDocument} from '../src/index';
import {largeDocument} from './fixtures/large-holding-report';
const options:LargeHoldingSearchOptions={cutoff:'2026-10-28T00:00:00Z',dutyDate:'2025-06-16',scope:'report',metric:'holdingPercent'};
const observation=(d:LargeHoldingDocument)=>({observationId:d.metadata.docID,observedAt:d.metadata.knownAt,document:{...d.metadata}});
const source=(d:LargeHoldingDocument)=>({docID:d.metadata.docID,availableAt:d.metadata.knownAt,sourceSha256:createHash('sha256').update(d.xml).digest('hex'),coverContextRef:'cover',xml:d.xml});
it('観測済み訂正版を選び原本hashとcutoffを保った検索へ接続する',()=>{
 const a=largeDocument({docID:'ORIGINAL'}),b=largeDocument({docID:'CORRECTED',correction:true});
 const r=search([observation(a),observation(b)],[source(a),source(b)],options);
 expect(r.matched).toBe(1);expect(r.reports[0].metadata.docID).toBe('CORRECTED');expect(r.unavailableSources).toEqual([]);
});
it.each(['missing','future','unloaded','hash','parse'] as const)('訂正原本が%sでも親の数値へ戻らない',kind=>{
 const a=largeDocument({docID:'ORIGINAL'}),b=largeDocument({docID:'CORRECTED',correction:true}),s=source(b);
 if(kind==='future')s.availableAt='2026-10-29T00:00:00Z';
 if(kind==='hash')s.sourceSha256='0'.repeat(64);
 if(kind==='parse'){s.xml='not xml';s.sourceSha256=createHash('sha256').update(s.xml).digest('hex');}
 const r=search([observation(a),observation(b)],kind==='missing'?[source(a)]:[source(a),kind==='unloaded'?{...s,xml:undefined}:s],options);
 expect(r.matched).toBe(0);expect(r.reports).toEqual([]);expect(r.unavailableSources[0].docID).toBe('CORRECTED');
 expect(r.unavailableSources[0].reason).toBe({missing:'source-missing',future:'not-available-at-cutoff',unloaded:'source-not-loaded',hash:'source-hash-mismatch',parse:'source-parse-failed'}[kind]);
});
it('原本と一覧の遅い観測時刻を既知時刻として使う',()=>{
 const d=largeDocument({knownAt:'2025-06-25T00:00:00Z'}),s={...source(d),availableAt:'2025-06-26T00:00:00Z'};
 expect(search([observation(d)],[s],options).reports[0].metadata.knownAt).toBe(s.availableAt.replace('Z','.000Z'));
});
it('明示0を採用し未選択原本は解析しない',()=>{
 const d=largeDocument();d.xml=d.xml.replace('>0.0297</','>0</');const unused={...source(d),docID:'UNUSED',xml:'invalid'};
 expect(search([observation(d)],[source(d),unused],{...options,condition:{operator:'eq',value:0}}).matched).toBe(1);
});
it('重複原本と不正宣言や検索条件を拒否する',()=>{
 const d=largeDocument(),s=source(d);
 for(const run of [()=>search([], [s,s],options),()=>search([],[{...s,sourceSha256:'bad'}],options),()=>search([],[],{...options,scope:'bad'} as never)])expect(run).toThrow();
});
