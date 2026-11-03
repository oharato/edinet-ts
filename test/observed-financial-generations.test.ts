import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {createObservedFinancialSnapshots,FinancialDetailGenerations,type DocumentVersionObservation} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
it('観測cutoffで選んだ訂正前後の直接明細を保存・再開・再open・旧世代復帰できる',()=>{
 const dir=mkdtempSync(join(tmpdir(),'observed-financial-generations-'));let store:FinancialDetailGenerations|undefined;
 try{
  const path=join(dir,'details.sqlite'),base={parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'};
  const observations:DocumentVersionObservation[]=[{observationId:'A',observedAt:'2026-06-25T00:00:00Z',document:{...base,docID:'A'}},{observationId:'B',observedAt:'2026-07-01T00:00:00Z',document:{...base,docID:'B',parentDocID:'A',docTypeCode:'130',submitDateTime:'2026-06-30 10:00'}}];
  const sources=[{docID:'A',xml:reportingInstance(),availableAt:'2026-06-26T00:00:00Z'},{docID:'B',xml:reportingInstance().replace('>10</jppfs_cor:CostOfSales>','>30</jppfs_cor:CostOfSales>'),availableAt:'2026-07-02T00:00:00Z'}].map(s=>({...s,sourceSha256:createHash('sha256').update(s.xml).digest('hex')}));
  const before=createObservedFinancialSnapshots(observations,sources,{cutoff:'2026-06-27T00:00:00Z'}),after=createObservedFinancialSnapshots(observations,sources,{cutoff:'2026-07-03T00:00:00Z'});
  expect(before.records[0].docID).toBe('A');expect(after.records[0].docID).toBe('B');
  store=new FinancialDetailGenerations(path);
  for(const [id,r]of [['before',before],['after',after]] as const){
   const record=r.records[0],result=record.result;if(result.status!=='resolved'||result.accountingStandard!=='J-GAAP'||result.details.status!=='created')throw Error('expected J-GAAP details');
   const plan={id,keys:[record.docID],extractorVersion:'test-1',mappingVersion:'7'};store.begin(plan);store.close();store=new FinancialDetailGenerations(path);store.begin(plan);expect(store.pending(id)).toEqual([record.docID]);
   const inputs=[{key:record.docID,snapshot:result.details.snapshot,provenance:{sourceSha256:record.sourceSha256,extractorVersion:'test-1',mappingVersion:'7'}}];store.put(id,inputs);store.put(id,inputs);store.complete(id);store.activate(id);
  }
  store.close();store=new FinancialDetailGenerations(path);
  expect(store.read('before')[0].snapshot.selections.costOfSales).toMatchObject({status:'selected',raw:'10'});expect(store.read('after')[0].snapshot.selections.costOfSales).toMatchObject({status:'selected',raw:'30'});
  store.activate('before');expect(store.active()).toBe('before');store.activate('after');expect(store.active()).toBe('after');
 }finally{store?.close();rmSync(dir,{recursive:true,force:true});}
});
