import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {FinancialSearchIndex,financialIndexBuildPartId,projectFinancialIndexGeneration} from '../src/db/financial-search-index';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {authenticateFinancialVersionEvidence,FINANCIAL_VERSION_POLICY} from '../src/financial-version-selection';
import {financialVersionEvidenceFixture,signFinancialVersionBundle} from './fixtures/financial-version-evidence';
const canonical=(v:any):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
const cohort=(generation:string)=>({generation,group:'details' as const,accountingStandard:'J-GAAP' as const,scope:'Consolidated' as const,currency:'JPY' as const,period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual' as const});
async function setup(path=':memory:',held=false){
 let bundle=await financialVersionEvidenceFixture();
 if(held)bundle=signFinancialVersionBundle({...bundle,evidence:[]});
 const binding={bundle,context:await authenticateFinancialVersionEvidence(bundle)},archive=new ObservedFinancialArchive(':memory:'),index=new FinancialSearchIndex(path);
 archive.append(bundle.observations,bundle.sources);
 const options={cutoff:bundle.cutoff,extractorVersion:'financial-version-index-test',financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:bundle.evidenceManifestSha256}};
 return {archive,index,binding,options,close(){index.close();archive.close()}};
}
it('v1の通常結果を保持し、明示v2だけに全証拠と行bindingを保存する',async()=>{
 const s=await setup();try{
  const {financialVersion,...ordinary}=s.options,first=s.index.materialize('v1',s.archive,ordinary),before=canonical(first),quality=s.index.quality('v1');
  expect(first.indexVersion).toBe('1');expect(first.rows).toHaveLength(0);expect(quality.selectionDecisions).toEqual({selected:0,unresolved:1,unavailable:0});expect(quality).not.toHaveProperty('financialVersionDecisions');
  const report=s.index.materializeSourceBacked('v2',s.archive,s.options,s.binding);
  expect(report).toMatchObject({indexVersion:'2',selectionMode:FINANCIAL_VERSION_POLICY});expect(report.rows).toHaveLength(2);
  expect(s.index.quality('v2')).toMatchObject({selectionDecisions:{selected:0,unresolved:1,unavailable:0},financialVersionDecisions:{selected:1,held:0},selectedDocuments:1,rows:2});
  const row=s.index.screen(cohort('v2'),{metricIds:['costOfSales']}).rows[0];
  if(report.indexVersion!=='2')throw Error('v2 required');
  expect(row).toMatchObject({rootDocID:'A',chainDocIDs:['A','C'],observationIds:['A','B','C'],financialVersionDecisionSha256:report.financialVersionSelection[0].status==='selected-source'?report.financialVersionSelection[0].sha256:'',financialVersionEvidenceSha256:report.financialVersionProof.sha256,snapshot:{metadata:{docID:'C'},selections:{costOfSales:{raw:'10'}}}});
  expect(canonical(s.index.generation('v1'))).toBe(before);expect(s.index.quality('v1')).toEqual(quality);
  expect(s.index.materializeSourceBacked('v2',s.archive,s.options,s.binding)).toEqual(report);
  expect(()=>projectFinancialIndexGeneration('stripped',s.archive.createSourceBackedSnapshots(s.options,s.binding))).toThrow('専用');
  const backed=s.archive.createSourceBackedSnapshots(s.options,s.binding),{financialVersion:_,...provenance}=backed.provenance;
  const stripped={selection:backed.selection,records:backed.records,unavailableSources:backed.unavailableSources,provenance,cache:backed.cache};
  expect(()=>projectFinancialIndexGeneration('stripped-all',stripped)).toThrow('専用');
 }finally{s.close()}
});
it('証拠欠落はmetadata未解決とfinancial heldを別に保持する',async()=>{
 const s=await setup(':memory:',true);try{
  const g=s.index.materializeSourceBacked('held',s.archive,s.options,s.binding);expect(g.rows).toHaveLength(0);
  expect(s.index.quality('held')).toMatchObject({selectionDecisions:{selected:0,unresolved:1,unavailable:0},financialVersionDecisions:{selected:0,held:1},selectedDocuments:0});
 }finally{s.close()}
});
it('sidecar外の通常metadata未解決系列と会社scopeを落とさない',async()=>{
 const s=await setup();try{
  const source=s.binding.bundle.observations[0],document={...source.document,docID:'OUTSIDE',edinetCode:'E99999'};delete document.withdrawalStatus;
  s.archive.append([{...source,observationId:'outside',document}]);
  s.index.materializeSourceBacked('all',s.archive,s.options,s.binding);
  expect(s.index.quality('all')).toMatchObject({selectionDecisions:{selected:0,unresolved:2,unavailable:0},financialVersionDecisions:{selected:1,held:0}});
  const scoped=s.index.materializeSourceBacked('outside',s.archive,{...s.options,edinetCodes:['E99999']},s.binding);
  expect(scoped.rows).toHaveLength(0);expect(s.index.quality('outside')).toMatchObject({selectionDecisions:{selected:0,unresolved:1,unavailable:0},financialVersionDecisions:{selected:0,held:0}});
 }finally{s.close()}
});
it.each(['mode','version','policy','manifest','proof','metadata','decisions','effective-decision','row-decision','row-evidence','row-root','row-chain','row-knownAt','row-source','row-value','row-standard','row-scope','row-period','row-instant','row-type','row-security'])('SQL/hashを修復してもv2の%s不整合を全readerで拒否する',async field=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-version-index-')),path=join(dir,'index.sqlite');const s=await setup(path);
 try{s.index.materializeSourceBacked('v2',s.archive,s.options,s.binding)}finally{s.close()}
 try{
  const db=new DatabaseSync(path);try{
   const generation=JSON.parse(db.prepare("select body from financial_generations where id='v2'").get()!.body as string);
   if(field==='mode')delete generation.selectionMode;
   if(field==='version')generation.indexVersion='1';
   if(field==='policy')generation.selectionMode='invented-policy';
   if(field==='manifest')generation.provenance.financialVersion.evidenceManifestSha256='0'.repeat(64);
   if(field==='proof')generation.financialVersionProof.sha256='1'.repeat(64);
   if(field==='metadata')generation.metadataSelection.decisions[0].status='selected';
   if(field==='decisions')generation.financialVersionSelection=[];
   if(field==='effective-decision')generation.selection.decisions[0].selectedDocID='B';
   if(field.startsWith('row-')){
    const stored=db.prepare("select row_id,body from financial_rows where group_id=?").get(field==='row-instant'?'balanceSheet':'details')!,row=JSON.parse(stored.body as string);
    if(field==='row-decision')row.financialVersionDecisionSha256='2'.repeat(64);
    if(field==='row-evidence')delete row.financialVersionEvidenceSha256;
    if(field==='row-chain')row.chainDocIDs=['B','C'];
    if(field==='row-root'){row.rootDocID='UNRELATED';delete row.financialVersionDecisionSha256;delete row.financialVersionEvidenceSha256;}
    if(field==='row-knownAt')row.knownAt='2026-06-27T00:00:00Z';
    if(field==='row-source')row.sourceSha256='3'.repeat(64);
    if(field==='row-value'){row.snapshot.selections.costOfSales.raw='99';row.snapshot.selections.costOfSales.safeNumber=99;}
    if(field==='row-standard')row.snapshot.metadata.accountingStandard='IFRS';
    if(field==='row-scope')row.snapshot.metadata.scope='NonConsolidated';
    if(field==='row-period')row.snapshot.metadata.period.endDate='2025-03-31';
    if(field==='row-instant')row.snapshot.metadata.period.instant='2025-03-31';
    if(field==='row-type')row.snapshot.metadata.periodType='quarterly';
    if(field==='row-security')row.snapshot.metadata.secCode='99990';
    const body=canonical(row),entry=generation.rows.find((r:any)=>r.id===stored.row_id),m=row.snapshot.metadata;
    entry.metadata[3]=m.accountingStandard;entry.metadata[4]=m.scope;entry.metadata[7]=m.period.endDate??m.period.instant;entry.metadata[8]=m.periodType??'';entry.metadata[10]=m.secCode;
    entry.sha256=hash(canonical([entry.metadata,body]));
    db.prepare('update financial_rows set standard=?,scope=?,period_end=?,period_type=?,sec_code=?,body=?,sha256=? where row_id=?').run(m.accountingStandard,m.scope,m.period.endDate??m.period.instant,m.periodType??'',m.secCode,body,entry.sha256,stored.row_id as string);
   }
   const body=canonical(generation);db.prepare("update financial_generations set body=?,sha256=? where id='v2'").run(body,hash(canonical(['v2',body])));
  }finally{db.close()}
  const reader=new FinancialSearchIndex(path,{readOnly:true});try{const expected=['row-standard','row-scope','row-period','row-instant','row-type','row-security'].includes(field)?'認証済み原本':undefined;expect(()=>reader.generation('v2')).toThrow(expected);expect(()=>reader.quality('v2')).toThrow(expected);expect(()=>reader.screen(cohort('v2'),{metricIds:['costOfSales']})).toThrow(expected)}finally{reader.close()}
 }finally{rmSync(dir,{recursive:true,force:true})}
});
it('v2行bindingの失敗は世代/全行/値のtransactionをrollbackする',async()=>{
 const s=await setup();try{
  const {financialVersion,...ordinary}=s.options;
  const before=s.index.materialize('v1',s.archive,ordinary),original=s.archive.createSourceBackedSnapshots.bind(s.archive);
  s.archive.createSourceBackedSnapshots=((...args:Parameters<typeof original>)=>{
   const result=original(...args);for(const r of result.records)r.financialVersionDecisionSha256='0'.repeat(64);return result;
  }) as typeof s.archive.createSourceBackedSnapshots;
  expect(()=>s.index.materializeSourceBacked('failed',s.archive,s.options,s.binding)).toThrow();expect(()=>s.index.generation('failed')).toThrow();expect(s.index.generation('v1')).toEqual(before);
  s.archive.createSourceBackedSnapshots=original;
  expect(s.index.materializeSourceBacked('failed',s.archive,s.options,s.binding).rows).toHaveLength(2);
 }finally{s.close()}
});
it('v2会社別集約/利用側exportはtyped証拠を保持しv1混合を拒否する',async()=>{
 const s=await setup(),target=new FinancialSearchIndex(':memory:');try{
  const planSha256='a'.repeat(64),archiveSha256='b'.repeat(64),id=financialIndexBuildPartId(planSha256,'E12345');
  const part=s.index.materializeSourceBacked(id,s.archive,{...s.options,edinetCodes:['E12345']},s.binding);
  const context={planSha256,archiveSha256,population:{asOf:'2026-06-29',observedAt:s.options.cutoff,source:'test',sourceSha256:'c'.repeat(64),edinetCodes:['E12345']}};
  const combined=s.index.combine('combined',[id],context);expect(combined.indexVersion).toBe('2');expect(combined).toMatchObject({financialVersionProof:(part as any).financialVersionProof});
  const quality=s.index.quality('combined');expect(s.index.exportGenerationTo('combined',target)).toEqual(combined);expect(target.quality('combined')).toEqual(quality);expect(target.screen(cohort('combined'),{metricIds:['costOfSales']})).toEqual(s.index.screen(cohort('combined'),{metricIds:['costOfSales']}));
  const {financialVersion,...ordinary}=s.options;s.index.materialize('v1part',s.archive,{...ordinary,edinetCodes:['E12345']});expect(()=>s.index.combine('mixed',[id,'v1part'],context)).toThrow();
 }finally{target.close();s.close()}
});
it.skipIf(!process.env.FINANCIAL_VERSION_BASELINE_DIST)('凍結未変更baseline実readerは同DBのv1を読みv2 generation/quality/screenを拒否する',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'financial-version-baseline-')),path=join(dir,'index.sqlite'),s=await setup(path);
 try{const {financialVersion,...ordinary}=s.options;s.index.materialize('v1',s.archive,ordinary);s.index.materializeSourceBacked('v2',s.archive,s.options,s.binding)}finally{s.close()}
 try{
  const before=hash(readFileSync(path));const result=spawnSync(process.execPath,['-e',`const assert=require('node:assert/strict');const {FinancialSearchIndex}=require(process.argv[1]);const index=new FinancialSearchIndex(process.argv[2],{readOnly:true});try{assert.equal(index.generation('v1').indexVersion,'1');for(const call of [()=>index.generation('v2'),()=>index.quality('v2'),()=>index.screen(JSON.parse(process.argv[3]),{metricIds:['costOfSales']})])assert.throws(call)}finally{index.close()}` ,process.env.FINANCIAL_VERSION_BASELINE_DIST!,path,JSON.stringify(cohort('v2'))],{encoding:'utf8'});
  expect(result.status,result.stderr).toBe(0);expect(hash(readFileSync(path))).toBe(before);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
