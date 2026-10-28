import {mkdtempSync,rmSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir,cpus} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {createHash} from 'node:crypto';
import {strict as assert} from 'node:assert';
import {ObservedFinancialArchive,FinancialSearchIndex,screenFinancialDetailSnapshots,type FinancialDetailSnapshot,type FinancialIndexCohort} from '../src/index';
import {reportingInstance} from '../test/fixtures/financial-reporting-basis';
const results=[];
for(const size of [100,500,1000]){
 const dir=mkdtempSync(join(tmpdir(),'financial-index-benchmark-')),path=join(dir,'index.sqlite'),archive=new ObservedFinancialArchive(':memory:');let index:FinancialSearchIndex|undefined;
 try{
  for(let start=0;start<size;start+=100){const batch=Array.from({length:Math.min(100,size-start)},(_,j)=>{const i=start+j,docID='BENCH-'+i,issuer='E'+String(i+1).padStart(5,'0'),secCode=String(1000+i)+'0',xml=reportingInstance({issuer,security:secCode}).replace('>10</jppfs_cor:CostOfSales>','>'+i%17+'</jppfs_cor:CostOfSales>');return {observation:{observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode:issuer,secCode,periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}},source:{docID,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex'),xml}};});archive.append(batch.map(x=>x.observation),batch.map(x=>x.source));}
  const settings={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'benchmark-1'},raw=archive.createSnapshots(settings),snapshots=raw.records.map(record=>{const r=record.result;assert(r.status==='resolved'&&r.accountingStandard==='J-GAAP'&&r.details.status==='created');return r.details.snapshot as FinancialDetailSnapshot;});
  index=new FinancialSearchIndex(path);index.materialize('bench',archive,settings);index.close();const opened=performance.now();index=new FinancialSearchIndex(path,{readOnly:true});const openMs=performance.now()-opened,cohort:FinancialIndexCohort={generation:'bench',group:'details',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'},options={metricIds:['costOfSales','sellingGeneralAndAdministrativeExpenses'] as const,conditions:[{metric:'costOfSales' as const,operator:'gte' as const,value:10}],sortBy:'costOfSales' as const,order:'desc' as const,limit:10};
  const expected=screenFinancialDetailSnapshots(snapshots,options),initial=index.screen(cohort,options);assert.deepEqual(JSON.parse(JSON.stringify({...initial,rows:initial.rows.map(r=>r.snapshot)})),JSON.parse(JSON.stringify(expected)));
  const samples={sql:[] as number[],memory:[] as number[]};
  for(let i=0;i<5;i++){let now=performance.now();const sql=index.screen(cohort,options);samples.sql.push(performance.now()-now);now=performance.now();const mem=screenFinancialDetailSnapshots(snapshots,options);samples.memory.push(performance.now()-now);assert.equal(sql.total,mem.total);assert.deepEqual(sql.rows.map(r=>r.snapshot.metadata.docID),mem.rows.map(r=>r.metadata.docID));}
  const median=(xs:number[])=>[...xs].sort((a,b)=>a-b)[2];results.push({size,bytes:statSync(path).size,openMs,sqlMedianMs:median(samples.sql),memoryMedianMs:median(samples.memory),samples});console.log(results.at(-1));
 }finally{index?.close();archive.close();rmSync(dir,{recursive:true,force:true});}
}
mkdirSync('data/benchmarks',{recursive:true});
writeFileSync('data/benchmarks/financial-search-index.json',JSON.stringify({node:process.version,cpu:cpus()[0]?.model,conditions:'synthetic J-GAAP; two stored groups; details two metrics; gte 10 / desc / limit 10; one process also holds memory inputs; one warmup; five samples; readonly copy opening excluded; full metadata/projection audit included',results},null,2));
