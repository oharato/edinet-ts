import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {createObservedFinancialSnapshots as run,selectDocumentVersions,type DocumentVersionObservation,type ObservedFinancialSource} from '../src/index';
import {reportingInstance as xml} from './fixtures/financial-reporting-basis';
const cutoff='2026-10-28T00:00:00Z';
function observation(id='A',parent?:string,extra:Record<string,unknown>={}):DocumentVersionObservation{return {observationId:id,observedAt:'2026-06-26T00:00:00Z',document:{docID:id,parentDocID:parent??null,docTypeCode:parent?'130':'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:parent?'2026-06-25 10:00':'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',...extra}};}
function source(docID='A',input=xml()):ObservedFinancialSource{return {docID,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(input).digest('hex'),xml:input};}
it('選択原本のDEIと一覧を照合し、観測と取得の遅い時刻を既知時刻にする',()=>{
 const r=run([observation()],[source()],{cutoff});expect(r.records).toHaveLength(1);expect(r.unavailableSources).toEqual([]);
 expect(r.records[0]).toMatchObject({docID:'A',rootDocID:'A',chainDocIDs:['A'],knownAt:'2026-06-27T00:00:00.000Z',result:{status:'resolved',accountingStandard:'J-GAAP',details:{status:'created'}}});
});
it('後から観測した訂正の取下げも選択に必要なknownAtに含める',()=>{
 const a=observation(),b=observation('B','A',{withdrawalStatus:'2'});b.observedAt='2026-06-30T00:00:00Z';
 const r=run([a,b],[source()],{cutoff});expect(r.records[0]).toMatchObject({docID:'A',knownAt:'2026-06-30T00:00:00.000Z'});
 expect(r.selection.selected[0]).toMatchObject({observation:{document:{docID:'A'}},observedAt:'2026-06-30T00:00:00.000Z'});
});
it('訂正版の直接値だけを採用し、親の明細で不在を補完しない',()=>{
 const corrected=xml().replace(/<jppfs_cor:CostOfSales\b[^>]*>[\s\S]*?<\/jppfs_cor:CostOfSales>/,'');
 const r=run([observation(),observation('B','A')],[source(),source('B',corrected)],{cutoff});
 expect(r.selection.financialValuesMerged).toBe(false);expect(r.records).toHaveLength(1);expect(r.records[0]).toMatchObject({docID:'B',chainDocIDs:['A','B'],result:{details:{snapshot:{selections:{costOfSales:{status:'missing',reason:'tag-absent'}}}}}});
});
it.each(['missing','future','unloaded','hash','parse','before'] as const)('訂正原本の%sを理由付きで保留し親に戻らない',kind=>{
 const s=source('B');if(kind==='future')s.availableAt='2026-10-29T00:00:00Z';if(kind==='unloaded')delete s.xml;if(kind==='hash')s.sourceSha256='0'.repeat(64);if(kind==='parse'){s.xml='<invalid>';s.sourceSha256=createHash('sha256').update(s.xml).digest('hex');}if(kind==='before')s.availableAt='2026-06-20T00:00:00Z';
 const r=run([observation(),observation('B','A')],kind==='missing'?[source()]:[source(),s],{cutoff});expect(r.records).toEqual([]);
 expect(r.unavailableSources).toEqual([{docID:'B',rootDocID:'A',reason:{missing:'source-missing',future:'not-available-at-cutoff',unloaded:'source-not-loaded',hash:'source-hash-mismatch',parse:'source-parse-failed',before:'source-before-submission'}[kind]}]);
});
it.each([['edinetCode','E99999','issuer-mismatch'],['secCode','99990','security-code-mismatch'],['periodEnd','2026-03-30','period-mismatch'],['docTypeCode','160','report-type-mismatch']])('一覧の%sが原本と不一致なら採用しない',(field,value,reason)=>{
 const r=run([observation('A',undefined,{[field]:value})],[source()],{cutoff});expect(r.records).toEqual([]);expect(r.unavailableSources[0].reason).toBe(reason);
});
it('訂正版に期間記載がなくても親の一覧期間と原本DEIを照合する',()=>{
 const r=run([observation(),observation('B','A',{periodStart:null,periodEnd:null})],[source('B')],{cutoff});expect(r.records[0].docID).toBe('B');expect(r.selection.selected[0].targetPeriod.sourceDocID).toBe('A');
});
it('cutoffより後の訂正観測・取得原本を遡及利用しない',()=>{
 const b=observation('B','A');b.observedAt='2026-10-29T00:00:00Z';
 expect(run([observation(),b],[source(),source('B')],{cutoff}).records[0].docID).toBe('A');
 expect(run([observation()],[source()],{cutoff:'2026-06-25T00:00:00Z'}).records).toEqual([]);
});
it('曖昧な訂正系列・不開示系列から抽出しない',()=>{
 for(const observations of [[observation(),observation('B','A'),observation('C','A')],[observation('A',undefined,{disclosureStatus:'2'})]]){
  const r=run(observations,[source()],{cutoff});expect(r.records).toEqual([]);expect(r.unavailableSources).toEqual([]);
 }
});
it('IFRS連結と対象外単体を日本基準に切り替えず結果に保持する',()=>{
 expect(run([observation()],[source('A',xml({standard:'IFRS'}))],{cutoff}).records[0].result).toMatchObject({status:'resolved',accountingStandard:'IFRS'});
 expect(run([observation()],[source('A',xml({standard:'IFRS',consolidated:'false'}))],{cutoff}).records[0].result).toMatchObject({status:'unresolved',reason:'unsupported-ifrs-scope'});
});
it('DEI不明と証券コード不在を解析失敗にしない',()=>{
 expect(run([observation()],[source('A',xml({standard:'US GAAP'}))],{cutoff}).records[0].result).toMatchObject({status:'unresolved',reason:'basis-unresolved'});
 expect(run([observation('A',undefined,{secCode:null})],[source('A',xml({security:null}))],{cutoff}).records[0].result).toMatchObject({status:'unresolved',reason:'security-code-unavailable'});
});
it('半期のHYと実在するQ2累計を期間と書類種別で照合する',()=>{
 for(const periodCode of ['HY','Q2'])expect(run([observation('A',undefined,{docTypeCode:'160',periodEnd:'2025-09-30'})],[source('A',xml({periodCode,currentEnd:'2025-09-30'}))],{cutoff}).records).toHaveLength(1);
 expect(run([observation('A',undefined,{docTypeCode:'140',periodEnd:'2025-09-30'})],[source('A',xml({periodCode:'HY',currentEnd:'2025-09-30'}))],{cutoff}).unavailableSources[0].reason).toBe('report-type-mismatch');
});
it('原本がなくても不正項目・未知options・疎配列を拒否する',()=>{
 for(const fn of [()=>run([],[],{cutoff,detailMetricIds:['unknown'] as never}),()=>run([],[],{cutoff,detailMetricIds:['costOfSales','costOfSales']}),()=>run([],[],{cutoff,extra:true} as never),()=>run([],new Array(1),{cutoff}),()=>run(new Array(1),[],{cutoff}),()=>run([],[],{cutoff,detailMetricIds:new Array(1)})])expect(fn).toThrow();
});
it('原本の重複・hash/取得日時/未知属性・件数上限を拒否する',()=>{
 const s=source();for(const sources of [[s,s],[{...s,sourceSha256:'bad'}],[{...s,availableAt:'2026-06-27 00:00'}],[{...s,extra:true}],Array.from({length:101},()=>s)])expect(()=>run([],sources,{cutoff})).toThrow();
});
it('独自iteratorを使わず、指定配列の各indexだけを検証する',()=>{
 const observations=[observation()],sources=[source()];observations[Symbol.iterator]=()=>{throw Error('iterator');};sources[Symbol.iterator]=()=>{throw Error('iterator');};
 expect(run(observations,sources,{cutoff}).records).toHaveLength(1);
});
it('出力の一覧情報・配列を変更しても元入力を変えない',()=>{
 const a=observation(),s=source(),r=run([a],[s],{cutoff});r.selection.selected[0].observation.document.docID='OTHER';r.records[0].chainDocIDs.push('OTHER');expect(a.document.docID).toBe('A');expect(s.docID).toBe('A');
});
it('基準に合わない明示項目をXML解析失敗と区別する',()=>{
 const r=run([observation()],[source('A',xml({standard:'IFRS'}))],{cutoff,detailMetricIds:['incomeTaxes']});expect(r.unavailableSources[0].reason).toBe('metric-projection-mismatch');
});
it('観測・原本のlengthを一回だけ固定して上限を検証する',()=>{
 let observationReads=0,sourceReads=0;
 const observations=new Proxy([observation()],{get:(o,k,r)=>k==='length'?(++observationReads===1?1:10001):Reflect.get(o,k,r)});
 const sources=new Proxy([source()],{get:(o,k,r)=>k==='length'?(++sourceReads===1?1:101):Reflect.get(o,k,r)});
 expect(run(observations,sources,{cutoff}).records).toHaveLength(1);expect(observationReads).toBe(1);expect(sourceReads).toBe(1);
});
