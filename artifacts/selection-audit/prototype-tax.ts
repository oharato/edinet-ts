// Research only: use existing pure selector with its opt-in behavior; public APIs remain unchanged.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {EdinetXbrlParser} from '../../src/edinet-xbrl-parser';
import {selectDefinedMetricFact} from '../../src/metric-selection';
import {FINANCIAL_DETAIL_REGISTRY_VERSION,FINANCIAL_DETAIL_REGISTRY} from '../../src/financial-detail-registry';
import {createFinancialDetailSnapshot} from '../../src/financial-detail-screening';
import {normalizeFinancialDetailSnapshot} from '../../src/financial-detail-snapshots';
import {instance,context,fact,period} from '../../test/fixtures/metric-boundaries';
assert.equal(FINANCIAL_DETAIL_REGISTRY_VERSION,"4","過去の採用前試作はe206f99で再現してください");
const id='incomeBeforeIncomeTaxes' as const;
function proposed(xml:string, options:any){
 const object=new EdinetXbrlParser().parse(xml);
 // Internal parsed maps are read only in this disposable experiment.
 const internal=object as any;
 return selectDefinedMetricFact(FINANCIAL_DETAIL_REGISTRY[id],options,object.dataMap,internal.contextMap,internal.unitMap,internal.duplicateContextIds,{collapseIdenticalDuplicates:true});
}
const options={accountingStandard:'J-GAAP',scope:'Consolidated',period};
const f=(raw='100',attrs='',ctx='current')=>fact(raw,attrs,'jppfs_cor:IncomeBeforeIncomeTaxes',ctx);
const cases:[string,string,string][]=[
 ['identical',instance(f()+f()),'selected'],
 ['negative-identical',instance(f('-100')+f('-100')),'selected'],
 ['zero-identical',instance(f('0')+f('0')),'selected'],
 ['unsafe-identical',instance(f('9007199254740993')+f('9007199254740993')),'selected'],
 ['different-value',instance(f()+f('101')),'ambiguous'],
 ['different-raw',instance(f()+f('100.0')),'ambiguous'],
 ['different-decimals',instance(f()+f().replace('decimals="INF"','decimals="0"')),'ambiguous'],
 ['nil-mixed',instance(f()+f('','xsi:nil="true"')),'ambiguous'],
 ['invalid-unit',instance(f()+f().replace('unitRef="money"','unitRef="unknown"')),'ambiguous'],
 ['duplicate-context',instance(f()+f(),context()+context()),'ambiguous'],
 ['different-period',instance(f()+f('101','','prior'),context()+context('prior','',{startDate:'2023-04-01',endDate:'2024-03-31'})),'selected'],
 ['unresolved-namespace',instance(f()+f()).replace('taxonomy/jppfs/2024-11-01/jppfs_cor','invalid'),'ambiguous']
];
for(const [name,xml,status] of cases){const result=proposed(xml,options);assert.equal(result.status,status,name);if(name==='unsafe-identical')assert.equal(result.status==='selected'&&result.safeNumber,undefined);}
const inputs=[...JSON.parse(readFileSync('artifacts/selection-audit/manifest.json','utf8')),...JSON.parse(readFileSync('data/selection-research/manifest.json','utf8'))].filter(x=>x.standard==='J-GAAP');
let selected=0,recovered=0,legacyAccepted=0,newRejected=0;
for(const input of inputs){const xml=readFileSync(input.file,'utf8');for(const p of input.periods)for(const scope of ['Consolidated','NonConsolidated'] as const){
 const metadata={secCode:input.code,docID:input.code,scope,accountingStandard:'J-GAAP' as const,currency:'JPY' as const,period:{startDate:p.startDate,endDate:p.endDate},periodType:'annual' as const};
 const baseline=createFinancialDetailSnapshot(xml,metadata,[id]);normalizeFinancialDetailSnapshot(baseline);legacyAccepted++;
 const result=proposed(xml,{...options,scope,period:metadata.period});assert.equal(result.status,'selected');selected++;
 if(baseline.selections[id]?.status==='ambiguous'){
  recovered++;assert.equal(result.reason,'selected-identical-duplicates');
  // Demonstrate that selector-only implementation would break JSON compatibility.
  assert.throws(()=>normalizeFinancialDetailSnapshot({metadata,selections:{[id]:result}}));newRejected++;
 }
}}
assert.equal(selected,20);assert.equal(recovered,10);assert.equal(legacyAccepted,20);assert.equal(newRejected,10);
const summary={runtime:process.version,syntheticBoundaryChecks:cases.length,realSelections:selected,recoveredFromAmbiguous:recovered,legacySnapshotsAccepted:legacyAccepted,proposedSnapshotsRejectedByCurrentNormalizer:newRejected,publicPolicyChanged:false};
writeFileSync('data/selection-research/prototype-tax-summary.json',JSON.stringify(summary,null,2)+'\n');console.log(summary);
