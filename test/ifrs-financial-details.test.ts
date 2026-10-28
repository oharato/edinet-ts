import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {EdinetXbrlParser,createIfrsFinancialDetailSnapshot as snapshot,screenIfrsFinancialDetailDocuments as screen,DEFAULT_IFRS_FINANCIAL_DETAIL_METRICS as defaults,type IfrsFinancialDetailMetricId as Id,type IfrsFinancialDetailScreeningOptions} from '../src/index';
import {ifrsDetailMappings as mappings,ifrsDetailDocument as doc,ifrsDetailMetadata} from './fixtures/ifrs-financial-details';
import {fact} from './fixtures/metric-boundaries';
const ids=mappings.map(([id])=>id),opts={accountingStandard:'IFRS',scope:'Consolidated',period:ifrsDetailMetadata().period} as const;
const select=(id:Id,d=doc())=>new EdinetXbrlParser().parse(d.xml,d.metadata.docID).selectIfrsFinancialDetail(id,opts);
describe('IFRSの直接PL/CF17項目',()=>{
 it.each(mappings)('%sは対応する直接durationタグの原値・原符号を読む',(id,tag)=>{
  const d=doc(),r=select(id,d);expect(r).toMatchObject({status:'selected',source:{key:'jpigp_cor:'+tag,period:opts.period,unit:'iso4217:JPY',scope:'Consolidated',entity:{identifier:'1001'}}});
  expect(snapshot(d.xml,d.metadata,[id]).selections[id]).toEqual(r);
 });
 it('既定はPL5項目で、CFやJ-GAAPの既定項目を混入しない',()=>{
  const d=doc(),r=snapshot(d.xml,d.metadata);expect(Object.keys(r.selections)).toEqual(defaults);expect(r.selections.incomeTaxesPaidCashFlow).toBeUndefined();expect(defaults).toHaveLength(5);
  expect(new EdinetXbrlParser().parse(d.xml,'A').selectFinancialDetail('costOfSales',opts)).toMatchObject({status:'unsupported',reason:'unsupported-standard'});
 });
 it('合算/差引で税金・設備・配当・借入範囲を補完しない',()=>{
  for(const id of ['incomeTaxesPaidCashFlow','netIncomeTaxesRefundPaidCashFlow','dividendsPaidToOwnersOfParentCashFlow','propertyPlantEquipmentPurchaseCashFlow','longTermBorrowingsRepaymentCashFlow'] as const)expect(select(id,doc('1001',{absent:id}))).toMatchObject({status:'missing',reason:'tag-absent'});
 });
 it.each(['sellingGeneralAndAdministrativeExpenses','profitBeforeTax'] as const)('%sの実原本で確認した完全一致重複だけを理由付きで採用する',id=>{
  const r=select(id,doc('1001',{duplicate:id}));expect(r).toMatchObject({status:'selected',reason:'selected-identical-duplicates'});expect(r.evidence).toHaveLength(2);
  const d=doc('1001',{duplicate:id}),tag=mappings.find(([key])=>key===id)![1],marker='<jpigp_cor:'+tag,at=d.xml.lastIndexOf(marker);
  for(const change of [(s:string)=>s.replace('decimals="INF"','decimals="0"'),(s:string)=>s.replace(/>\d+</,'>999<')]){
   const changed={...d,xml:d.xml.slice(0,at)+change(d.xml.slice(at))};expect(select(id,changed)).toMatchObject({status:'ambiguous',reason:'multiple-facts'});
  }
 });
 it('他科目の重複は勝手に完全一致採用へ変えない',()=>{expect(select('costOfSales',doc('1001',{duplicate:'costOfSales'}))).toMatchObject({status:'ambiguous',reason:'multiple-facts'});});
 it.each(['0','-0','-10.25','9007199254740993'])('0/負数/巨大原値%sを失わない',raw=>{
  const r=select('incomeTaxesPaidCashFlow',doc('1001',{raw}));expect(r).toMatchObject({status:'selected',raw});expect(r.status==='selected'&&r.safeNumber).toBe(raw==='9007199254740993'?undefined:Number(raw));
 });
 it('nilを0にせず、旧IFRS/企業拡張/外貨/単体/期間不一致を代用しない',()=>{
  expect(select('incomeTaxesRefundCashFlow',doc('1001',{nil:'incomeTaxesRefundCashFlow'}))).toMatchObject({status:'missing',reason:'nil'});
  expect(select('costOfSales',doc('1001',{namespace:'http://disclosure.edinet-fsa.go.jp/taxonomy/jpigp/2017-03-31/jpigp_cor'}))).toMatchObject({status:'unsupported',reason:'unknown-namespace'});
  expect(select('costOfSales',doc('1001',{unit:'iso4217:USD'}))).toMatchObject({status:'unsupported',reason:'unsupported-unit'});
  expect(select('costOfSales',doc('1001',{scope:'NonConsolidated'})).status).not.toBe('selected');
  const d=doc('1001',{absent:'costOfSales',extra:fact('100','','extension:CostOfSalesIFRS')});expect(select('costOfSales',d).status).not.toBe('selected');
 });
 it('標準・範囲・期間の入口を一度だけ固定する',()=>{
  const d=doc(),o=new EdinetXbrlParser().parse(d.xml,'A');let reads=0;
  expect(o.selectIfrsFinancialDetail('costOfSales',{get accountingStandard(){reads++;return reads===1?'IFRS':'J-GAAP';},scope:'Consolidated',period:opts.period})).toMatchObject({status:'selected'});expect(reads).toBe(1);
  expect(o.selectIfrsFinancialDetail('costOfSales',{...opts,scope:'NonConsolidated'})).toMatchObject({status:'unsupported',reason:'unsupported-semantics',evidence:[]});
  expect(o.selectIfrsFinancialDetail('costOfSales',{...opts,accountingStandard:'J-GAAP'})).toMatchObject({status:'unsupported',reason:'unsupported-standard'});
  for(const period of [{instant:'2025-03-31'},{startDate:'2025-02-30',endDate:'2025-03-31'},{...opts.period,instant:'2025-03-31'}])expect(o.selectIfrsFinancialDetail('costOfSales',{...opts,period} as never)).toMatchObject({status:'unsupported',reason:'invalid-period'});
  expect(()=>o.selectIfrsFinancialDetail('__proto__' as never,opts)).toThrow('ID');
 });
});
describe('IFRS明細のsnapshot/検索',()=>{
 it('同じXMLのBOM/hash・metadata・選択を保存し、入力へ変更を戻さない',()=>{
  const d=doc(),xml='\ufeff'+d.xml,r=snapshot(xml,d.metadata,ids);expect(r.inputXmlSha256).toBe(createHash('sha256').update(xml).digest('hex'));expect(r.metadata.secCode).toBe('10010');
  r.metadata.period.endDate='2020-01-01';expect(d.metadata.period.endDate).toBe(opts.period.endDate);expect(Object.keys(r.selections)).toHaveLength(17);
 });
 it('未使用欠損は除外せず、必要なnil/巨大値は診断付きで除外する',()=>{
  const d=doc('1001',{nil:'incomeTaxesRefundCashFlow'}),r=screen([d],{metricIds:ids,conditions:[{metric:'costOfSales',operator:'gte',value:0}]});expect(r.total).toBe(1);expect(r.diagnostics).toContainEqual(expect.objectContaining({metric:'incomeTaxesRefundCashFlow',required:false,selectionReason:'nil'}));
  expect(screen([d],{metricIds:['incomeTaxesRefundCashFlow']})).toMatchObject({total:0,excludedRows:1});
  expect(screen([doc('1001',{raw:'9007199254740993'})],{metricIds:['incomeTaxExpense']})).toMatchObject({excludedRows:1,reasonCounts:{'unsafe-number':1}});
 });
 it.each([['gt',['10010']],['gte',['10010','10020']],['lt',['10030']],['lte',['10020','10030']],['eq',['10020']]] as const)('負数CFの%s比較と並べ替え',(operator,codes)=>{
  const docs=[doc('1002',{raw:'-100'}),doc('1003',{raw:'-200'}),doc('1001',{raw:'0'})];
  const r=screen(docs,{metricIds:['incomeTaxesPaidCashFlow'],conditions:[{metric:'incomeTaxesPaidCashFlow',operator,value:-100}],sortBy:'incomeTaxesPaidCashFlow'});
  expect(r.rows.map(r=>r.metadata.secCode)).toEqual(codes);
 });
 it('順序/ページ・未指定CF要求・期間/分類/企業の混在を検査する',()=>{
  const a=doc(),b=doc('1002',{raw:'50'});expect(screen([a,b],{metricIds:['costOfSales'],sortBy:'costOfSales',order:'asc',offset:1,limit:1}).rows[0].metadata.secCode).toBe('10010');
  const unsafe={get xml(){throw Error('XML must not be read');},metadata:a.metadata};
  expect(()=>screen([unsafe],{conditions:[{metric:'incomeTaxesPaidCashFlow',operator:'gte',value:0}]})).toThrow('metricIds');
  expect(()=>screen([a,a])).toThrow('同一企業');
  expect(()=>screen([a,{...b,metadata:{...b.metadata,periodType:'ytd'}}])).toThrow('期間/分類');
  expect(()=>screen([a,{...b,metadata:{...b.metadata,period:{...b.metadata.period,startDate:'2024-10-01'}}}])).toThrow('期間/分類');
  expect(()=>screen([a,{...b,xml:a.xml}])).toThrow('entity');
 });
 it.each([{metricIds:[]},{metricIds:['costOfSales','costOfSales']},{metricIds:['unknown']},{metricIds:Array(1)},{conditions:null},{conditions:[{metric:'costOfSales',operator:'gte',value:Infinity}]},{conditions:[{metric:'costOfSales',operator:'gte',value:Number.MAX_SAFE_INTEGER+1}]},{offset:-1},{limit:NaN},{order:'random'},{extra:true}])('不正設定を空検索でも拒否する %j',settings=>{expect(()=>screen([],settings as never)).toThrow();});
 it('読取時に配列iterator・後続metadataの変更で比較範囲を変えさせない',()=>{
  const a=doc(),b=doc('1002'),original=b.metadata.period.endDate;
  const docs=[{get xml(){b.metadata.period.endDate='2020-01-01';return a.xml;},metadata:a.metadata},b];
  const result=screen(docs,{metricIds:['costOfSales']});expect(result.rows.map(r=>r.metadata.period.endDate)).toEqual([original,original]);
  const array=[doc()];array[Symbol.iterator]=function*(){yield doc('9999');};expect(screen(array).rows[0].metadata.secCode).toBe('10010');
 });
 it.each([{scope:'NonConsolidated'},{accountingStandard:'J-GAAP'},{currency:'USD'},{period:{instant:'2025-03-31'}},{periodType:'quarter'},{period:{startDate:'2024-04-01',endDate:'2025-02-30'}},{unknown:true}])('metadataの不整合を拒否する %j',changed=>{
  const d=doc();expect(()=>snapshot(d.xml,{...d.metadata,...changed} as never)).toThrow();
 });
});
