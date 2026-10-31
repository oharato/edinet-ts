import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {EdinetXbrlParser,createAutomaticFinancialSnapshots,createIfrsBalanceSheetSnapshot,createIfrsFinancialDetailSnapshot,screenIfrsBalanceSheetDocuments,screenIfrsFinancialDetailDocuments,ObservedFinancialArchive,FinancialSearchIndex} from '../src/index';
import {reportingInstance as fixture} from './fixtures/financial-reporting-basis';
const xml=(change:Parameters<typeof fixture>[0]={})=>fixture({standard:'IFRS',consolidated:'false',...change});
const bs={secCode:'10010',docID:'A',scope:'NonConsolidated',accountingStandard:'IFRS',currency:'JPY',instant:'2026-03-31'} as const;
const pl={...bs,instant:undefined,period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'} as const;
const plMetadata=()=>{const {instant,...m}=pl;return m};
it('当期主範囲の単体IFRSだけを直接fact/factory/automaticで採用しDEIを保持する',()=>{
 const raw=xml(),object=new EdinetXbrlParser().parse(raw,'A');
 expect(object.selectIfrsBalanceSheetMetric('currentAssets',{...bs,period:{instant:bs.instant}})).toMatchObject({status:'selected',raw:'100',source:{scope:'NonConsolidated',dimensions:['NonConsolidatedMember']}});
 expect(createIfrsBalanceSheetSnapshot(raw,bs)).toMatchObject({reportingBasis:{status:'selected',metadata:{scope:'NonConsolidated'}},selections:{currentAssets:{raw:'100'}}});
 expect(createIfrsFinancialDetailSnapshot(raw,plMetadata()).selections.costOfSales).toMatchObject({raw:'10'});
 expect(createAutomaticFinancialSnapshots(raw,{docID:'A'})).toMatchObject({status:'resolved',balanceSheet:{status:'created',snapshot:{metadata:{scope:'NonConsolidated'}}}});
});
it('前年の技術単体contextに値があっても当期主範囲から遡及認証しない',()=>{
 const raw=xml().replace('</xbrli:xbrl>','<xbrli:context id="prior"><xbrli:entity><xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E12345-000</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="jppfs_cor:ConsolidatedOrNonConsolidatedAxis">jppfs_cor:NonConsolidatedMember</xbrldi:explicitMember></xbrli:scenario></xbrli:context><jpigp_cor:CurrentAssetsIFRS contextRef="prior" unitRef="money" decimals="0">999</jpigp_cor:CurrentAssetsIFRS></xbrli:xbrl>');
 expect(createIfrsBalanceSheetSnapshot(raw,{...bs,instant:'2025-03-31'}).selections.currentAssets).toMatchObject({status:'unsupported',reason:'unsupported-semantics'});
 expect(createIfrsFinancialDetailSnapshot(raw,{...plMetadata(),period:{startDate:'2024-04-01',endDate:'2025-03-31'}}).selections.costOfSales).toMatchObject({status:'unsupported',reason:'unsupported-semantics'});
 expect(screenIfrsBalanceSheetDocuments([{xml:raw,metadata:{...bs,instant:'2025-03-31'}}],{conditions:[{metric:'currentAssets',operator:'gte',value:0}]})).toMatchObject({rows:[],excludedRows:1});
});
it.each([{standard:'Japan GAAP'},{consolidated:'true'},{entity:'E99999-000'},{deiNamespace:'urn:unknown'},{omit:'CurrentPeriodEndDateDEI'}])('別基準/主範囲/企業/不明DEIを単体IFRSへfallbackしない %j',change=>{
 expect(createIfrsBalanceSheetSnapshot(xml(change),bs).selections.currentAssets).toMatchObject({status:'unsupported',reason:'unsupported-semantics'});
});
it('単体の要求証券コード/分類は原本DEIと一致し、連結と比較混在しない',()=>{
 expect(()=>createIfrsBalanceSheetSnapshot(xml(),{...bs,secCode:'99990'})).toThrow('証券コード');
 expect(createIfrsFinancialDetailSnapshot(xml(),{...plMetadata(),periodType:'ytd'}).selections.costOfSales).toMatchObject({status:'unsupported'});
 expect(()=>screenIfrsBalanceSheetDocuments([{xml:xml(),metadata:bs},{xml:xml({consolidated:'true',security:'10020',issuer:'E12346'}),metadata:{...bs,secCode:'10020',docID:'B',scope:'Consolidated'}}])).toThrow();
 expect(()=>screenIfrsFinancialDetailDocuments([{xml:xml(),metadata:plMetadata()},{xml:xml({consolidated:'true',security:'10020',issuer:'E12346'}),metadata:{...plMetadata(),secCode:'10020',docID:'B',scope:'Consolidated'}}])).toThrow();
});
it('同期間2社をarchive/cache/indexへ接続しscope別SQLで比較し旧解析版を使わない',()=>{
 const archive=new ObservedFinancialArchive(':memory:'),index=new FinancialSearchIndex(':memory:');
 try{
  const observations=[1,2].map(i=>({observationId:'A'+i,observedAt:'2026-06-26T00:00:00Z',document:{docID:'A'+i,parentDocID:null,docTypeCode:'120',edinetCode:'E1234'+i,secCode:'100'+i+'0',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}));
  archive.append(observations,observations.map(o=>{const raw=xml({issuer:o.document.edinetCode,security:o.document.secCode});return {docID:o.document.docID,xml:raw,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(raw).digest('hex')}}));
  const q={cutoff:'2026-06-30T00:00:00Z',extractorVersion:'standalone-current'};const first=archive.createSnapshots(q),again=archive.createSnapshots(q);expect(again.cache).toEqual({hits:2,extracted:0});expect(first.provenance.mappingVersions).toMatchObject({ifrsBalanceSheet:'4',ifrsDetails:'3',observed:'8'});
  index.materialize('g',archive,q);const cohort={generation:'g',group:'balanceSheet',accountingStandard:'IFRS',scope:'NonConsolidated',currency:'JPY',period:{instant:bs.instant}} as const;
  expect(index.screen(cohort,{metricIds:['currentAssets']})).toMatchObject({total:2,rows:[{snapshot:{reportingBasis:{status:'selected'}}},{snapshot:{reportingBasis:{status:'selected'}}}]});expect(index.screen({...cohort,scope:'Consolidated'},{metricIds:['currentAssets']})).toMatchObject({total:0});
 }finally{index.close();archive.close()}
});
it('単体のquarterly profileは未対応とし、Q1同一3か月でも分類を無言で変更しない',()=>{
 const q1=xml({periodCode:'Q1',currentEnd:'2025-06-30'}),m={...plMetadata(),period:{startDate:'2025-04-01',endDate:'2025-06-30'}};
 expect(createIfrsFinancialDetailSnapshot(q1,{...m,periodType:'ytd'}).selections.costOfSales?.status).toBe('selected');
 expect(createIfrsFinancialDetailSnapshot(q1,{...m,periodType:'quarterly'}).selections.costOfSales).toMatchObject({status:'unsupported',reason:'unsupported-semantics'});
 const q2=xml({periodCode:'Q2',currentEnd:'2025-09-30',quarterStart:'2025-07-01'});
 expect(createIfrsFinancialDetailSnapshot(q2,{...m,period:{startDate:'2025-07-01',endDate:'2025-09-30'},periodType:'quarterly'}).selections.costOfSales).toMatchObject({status:'unsupported',reason:'unsupported-semantics'});
 expect(new EdinetXbrlParser().parse(q2,'A').selectIfrsFinancialDetail('costOfSales',{accountingStandard:'IFRS',scope:'NonConsolidated',period:{startDate:'2025-07-01',endDate:'2025-09-30'}})).toMatchObject({status:'unsupported',reason:'unsupported-semantics'});
});
