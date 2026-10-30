import {mkdtempSync,rmSync,readFileSync,writeFileSync,readdirSync,symlinkSync,linkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive,FinancialSearchIndex,screenFinancialDetailDocuments,screenIfrsFinancialDetailDocuments,type FinancialIndexCohort,type FinancialIndexSearchOptions,type FinancialDetailDocument,type IfrsFinancialDetailDocument,type DocumentVersionObservation} from '../src/index';
import {Database} from '../src/db/node-sqlite';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const query={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'index-test-1'};
const cohort=(standard:'J-GAAP'|'IFRS'='J-GAAP'):FinancialIndexCohort=>({generation:'g1',group:'details',accountingStandard:standard,scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'});
function entry(n=1,standard:'J-GAAP'|'IFRS'='J-GAAP',transform=(s:string)=>s){
 const docID='A'+n,issuer='E'+String(12000+n).padStart(5,'0'),secCode=String(1000+n)+'0',xml=transform(reportingInstance({issuer,security:secCode,standard:standard==='IFRS'?'IFRS':'Japan GAAP'}));
 const observation:DocumentVersionObservation={observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode:issuer,secCode,periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}};
 return {observation,source:{docID,xml,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex')}};
}
function setup(entries= [entry(1),entry(2)],file=':memory:'){
 const archive=new ObservedFinancialArchive(':memory:');archive.append(entries.map(d=>d.observation),entries.map(d=>d.source));const index=new FinancialSearchIndex(file);index.materialize('g1',archive,query);return {archive,index,close(){index.close();archive.close();}};
}
const comparable=(r:ReturnType<FinancialSearchIndex['screen']>)=>({...r,rows:r.rows.map(row=>row.snapshot)});
it.each(['J-GAAP','IFRS'] as const)('%sのSQL検索を既存のXML検索と条件・診断・並び・ページで一致させる',standard=>{
 const prefix=standard==='IFRS'?'jpigp_cor':'jppfs_cor',tag=standard==='IFRS'?'CostOfSalesIFRS':'CostOfSales',entries=[entry(1,standard,s=>s.replace('>10</'+prefix+':'+tag+'>','>0</'+prefix+':'+tag+'>')),entry(2,standard,s=>s.replace('>10</'+prefix+':'+tag+'>','>-30</'+prefix+':'+tag+'>')),entry(3,standard,s=>s.replace(new RegExp('<'+prefix+':'+tag+'\\b[^>]*>[\\s\\S]*?</'+prefix+':'+tag+'>'),''))],s=setup(entries);
 try{for(const operator of ['gte','lte','gt','lt','eq']as const)for(const order of ['asc','desc']as const)for(const page of [{},{offset:1,limit:1},{limit:0}]){
  const options:FinancialIndexSearchOptions={metricIds:['costOfSales','sellingGeneralAndAdministrativeExpenses'],conditions:[{metric:'costOfSales',operator,value:0}],sortBy:'costOfSales',order,...page};
  const docs=entries.map(d=>({xml:d.source.xml,metadata:{secCode:d.observation.document.secCode!,docID:d.source.docID,...cohort(standard),generation:undefined,group:undefined}}));
  const financial=docs.map(d=>({xml:d.xml,metadata:{secCode:d.metadata.secCode,docID:d.metadata.docID,period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual' as const,accountingStandard:standard,scope:'Consolidated' as const,currency:'JPY' as const}}));
  const expected=standard==='IFRS'?screenIfrsFinancialDetailDocuments(financial as IfrsFinancialDetailDocument[],options as never):screenFinancialDetailDocuments(financial as FinancialDetailDocument[],options as never),got=comparable(s.index.screen(cohort(standard),options));
  // IFRSの原本hashは索引行のsourceSha256に保持します。
  expect(got).toEqual({...expected,rows:expected.rows.map(({metadata,selections})=>({metadata,selections}))});
 }}finally{s.close();}
});
it('不要な欠損は診断に残し、条件なしでは明示した全項目を必須にする',()=>{
 const s=setup([entry(1,'J-GAAP',x=>x.replace(/<jppfs_cor:SellingGeneralAndAdministrativeExpenses\b[^>]*>[\s\S]*?<\/jppfs_cor:SellingGeneralAndAdministrativeExpenses>/,''))]);try{
  const partial=s.index.screen(cohort(),{metricIds:['costOfSales','sellingGeneralAndAdministrativeExpenses'],conditions:[{metric:'costOfSales',operator:'eq',value:10}]});expect(partial).toMatchObject({total:1,excludedRows:0,diagnostics:[{metric:'sellingGeneralAndAdministrativeExpenses',reason:'missing',required:false}]});
  expect(s.index.screen(cohort(),{metricIds:['costOfSales','sellingGeneralAndAdministrativeExpenses']})).toMatchObject({total:0,excludedRows:1,filteredRows:0});
 }finally{s.close();}
});
it('安全なnumberへ変換できない原値を0へ変えず除外する',()=>{
 const s=setup([entry(1,'J-GAAP',x=>x.replace('>10</jppfs_cor:CostOfSales>','>9007199254740992</jppfs_cor:CostOfSales>'))]);try{const r=s.index.screen(cohort(),{metricIds:['costOfSales']});expect(r).toMatchObject({total:0,excludedRows:1,reasonCounts:{'unsafe-number':1},diagnostics:[{reason:'unsafe-number',selectionReason:'selected-raw-only'}]});}finally{s.close();}
});
it('BS3科目の対象日と連結/単体を分け、金額をSQLで検索する',()=>{
 const s=setup();try{const c:FinancialIndexCohort={...cohort(),group:'balanceSheet',period:{instant:'2026-03-31'},periodType:undefined},r=s.index.screen(c,{metricIds:['currentAssets','currentLiabilities','totalLiabilities'],conditions:[{metric:'currentAssets',operator:'gte',value:100}],sortBy:'currentLiabilities',order:'asc'});expect(r.total).toBe(2);expect(r.rows[0].snapshot.selections.currentAssets?.raw).toBe('100');expect(s.index.screen({...c,period:{instant:'2025-03-31'}},{metricIds:['currentAssets']}).total).toBe(0);expect(s.index.screen({...c,scope:'NonConsolidated'},{metricIds:['currentAssets']}).total).toBe(0);}finally{s.close();}
});
it('保存していない項目を原本の不在と推定せず拒否する',()=>{const s=setup();try{expect(()=>s.index.screen(cohort(),{metricIds:['incomeTaxes']})).toThrow('選択記録');expect(()=>s.index.screen(cohort(),{metricIds:['costOfSales'],sortBy:'incomeTaxes'})).toThrow('明示');}finally{s.close();}});
it('同一企業の複数候補から一方を自動採用しない',()=>{
 const d=entry(),other={...d,observation:{...d.observation,observationId:'OTHER',document:{...d.observation.document,docID:'OTHER'}},source:{...d.source,docID:'OTHER'}},s=setup([d,other]);try{expect(()=>s.index.screen(cohort(),{metricIds:['costOfSales']})).toThrow('同一企業');expect(s.index.screen({...cohort(),docIDs:['OTHER']},{metricIds:['costOfSales']})).toMatchObject({total:1,rows:[{snapshot:{metadata:{docID:'OTHER'}}}]});expect(()=>s.index.screen({...cohort(),docIDs:['unknown']},{metricIds:['costOfSales']})).toThrow('対象cohort');}finally{s.close();}
});
it('世代の再投入は同内容のみ許可し、旧世代を保持して再open/readOnly検索する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-index-'));try{const path=join(dir,'index.sqlite'),s=setup([entry()],path);s.index.materialize('g1',s.archive,query);const first=s.index.screen(cohort(),{metricIds:['costOfSales']});s.archive.append([{...entry().observation,observationId:'withdrawn',observedAt:'2026-07-01T00:00:00Z',document:{...entry().observation.document,withdrawalStatus:'2'}}]);expect(()=>s.index.materialize('g1',s.archive,query)).toThrow('別ID');s.index.materialize('g2',s.archive,query);expect(s.index.screen({...cohort(),generation:'g2'},{metricIds:['costOfSales']}).total).toBe(0);expect(s.index.screen(cohort(),{metricIds:['costOfSales']})).toEqual(first);s.close();const before=readFileSync(path),names=readdirSync(dir),ro=new FinancialSearchIndex(path,{readOnly:true});try{expect(ro.screen(cohort(),{metricIds:['costOfSales']})).toEqual(first);expect(()=>ro.materialize('forbidden',s.archive,query)).toThrow('readOnly');}finally{ro.close();}expect(readFileSync(path)).toEqual(before);expect(readdirSync(dir)).toEqual(names);}finally{rmSync(dir,{recursive:true,force:true});}
});
it('未確定・原本不在・context不在を世代reportへ保持する',()=>{
 const a=entry(1,'IFRS',x=>x.replace('>true</d:WhetherConsolidatedFinancialStatementsArePreparedDEI>','>false</d:WhetherConsolidatedFinancialStatementsArePreparedDEI>')),b=entry(2,'J-GAAP',x=>x.replace(/<xbrli:context id="arbitrary-duration">[\s\S]*?<\/xbrli:context>/,'')),archive=new ObservedFinancialArchive(':memory:'),index=new FinancialSearchIndex(':memory:');try{archive.append([a.observation,b.observation,entry(3).observation],[a.source,b.source]);const g=index.materialize('g',archive,query);expect(g.unresolvedRecords[0].result).toMatchObject({reason:'unsupported-ifrs-scope'});expect(g.unavailableSources).toContainEqual(expect.objectContaining({docID:'A3',reason:'source-missing'}));expect(g.unavailableGroups).toContainEqual({docID:'A2',group:'details',reason:'current-period-context-absent'});}finally{archive.close();index.close();}
});
it.each(['financial_values','financial_rows','financial_generations'])('%sの破損・索引移動を正常な検索として返さない',table=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-index-corrupt-'));try{const path=join(dir,'index.sqlite'),s=setup([entry()],path);s.close();const raw=new Database(path);raw.exec(table==='financial_values'?"UPDATE financial_values SET numeric_value=999999":table==='financial_rows'?"UPDATE financial_rows SET standard='IFRS'":"UPDATE financial_generations SET body='corrupt'");raw.close();const index=new FinancialSearchIndex(path);try{expect(()=>index.screen(cohort(),{metricIds:['costOfSales']})).toThrow();}finally{index.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});
it('空の世代でも未知項目・不正cohort/条件/ページを拒否する',()=>{
 const s=setup([]);try{expect(s.index.screen(cohort(),{metricIds:['costOfSales']})).toMatchObject({rows:[],total:0});for(const [c,q]of [[{...cohort(),currency:'USD'},{metricIds:['costOfSales']}],[cohort(),{metricIds:['bad']}],[cohort(),{metricIds:[]}],[cohort(),{metricIds:new Array(1)}],[cohort(),{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator:'eq',value:Infinity}]}],[cohort(),{metricIds:['costOfSales'],offset:-1}],[{...cohort(),group:'balanceSheet'},{metricIds:['currentAssets']}],[cohort(),{metricIds:['costOfSales'],extra:true}]])expect(()=>s.index.screen(c as never,q as never)).toThrow();}finally{s.close();}
});
it.each(['text','empty','archive','symlink','hardlink','sidecar','orphan'])('専用DB以外の%sを内容・副ファイルを変えず拒否する',kind=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-index-protect-'));try{const path=join(dir,'index.sqlite');if(kind==='archive'){const a=new ObservedFinancialArchive(path);a.close();}else if(kind==='sidecar'){const i=new FinancialSearchIndex(path);i.close();writeFileSync(path+'-wal','sidecar');}else if(kind==='orphan')writeFileSync(path+'-journal','sidecar');else if(kind==='symlink'||kind==='hardlink'){const original=join(dir,'original');writeFileSync(original,'private input');if(kind==='symlink')symlinkSync(original,path);else linkSync(original,path);}else writeFileSync(path,kind==='empty'?'':'private input');const names=readdirSync(dir),before=kind==='orphan'?undefined:readFileSync(path);expect(()=>new FinancialSearchIndex(path)).toThrow();expect(readdirSync(dir)).toEqual(names);if(before)expect(readFileSync(path)).toEqual(before);}finally{rmSync(dir,{recursive:true,force:true});}
});

it('有限の大きな条件値は日本基準の既存比較と一致し、IFRSの上限は維持する',()=>{
 const s=setup();try{expect(s.index.screen(cohort(),{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator:'lt',value:1e100}]}).total).toBe(2);expect(s.index.screen(cohort(),{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator:'gt',value:1e100}]}).filteredRows).toBe(2);expect(()=>s.index.screen(cohort('IFRS'),{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator:'lt',value:1e100}]})).toThrow('数値条件');}finally{s.close();}
});

