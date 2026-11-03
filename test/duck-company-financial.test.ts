import {it,expect} from 'vitest';
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {screenDuckCompanyFinancials,compareDuckCompanyFinancialsByIndustry,type CompanyMasterSnapshot,type CompanyFinancialScreeningOptions,type CompanyIndustryComparisonOptions} from '../src/index';
import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
const cohort={generation:'all',group:'details' as const,accountingStandard:'J-GAAP' as const,scope:'Consolidated' as const,currency:'JPY' as const,period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual' as const};
const master:CompanyMasterSnapshot={asOf:'2026-10-27',observedAt:'2026-10-27T00:00:00Z',sourceUrl:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),records:[
 {entityId:'edinet:E12001',edinetCode:'E12001',securityCode:'10010',name:'会社1',filerType:'内国法人',listingStatus:'listed',industry:'建設業'},
 {entityId:'edinet:E12002',edinetCode:'E12002',securityCode:'10020',name:'会社2',filerType:'内国法人',listingStatus:'listed',industry:'化学'}]};
const screening:CompanyFinancialScreeningOptions={cohort,company:{asOf:'2026-10-27',listingStatus:'listed'},search:{metricIds:['costOfSales'],sortBy:'costOfSales',order:'asc'}};
const comparison:CompanyIndustryComparisonOptions={cohort,company:{asOf:'2026-10-27',listingStatus:'listed'},metricIds:['costOfSales']};
it('DuckDBでも企業マスターをEDINET IDで結合し、欠損を0へ変えない',async()=>{
 await fixture(async({path})=>{
  const r=await screenDuckCompanyFinancials(path,[master],screening);
  expect(r.master).toMatchObject({status:'available',total:2});
  expect(r.total).toBe(1);
  expect(r.rows.map(row=>row.company.edinetCode)).toEqual(['E12001']);
  expect(r.rows[0].financial.snapshot.selections.costOfSales?.raw).toBe('10');
  expect(r.excludedRows).toBe(1);
  expect(r.diagnostics).toMatchObject([{company:{edinetCode:'E12002'},reason:'unsafe-number',required:true}]);
  expect((await screenDuckCompanyFinancials(path,[master],{...screening,search:{...screening.search,limit:0}}))).toMatchObject({total:1,rows:[]});
  expect((await screenDuckCompanyFinancials(path,[master],{...screening,company:{asOf:'2026-10-27',industry:'化学'}}))).toMatchObject({total:0,rows:[]});
  expect((await screenDuckCompanyFinancials(path,[{...master,observedAt:'2026-10-29T00:00:00Z'}],screening)).master).toMatchObject({status:'unavailable'});
 });
},20000);
it('DuckDBでも業種別の共通採用集合と分数統計が同じ',async()=>{
 await fixture(async({path})=>{
  const r=await compareDuckCompanyFinancialsByIndustry(path,[master],comparison);
  expect(r.sample).toBe('complete-case');expect(r.total).toBe(1);
  const construction=r.industries.find(g=>g.industry==='建設業')!;
  expect(construction).toMatchObject({masterCompanies:1,usableCompanies:1,excludedCompanies:0,unrepresentedCompanies:0});
  expect(construction.metrics[0]).toMatchObject({count:1,sum:{numerator:'10',denominator:'1'},mean:{numerator:'10',denominator:'1'},median:{numerator:'10',denominator:'1'},min:10,max:10});
  expect(r.industries.find(g=>g.industry==='化学')).toMatchObject({masterCompanies:1,usableCompanies:0,excludedCompanies:1,unrepresentedCompanies:0,metrics:[]});
 });
},20000);
it('DuckDBの企業結合CLIはAPIと同じ返却値を出す',async()=>{
 await fixture(async({path,dir})=>{
  const write=(name:string,value:unknown)=>writeFileSync(join(dir,name),JSON.stringify(value));
  write('cohort.json',cohort);write('master.json',[master]);write('company.json',screening.company);write('compare-company.json',comparison.company);
  const run=(args:string[])=>spawnSync(process.execPath,['--import','tsx',resolve('src/cli.ts'),...args],{encoding:'utf8'});
  const screen=run(['screen-duck-financial-index','--db',path,'--cohort',join(dir,'cohort.json'),'--metrics','costOfSales','--sort-by','costOfSales','--order','asc','--company-master',join(dir,'master.json'),'--company-query',join(dir,'company.json')]);
  expect(screen.status,screen.stderr).toBe(0);
  expect(JSON.parse(screen.stdout)).toEqual(await screenDuckCompanyFinancials(path,[master],screening));
  const industry=run(['compare-duck-financial-industries','--db',path,'--cohort',join(dir,'cohort.json'),'--metrics','costOfSales','--company-master',join(dir,'master.json'),'--company-query',join(dir,'compare-company.json')]);
  expect(industry.status,industry.stderr).toBe(0);
  expect(JSON.parse(industry.stdout)).toEqual(await compareDuckCompanyFinancialsByIndustry(path,[master],comparison));
  expect(run(['screen-duck-financial-index','--db',path,'--cohort',join(dir,'cohort.json'),'--metrics','costOfSales','--company-master',join(dir,'master.json')]).status).toBe(1);
 });
},30000);
