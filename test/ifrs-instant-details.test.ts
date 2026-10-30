import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import {createIfrsBalanceSheetSnapshot,screenIfrsBalanceSheetDocuments,createAutomaticFinancialSnapshots,ObservedFinancialArchive,FinancialSearchIndex,IfrsBalanceSheetMetricId as M,DEFAULT_IFRS_BALANCE_SHEET_METRICS,type FinancialIndexCohort} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const mappings = [
 [M.NoncurrentAssets,'NonCurrentAssetsIFRS'],
 [M.CurrentInterestBearingLiabilities,'InterestBearingLiabilitiesCLIFRS'],
 [M.NoncurrentInterestBearingLiabilities,'InterestBearingLiabilitiesNCLIFRS'],
 [M.CurrentLeaseLiabilities,'LeaseLiabilitiesCLIFRS'],
 [M.NoncurrentLeaseLiabilities,'LeaseLiabilitiesNCLIFRS']
] as const;
const extraIds=mappings.map(([id])=>id),all=[...DEFAULT_IFRS_BALANCE_SHEET_METRICS,...extraIds];
const metadata={secCode:'10010',docID:'A',instant:'2026-03-31',accountingStandard:'IFRS',scope:'Consolidated',currency:'JPY'} as const;
const fact=(tag:string,raw:string,attrs='')=>`<jpigp_cor:${tag} contextRef="arbitrary-instant" unitRef="money" decimals="0" ${attrs}>${raw}</jpigp_cor:${tag}>`;
const xml=(extra=mappings.map(([,tag],i)=>fact(tag,String(i*10))).join(''))=>reportingInstance({standard:'IFRS',extra});
const doc=(input=xml())=>({xml:input,metadata});
it('既定3項目を変えず、指定した追加項目の原値・0と出典を読む',()=>{
 expect(Object.keys(createIfrsBalanceSheetSnapshot(xml(),metadata).selections)).toEqual(DEFAULT_IFRS_BALANCE_SHEET_METRICS);
 const result=createIfrsBalanceSheetSnapshot(xml(),metadata,extraIds);expect(Object.keys(result.selections)).toEqual(all);
 mappings.forEach(([id,tag],i)=>expect(result.selections[id]).toMatchObject({status:'selected',raw:String(i*10),safeNumber:i*10,source:{key:'jpigp_cor:'+tag,contextRef:'arbitrary-instant',unit:'iso4217:JPY',period:{instant:metadata.instant}}}));
 const plain=screenIfrsBalanceSheetDocuments([doc(xml(''))]);expect(plain).toMatchObject({total:1,diagnostics:[],reasonCounts:{missing:0}});
});
it('追加項目を検索に明示し、欠損を0や推定値にせず、不要な欠損では除外しない',()=>{
 const metric=M.CurrentLeaseLiabilities,input=xml(fact('LeaseLiabilitiesCLIFRS','0'));
 expect(()=>screenIfrsBalanceSheetDocuments([doc(input)],{sortBy:metric})).toThrow('明示');
 const found=screenIfrsBalanceSheetDocuments([doc(input)],{metricIds:extraIds,conditions:[{metric,operator:'eq',value:0}],sortBy:metric});
 expect(found).toMatchObject({total:1,excludedRows:0,reasonCounts:{missing:4}});expect(found.diagnostics.every(d=>!d.required)).toBe(true);
 expect(screenIfrsBalanceSheetDocuments([doc(input)],{metricIds:extraIds})).toMatchObject({total:0,excludedRows:1});
});
it.each([[],[M.NoncurrentAssets,M.NoncurrentAssets],['__proto__'],new Array(1)].map(metricIds=>({metricIds})))('不正な追加指定$metricIdsを原本なしでも拒否する',({metricIds})=>{
 expect(()=>screenIfrsBalanceSheetDocuments([],{metricIds:metricIds as never})).toThrow();
 expect(()=>createIfrsBalanceSheetSnapshot('<bad>',metadata,metricIds as never)).toThrow();
});
it('追加項目の配列を検証時に固定し、独自iteratorを使わない',()=>{
 const chosen=[M.NoncurrentAssets];Object.defineProperty(chosen,Symbol.iterator,{value:function*(){yield '__proto__'}});
 expect(createIfrsBalanceSheetSnapshot(xml(),metadata,chosen).selections.noncurrentAssets).toMatchObject({status:'selected'});
});
it('nil・不在・精度不足を直接値と区別し、有利子負債とリース負債を合算しない',()=>{
 const input=xml(fact('NonCurrentAssetsIFRS','', 'xsi:nil="true"')+fact('InterestBearingLiabilitiesCLIFRS','9007199254740993')+fact('LeaseLiabilitiesCLIFRS','50'));
 const result=createIfrsBalanceSheetSnapshot(input,metadata,extraIds);
 expect(result.selections.noncurrentAssets).toMatchObject({status:'missing',reason:'nil'});
 expect(result.selections.currentInterestBearingLiabilities).toMatchObject({status:'selected',raw:'9007199254740993'});expect(result.selections.currentInterestBearingLiabilities?.safeNumber).toBeUndefined();
 expect(result.selections.noncurrentInterestBearingLiabilities).toMatchObject({status:'missing',reason:'tag-absent'});expect(result.selections.currentLeaseLiabilities?.raw).toBe('50');
});
it('自動抽出・版付きcache・再openしたSQL索引まで8項目を保存し、日本基準と混ぜない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ifrs-instant-index-'));let archive:ObservedFinancialArchive|undefined,index:FinancialSearchIndex|undefined;
 try{
  const input=xml(),sourceSha256=createHash('sha256').update(input).digest('hex'),archivePath=join(dir,'archive.sqlite'),indexPath=join(dir,'index.sqlite');
  const automatic=createAutomaticFinancialSnapshots(input,{docID:'A'});expect(automatic.status).toBe('resolved');if(automatic.status!=='resolved'||automatic.balanceSheet.status!=='created')throw Error('fixture');expect(Object.keys(automatic.balanceSheet.snapshot.selections)).toEqual(all);
  archive=new ObservedFinancialArchive(archivePath);archive.append([{observationId:'A',observedAt:'2026-06-25T00:00:00Z',document:{docID:'A',parentDocID:null,periodStart:'2025-04-01',periodEnd:'2026-03-31',edinetCode:'E12345',secCode:'10010',docTypeCode:'120',submitDateTime:'2026-06-24 09:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID:'A',xml:input,sourceSha256,availableAt:'2026-06-26T00:00:00Z'}]);
  const query={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'ifrs-instant-test'};
  const first=archive.createSnapshots(query),cached=archive.createSnapshots(query);expect(first.provenance.mappingVersions.ifrsBalanceSheet).toBe('3');expect(cached.cache).toEqual({hits:1,extracted:0});expect(cached.records).toEqual(first.records);
  index=new FinancialSearchIndex(indexPath);index.materialize('g',archive,query);const cohort:FinancialIndexCohort={generation:'g',group:'balanceSheet',accountingStandard:'IFRS',scope:'Consolidated',currency:'JPY',period:{instant:metadata.instant}};
  const options={metricIds:all,conditions:[{metric:M.CurrentLeaseLiabilities,operator:'gte' as const,value:30}],sortBy:M.NoncurrentAssets};
  const result=index.screen(cohort,options),memory=screenIfrsBalanceSheetDocuments([doc(input)],options);expect(result.total).toBe(1);expect(result.rows[0].snapshot.selections).toEqual(memory.rows[0].selections);expect(index.quality('g').cohorts.find(c=>c.cohort.group==='balanceSheet')?.values.available).toBe(8);
  expect(()=>index!.screen({...cohort,accountingStandard:'J-GAAP'},options)).toThrow('既知');
  index.close();index=undefined;archive.close();archive=undefined;const before=readFileSync(indexPath);index=new FinancialSearchIndex(indexPath,{readOnly:true});expect(index.screen(cohort,options)).toEqual(result);expect(readFileSync(indexPath)).toEqual(before);
 }finally{index?.close();archive?.close();rmSync(dir,{recursive:true,force:true})}
});
it('built CLIで追加項目を明示して検索し、不正指定と未指定の条件を拒否する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ifrs-instant-cli-'));
 try{
  const input=xml();writeFileSync(join(dir,'a.xml'),input);writeFileSync(join(dir,'files.json'),JSON.stringify([{file:'a.xml',metadata}]));
  const run=(args:string[])=>spawnSync(process.execPath,[resolve('dist/cli.js'),'screen-ifrs-bs','--manifest',join(dir,'files.json'),...args],{cwd:'/tmp',encoding:'utf8'});
  const result=run(['--metrics',extraIds.join(','),'--sort-by',M.NoncurrentAssets]);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).rows[0].selections.currentLeaseLiabilities.raw).toBe('30');
  for(const args of [['--sort-by',M.NoncurrentAssets],['--metrics','__proto__'],['--metrics','']])expect(run(args).status).toBe(1);
  expect(readFileSync(join(dir,'a.xml'),'utf8')).toBe(input);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
