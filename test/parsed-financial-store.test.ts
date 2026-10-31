import {describe,it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Database} from '../src/db/node-sqlite';
import {ParsedFinancialStore,parsedFinancialExtractionId,parsedFinancialMappingVersions,type ParsedFinancialExtraction} from '../src/db/parsed-financial-store';
import {createAutomaticFinancialSnapshots} from '../src/automatic-financial-snapshots';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const clean=(v:unknown)=>JSON.parse(JSON.stringify(v));
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
function extraction(options:Parameters<typeof reportingInstance>[0]={},docID='D1'):ParsedFinancialExtraction {
 const xml=reportingInstance(options);
 return {parsedAt:'2026-10-31T00:00:00.000Z',identity:{docID,sourceSha256:hash(xml),extractorVersion:'parser-1',sourceCommit:'a'.repeat(40),mappingVersions:parsedFinancialMappingVersions()},
  outcome:{status:'completed',result:createAutomaticFinancialSnapshots(xml,{docID})}};
}
function withStore(fn:(s:ParsedFinancialStore,path:string,dir:string)=>void){
 const dir=mkdtempSync(join(tmpdir(),'edinet-parsed-')),path=join(dir,'parsed.sqlite'),s=new ParsedFinancialStore(path);
 try{fn(s,path,dir)}finally{s.close();rmSync(dir,{recursive:true,force:true})}
}
function sql(path:string,query:string){const c=new Database(path);try{c.exec(query)}finally{c.close()}}
function rows(path:string,query:string){const c=new Database(path,{readOnly:true});try{const stmt=c.prepare(query);try{return stmt.all()}finally{stmt.close()}}finally{c.close()}}
describe('ParsedFinancialStore',()=>{
 it.each(['Japan GAAP','IFRS'])('保存した%sの原値・証跡・期間をXMLなしで再読取',standard=>withStore((s,path)=>{
  const input=extraction({standard}),first=s.put(input);expect(first.inserted).toBe(true);expect(s.get(first.id)).toEqual(clean(input));
  expect(rows(path,'SELECT group_id,standard,period_start,period_end FROM parsed_rows ORDER BY group_id')).toEqual([
   {group_id:'balanceSheet',standard:standard==='IFRS'?'IFRS':'J-GAAP',period_start:'',period_end:'2026-03-31'},
   {group_id:'details',standard:standard==='IFRS'?'IFRS':'J-GAAP',period_start:'2025-04-01',period_end:'2026-03-31'}]);
  const stored=rows(path,"SELECT * FROM parsed_values WHERE metric_id='costOfSales'")[0];expect(stored.raw_text).toBe('10');expect(stored.numeric_value).toBe(10);expect(stored.unit).toBe('iso4217:JPY');expect(JSON.parse(stored.body as string).source.contextRef).toBe('arbitrary-duration');
  s.close();const reopened=new ParsedFinancialStore(path);try{expect(reopened.get(first.id)).toEqual(clean(input));expect(reopened.put(input)).toEqual({...first,inserted:false})}finally{reopened.close()}
 }));
 it('原本・版・commit・対応表・処理条件を別キーとし、条件の順序は同一視',()=>withStore(s=>{
  const input=extraction(),id=s.put(input).id;
  for(const identity of [{...input.identity,extractorVersion:'parser-2'},{...input.identity,sourceCommit:'b'.repeat(40)},{...input.identity,mappingVersions:{...input.identity.mappingVersions,details:'next'}}])expect(s.put({...input,identity}).id).not.toBe(id);
  const a={...input.identity,detailMetricIds:['sellingGeneralAndAdministrativeExpenses','costOfSales'] as const},b={...a,detailMetricIds:[...a.detailMetricIds].reverse()};
  expect(parsedFinancialExtractionId(a)).toBe(parsedFinancialExtractionId(b));
  const changed=extraction({start:'2024-04-01',end:'2025-03-31'});expect(s.put(changed).id).not.toBe(id);expect(s.get(id)).toEqual(clean(input));
 }));
 it('同じキーの異なる内容を拒否し、旧結果を維持',()=>withStore(s=>{
  const input=extraction(),id=s.put(input).id,changed=clean(input);changed.outcome.result.basis.issues.push({reason:'field-unavailable'});
  expect(()=>s.put(changed)).toThrow('異なります');expect(s.get(id)).toEqual(clean(input));expect(s.put({...input,parsedAt:'2026-11-01T00:00:00Z'}).inserted).toBe(false);
 }));
 it('結果のない解析失敗を保存し、成功や0値へ変換しない',()=>withStore((s,path)=>{
  const input=extraction();input.outcome={status:'failed',reason:'parse-failed'};const id=s.put(input).id;
  expect(s.get(id)).toEqual(clean(input));expect(rows(path,'SELECT * FROM parsed_values')).toEqual([]);
  expect(()=>s.put(extraction())).toThrow('異なります');
 }));
 it.each([{standard:'US GAAP'},{security:null}])('基準未解決を理由・DEIごと保持 %j',options=>withStore((s,path)=>{
  const input=extraction(options);expect(input.outcome.status==='completed'&&input.outcome.result.status).toBe('unresolved');
  expect(s.get(s.put(input).id)).toEqual(clean(input));expect(rows(path,'SELECT * FROM parsed_rows')).toEqual([]);
 }));
 it('IFRS単体の解決結果・根拠・scope列を保持する',()=>withStore((s,path)=>{
  const input=extraction({standard:'IFRS',consolidated:'false'});expect(input.outcome).toMatchObject({status:'completed',result:{status:'resolved',basis:{status:'selected',metadata:{scope:'NonConsolidated'}}}});expect(s.get(s.put(input).id)).toEqual(clean(input));expect(rows(path,'SELECT scope FROM parsed_rows')).toEqual([{scope:'NonConsolidated'},{scope:'NonConsolidated'}]);
 }));
 it('0・nil・曖昧・安全範囲外を区別し、精度・原文字列を維持',()=>withStore((s,path)=>{
  const xml=reportingInstance().replace('>10</jppfs_cor:CostOfSales>','>9007199254740993</jppfs_cor:CostOfSales>').replace('>20</jppfs_cor:SellingGeneralAndAdministrativeExpenses>',' xsi:nil="true"></jppfs_cor:SellingGeneralAndAdministrativeExpenses>');
  const input=extraction();input.identity.sourceSha256=hash(xml);input.outcome={status:'completed',result:createAutomaticFinancialSnapshots(xml,{docID:'D1'})};s.put(input);
  expect(rows(path,"SELECT raw_text,numeric_value,failure_kind FROM parsed_values WHERE metric_id='costOfSales'")).toEqual([{raw_text:'9007199254740993',numeric_value:null,failure_kind:'unsafe-number'}]);
  expect(rows(path,"SELECT raw_text,numeric_value,failure_kind,reason FROM parsed_values WHERE metric_id='sellingGeneralAndAdministrativeExpenses'")).toEqual([{raw_text:null,numeric_value:null,failure_kind:'missing',reason:'nil'}]);
  const zeroXml=reportingInstance().replace('>10</jppfs_cor:CostOfSales>','>0</jppfs_cor:CostOfSales>'),zero=extraction();zero.identity.sourceSha256=hash(zeroXml);zero.outcome={status:'completed',result:createAutomaticFinancialSnapshots(zeroXml,{docID:'D1'})};s.put(zero);expect(rows(path,"SELECT available,numeric_value FROM parsed_values WHERE metric_id='costOfSales' AND raw_text='0'")).toEqual([{available:1,numeric_value:0}]);
 }));
 it.each([
  {standard:'Japan GAAP',prefix:'jppfs_cor',tag:'DepreciationAndAmortizationOpeCF',metric:'depreciationOperatingCashFlow'},
  {standard:'IFRS',prefix:'jpigp_cor',tag:'DepreciationAndAmortizationOpeCFIFRS',metric:'depreciationAndAmortizationCashFlow'},
 ])('CFの明示項目と原精度を保持 $standard',({standard,prefix,tag,metric})=>withStore((s,path)=>{
  const xml=reportingInstance({standard,extra:`<${prefix}:${tag} contextRef="arbitrary-duration" unitRef="money" decimals="-3">123000</${prefix}:${tag}>`});
  const input=extraction();input.identity.sourceSha256=hash(xml);input.identity.detailMetricIds=[metric as any];input.outcome={status:'completed',result:createAutomaticFinancialSnapshots(xml,{docID:'D1',detailMetricIds:[metric as any]})};s.put(input);
  expect(rows(path,`SELECT raw_text,numeric_value,decimals FROM parsed_values WHERE metric_id='${metric}'`)).toEqual([{raw_text:'123000',numeric_value:123000,decimals:'-3'}]);
 }));
 it('単体のscopeを保持し、連結へ混ぜない',()=>withStore((s,path)=>{s.put(extraction({consolidated:'false'}));expect(rows(path,'SELECT DISTINCT scope FROM parsed_rows')).toEqual([{scope:'NonConsolidated'}])}));
 it('期間context不在を解析失敗や0行の成功へ書換えない',()=>withStore((s,path)=>{const input=extraction({noDuration:true}),id=s.put(input).id;expect(s.get(id)).toEqual(clean(input));expect(rows(path,'SELECT group_id FROM parsed_rows')).toEqual([{group_id:'balanceSheet'}])}));
 it('明示した項目と結果が異なる場合は保存しない',()=>withStore(s=>{
  const input=extraction();input.identity.detailMetricIds=['costOfSales'];expect(()=>s.put(input)).toThrow('明示項目');
  input.outcome={status:'completed',result:createAutomaticFinancialSnapshots(reportingInstance(),{docID:'D1',detailMetricIds:['costOfSales']})};expect(s.put(input).inserted).toBe(true);
 }));
 it('異なる候補値による曖昧状態を保持',()=>withStore((s,path)=>{
  const input=extraction({extra:'<jppfs_cor:CostOfSales contextRef="arbitrary-duration" unitRef="money" decimals="0">11</jppfs_cor:CostOfSales>'});s.put(input);
  expect(rows(path,"SELECT raw_text,numeric_value,failure_kind FROM parsed_values WHERE metric_id='costOfSales'")).toEqual([{raw_text:null,numeric_value:null,failure_kind:'ambiguous'}]);
 }));
 it('訂正対象と半期の期間を独立した列と証跡へ保持',()=>withStore((s,path)=>{
  const extra='<d:IdentificationOfDocumentSubjectToAmendmentDEI contextRef="filing">ORIGINAL</d:IdentificationOfDocumentSubjectToAmendmentDEI>';
  const input=extraction({periodCode:'HY',currentEnd:'2025-09-30',extra});const id=s.put(input).id;
  expect(rows(path,"SELECT amendment_target,period_start,period_end,period_type FROM parsed_rows WHERE group_id='details'")).toEqual([{amendment_target:'ORIGINAL',period_start:'2025-04-01',period_end:'2025-09-30',period_type:'ytd'}]);expect(s.get(id)).toEqual(clean(input));
 }));
 it('行の途中で保存が中断しても全transactionを戻し、同入力で再開',()=>withStore((s,path)=>{
  const unsafe=s as any,original=unsafe.run;unsafe.run=function(query:string,args:unknown[]){original.call(this,query,args);if(query.startsWith('INSERT INTO parsed_values'))throw Error('interrupted')};
  expect(()=>s.put(extraction())).toThrow('interrupted');unsafe.run=original;
  for(const t of ['parsed_extractions','parsed_rows','parsed_values'])expect(rows(path,`SELECT * FROM ${t}`)).toEqual([]);
  expect(s.put(extraction()).inserted).toBe(true);
 }));
 it.each(["UPDATE parsed_values SET numeric_value=42", "DELETE FROM parsed_values WHERE metric_id='costOfSales'", "UPDATE parsed_rows SET period_end='2000-01-01'", "UPDATE parsed_extractions SET state='failed'", "UPDATE parsed_extractions SET sha256='bad'", 'DELETE FROM parsed_extractions'])('改変をcache hitや欠損として返さない: %s',query=>withStore((s,path)=>{
  const id=s.put(extraction()).id;sql(path,query);expect(()=>s.get(id)).toThrow();expect(()=>s.put(extraction())).toThrow();
 }));
 it('大きな結果の手前で区切り、cursorの次から欠落なく続行',()=>withStore(s=>{
  const ids=[s.put(extraction({},'D1')).id,s.put(extraction({},'D2')).id].sort();
  // Large stored lengths without allocating 128 MiB of fixture JSON.
  const unsafe=s as any,original=unsafe.rows;unsafe.rows=function(query:string,args:unknown[]){const result=original.call(this,query,args);return query.startsWith('SELECT id,length')?result.map((r:any)=>({...r,bytes:40*1024*1024})):result};
  const first=s.page();expect(first.records.map(r=>r.id)).toEqual([ids[0]]);expect(first.complete).toBe(false);
  const next=s.page({afterId:first.nextAfterId});expect(next.records.map(r=>r.id)).toEqual([ids[1]]);expect(next.complete).toBe(true);
 }));
 it('巨大な改変本文は読込前の容量検査で拒否',()=>withStore((s,path)=>{const id=s.put(extraction()).id;sql(path,'UPDATE parsed_extractions SET body=zeroblob(67108865)');expect(()=>s.get(id)).toThrow('容量')}));
 it('読取専用copyと分割読取で元DBを変更しない',()=>withStore((s,path)=>{
  s.put(extraction({},'D1'));s.put(extraction({},'D2'));s.close();const before=readFileSync(path),ro=new ParsedFinancialStore(path,{readOnly:true});
  try{const a=ro.page({limit:1});expect(a.complete).toBe(false);const b=ro.page({afterId:a.nextAfterId,limit:1});expect(b.complete).toBe(true);expect([...a.records,...b.records]).toHaveLength(2);expect(ro.snapshotSha256()).toMatch(/^[a-f0-9]{64}$/);expect(()=>ro.put(extraction())).toThrow('readOnly')}finally{ro.close()}
  expect(readFileSync(path)).toEqual(before);
 }));
 it('不正な識別・値・schema・副ファイル・リンクを拒否',()=>withStore((s,path,dir)=>{
  const input=extraction();expect(()=>s.put({...input,parsedAt:'2026-10-31'})).toThrow();for(const identity of [{...input.identity,sourceSha256:'bad'},{...input.identity,sourceCommit:'bad'},{...input.identity,extra:1},{...input.identity,detailMetricIds:['unknown']}])expect(()=>s.put({...input,identity} as never)).toThrow();
  expect(()=>s.put({...input,identity:{...input.identity,mappingVersions:{...input.identity.mappingVersions,basis:'wrong'}}})).toThrow();
  const changed=clean(input);changed.outcome.result.details.snapshot.selections.costOfSales.safeNumber=NaN;expect(()=>s.put(changed)).toThrow();
  expect(()=>s.page({limit:101})).toThrow();expect(()=>s.get('bad')).toThrow();
  const other=join(dir,'other');writeFileSync(other,'');expect(()=>new ParsedFinancialStore(other)).toThrow();
  const journal=join(dir,'new.sqlite');writeFileSync(journal+'-journal','');expect(()=>new ParsedFinancialStore(journal)).toThrow();
  const link=join(dir,'link.sqlite');symlinkSync(path,link);expect(()=>new ParsedFinancialStore(link)).toThrow();
 }));
});
