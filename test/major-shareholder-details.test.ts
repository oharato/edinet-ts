import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {extractMajorShareholderDetails,searchMajorShareholderDetails,EdinetXbrlParser,type MajorShareholderSearchOptions} from '../src/index';
import {majorDocument,majorTable,referenceNote,referenceTable} from './fixtures/major-shareholders';
const query:MajorShareholderSearchOptions={kind:'major-shareholders-table',date:{basis:'holding-as-of',value:'2026-03-31'},role:'named',metric:'holdingPercent'};
const refQuery:MajorShareholderSearchOptions={kind:'large-holding-reference',date:{basis:'holding-as-of',value:'2026-04-30'},role:'named',metric:'reportedCount'};
const extract=(raw:string)=>extractMajorShareholderDetails(majorDocument({raw}));
describe('大株主と注記引用の分離',()=>{
 it('期末表と引用の種類/日付/分母/単位を分け、原文と出典を保持する',()=>{
  const r=extractMajorShareholderDetails(majorDocument());expect(r.diagnostics).toEqual([]);expect(r.groups).toHaveLength(2);
  expect(r.groups[0]).toMatchObject({kind:'major-shareholders-table',holdingAsOf:{status:'selected',date:'2026-03-31',basis:'table-date-cell'},publicInspectionDates:[],denominator:{basis:'issued-shares-excluding-treasury'}});
  expect(r.groups[1]).toMatchObject({kind:'large-holding-reference',holdingAsOf:{date:'2026-04-30'},publicInspectionDates:[{date:'2026-05-12'}],ownershipConfirmation:'reference-only-not-confirmed-by-filer',denominator:{basis:'large-holding-definition-unconfirmed'}});
  expect(r.groups[0].rows[0]).toMatchObject({identity:'unresolved',reportedCount:{unit:'shares',decimal:'1000000'},holdingPercent:{unit:'percent',decimal:'16.90'}});
  expect(r.groups[1].rows[0].reportedCount).toMatchObject({unit:'reported-holding-equivalents',decimal:'1300000'});
  expect(r.groups[0].rows[2]).toMatchObject({role:'reported-total',address:{status:'missing',reason:'merged-summary-cell'}});
  for(const g of r.groups)for(const row of g.rows)for(const v of [row.holder,row.reportedCount,row.holdingPercent,...('cellIndex'in row.address?[row.address]:[])])expect(r.source.tables[g.tableIndex].cells[v.cellIndex].parsedText).toBe(v.raw);
 });
 it('同じ名義や共同保有者・合計を足したり名寄せしたりしない',()=>{const g=extract(majorTable+referenceNote+referenceTable.replace('共同保有者','甲信託銀行')).groups;expect(g[1].rows.map(r=>r.holder.raw)).toEqual(['甲信託銀行','甲信託銀行','合計']);expect(new Set(g[1].rows.map(r=>r.rowKey)).size).toBe(3);});
 it('保有日が記載されなければ公衆縦覧日や期末で補わない',()=>{
  const d=majorDocument({raw:majorTable+referenceNote.replace('が2026年４月30日現在で','が')+referenceTable});expect(extractMajorShareholderDetails(d).groups[1].holdingAsOf).toMatchObject({status:'unavailable'});
  expect(searchMajorShareholderDetails([d],refQuery)).toMatchObject({matched:0,excluded:[{reason:'holding-date-not-established'},{reason:'holding-date-not-established'}]});
  expect(searchMajorShareholderDetails([d],{...refQuery,date:{basis:'public-inspection-date',value:'2026-05-12'}}).matched).toBe(2);
 });
 it('表の直前の注記を結び、前の引用日を次表へ持ち越さない',()=>{
  const raw=majorTable+referenceNote+referenceTable+referenceTable;const d=majorDocument({raw});d.tables=[...d.tables,{...d.tables[0],tableIndex:2}];const r=extractMajorShareholderDetails(d);expect(r.groups).toHaveLength(2);expect(r.diagnostics).toContainEqual({reason:'unconfirmed-reference',tableIndex:2,rowIndex:undefined});
 });
 it('句点のない注番号と年の間の空白を保ち、正しい引用日を読む',()=>{
  const r=extract(majorTable+referenceNote.replace('１．','３ ')+referenceTable);expect(r.groups[1].publicInspectionDates[0].date).toBe('2026-05-12');
 });
 it('複数の公衆縦覧日を保持し、一番新しい日へ置換しない',()=>{
  const d=majorDocument({raw:majorTable+referenceNote.replace('2026年５月12日付','2026年５月１日付および2026年５月12日付')+referenceTable});expect(extractMajorShareholderDetails(d).groups[1].publicInspectionDates.map(d=>d.date)).toEqual(['2026-05-01','2026-05-12']);
 });
 it('一部の引用日より後の共通保有日は候補を残し、確定日検索へ混ぜない',()=>{
  const d=majorDocument({raw:majorTable+referenceNote.replace('2026年５月12日付','2025年４月21日付および2026年５月12日付')+referenceTable});
  expect(extractMajorShareholderDetails(d).groups[1].holdingAsOf).toMatchObject({status:'unavailable',reason:'conflicting-reference-chronology',reportedDate:'2026-04-30'});expect(searchMajorShareholderDetails([d],refQuery).excluded[0].reason).toBe('conflicting-reference-chronology');
 });
 it('引用の株式等表示も原見出しを残して採用し、株券等に書き換えない',()=>{
  const r=extract(majorTable+referenceNote+referenceTable.replace('保有株券等','保有株式等').replace('千株','株'));expect(r.groups[1].countDefinition.rawHeader).toBe('保有株式等の数(株)');expect(r.groups[1].rows[0].reportedCount).toMatchObject({unit:'reported-holding-equivalents',decimal:'1300'});
 });
 it('表外の期末日を使い、別年度を混ぜない',()=>{
  const table=majorTable.replace('<tr><td colspan="4">2026年３月31日現在</td></tr>','');const r=extract('<p>2025年３月31日現在</p>'+table.replace('1,000','900'));expect(r.groups[0].holdingAsOf).toMatchObject({date:'2025-03-31'});
 });
 it('株/千株の違いを保持する',()=>{expect(extract(majorTable.replace('千株','株')).groups[0].rows[0].reportedCount).toMatchObject({decimal:'1000',multiplier:1});});
 it.each(['1.0001','1 2','1\n2','１００','1,000(注)','△1'])('数値%sを株数へ推測変換しない',text=>{expect(extract(majorTable.replace('1,000',text)).groups[0].rows[0].reportedCount.status).toBe('unavailable');});
 it('千株の小数は換算後の株単位が整数なら採用し、1株未満は拒否する',()=>{
  expect(extract(majorTable.replace('1,000','1.5')).groups[0].rows[0].reportedCount).toMatchObject({status:'numeric',decimal:'1500.0'});
  expect(extract(majorTable.replace('千株','株').replace('1,000','1.5')).groups[0].rows[0].reportedCount).toMatchObject({status:'unavailable',reason:'non-integer-count'});
 });
 it.each(['100.01','101','-1','△1'])('範囲外割合%sを採用しない',text=>{expect(extract(majorTable.replace('16.90',text)).groups[0].rows[0].holdingPercent.status).toBe('unavailable');});
 it('空欄/ダッシュ/零を区別し、合計や割合を再計算しない',()=>{const r=extract(majorTable.replace('1,000','－').replace('200','0').replace('20.28','20.27'));expect(r.groups[0].rows[0].reportedCount).toMatchObject({reason:'dash'});expect(r.groups[0].rows[1].reportedCount).toMatchObject({decimal:'0'});expect(r.groups[0].rows[2].holdingPercent).toMatchObject({decimal:'20.27'});expect(extract(majorTable.replace('1,000','')).groups[0].rows[0].reportedCount).toMatchObject({reason:'blank'});});
 it.each([
  majorTable.replace('千株','百株'),majorTable.replace('自己株式を除く。',''),majorTable.replace('住所','居住国'),
  majorTable.replace('<td>1,000</td><td>16.90</td>','<td colspan="2">1,000</td>'),
 ])('未知の単位/分母/見出し/結合を採用しない #%#',raw=>{const r=extract(raw);expect(r.groups.flatMap(g=>g.rows).some(r=>r.holder.raw==='甲信託銀行（信託口）')).toBe(false);});
 it.each(['2026年２月30日','2026年６月30日'])('不正/未来の期末%sを採用しない',date=>{expect(extract(majorTable.replace('2026年３月31日',date)).groups).toEqual([]);});
 it('確認不能の注記がない引用を所有確認済みとしない',()=>{const r=extract(majorTable+referenceNote.replace('実質所有株式数の確認ができない','所有株式数を確認した')+referenceTable);expect(r.groups).toHaveLength(1);expect(r.diagnostics).toContainEqual({reason:'unconfirmed-reference',tableIndex:1,rowIndex:undefined});});
 it('確認できた旨の肯定文を確認不能に読み替えない',()=>{for(const positive of ['確認ができました','確認ができる'])expect(extract(majorTable+referenceNote.replace('確認ができない',positive)+referenceTable).groups).toHaveLength(1);});
 it('5桁の年の一部を西暦として拾わない',()=>{const table=majorTable.replace('<tr><td colspan="4">2026年３月31日現在</td></tr>','');expect(extract('<p>12026年３月31日現在</p>'+table).groups).toEqual([]);});
 it('不正/未来の引用日を採用しない',()=>{for(const date of ['2026年２月30日','2026年７月１日'])expect(extract(majorTable+referenceNote.replace('2026年５月12日',date)+referenceTable).groups).toHaveLength(1);});
 it('本文参照/表重複/種類/期間contextを検査する',()=>{const d=majorDocument();expect(()=>extractMajorShareholderDetails({...d,tables:[{...d.tables[0],rawSha256:'a'.repeat(64)}]})).toThrow('本文参照');expect(()=>extractMajorShareholderDetails({...d,tables:[...d.tables,...d.tables]})).toThrow('重複');expect(()=>extractMajorShareholderDetails({...d,selection:{...d.selection,kind:'facilities'}})).toThrow();expect(extractMajorShareholderDetails(majorDocument({contextPeriod:'<xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate>'})).groups).toEqual([]);});
 it('未知namespaceを採用しない',()=>{expect(extractMajorShareholderDetails(majorDocument({namespace:'urn:extension'})).source).toMatchObject({status:'unsupported',reason:'unknown-namespace'});});
 it('取得結果の変更を再抽出に戻さない',()=>{const d=majorDocument(),r=extractMajorShareholderDetails(d);r.groups[0].rows[0].holder.raw='change';expect(extractMajorShareholderDetails(d).groups[0].rows[0].holder.raw).not.toBe('change');});
 it('旧APIの比率はpure原値を維持し、百分率と呼び替えない',()=>{const object=new EdinetXbrlParser().parse(readFileSync('test/test_data/CJ_2371_kakakucom.xbrl','utf8'),'LEGACY');expect(object.getMajorShareholders()[0].ownershipRatio).toBe(0.2037);});
});
describe('大株主/引用の逆引き',()=>{
 it('日付の意味・種類・役割で分離して条件/順序/ページを返す',()=>{const docs=[majorDocument({docID:'B'}),majorDocument({docID:'A'})];const r=searchMajorShareholderDetails(docs,{...query,sort:'value-desc',offset:1,limit:2});expect(r.matched).toBe(4);expect(r.rows.map(r=>r.row.holdingPercent)).toMatchObject([{decimal:'16.90'},{decimal:'3.38'}]);expect(searchMajorShareholderDetails(docs,{...query,role:'reported-total'}).matched).toBe(2);expect(searchMajorShareholderDetails(docs,refQuery).matched).toBe(4);});
 it.each([['gt',0],['gte',1],['lt',1],['lte',2],['eq',1]] as const)('%sの百分率境界',(operator,n)=>{expect(searchMajorShareholderDetails([majorDocument()],{...query,condition:{operator,value:16.90}}).matched).toBe(n);});
 it('名義/住所は原文部分一致で絞り、同一法人へ統合しない',()=>{expect(searchMajorShareholderDetails([majorDocument()],{...query,holderContains:'（別口）',addressContains:'本町'}).matched).toBe(1);expect(searchMajorShareholderDetails([majorDocument()],{...query,holderContains:'.*'}).matched).toBe(0);});
 it('日付と数値不明と条件外を分ける',()=>{const d=majorDocument({raw:majorTable.replace('16.90','－')+referenceNote+referenceTable});expect(searchMajorShareholderDetails([d],query)).toMatchObject({matched:1,excluded:[{reason:'dash'}]});expect(searchMajorShareholderDetails([d],{...query,date:{basis:'holding-as-of',value:'2025-03-31'}}).matched).toBe(0);});
 it('同一原本/提出者の重複は訂正選択を要求する',()=>{const d=majorDocument();expect(()=>searchMajorShareholderDetails([d,d],query)).toThrow();expect(()=>searchMajorShareholderDetails([d,majorDocument({docID:'B',entity:'MAJOR-A'})],query)).toThrow('訂正系列');});
 it.each([{kind:'all'},{date:{basis:'public-inspection-date',value:'2026-05-12'}},{date:null},{date:{basis:'holding-as-of',value:'2026-02-30'}},{metric:'revenue'},{role:'all'},{condition:null},{condition:{operator:'eq',value:NaN}},{condition:{operator:'bad',value:1}},{holderContains:''},{addressContains:0},{sort:'name'},{offset:-1},{limit:0},{limit:1001}])('不正条件を拒否する %j',change=>{expect(()=>searchMajorShareholderDetails([majorDocument()],{...query,...change} as never)).toThrow();});
 it('原本数/合計上限を検査する',()=>{expect(()=>searchMajorShareholderDetails(Array(101).fill(majorDocument()),query)).toThrow();const d=majorDocument();d.xml='x'.repeat(256*1024*1024+1);expect(()=>searchMajorShareholderDetails([d],query)).toThrow('上限');});
});
