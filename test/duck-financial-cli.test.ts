import {it,expect,vi} from 'vitest';import {Command} from 'commander';import {writeFileSync} from 'node:fs';import {join} from 'node:path';
import {registerDuckFinancialCommands} from '../src/duck-financial-cli';import {FinancialIndexPublication,type FinancialIndexPublicationPolicy} from '../src/db/financial-index-publication';import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
async function run(args:string[]){const log=vi.spyOn(console,'log').mockImplementation(()=>{}),error=vi.spyOn(console,'error').mockImplementation(()=>{}),prior=process.exitCode;try{process.exitCode=0;const p=new Command().exitOverride();registerDuckFinancialCommands(p);await p.parseAsync(['node','edinet-ts',...args]);return {code:process.exitCode,stdout:log.mock.calls.map(c=>String(c[0])).join('\n'),stderr:error.mock.calls.map(c=>String(c[0])).join('\n')}}finally{process.exitCode=prior;log.mockRestore();error.mockRestore()}}
it('検索・品質・世代コマンドがSDKと同じ結果を返す',()=>fixture(async({duck,dir,path})=>{
 const cohort={generation:'all',group:'details',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'} as const,file=join(dir,'cohort.json');writeFileSync(file,JSON.stringify(cohort));
 const result=await run(['screen-duck-financial-index','--db',path,'--cohort',file,'--metrics','costOfSales','--limit','1']);expect(result.code).toBe(0);expect(JSON.parse(result.stdout)).toEqual(await duck.screen(cohort,{metricIds:['costOfSales'],limit:1}));
 for(const method of ['quality','generation'] as const){const r=await run([`duck-financial-index-${method}`,'--db',path,'--generation','all']);expect(r.code).toBe(0);expect(JSON.parse(r.stdout)).toEqual(await duck[method]('all'))}
}),20000);
it('不正な数値・比較集合・未知ファイルを拒否し内容をログへ出さない',()=>fixture(async({dir,path})=>{
 const file=join(dir,'cohort.json');writeFileSync(file,JSON.stringify({secret:'private-content'}));for(const args of [['screen-duck-financial-index','--db',path,'--cohort',file,'--metrics','costOfSales','--offset','-1'],['screen-duck-financial-index','--db',path,'--cohort',file,'--metrics','costOfSales'],['duck-financial-index-quality','--db',join(dir,'missing'),'--generation','private-content']]){const r=await run(args);expect(r.code).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).not.toContain('private-content')}
}));
it('catalog状態を検査し、候補と履歴を出力する',()=>fixture(async({duck,dir,path})=>{
 const file=join(dir,'catalog.sqlite'),c=new FinancialIndexPublication(file),policy:FinancialIndexPublicationPolicy={minimumCompaniesWithUsableValues:4,maxUnavailableSources:0,maxUnresolvedSelections:0,maxUnavailableSelections:0,maxUnresolvedRecords:0,maxUnavailableGroups:0,maxDuplicateCohortIdentifiers:0,maxUnavailableValues:100};try{const expected=await c.prepareAsync('current',duck,'all',policy);await c.activateAsync('current',duck,{expectedActive:null});const r=await run(['duck-financial-publication-status','--catalog',file,'--db',path]);expect(r.code).toBe(0);expect(JSON.parse(r.stdout)).toEqual({active:expected,indexVerified:true,history:c.history()})}finally{c.close()}
}));
it('原本照合CLIは記録作成・再照合でき、未記録・異入力を拒否し正式参照を変えない',()=>fixture(async({duck,dir,path})=>{
 const file=join(dir,'verify-catalog.sqlite'),catalog=new FinancialIndexPublication(file),record=join(dir,'verification.json');
 try{
  await catalog.prepareAsync('candidate',duck,'all',{minimumCompaniesWithUsableValues:4,maxUnavailableSources:0,maxUnresolvedSelections:0,maxUnavailableSelections:0,maxUnresolvedRecords:0,maxUnavailableGroups:0,maxDuplicateCohortIdentifiers:0,maxUnavailableValues:100});
  const args=['verify-duck-financial-values','--db',path,'--catalog',file,'--candidate','candidate','--input-sha256','a'.repeat(64),'--archive',join(dir,'a.sqlite'),'--record',record];
  expect((await run([...args,'--check'])).code).toBe(1);
  const first=await run(args);expect(first.code).toBe(0);expect(JSON.parse(first.stdout).checks.documents).toBe(4);
  const checked=await run([...args,'--check']);expect(checked.code).toBe(0);expect(JSON.parse(checked.stdout).recordSha256).toBe(JSON.parse(first.stdout).sha256);
  const changed=[...args];changed[changed.indexOf('--input-sha256')+1]='b'.repeat(64);const rejected=await run([...changed,'--check']);expect(rejected.code).toBe(1);expect(rejected.stdout).toBe('');expect(catalog.current()).toBeUndefined();
 }finally{catalog.close()}
}),30000);
