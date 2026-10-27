import { describe,it,expect } from 'vitest';
import { extractSegmentDetails,searchSegmentDetails,SegmentMetric as M,type SegmentSearchOptions } from '../src/index';
import { segmentDocument as document, combinedSegmentTable,splitSegmentTables,segmentRows,currentSegmentPeriod as period,previousSegmentPeriod } from './fixtures/segments';
const query:SegmentSearchOptions={period,role:'reported-segment'};
describe('期間別のセグメントと集計列の直接値',()=>{
 it('報告セグメント/記載合計/調整/財務諸表合計の役割を分離する',()=>{
  const result=extractSegmentDetails(document());expect(result.groups).toHaveLength(1);const columns=result.groups[0].columns;
  expect(columns.map(c=>c.role)).toEqual(['reported-segment','reported-segment','reported-total','adjustment','financial-statement-total']);
  expect(columns[0]).toMatchObject({label:'通信',identity:'source-column-only',values:{externalRevenueJPY:{status:'numeric',decimal:'100000000',periodBasis:'duration'},assetsJPY:{status:'numeric',decimal:'1000000000',periodBasis:'period-end'}}});
  expect(columns[0].columnKey).toMatch(/^[a-f0-9]{64}$/);expect(result.diagnostics).toEqual([]);
 });
 it('横分割の表を原表参照付きで同一期間にまとめ、行番号で対応付けない',()=>{
  const rows=segmentRows();const tables=splitSegmentTables(rows).replace('<tr><td>減価償却費</td><td>3</td><td>－</td><td>3</td></tr>','');
  const result=extractSegmentDetails(document('A',{tables,indexes:[1,0]}));expect(result.groups[0].tableIndexes).toEqual([0,1]);
  expect(result.groups[0].columns).toHaveLength(5);expect(result.groups[0].columns[2].values.depreciationJPY).toMatchObject({status:'missing',reason:'row-absent'});expect(result.groups[0].columns[2].values.assetAdditionsJPY).toMatchObject({status:'numeric',decimal:'7000000'});
 });
 it('負の調整・丸め差を保持し、合計を算術で上書きしない',()=>{
  const cols=extractSegmentDetails(document()).groups[0].columns;
  expect(cols[2].values.profitJPY).toMatchObject({decimal:'35081000000'});expect(cols[3].values.profitJPY).toMatchObject({source:{raw:'△813'},decimal:'-813000000'});expect(cols[4].values.profitJPY).toMatchObject({decimal:'34267000000'});
 });
 it.each(['△1,234.5','-1,234.5','−1,234.5'])('負数表記%sを元表記付きで換算する',raw=>{
  const rows=segmentRows();rows[4][1]=raw;const value=extractSegmentDetails(document('A',{tables:combinedSegmentTable(rows)})).groups[0].columns[0].values.profitJPY;
  expect(value).toMatchObject({status:'numeric',source:{raw},decimal:'-1234500000.0'});
 });
 it.each(['－','','1,00','(100)','△△1','-−1','1e3','１２３'])('不採用原値%sを0にしない',raw=>{
  const rows=segmentRows();rows[4][1]=raw;expect(extractSegmentDetails(document('A',{tables:combinedSegmentTable(rows)})).groups[0].columns[0].values.profitJPY).toMatchObject({status:'unavailable'});
 });
 it('利益又は損失の原値を保ち、正の損失額の符号を推測しない',()=>{
  const rows=segmentRows();rows[4][0]='セグメント利益又は損失（△）';rows[4][1]='△10';expect(extractSegmentDetails(document('A',{tables:combinedSegmentTable(rows)})).groups[0].columns[0].values.profitJPY).toMatchObject({decimal:'-10000000'});
  rows[4][0]='セグメント損失';expect(extractSegmentDetails(document('A',{tables:combinedSegmentTable(rows)})).groups[0].columns[0].values.profitJPY.status).toBe('missing');
 });
 it('記載されていない資産/取得の行を欠損のままにする',()=>{
  const rows=segmentRows().filter(r=>!['セグメント資産','有形固定資産及び無形固定資産の増加額'].includes(r[0]));const value=extractSegmentDetails(document('A',{tables:combinedSegmentTable(rows)})).groups[0].columns[0];
  expect(value.values.assetsJPY).toEqual({status:'missing',reason:'row-absent',periodBasis:'period-end',unit:'JPY',multiplier:1000000});expect(value.values.assetAdditionsJPY.status).toBe('missing');
 });
 it('同じ指標が2行あれば全候補を残して曖昧とする',()=>{
  const rows=segmentRows();rows.push(['セグメント利益','1','2','3','4','5']);const value=extractSegmentDetails(document('A',{tables:combinedSegmentTable(rows)})).groups[0].columns[0].values.profitJPY;
  expect(value).toMatchObject({status:'unavailable',reason:'ambiguous-row',candidates:[{raw:'10'},{raw:'1'}]});
 });
 it('複数列へ結合された数値を各セグメントへ複製しない',()=>{
  const tables=combinedSegmentTable().replace('<td>100</td><td>200</td>','<td colspan="2">300</td>');const cols=extractSegmentDetails(document('A',{tables})).groups[0].columns;
  expect(cols[0].values.externalRevenueJPY).toMatchObject({status:'unavailable',reason:'merged-data-cell'});expect(cols[1].values.externalRevenueJPY.status).toBe('unavailable');
 });
 it('未知行は診断を残し、営業利益へ読み替えない',()=>{
  const rows=segmentRows();rows[4][0]='営業利益';const result=extractSegmentDetails(document('A',{tables:combinedSegmentTable(rows)}));expect(result.groups[0].columns[0].values.profitJPY.status).toBe('missing');expect(result.diagnostics).toContainEqual({reason:'unrecognized-row',tableIndex:0,rowIndex:7});
 });
 it('同じ集計役割やセグメント表示名の二重採用を拒否する',()=>{
  for(const tables of [combinedSegmentTable()+combinedSegmentTable(),combinedSegmentTable().replace('>設備<','>通信<')]){
   const result=extractSegmentDetails(document('A',{tables,indexes:tables.includes('</table><table>')?[0,1]:[0]}));expect(result.groups).toEqual([]);expect(result.diagnostics[0].reason).toBe('duplicate-column');
  }
 });
 it('報告セグメント配下の名前を集計列と取り違えない',()=>{
  const result=extractSegmentDetails(document('A',{tables:combinedSegmentTable().replace('>通信<','>調整額<')}));expect(result.groups[0].columns[0].role).toBe('reported-segment');
 });
 it.each(['千円','百万ドル'])('未知単位%sを百万円扱いしない',unit=>{
  const r=extractSegmentDetails(document('A',{tables:combinedSegmentTable().replace('百万円',unit)}));expect(r.groups).toEqual([]);expect(r.diagnostics[0].reason).toBe('unsupported-unit');
 });
 it('無単位の集計表だけを独立採用しない',()=>{
  const tables=splitSegmentTables().split('</table>')[1]+'</table>';const r=extractSegmentDetails(document('A',{tables}));expect(r.groups).toEqual([]);expect(r.diagnostics[0].reason).toBe('unsupported-unit');
 });
 it('未知見出し/表の片側だけが非対応ならその期の全体を不採用にする',()=>{
  const r=extractSegmentDetails(document('A',{tables:splitSegmentTables().replace('連結財務諸表計上額','不明な合計'),indexes:[0,1]}));expect(r.groups).toEqual([]);expect(r.diagnostics[0].reason).toBe('unsupported-layout');
 });
 it('複数期間は明示区分し、未確認表は残す',()=>{
  const d=document('A',{tables:combinedSegmentTable()+combinedSegmentTable()+combinedSegmentTable()});d.declarations=[d.declarations[0],{...d.declarations[0],period:previousSegmentPeriod,tableIndexes:[1]}];
  const result=extractSegmentDetails(d);expect(result.groups.map(g=>g.period)).toEqual([period,previousSegmentPeriod]);expect(result.diagnostics).toContainEqual({reason:'not-reviewed',tableIndex:2});
 });
 it('原本参照・期間/物理表の二重宣言・未確認基準は拒否する',()=>{
  const d=document();for(const declarations of [[{...d.declarations[0],rawSha256:'0'.repeat(64)}],[{...d.declarations[0],tableIndexes:[999]}],[{...d.declarations[0],period:{startDate:'2020-04-01',endDate:'2021-03-31'}}],[d.declarations[0],d.declarations[0]],[d.declarations[0],{...d.declarations[0],period:previousSegmentPeriod}],[{...d.declarations[0],tableIndexes:[0,0]}]])expect(()=>extractSegmentDetails({...d,declarations})).toThrow();
  expect(()=>extractSegmentDetails({...d,accountingStandard:'IFRS' as never})).toThrow();
 });
 it('単体/他の次元や不正期間を連結セグメントへ読み替えない',()=>{
  const dimensions='<xbrldi:explicitMember dimension="p:ConsolidatedOrNonConsolidatedAxis">p:NonConsolidatedMember</xbrldi:explicitMember>';
  for(const d of [document('A',{dimensions}),document('A',{contextPeriod:'<xbrli:instant>2026-03-31</xbrli:instant>'})])expect(extractSegmentDetails(d)).toMatchObject({groups:[],diagnostics:[{reason:'unsupported-context'}]});
 });
 it('未知namespaceと本文の非対応は元の状態を残す',()=>{const r=extractSegmentDetails(document('A',{namespace:'urn:unknown'}));expect(r.source.status).toBe('unsupported');expect(r.groups).toEqual([]);});
});
describe('期間・役割を揃えたセグメント検索',()=>{
 it.each([['gt',100000000,1],['gte',100000000,2],['lt',100000000,0],['lte',100000000,1],['eq',100000000,1]] as const)('%sの円単位条件を厳密比較',(operator,value,count)=>{
  expect(searchSegmentDetails([document()],{...query,conditions:[{metric:M.ExternalRevenueJPY,operator,value}]}).matched).toBe(count);
 });
 it('調整/合計を通常セグメントと別に検索する',()=>{
  const r=searchSegmentDetails([document()],{period,role:'adjustment',conditions:[{metric:M.ProfitJPY,operator:'lt',value:0}]});expect(r.matched).toBe(1);expect(r.rows[0].column.values.profitJPY).toMatchObject({decimal:'-813000000'});expect(searchSegmentDetails([document()],query).matched).toBe(2);
 });
 it('文字列・数値順・同値安定順とページを組み合わせる',()=>{
  const r=searchSegmentDetails([document('B'),document('A')],{...query,labelContains:'通信',sort:{metric:M.ProfitJPY,order:'desc'},offset:1,limit:1});expect(r.matched).toBe(2);expect(r.extractions[r.rows[0].sourceIndex].source.source.docID).toBe('B');
 });
 it('検索で必要な欠損だけを除外し、役割外の列を欠損除外に入れない',()=>{
  const rows=segmentRows().filter(r=>r[0]!=='セグメント資産');const d=document('A',{tables:combinedSegmentTable(rows)});expect(searchSegmentDetails([d],query).matched).toBe(2);const r=searchSegmentDetails([d],{...query,sort:{metric:M.AssetsJPY,order:'asc'}});expect(r).toMatchObject({matched:0,filtered:3});expect(r.excluded).toHaveLength(2);
 });
 it('指定した前期を選び、当期だけの宣言を代わりに使わない',()=>{
  const d=document('A',{period:previousSegmentPeriod});expect(searchSegmentDetails([d],{...query,period:previousSegmentPeriod}).matched).toBe(2);expect(()=>searchSegmentDetails([d],query)).toThrow('対象期間');
 });
 it('二重原本/同じ提出者/過剰入力/不正条件を拒否する',()=>{
  expect(()=>searchSegmentDetails([document(),document()],query)).toThrow();expect(()=>searchSegmentDetails([document(),document('B',{entity:'A'})],query)).toThrow('同じ提出者');expect(()=>searchSegmentDetails(Array(101).fill(document()),query)).toThrow();
  for(const change of [{role:'all'},{offset:-1},{limit:0},{sort:null},{conditions:[{metric:M.ProfitJPY,operator:'gte',value:NaN}]}])expect(()=>searchSegmentDetails([document()],{...query,...change} as SegmentSearchOptions)).toThrow();
 });
 it('空集合は0件',()=>{expect(searchSegmentDetails([],query)).toMatchObject({rows:[],matched:0,filtered:0,excluded:[]});});
});
