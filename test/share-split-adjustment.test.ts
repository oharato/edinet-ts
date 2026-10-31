import {describe,it,expect} from 'vitest';
import {adjustPerShareValuesForSplits, type ShareSplitAdjustmentOptions, type ShareSplitLedger} from '../src/share-split-adjustment';
import {calculateCagr,calculatePerShareGrowth,screenCagr,screenPerShareGrowth,CagrMetricId as C,PerShareGrowthMetricId as G} from '../src/annual-cagr';
import {point} from './fixtures/per-share';

const source={name:'reviewed synthetic split notice',sha256:'a'.repeat(64),observedAt:'2024-03-01T00:00:00Z'};
function options(count=2):ShareSplitAdjustmentOptions & {ledger:Extract<ShareSplitLedger,{state:'confirmed-complete'}>}{return {asOf:'2026-06-30',knownAt:'2026-06-30T00:00:00Z',targetBasisDate:'2024-04-01',sourceObservedAt:Array(count).fill('2026-06-24T12:00:00Z'),ledger:{state:'confirmed-complete',secCode:'1001',shareClass:'ordinary',basisConvention:'effective-date-inclusive',reviewedFrom:'2023-01-01',reviewedThrough:'2024-04-01',source,events:[{eventId:'split-2024',effectiveDate:'2024-04-01',oldShares:1,newShares:2,source}]}}}
function document(year:number,raw:string,basisDate:string,metric:'eps'|'dividend'='eps'){
 const document=point(year,raw,metric);if(document.shareBasis.state==='confirmed')document.shareBasis.basisDate=basisDate;return document;
}
const pair=(metric:'eps'|'dividend'='eps')=>({previous:document(2024,'100','2023-04-01',metric),current:document(2025,'60','2024-04-01',metric)});

