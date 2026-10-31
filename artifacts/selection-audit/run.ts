// Explicit saved-fixture cohort; no downloads, DB writes or automatic standard fallback.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { EdinetXbrlParser } from '../../src/edinet-xbrl-parser';
import { METRIC_REGISTRY } from '../../src/metric-registry';
import { FINANCIAL_DETAIL_REGISTRY_VERSION, FINANCIAL_DETAIL_REGISTRY } from '../../src/financial-detail-registry';
import { WORKFORCE_REGISTRY_VERSION, WORKFORCE_REGISTRY } from '../../src/workforce-registry';
import { BALANCE_SHEET_REGISTRY } from '../../src/balance-sheet-registry';
import { IFRS_BALANCE_SHEET_REGISTRY } from '../../src/ifrs-balance-sheet-registry';
assert.equal(FINANCIAL_DETAIL_REGISTRY_VERSION, "4", "過去の調査はe206f99の辞書で再現してください。現在の実装で過去結果を上書きしません");
assert.equal(WORKFORCE_REGISTRY_VERSION, "4");
const manifest = JSON.parse(readFileSync(process.argv[2] ?? 'artifacts/selection-audit/manifest.json','utf8'));
const rows: any[] = [], inputs: any[] = [];
for (const input of manifest) {
 const xml = readFileSync(input.file,'utf8');
 const hash = () => createHash('sha256').update(readFileSync(input.file)).digest('hex');
 const before = hash();
 const object = new EdinetXbrlParser().parse(xml, input.file);
 for (const period of input.periods) {
  const groups = input.standard === 'J-GAAP'
   ? [['details', FINANCIAL_DETAIL_REGISTRY, 'selectFinancialDetail', ['Consolidated','NonConsolidated']],
      ['bs', BALANCE_SHEET_REGISTRY, 'selectBalanceSheetMetric', ['Consolidated','NonConsolidated']],
      ['workforce', WORKFORCE_REGISTRY, 'selectWorkforceMetric', ['NonConsolidated']]]
   : [['ifrs-bs', IFRS_BALANCE_SHEET_REGISTRY, 'selectIfrsBalanceSheetMetric', ['Consolidated']]];
  groups.push(['key-metrics', METRIC_REGISTRY, 'selectMetric', ['Consolidated','NonConsolidated']] as any);
  for (const [group, registry, method, scopes] of groups as any) for (const scope of scopes) {
   for (const [id, def] of Object.entries(registry) as any) {
    const result = (object as any)[method](id, { accountingStandard: input.standard, scope,
     period: def.periodType === 'instant' ? {instant:period.endDate} : {startDate:period.startDate,endDate:period.endDate} });
    const evidenceReasons: Record<string,number> = {};
    for (const e of result.evidence) evidenceReasons[e.reason]=(evidenceReasons[e.reason]??0)+1;
    rows.push({file:input.file,code:input.code,column:period.column,endDate:period.endDate,scope,group,metric:id,
     source:result.status==='selected'?{key:result.source.key,contextRef:result.source.contextRef,rawSha256:createHash('sha256').update(result.raw).digest('hex')}:undefined,
     status:result.status,reason:result.reason,searchable:result.status==='selected'&&result.safeNumber!==undefined,evidenceReasons,
     // Compare all applicable valid candidates; never change the public selection result.
     identicalByWorkforceRule:result.status==='ambiguous' ? (()=>{
      const candidates=result.evidence.filter((e:any)=>!['context-mismatch','unsupported-dimensions'].includes(e.reason));
      return candidates.length>1 && candidates.every((e:any)=>e.reason==='selected'||e.reason==='selected-raw-only') &&
       new Set(candidates.map((e:any)=>JSON.stringify([e.key,e.raw,e.decimals,e.unit,e.period,e.scope,e.dimensions,e.entity]))).size===1;
     })():undefined,
     // Classify ambiguity without exporting numeric values.
     eligibleFacts:result.evidence.filter((e:any)=>e.reason==='selected').length,
     distinctEligibleValues:new Set(result.evidence.filter((e:any)=>e.reason==='selected').map((e:any)=>e.raw)).size});
   }
  }
 }
 assert.equal(hash(),before,'source mutated'); inputs.push({...input,sha256:before});
}
assert.equal(inputs.length,manifest.length);
assert.equal(rows.length,manifest.reduce((n:number,input:any)=>n+(input.standard==='J-GAAP'?174:78),0));
const summary: Record<string,any> = {};
for(const row of rows){const key=row.group;const s=summary[key]??={total:0,statuses:{},reasons:{},searchable:0};s.total++;s.statuses[row.status]=(s.statuses[row.status]??0)+1;s.reasons[row.reason]=(s.reasons[row.reason]??0)+1;s.searchable+=Number(row.searchable);}
writeFileSync(process.argv[3] ?? 'artifacts/selection-audit/results.json',JSON.stringify({runtime:process.version,inputs,summary,rows},null,2)+'\n');
console.log(JSON.stringify(summary,null,2));