it('同じ提出者の別証券コードを異なる企業として重複比較しない',()=>{
 const a=entry(1,'IFRS'),b=entry(2,'IFRS',s=>s.replaceAll('E12002','E12001'));b.observation.document.edinetCode='E12001';const s=setup([a,b]);try{expect(()=>s.index.screen(cohort('IFRS'),{metricIds:['costOfSales']})).toThrow('同一企業');expect(s.index.screen({...cohort('IFRS'),docIDs:['A1']},{metricIds:['costOfSales']}).total).toBe(1);}finally{s.close();}
});
it.each(['nil','unit','duplicate']as const)('%sの非採用状態をSQLの除外理由と全候補に保持する',kind=>{
 const s=setup([entry(1,'J-GAAP',x=>kind==='nil'?x.replace(/<jppfs_cor:CostOfSales\b([^>]*)>10<\/jppfs_cor:CostOfSales>/,'<jppfs_cor:CostOfSales$1 xsi:nil="true"></jppfs_cor:CostOfSales>'):kind==='unit'?x.replace('iso4217:JPY','iso4217:USD'):x.replace(/(<jppfs_cor:CostOfSales\b[^>]*>)(10)(<\/jppfs_cor:CostOfSales>)/,(_all,open,value,close)=>open+value+close+open+'11'+close))]);
 try{const r=s.index.screen(cohort(),{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator:'eq',value:0}]});expect(r.total).toBe(0);expect(r.excludedRows).toBe(1);expect(r.diagnostics[0]).toMatchObject({reason:{nil:'missing',unit:'unsupported',duplicate:'ambiguous'}[kind],selectionReason:{nil:'nil',unit:'unsupported-unit',duplicate:'multiple-facts'}[kind]});}finally{s.close();}
});
it('十進小数のguard済みnumberを元の文字列と分けてSQL比較する',()=>{
 const entries=[entry(1,'J-GAAP',s=>s.replace('>10</jppfs_cor:CostOfSales>','>0.1</jppfs_cor:CostOfSales>')),entry(2,'J-GAAP',s=>s.replace('>10</jppfs_cor:CostOfSales>','>0.25</jppfs_cor:CostOfSales>'))],s=setup(entries);try{for(const operator of ['gte','lte','gt','lt','eq']as const){const r=s.index.screen(cohort(),{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator,value:0.1}],sortBy:'costOfSales',order:'asc'});const expected=[0.1,0.25].filter(a=>({gte:a>=0.1,lte:a<=0.1,gt:a>0.1,lt:a<0.1,eq:a===0.1})[operator]);expect(r.rows.map(row=>row.snapshot.selections.costOfSales?.safeNumber)).toEqual(expected);}}finally{s.close();}
});
it('書込途中の失敗で新世代の行・値を全て戻し、旧世代を保持する',()=>{
 const s=setup();try{const before=s.index.screen(cohort(),{metricIds:['costOfSales']}),unsafe=s.index as unknown as {run:(sql:string,args?:unknown[])=>void},original=unsafe.run;let writes=0;unsafe.run=function(sql,args){if(++writes===3)throw Error('injected failure');original.call(s.index,sql,args);};try{expect(()=>s.index.materialize('failed',s.archive,query)).toThrow('injected');}finally{unsafe.run=original;}expect(()=>s.index.generation('failed')).toThrow('未収録');expect(s.index.screen(cohort(),{metricIds:['costOfSales']})).toEqual(before);s.index.materialize('retry',s.archive,query);expect(s.index.screen({...cohort(),generation:'retry'},{metricIds:['costOfSales']})).toEqual(before);}finally{s.close();}
});
it('返す本文の破損を、正しい索引値で正常結果へ隠さない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-index-body-'));try{const path=join(dir,'index.sqlite'),s=setup([entry()],path);s.close();const raw=new Database(path);raw.exec("UPDATE financial_rows SET body='corrupt' WHERE group_id='details'");raw.close();const index=new FinancialSearchIndex(path);try{expect(()=>index.screen(cohort(),{metricIds:['costOfSales']})).toThrow('本文のhash');}finally{index.close();}}finally{rmSync(dir,{recursive:true,force:true});}
});

it.each(['J-GAAP','IFRS'] as const)('%sの完全一致明細重複をSQLへ保存し、全証跡と採用理由を読取でも保持する',standard=>{
 const tag=standard==='IFRS'?'jpigp_cor:CostOfSalesIFRS':'jppfs_cor:CostOfSales';
 const s=setup([entry(1,standard,x=>x.replace(new RegExp('(<'+tag+'\\b[^>]*>10</'+tag+'>)'),'$1$1'))]);
 try{const r=s.index.screen(cohort(standard),{metricIds:['costOfSales'],conditions:[{metric:'costOfSales',operator:'eq',value:10}]});expect(r.total).toBe(1);expect(r.excludedRows).toBe(0);const selected=r.rows[0].snapshot.selections.costOfSales;expect(selected).toMatchObject({status:'selected',reason:'selected-identical-duplicates',raw:'10'});expect(selected?.evidence).toHaveLength(2);}finally{s.close();}
});
