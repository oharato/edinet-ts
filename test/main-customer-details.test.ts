import { describe, expect, it } from "vitest";
import { extractMainCustomerDetails, searchMainCustomerDetails, type MainCustomerSearchOptions } from "../src/index";
import { customerDocument as document, customerGroup, customerHeader } from "./fixtures/main-customer";
const query: MainCustomerSearchOptions = { period: { startDate:'2025-04-01',endDate:'2026-03-31' }, scope:'Consolidated' };
describe('主要顧客の記載単位と出典',()=>{
 it('結合された顧客/売上を1記載とし、複数セグメントを関連付ける',()=>{
  const result=extractMainCustomerDetails(document());expect(result.rows).toHaveLength(1);const row=result.rows[0];
  expect(row).toMatchObject({tableIndex:0,firstRow:1,rowSpan:2,customer:{raw:'架空顧客㈱（旧 架空旧社㈱）'},identity:'unresolved',revenueJPY:{status:'numeric',raw:'1,234.5',decimal:'1234500000.0',safeNumber:1234500000,unit:'JPY',multiplier:1000000}});
  expect(row.segments.map(s=>s.raw)).toEqual(['通信','設備']);expect(row.rowKey).toMatch(/^[a-f0-9]{64}$/);expect(result.diagnostics).toEqual([]);
  expect(result.source.source.rawSha256).toBe(document().proof.rawSha256);expect(result.source.inputXmlSha256).toMatch(/^[a-f0-9]{64}$/);
 });
 it('合計を個別顧客として採用しない',()=>{
  const result=extractMainCustomerDetails(document('A',{body:customerGroup('合計','100')}));expect(result.rows).toEqual([]);expect(result.diagnostics[0].reason).toBe('summary-row');
 });
 it('結合なし/単位行ありの形式と同一セル内の複数行を保持する',()=>{
  const raw='<table><tr><td></td><td></td><td>（単位：百万円）</td></tr>'+customerHeader+'<tr><td>顧客甲</td><td>0</td><td><p>通信</p><p>設備</p></td></tr></table>';
  const result=extractMainCustomerDetails(document('B',{raw}));expect(result.rows).toHaveLength(1);expect(result.rows[0].segments).toHaveLength(1);expect(result.rows[0].segments[0].raw).toContain('設備');expect(result.rows[0].revenueJPY).toMatchObject({status:'numeric',decimal:'0'});
 });
 it('同名・同値でも異なる物理記載を法人同一性で統合しない',()=>{
  const result=extractMainCustomerDetails(document('A',{body:customerGroup()+customerGroup()}));expect(result.rows).toHaveLength(2);expect(result.rows[0].rowKey).not.toBe(result.rows[1].rowKey);
 });
 it.each(['－','','100（20）','1,00','-1','1e3','１２３'])('未対応の原値%sを0/部分値にしない',raw=>{
  const result=extractMainCustomerDetails(document('A',{body:customerGroup('架空顧客',raw)}));expect(result.rows[0].revenueJPY).toMatchObject({status:'unavailable',raw});
 });
 it.each(['0.0000001','9,007,199,254,740,993'])('原値%sを正確な十進円文字列へ換算',raw=>{
  const amount=extractMainCustomerDetails(document('A',{body:customerGroup('架空顧客',raw)})).rows[0].revenueJPY;
  expect(amount).toMatchObject({status:'numeric',decimal:raw==='0.0000001'?'0.1000000':'9007199254740993000000'});
 });
 it.each([
  '<tr><td rowspan="2">顧客</td><td>100</td><td>通信</td></tr><tr><td>200</td><td>設備</td></tr>',
  '<tr><td>甲</td><td rowspan="2">100</td><td>通信</td></tr><tr><td>乙</td><td>設備</td></tr>',
  '<tr><td>甲</td><td>100</td><td rowspan="2">通信</td></tr><tr><td>乙</td><td>200</td></tr>'
 ])('結合範囲が異なる関係を合算や複製で補わない #%#',body=>{
  const result=extractMainCustomerDetails(document('A',{body}));expect(result.rows).toEqual([]);expect(result.diagnostics[0].reason).toBe('ambiguous-row-association');
 });
 it.each(['千円','百万円・千円','百万ドル'])('未知/混在単位%sを換算しない',unit=>{
  const result=extractMainCustomerDetails(document('A',{raw:`<p>（単位：${unit}）</p><table>${customerHeader}${customerGroup()}</table>`}));expect(result.rows).toEqual([]);expect(result.diagnostics).toEqual([{reason:'unsupported-unit'}]);
 });
 it('単位なし・異なる見出し・複数表を曖昧なまま残す',()=>{
  for(const raw of [`<table>${customerHeader}${customerGroup()}</table>`,`<p>（単位：百万円）</p><table>${customerHeader.replace('売上高','売上高（千円）')}${customerGroup()}</table>`,`<p>（単位：百万円）</p><table>${customerHeader}${customerGroup()}</table><table/>`]){
   const result=extractMainCustomerDetails(document('A',{raw}));expect(result.rows).toEqual([]);expect(result.diagnostics).not.toHaveLength(0);
  }
 });
 it.each(['<xbrli:instant>2026-03-31</xbrli:instant>','<xbrli:startDate>2026-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate>','<xbrli:startDate>2025-02-30</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate>'])('非対応の期間を推定しない',period=>{
  expect(extractMainCustomerDetails(document('A',{period}))).toMatchObject({rows:[],diagnostics:[{reason:'unsupported-period'}]});
 });
 it('単体の正式次元と連結の無次元を混同しない',()=>{
  const dimensions='<xbrldi:explicitMember dimension="p:ConsolidatedOrNonConsolidatedAxis">p:NonConsolidatedMember</xbrldi:explicitMember>';
  expect(extractMainCustomerDetails(document('A',{dimensions,scope:'NonConsolidated'})).rows).toHaveLength(1);
  expect(extractMainCustomerDetails(document('A',{dimensions})).diagnostics).toEqual([{reason:'unsupported-scope'}]);
  expect(extractMainCustomerDetails(document('A',{scope:'NonConsolidated'})).diagnostics).toEqual([{reason:'unsupported-scope'}]);
 });
 it('本文hash不一致・未対応会計基準は入口で拒否する',()=>{
  const d=document();expect(()=>extractMainCustomerDetails({...d,proof:{rawSha256:'0'.repeat(64)}})).toThrow('原本内参照');expect(()=>extractMainCustomerDetails({...d,accountingStandard:'IFRS' as never})).toThrow();
 });
 it('名前空間/原文/表の非対応を明細なしの正常開示に変えない',()=>{
  const r=extractMainCustomerDetails(document('A',{namespace:'urn:extension'}));expect(r.source.status).toBe('unsupported');expect(r.rows).toEqual([]);
 });
 it('入力のgetterを一度固定し、外部変更を次回解析へ持ち込まない',()=>{
  const base=document();let n=0;const input={...base,get proof(){n++;return base.proof;}};
  const result=extractMainCustomerDetails(input);expect(n).toBe(1);result.source.source.period!.endDate='2000-01-01';expect(extractMainCustomerDetails(base).source.source.period!.endDate).toBe('2026-03-31');
 });
});
describe('主要顧客からの明示原本逆引き',()=>{
 it.each([['gt',1234500000,0],['gte',1234500000,1],['lt',1234500000,0],['lte',1234500000,1],['eq',1234500000,1]] as const)('%sを円単位で比較', (operator,value,count)=>{
  expect(searchMainCustomerDetails([document()],{...query,revenue:{operator,value}}).matched).toBe(count);
 });
 it('顧客・関連セグメントの文字列、降順とページを組み合わせる',()=>{
  const result=searchMainCustomerDetails([document('B'),document('A')],{...query,customerContains:'旧社',segmentContains:'設備',sort:'revenue-desc',offset:1,limit:1});expect(result.matched).toBe(2);expect(result.extractions[result.rows[0].sourceIndex].source.source.docID).toBe('B');expect(result.excluded).toEqual([]);
  expect(searchMainCustomerDetails([document()],{...query,customerContains:'.*'})).toMatchObject({matched:0,filtered:1});
 });
 it('金額を使わない名前検索ではダッシュを欠損除外しない',()=>{
  const d=document('A',{body:customerGroup('架空顧客','－')});expect(searchMainCustomerDetails([d],query).matched).toBe(1);expect(searchMainCustomerDetails([d],{...query,sort:'revenue-asc'})).toMatchObject({matched:0,excluded:[{reason:'dash'}]});
 });
 it('原本/提出者/期間/連単混在、不正ページ/数値条件を拒否',()=>{
  expect(()=>searchMainCustomerDetails([document(),document()],query)).toThrow();expect(()=>searchMainCustomerDetails([document(),document('B',{entity:'A'})],query)).toThrow('同じ提出者');
  expect(()=>searchMainCustomerDetails([document('A',{year:2025})],query)).toThrow('期間');expect(()=>searchMainCustomerDetails([document('A',{scope:'NonConsolidated'})],query)).toThrow('範囲');
  for(const changes of [{limit:0},{offset:-1},{revenue:{operator:'gte',value:Infinity}}])expect(()=>searchMainCustomerDetails([document()],{...query,...changes} as MainCustomerSearchOptions)).toThrow();
  expect(()=>searchMainCustomerDetails(Array(101).fill(document()),query)).toThrow();
 });
 it('前年度は対応する対象期間でのみ検索できる',()=>{
  expect(searchMainCustomerDetails([document('A',{year:2025})],{...query,period:{startDate:'2024-04-01',endDate:'2025-03-31'}}).matched).toBe(1);
 });
 it('空母集団はゼロ件',()=>{expect(searchMainCustomerDetails([],query)).toMatchObject({rows:[],matched:0,filtered:0,excluded:[]});});
});
