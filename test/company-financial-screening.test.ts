import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';import {spawnSync} from 'node:child_process';
import {ObservedFinancialArchive,FinancialSearchIndex,screenCompanyFinancials,type CompanyMasterSnapshot,type CompanyFinancialScreeningOptions,type DocumentVersionObservation} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const options:CompanyFinancialScreeningOptions={cohort:{generation:'industry-fixture',group:'details',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'},company:{asOf:'2026-10-27',industry:'建設業',listingStatus:'listed'},search:{metricIds:['costOfSales'],sortBy:'costOfSales',order:'asc'}};
function fixture(fn:(file:string,master:CompanyMasterSnapshot,dir:string)=>void,duplicate=false,standard:'J-GAAP'|'IFRS'='J-GAAP'){
 const dir=mkdtempSync(join(tmpdir(),'company-financial-')),file=join(dir,'index.sqlite'),archive=new ObservedFinancialArchive(':memory:'),index=new FinancialSearchIndex(file);
 const master:CompanyMasterSnapshot={asOf:'2026-10-27',observedAt:'2026-10-27T00:00:00Z',sourceUrl:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),records:[]};
 try{const observations:DocumentVersionObservation[]=[],sources=[];
  for(let i=1;i<=(duplicate?5:4);i++){const n=i===5?1:i,docID='A'+i,edinetCode='E1200'+n,secCode='100'+n+'0';const prefix=standard==='IFRS'?'jpigp_cor':'jppfs_cor',tag=standard==='IFRS'?'CostOfSalesIFRS':'CostOfSales';let xml=reportingInstance({issuer:edinetCode,security:secCode,standard:standard==='IFRS'?'IFRS':'Japan GAAP'});xml=i===4?xml.replace(new RegExp('<'+prefix+':'+tag+'\\b[^>]*>[\\s\\S]*?</'+prefix+':'+tag+'>'),''):xml.replace('>10</'+prefix+':'+tag+'>','>'+i*10+'</'+prefix+':'+tag+'>');
   observations.push({observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,edinetCode,secCode,parentDocID:null,docTypeCode:'120',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}});
   sources.push({docID,xml,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex')});
   if(i<=4)master.records=[...master.records,{entityId:'edinet:'+edinetCode,edinetCode,securityCode:secCode,name:'会社'+i,filerType:'内国法人',listingStatus:'listed',industry:i===2?'化学':'建設業'}];
  }archive.append(observations,sources);index.materialize('industry-fixture',archive,{cutoff:'2026-10-28T00:00:00Z',extractorVersion:'industry-fixture'});
 }finally{index.close();archive.close()}
 try{fn(file,master,dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
it('業種をEDINET IDで結合してから並びのページを切り、欠損を0へ変えない',()=>fixture((file,master)=>{
 const before=readFileSync(file),r=screenCompanyFinancials(file,[master],{...options,search:{...options.search,offset:1,limit:1}});
 expect(r.total).toBe(2);expect(r.rows.map(r=>r.company.edinetCode)).toEqual(['E12003']);expect(r.rows[0].financial.snapshot.selections.costOfSales?.raw).toBe('30');expect(r.excludedRows).toBe(1);expect(r.diagnostics).toMatchObject([{company:{edinetCode:'E12004'},reason:'missing',required:true}]);expect(r.master).toMatchObject({status:'available',total:3});expect(r.indexSha256).toBe(createHash('sha256').update(before).digest('hex'));expect(readFileSync(file)).toEqual(before);
 expect(screenCompanyFinancials(file,[master],{...options,search:{...options.search,limit:0}})).toMatchObject({total:2,rows:[]});
}));
it('数値条件・降順と会社属性を同時に使い、全業種も検索できる',()=>fixture((file,master)=>{
 const r=screenCompanyFinancials(file,[master],{...options,search:{...options.search,conditions:[{metric:'costOfSales',operator:'gte',value:20}],order:'desc'}});expect(r.rows.map(r=>r.company.edinetCode)).toEqual(['E12003']);
 const all=screenCompanyFinancials(file,[master],{...options,company:{asOf:options.company.asOf}});expect(all.total).toBe(3);expect(all.rows[1].company.industry).toBe('化学');
}));
it('証券コードの再利用で別EDINET法人の過去財務を結合しない',()=>fixture((file,master)=>{
 master.records=[...master.records,{...master.records[0],entityId:'edinet:E22001',edinetCode:'E22001',industry:'電気機器',name:'別の会社'}];const r=screenCompanyFinancials(file,[master],{...options,company:{asOf:options.company.asOf,industry:'電気機器'}});expect(r.total).toBe(0);expect(r.rows).toEqual([]);
}));
it('企業マスターの未来観測を財務世代のcutoffへ遡及しない',()=>fixture((file,master)=>{
 const future=structuredClone(master);future.observedAt='2026-10-29T00:00:00Z';future.sourceSha256='b'.repeat(64);future.records=future.records.map(r=>({...r,industry:'化学'}));const r=screenCompanyFinancials(file,[master,future],options);expect(r.total).toBe(2);expect(r.master).toMatchObject({status:'available',observedAt:master.observedAt});expect(screenCompanyFinancials(file,[future],options)).toMatchObject({master:{status:'unavailable',reason:'no-observation'},total:0});
}));
it.each(['knownAt','offset','metric','extra'])('%sの不正入力を読取専用の比較で受理しない',kind=>fixture((file,master)=>{
 const input:any=structuredClone(options);if(kind==='knownAt')input.company.knownAt='2027-01-01T00:00:00Z';if(kind==='offset')input.search.offset=-1;if(kind==='metric')input.search.metricIds=['__proto__'];if(kind==='extra')input.surprise=true;expect(()=>screenCompanyFinancials(file,[master],input)).toThrow();
}));
it('業種外のcohortにある同一企業の複数書類も条件で隠さない',()=>fixture((file,master)=>{expect(()=>screenCompanyFinancials(file,[master],{...options,company:{asOf:options.company.asOf,industry:'化学'}})).toThrow('同一企業')},true));
it('CLIで業種と財務を検索し、2つの企業入力指定の片方だけでは失敗する',()=>fixture((file,master,dir)=>{
 const cohort=join(dir,'cohort.json'),snapshots=join(dir,'master.json'),company=join(dir,'query.json');writeFileSync(cohort,JSON.stringify(options.cohort));writeFileSync(snapshots,JSON.stringify([master]));writeFileSync(company,JSON.stringify(options.company));
 const run=(args:string[])=>spawnSync(process.execPath,['--import','tsx',resolve('src/cli.ts'),'screen-financial-index','--db',file,'--cohort',cohort,'--metrics','costOfSales','--sort-by','costOfSales','--order','asc',...args],{encoding:'utf8'});
 const r=run(['--company-master',snapshots,'--company-query',company,'--offset','1','--limit','1']);expect(r.status,r.stderr).toBe(0);const result=JSON.parse(r.stdout);expect(result.total).toBe(2);expect(result.rows[0].company.edinetCode).toBe('E12003');expect(run(['--company-master',snapshots]).status).toBe(1);expect(run(['--company-query',company]).status).toBe(1);
}));

it.each(['J-GAAP','IFRS'] as const)('%sのBSも同一期末のまま企業属性と結合する',standard=>fixture((file,master)=>{
 const r=screenCompanyFinancials(file,[master],{...options,cohort:{...options.cohort,group:'balanceSheet',accountingStandard:standard,period:{instant:'2026-03-31'},periodType:undefined},search:{metricIds:['currentAssets'],sortBy:'currentAssets'}});
 expect(r.total).toBe(3);expect(r.rows.every(row=>row.financial.group==='balanceSheet'&&row.financial.snapshot.metadata.accountingStandard===standard&&row.financial.snapshot.selections.currentAssets?.safeNumber===100)).toBe(true);expect(r.excludedRows).toBe(0);
},false,standard));
