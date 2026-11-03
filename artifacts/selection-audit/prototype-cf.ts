// Research only: candidate definitions are not registered in public APIs.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {EdinetXbrlParser} from '../../src/edinet-xbrl-parser';
import {selectDefinedMetricFact,type FactSelectionResult} from '../../src/metric-selection';
import type {MetricDefinition} from '../../src/metric-registry';
const tags=['IncomeTaxesPaidOpeCF','CashDividendsPaidFinCF','RepaymentOfLongTermLoansPayableFinCF'];
const inputs=[...JSON.parse(readFileSync('artifacts/selection-audit/manifest.json','utf8')),...JSON.parse(readFileSync('data/selection-research/manifest.json','utf8'))].filter(x=>x.standard==='J-GAAP');
const expected=JSON.parse(readFileSync('data/selection-research/pdf-cf-expectations.json','utf8'));
const rows:any[]=[];let pdfChecks=0;
for(const input of inputs){const object=new EdinetXbrlParser().parse(readFileSync(input.file,'utf8'));const internal=object as any;
 for(const p of input.periods)for(const scope of ['Consolidated','NonConsolidated'] as const)for(const tag of tags){
  const definition:MetricDefinition<string>={id:tag,valueType:'decimal',unit:'JPY',periodType:'duration',candidates:[{key:'jppfs_cor:'+tag,standard:'J-GAAP',supported:true}],fallback:'ordered-tags-only-no-scope-period-currency-fallback'};
  const result=selectDefinedMetricFact(definition,{accountingStandard:'J-GAAP',scope,period:{startDate:p.startDate,endDate:p.endDate}},object.dataMap,internal.contextMap,internal.unitMap,internal.duplicateContextIds);
  const e=scope==='Consolidated'?expected.find((e:any)=>input.file.includes(e.docID)&&e.tag===tag&&e.endDate===p.endDate):undefined;
  if(e){assert.equal(result.status,'selected');assert.equal(result.status==='selected'?result.raw:undefined,e.rawJPY);pdfChecks++;}
  rows.push({code:input.code,column:p.column,scope,tag,status:result.status,reason:result.reason});
 }
}
assert.equal(rows.length,60);assert.equal(rows.filter(x=>x.status==='selected').length,26);assert.equal(pdfChecks,12);
const summary={runtime:process.version,selections:rows.length,selected:26,missing:34,pdfChecks,pdfMatches:pdfChecks,publicRegistryChanged:false,byTag:Object.fromEntries(tags.map(tag=>[tag,{selected:rows.filter(x=>x.tag===tag&&x.status==='selected').length,missing:rows.filter(x=>x.tag===tag&&x.status==='missing').length}]))};
writeFileSync('data/selection-research/prototype-cf-summary.json',JSON.stringify(summary,null,2)+'\n');console.log(summary);
