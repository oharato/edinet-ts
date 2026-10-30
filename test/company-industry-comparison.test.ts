import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {ObservedFinancialArchive,FinancialSearchIndex,compareCompanyFinancialsByIndustry,type CompanyMasterSnapshot,type CompanyIndustryComparisonOptions,type DocumentVersionObservation} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const options:CompanyIndustryComparisonOptions={cohort:{generation:'industry-compare',group:'details',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'},company:{asOf:'2026-10-27',listingStatus:'listed'},metricIds:['costOfSales']};
function fixture(fn:(file:string,master:CompanyMasterSnapshot,dir:string)=>void,standard:'J-GAAP'|'IFRS'='J-GAAP',values=['0.1','0.2','-3','0','9007199254740991','9007199254740991']){
 const dir=mkdtempSync(join(tmpdir(),'industry-comparison-')),file=join(dir,'index.sqlite'),archive=new ObservedFinancialArchive(':memory:'),index=new FinancialSearchIndex(file);
 const master:CompanyMasterSnapshot={asOf:'2026-10-27',observedAt:'2026-10-27T00:00:00Z',sourceUrl:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),records:[]};
 try{const observations:DocumentVersionObservation[]=[],sources=[];
  for(let i=0;i<8;i++){
   const edinetCode='E1200'+i,secCode='100'+i+'0',docID='A'+i,industry=i<2?'建設業':i<4?'化学':i<6?'大額':i===6?'欠損業':undefined;
   master.records=[...master.records,{entityId:'edinet:'+edinetCode,edinetCode,securityCode:secCode,name:'会社'+i,filerType:'内国法人',listingStatus:'listed',industry}];
   if(i===7)continue;
   const prefix=standard==='IFRS'?'jpigp_cor':'jppfs_cor',tag=standard==='IFRS'?'CostOfSalesIFRS':'CostOfSales';let xml=reportingInstance({issuer:edinetCode,security:secCode,standard:standard==='IFRS'?'IFRS':'Japan GAAP'});
   xml=i===6?xml.replace(new RegExp('<'+prefix+':'+tag+'\\b[^>]*>[\\s\\S]*?</'+prefix+':'+tag+'>'),''):xml.replace('>10</'+prefix+':'+tag+'>','>'+values[i]+'</'+prefix+':'+tag+'>');
   if(i===1||i===6)xml=xml.replace(new RegExp('<'+prefix+':SellingGeneralAndAdministrativeExpenses(?:IFRS)?\\b[^>]*>[\\s\\S]*?</'+prefix+':SellingGeneralAndAdministrativeExpenses(?:IFRS)?>'),'');
   observations.push({observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,edinetCode,secCode,parentDocID:null,docTypeCode:'120',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}});
   sources.push({docID,xml,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex')});
  }archive.append(observations,sources);index.materialize('industry-compare',archive,{cutoff:'2026-10-28T00:00:00Z',extractorVersion:'industry-compare'});
 }finally{index.close();archive.close()}
 try{fn(file,master,dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
it('十進小数・負値・0・安全整数上限を丸めず集計し、欠損と未収録を分ける',()=>fixture((file,master)=>{
 const before=readFileSync(file),r=compareCompanyFinancialsByIndustry(file,[master],options);expect(r.sample).toBe('complete-case');expect(r.total).toBe(6);
 const g=(name:string|null)=>r.industries.find(g=>g.industry===name)!;
 expect(g('建設業')).toMatchObject({masterCompanies:2,usableCompanies:2,excludedCompanies:0,unrepresentedCompanies:0,metrics:[{count:2,sum:{numerator:'3',denominator:'10'},mean:{numerator:'3',denominator:'20'},median:{numerator:'3',denominator:'20'},min:0.1,max:0.2}]});
 expect(g('化学').metrics[0]).toMatchObject({sum:{numerator:'-3',denominator:'1'},mean:{numerator:'-3',denominator:'2'},median:{numerator:'-3',denominator:'2'},min:-3,max:0});
 expect(g('大額').metrics[0].sum).toEqual({numerator:'18014398509481982',denominator:'1'});
 expect(g('欠損業')).toMatchObject({masterCompanies:1,usableCompanies:0,excludedCompanies:1,unrepresentedCompanies:0,metrics:[]});expect(g(null)).toMatchObject({masterCompanies:1,usableCompanies:0,excludedCompanies:0,unrepresentedCompanies:1,metrics:[]});expect(readFileSync(file)).toEqual(before);
}));
it('全指定指標が揃う共通企業だけで比較し、指標別に母集団を変えない',()=>fixture((file,master)=>{
 const r=compareCompanyFinancialsByIndustry(file,[master],{...options,metricIds:['costOfSales','sellingGeneralAndAdministrativeExpenses']});const g=r.industries.find(g=>g.industry==='建設業')!;expect(g.usableCompanies).toBe(1);expect(g.excludedCompanies).toBe(1);expect(g.metrics.map(m=>m.count)).toEqual([1,1]);expect(g.metrics[0].mean).toEqual({numerator:'1',denominator:'10'});expect(r.industries.find(g=>g.industry==='欠損業')?.excludedCompanies).toBe(1);expect(r.diagnostics.filter(d=>d.company.edinetCode==='E12006')).toHaveLength(2);
}));
it('奇数の中央値は中央原値で、企業条件を集計前へ適用する',()=>fixture((file,master)=>{
 master.records=master.records.map((r,i)=>i<3?{...r,industry:'合流'}:r);const r=compareCompanyFinancialsByIndustry(file,[master],{...options,company:{...options.company,industry:'合流'}});expect(r.industries).toHaveLength(1);expect(r.industries[0].metrics[0]).toMatchObject({count:3,median:{numerator:'1',denominator:'10'},sum:{numerator:'-27',denominator:'10'}});
}));
it('未知の過去マスターでは空とし、未来観測を過去の分類に使わない',()=>fixture((file,master)=>{
 const future=structuredClone(master);future.observedAt='2026-10-29T00:00:00Z';future.sourceSha256='b'.repeat(64);future.records=future.records.map(r=>({...r,industry:'未来業種'}));expect(compareCompanyFinancialsByIndustry(file,[master,future],options).industries.some(g=>g.industry==='未来業種')).toBe(false);expect(compareCompanyFinancialsByIndustry(file,[future],options)).toMatchObject({master:{status:'unavailable'},industries:[],rows:[]});
}));
it.each(['knownAt','page','conditions','duplicate-metrics','wrong-period'])('%sを比較条件として受理しない',kind=>fixture((file,master)=>{
 const input:any=structuredClone(options);if(kind==='knownAt')input.company.knownAt='2027-01-01T00:00:00Z';if(kind==='page')input.limit=1;if(kind==='conditions')input.conditions=[];if(kind==='duplicate-metrics')input.metricIds=['costOfSales','costOfSales'];if(kind==='wrong-period')input.cohort.period={instant:'2026-03-31'};expect(()=>compareCompanyFinancialsByIndustry(file,[master],input)).toThrow();
}));
it.each(['J-GAAP','IFRS'] as const)('%sのBSは同一期末・基準だけで業種比較する',standard=>fixture((file,master)=>{
 const r=compareCompanyFinancialsByIndustry(file,[master],{...options,cohort:{...options.cohort,group:'balanceSheet',accountingStandard:standard,period:{instant:'2026-03-31'},periodType:undefined},metricIds:['currentAssets']});expect(r.total).toBe(7);expect(r.industries.filter(g=>g.usableCompanies).every(g=>g.metrics[0].mean.numerator==='100'&&g.metrics[0].mean.denominator==='1')).toBe(true);
},standard));
it('CLIの分数・母集団・欠損件数はAPIと一致する',()=>fixture((file,master,dir)=>{
 const cohort=join(dir,'cohort.json'),snapshots=join(dir,'master.json'),company=join(dir,'query.json');writeFileSync(cohort,JSON.stringify(options.cohort));writeFileSync(snapshots,JSON.stringify([master]));writeFileSync(company,JSON.stringify(options.company));
 const r=spawnSync(process.execPath,['--import','tsx',resolve('src/cli.ts'),'compare-financial-industries','--db',file,'--cohort',cohort,'--metrics','costOfSales','--company-master',snapshots,'--company-query',company],{encoding:'utf8'});expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual(compareCompanyFinancialsByIndustry(file,[master],options));
}));