describe('explicit split conversion',()=>{
 it('EPSの異なる確認済み基準を換算し、原値と根拠を保持する',()=>{
  const input=pair();expect(calculatePerShareGrowth(input,G.EarningsPerShare)).toMatchObject({status:'unavailable',reason:'incompatible-share-basis'});
  const result=calculatePerShareGrowth(input,G.EarningsPerShare,options());expect(result).toMatchObject({status:'calculated',exact:{numerator:'1',denominator:'5'},previous:{selection:{raw:'100',safeNumber:100}},shareAdjustment:{status:'adjusted',points:[{originalValue:100,value:50,eventIds:['split-2024']},{originalValue:60,value:60,eventIds:[]}]}});
  expect(result.status==='calculated'&&result.value).toBeCloseTo(.2);
  expect(input.previous.shareBasis).toMatchObject({basisDate:'2023-04-01'});
 });
 it('掲載EPSの遡及調整済み基準には同じ分割を二重適用しない',()=>{
  const input={previous:document(2024,'50','2024-04-01'),current:document(2025,'60','2024-04-01')};
  const result=calculatePerShareGrowth(input,G.EarningsPerShare,options());expect(result).toMatchObject({status:'calculated',exact:{numerator:'1',denominator:'5'},shareAdjustment:{points:[{value:50,eventIds:[]},{value:60,eventIds:[]}]}});
 });
 it('CAGRの公開wrapperも第3引数と正確な換算分数を伝播する',()=>{
  const documents=[document(2023,'100','2023-03-31'),document(2024,'120','2023-03-31'),document(2025,'80','2024-04-01')];
  expect(calculateCagr(documents,C.EarningsPerShare)).toMatchObject({status:'unavailable',reason:'incompatible-share-basis'});
  const result=calculateCagr(documents,C.EarningsPerShare,options(3));expect(result).toMatchObject({status:'calculated',exact:{numerator:'8',denominator:'5',root:2},shareAdjustment:{status:'adjusted'}});
  expect(result.status==='calculated'&&result.value).toBeCloseTo(Math.sqrt(1.6)-1);
 });
 it('支払済み配当の比較換算額を実支払原値と区別し、予定配当は除外する',()=>{
  const input=pair('dividend'),result=calculatePerShareGrowth(input,G.DividendPerShare,options());
  expect(result).toMatchObject({status:'calculated',previous:{selection:{raw:'100'}},shareAdjustment:{points:[{originalValue:100,value:50},{originalValue:60,value:60}]}});
  if(input.current.shareBasis.state==='confirmed')input.current.shareBasis.dividendStatus='proposed';
  expect(calculatePerShareGrowth(input,G.DividendPerShare,options())).toMatchObject({status:'unavailable',reason:'proposed-dividend'});
 });
 it('逆分割と元基準への逆向き換算を扱う',()=>{
  const settings=options();settings.ledger.events[0]={...settings.ledger.events[0],oldShares:10,newShares:1};
  expect(adjustPerShareValuesForSplits([{value:20,basisDate:'2023-04-01'},{value:250,basisDate:'2024-04-01'}],'1001',settings)).toMatchObject({status:'adjusted',points:[{value:200,multiplier:{numerator:'10',denominator:'1'}},{value:250}]});
  settings.targetBasisDate='2023-04-01';
  expect(adjustPerShareValuesForSplits([{value:20,basisDate:'2023-04-01'},{value:250,basisDate:'2024-04-01'}],'1001',settings)).toMatchObject({status:'adjusted',points:[{value:20},{value:25,multiplier:{numerator:'1',denominator:'10'}}]});
 });
 it('3分割など有限小数にならない換算でも前年比の正確分数を保存する',()=>{
  const settings=options();settings.ledger.events[0]={...settings.ledger.events[0],newShares:3};
  const input=pair();input.current=document(2025,'50','2024-04-01');
  expect(calculatePerShareGrowth(input,G.EarningsPerShare,settings)).toMatchObject({status:'calculated',exact:{numerator:'1',denominator:'2'},shareAdjustment:{points:[{exact:{numerator:'100',denominator:'3'}},{value:50}]}});
 });
 it('換算前後の表示numberが同じでも、正確比の微小な成長を0にしない',()=>{
  const settings=options();settings.ledger.events[0]={...settings.ledger.events[0],newShares:3};
  const input=pair();input.current=document(2025,'33.333333333333336','2024-04-01');
  const growth=calculatePerShareGrowth(input,G.EarningsPerShare,settings),cagr=calculateCagr([input.previous,input.current],C.EarningsPerShare,settings);
  expect(growth.status).toBe('calculated');expect(cagr.status).toBe('calculated');
  if(growth.status==='calculated'){expect(growth.value).toBeGreaterThan(0);expect(growth.exact.numerator).not.toBe('0');}
  if(cagr.status==='calculated')expect(cagr.value).toBeGreaterThan(0);
  expect(screenPerShareGrowth([input],G.EarningsPerShare,{shareAdjustments:{'1001':settings},conditions:[{operator:'gt',value:0}]}).total).toBe(1);
 });
 it('効力日の当日を含み、元基準日のイベントは含めず、将来イベントは適用しない',()=>{
  const settings=options();settings.ledger.events=[{...settings.ledger.events[0],eventId:'at-source',effectiveDate:'2023-04-01'},...settings.ledger.events,{...settings.ledger.events[0],eventId:'future',effectiveDate:'2025-04-01'}];
  const result=adjustPerShareValuesForSplits([{value:100,basisDate:'2023-04-01'},{value:50,basisDate:'2024-04-01'}],'1001',settings);
  expect(result).toMatchObject({status:'adjusted',points:[{value:50,eventIds:['split-2024']},{value:50,eventIds:[]}]});
 });
 it('複数イベントを合成し同じ観測の重複は一度だけ適用する',()=>{
  const settings=options();settings.targetBasisDate=settings.ledger.reviewedThrough='2025-04-01';
  settings.ledger.events=[...settings.ledger.events,...settings.ledger.events,{...settings.ledger.events[0],eventId:'split-2025',effectiveDate:'2025-04-01',newShares:3}];
  expect(adjustPerShareValuesForSplits([{value:120,basisDate:'2023-04-01'},{value:20,basisDate:'2025-04-01'}],'1001',settings)).toMatchObject({status:'adjusted',points:[{value:20,eventIds:['split-2024','split-2025']},{value:20}]});
 });
 it('同じIDの競合と同日別IDの二重イベントを推測解決しない',()=>{
  for(const changed of [{newShares:3},{eventId:'different'},{effectiveDate:'2025-01-01'}]){
   const settings=options();settings.ledger.events=[...settings.ledger.events,{...settings.ledger.events[0],...changed}];
   expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,settings)).toMatchObject({status:'unavailable',reason:'conflicting-split-events'});
  }
 });
 it('台帳の確認範囲が不足すると未換算を明示する',()=>{
  const settings=options();settings.ledger.reviewedFrom='2024-01-01';
  expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,settings)).toMatchObject({status:'unavailable',reason:'incomplete-split-history',shareAdjustment:{status:'unavailable'}});
 });
 it('イベント・台帳・財務原本の未来観測はknownAtへ持ち込まない',()=>{
  for(const kind of ['event','ledger','financial']){
   const settings=options(),later='2026-06-30T00:00:00.001Z';
   if(kind==='event')settings.ledger.events[0]={...settings.ledger.events[0],source:{...source,observedAt:later}};
   if(kind==='ledger')settings.ledger.source={...source,observedAt:later};
   if(kind==='financial')settings.sourceObservedAt=[later,settings.sourceObservedAt[1]];
   expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,settings)).toMatchObject({status:'unavailable',reason:'split-source-after-cutoff'});
  }
  const exact=options();exact.ledger.source={...source,observedAt:exact.knownAt};
  expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,exact).status).toBe('calculated');
  const unused=options();unused.ledger.events=[...unused.ledger.events,{...unused.ledger.events[0],eventId:'outside',effectiveDate:'2025-04-01',source:{...source,observedAt:'2027-01-01T00:00:00Z'}}];
  expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,unused)).toMatchObject({status:'unavailable',reason:'split-source-after-cutoff'});
 });
 it('基準日の未来指定と不正比率・株価調整基準・銘柄違いを拒否する',()=>{
  const future=options();future.targetBasisDate='2026-07-01';expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,future)).toMatchObject({status:'unavailable',reason:'split-basis-after-as-of'});
  for(const changed of [{oldShares:0},{newShares:-2},{newShares:1.5},{newShares:1}]){
   const settings=options();settings.ledger.events[0]={...settings.ledger.events[0],...changed};expect(()=>calculatePerShareGrowth(pair(),G.EarningsPerShare,settings)).toThrow();
  }
  const wrong=options();wrong.ledger.secCode='2002';expect(()=>calculatePerShareGrowth(pair(),G.EarningsPerShare,wrong)).toThrow();
  const exDate=options();(exDate.ledger as any).basisConvention='ex-date-inclusive';expect(()=>calculatePerShareGrowth(pair(),G.EarningsPerShare,exDate)).toThrow();
 });
 it('原本の注記日より前の観測宣言やasOfより未来の会計期間を採用しない',()=>{
  const settings=options();settings.sourceObservedAt=['2026-06-23T00:00:00Z','2026-06-24T12:00:00Z'];
  expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,settings)).toMatchObject({status:'unavailable',reason:'split-source-before-reference',shareAdjustment:{status:'unavailable'}});
  const historical=options();historical.asOf='2024-04-01';historical.knownAt='2024-04-01T00:00:00Z';historical.sourceObservedAt=['2024-04-01T00:00:00Z','2024-04-01T00:00:00Z'];
  expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,historical)).toMatchObject({status:'unavailable',reason:'split-source-after-cutoff'});
  const period=options();period.asOf='2024-04-01';
  expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,period)).toMatchObject({status:'unavailable',reason:'split-financial-period-after-as-of'});
 });
 it('0・負値について従来のEPSと配当/CAGRの違いを維持する',()=>{
  for(const raw of ['0','-10']){
   const input=pair();input.previous=document(2024,raw,'2023-04-01');expect(calculatePerShareGrowth(input,G.EarningsPerShare,options()).status).toBe('unavailable');
  }
  const loss=pair();loss.current=document(2025,'-10','2024-04-01');expect(calculatePerShareGrowth(loss,G.EarningsPerShare,options())).toMatchObject({status:'calculated',exact:{numerator:'-6',denominator:'5'}});
  expect(calculateCagr([loss.previous,loss.current],C.EarningsPerShare,options())).toMatchObject({status:'unavailable',reason:'negative-input'});
  const dividend=pair('dividend');dividend.current=document(2025,'-10','2024-04-01','dividend');expect(calculatePerShareGrowth(dividend,G.DividendPerShare,options())).toMatchObject({status:'unavailable',reason:'negative-input'});
  dividend.current=document(2025,'0','2024-04-01','dividend');expect(calculatePerShareGrowth(dividend,G.DividendPerShare,options())).toMatchObject({status:'calculated',value:-1});
 });
 it('分割で会社・期間・株式注記の既存検査を迂回しない',()=>{
  const input=pair();input.current=point(2025,'60','eps','2002');expect(calculatePerShareGrowth(input,G.EarningsPerShare,options())).toMatchObject({status:'unavailable',reason:'incompatible-metadata'});
  const missing=pair();missing.current.shareBasis={state:'unknown'};expect(calculatePerShareGrowth(missing,G.EarningsPerShare,options())).toMatchObject({status:'unavailable',reason:'unverified-share-basis'});
 });
 it('長大な比率合成の非有限結果や未知の入力列を通常値へ昇格しない',()=>{
  const settings=options();settings.targetBasisDate=settings.ledger.reviewedThrough='2024-12-31';
  settings.ledger.events=Array.from({length:30},(_,i)=>({eventId:'huge-'+i,effectiveDate:new Date(Date.UTC(2024,0,i+1)).toISOString().slice(0,10),oldShares:1,newShares:Number.MAX_SAFE_INTEGER,source}));
  expect(adjustPerShareValuesForSplits([{value:100,basisDate:'2023-04-01'},{value:1,basisDate:'2024-12-31'}],'1001',settings)).toMatchObject({status:'unavailable',reason:'unsafe-split-adjustment'});
  const unknown=options();(unknown.ledger.events[0] as any).cashDividend=10;
  expect(()=>calculatePerShareGrowth(pair(),G.EarningsPerShare,unknown)).toThrow();
 });
 it('複数社検索は1社の分割と他社の非分割を別台帳で扱い、換算値でfilter/sortする',()=>{
  const first=pair(),second={previous:point(2024,'100','eps','2002'),current:point(2025,'110','eps','2002')};
  const a=options(),b=options();b.ledger={...b.ledger,secCode:'2002',events:[]};
  const settings={shareAdjustments:{'1001':a,'20020':b}};
  const result=screenPerShareGrowth([second,first],G.EarningsPerShare,settings);
  expect(result.rows.map(row=>row.previous.metadata.secCode)).toEqual(['10010','20020']);
  expect(result.rows.map(row=>row.value)).toEqual([expect.closeTo(.2),expect.closeTo(.1)]);
  expect(screenPerShareGrowth([second,first],G.EarningsPerShare,{...settings,conditions:[{operator:'gte',value:.15}]})).toMatchObject({total:1,filteredRows:1,excludedRows:0});
  expect(screenPerShareGrowth([second,first],G.EarningsPerShare,{...settings,order:'asc',offset:1,limit:1}).rows[0].previous.metadata.secCode).toBe('10010');
 });
 it('検索台帳の欠落は除外し、銘柄誤帰属・重複キー・cutoff不一致は拒否する',()=>{
  const first=pair(),second={previous:point(2024,'100','eps','2002'),current:point(2025,'110','eps','2002')},a=options();
  expect(screenPerShareGrowth([first,second],G.EarningsPerShare,{shareAdjustments:{'1001':a}})).toMatchObject({total:1,excludedRows:1,excluded:[{reason:'missing-split-adjustment'}]});
  const b=options();b.ledger={...b.ledger,secCode:'2002',events:[]};
  expect(()=>screenPerShareGrowth([first,second],G.EarningsPerShare,{shareAdjustments:{'1001':b,'2002':a}})).toThrow();
  expect(()=>screenPerShareGrowth([first],G.EarningsPerShare,{shareAdjustments:{'1001':a,'10010':a}})).toThrow();
  b.knownAt='2026-06-30T01:00:00Z';
  expect(()=>screenPerShareGrowth([first,second],G.EarningsPerShare,{shareAdjustments:{'1001':a,'2002':b}})).toThrow('cutoff');
 });
 it('同じeventIDを持つ別企業は混同せず、CAGR検索も正確分数で比較する',()=>{
  const first=pair(),second={previous:point(2024,'100','eps','2002'),current:point(2025,'50','eps','2002')};
  if(second.previous.shareBasis.state==='confirmed')second.previous.shareBasis.basisDate='2023-04-01';
  const a=options(),b=options();b.ledger={...b.ledger,secCode:'2002',events:[{...b.ledger.events[0],newShares:3}]};
  const settings={shareAdjustments:{'1001':a,'2002':b}};
  const result=screenCagr([[first.previous,first.current],[second.previous,second.current]],C.EarningsPerShare,{...settings,conditions:[{operator:'eq',value:.5}]});
  expect(result).toMatchObject({total:1,filteredRows:1,rows:[{exact:{numerator:'3',denominator:'2',root:1}}]});
  expect(result.rows[0].points[0].metadata.secCode).toBe('20020');
  expect(screenPerShareGrowth([first,second],G.EarningsPerShare,settings).rows.map(row=>row.previous.metadata.secCode)).toEqual(['20020','10010']);
 });
 it('未確認台帳は0成長にせず理由を保持し、非1株当たりCAGRへのoptionは空検索でも拒否する',()=>{
  const settings:ShareSplitAdjustmentOptions={...options(),ledger:{state:'unknown'}};
  expect(calculatePerShareGrowth(pair(),G.EarningsPerShare,settings)).toMatchObject({status:'unavailable',reason:'unverified-split-history',shareAdjustment:{status:'unavailable'}});
  expect(screenPerShareGrowth([pair()],G.EarningsPerShare,{shareAdjustments:{'1001':settings}})).toMatchObject({total:0,excludedRows:1,excluded:[{reason:'unverified-split-history'}]});
  expect(()=>screenCagr([],C.NetSales,{shareAdjustments:{}})).toThrow();
  expect(()=>screenCagr([],C.NetIncome,{shareAdjustments:{}})).toThrow();
 });
 it('新規配列入口はcustom iteratorを使わず、自分の添字で固定し疎配列を拒否する',()=>{
  const values=[{value:100,basisDate:'2023-04-01'},{value:60,basisDate:'2024-04-01'}],settings=options();
  Object.defineProperty(values,Symbol.iterator,{value:function*(){yield {value:999,basisDate:'2023-04-01'}}});
  Object.defineProperty(settings.sourceObservedAt,Symbol.iterator,{value:function*(){yield '2030-01-01T00:00:00Z'}});
  Object.defineProperty(settings.ledger.events,Symbol.iterator,{value:function*(){yield {...settings.ledger.events[0],newShares:999}}});
  expect(adjustPerShareValuesForSplits(values,'1001',settings)).toMatchObject({status:'adjusted',points:[{originalValue:100,value:50},{originalValue:60,value:60}]});
  expect(()=>adjustPerShareValuesForSplits(Array(2),'1001',options())).toThrow('疎配列');
  const times=options();times.sourceObservedAt=Array(2);expect(()=>adjustPerShareValuesForSplits([{value:1,basisDate:'2023-04-01'},{value:1,basisDate:'2024-04-01'}],'1001',times)).toThrow('疎配列');
  const events=options();events.ledger.events=Array(1);expect(()=>calculatePerShareGrowth(pair(),G.EarningsPerShare,events)).toThrow('疎配列');
 });
});
