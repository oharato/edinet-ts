import {describe,it,expect} from 'vitest';
import {extractOrderDetails,searchOrderDetails,OrderMetric,type OrderSearchOptions} from '../src/index';
import {orderDocument,orderPeriod,constructionOrders,verticalOrders,horizontalOrders,extendedOrders} from './fixtures/orders';
const query:OrderSearchOptions={period:orderPeriod,scope:'NonConsolidated',role:'detail',metric:OrderMetric.OrdersReceivedJPY};
const consolidated=(raw=verticalOrders)=>orderDocument({raw,declarations:[{tableIndex:0,period:orderPeriod,scope:'Consolidated'}]});
describe('受注と繰越の原表明細',()=>{
 it('元表示と出典を保ち、フロー/期首繰越/期末繰越と合計を分離する',()=>{
  const r=extractOrderDetails(orderDocument());expect(r.diagnostics).toEqual([]);expect(r.rows).toHaveLength(3);
  expect(r.rows[0]).toMatchObject({scope:'NonConsolidated',role:'detail',period:orderPeriod,identity:'source-label-only',periodEvidence:{basis:'source-period-cell'},values:{ordersReceivedJPY:{status:'numeric',decimal:'30000000',periodBasis:'duration'},completedConstructionJPY:{status:'numeric',decimal:'20000000'},openingBacklogJPY:{decimal:'100000000',periodBasis:'period-start-opening'},closingBacklogJPY:{decimal:'110000000',periodBasis:'period-end'},salesJPY:{status:'missing',reason:'not-in-table'}}});
  expect(r.rows[1].values).toMatchObject({ordersReceivedJPY:{decimal:'0'},openingBacklogJPY:{status:'unavailable',reason:'dash'},completedConstructionJPY:{status:'unavailable',reason:'blank'},closingBacklogJPY:{decimal:'1234500000.0'}});
  expect(r.rows[2].role).toBe('reported-total');
  for(const row of r.rows)for(const v of Object.values(row.values))if('cellIndex'in v)expect(r.source.tables[row.tableIndex].cells[v.cellIndex].parsedText).toBe(v.raw);
 });
 it('横表は受注だけを取り、増減率や売上を混ぜない',()=>{
  const r=extractOrderDetails(consolidated(horizontalOrders));expect(r.diagnostics).toEqual([]);expect(r.rows.map(r=>r.values.ordersReceivedJPY)).toMatchObject([{decimal:'100000000'},{decimal:'200000000'},{decimal:'300000000'}]);expect(r.rows.map(r=>r.label.raw)).toEqual(['通信','都市','システム']);expect(r.rows.every(r=>r.values.salesJPY.status==='missing')).toBe(true);
 });
 it('縦表の合計は別役割で保持し、合計値を再計算しない',()=>{
  const r=extractOrderDetails(consolidated(verticalOrders.replace('<td>500</td>','<td>501</td>')));expect(r.rows.map(r=>r.role)).toEqual(['detail','detail','reported-total']);expect(r.rows[2].values.ordersReceivedJPY).toMatchObject({decimal:'501000000'});
 });
 it('施工高付き表は手持高を残高として取り、施工高/割合を混ぜない',()=>{
  const r=extractOrderDetails(orderDocument({raw:extendedOrders}));expect(r.diagnostics).toEqual([]);expect(r.rows.map(r=>r.role)).toEqual(['detail','subtotal','reported-total']);expect(r.rows[0].values).toMatchObject({ordersReceivedJPY:{decimal:'90000000'},salesJPY:{decimal:'80000000'},completedConstructionJPY:{status:'missing'},closingBacklogJPY:{decimal:'110000000'}});
  expect(searchOrderDetails([orderDocument({raw:extendedOrders})],{...query,role:'subtotal'}).matched).toBe(1);
 });
 it('予想表の期間や将来期間を実績として採用しない',()=>{
  const forecast=constructionOrders.replace('当事業年度(', '当事業年度予想(');expect(extractOrderDetails(orderDocument({raw:forecast})).rows).toEqual([]);
  const d=orderDocument({raw:constructionOrders.replace('2025年４月１日','2026年４月１日').replace('2026年３月31日','2027年３月31日'),declarations:[{tableIndex:0,period:{startDate:'2026-04-01',endDate:'2027-03-31'},scope:'NonConsolidated'}]});expect(extractOrderDetails(d).rows).toEqual([]);
 });
 it('期間宣言は元の期間セルに照合し、前期も区別する',()=>{
  const raw=constructionOrders.replaceAll('2025年４月１日','2024年４月１日').replaceAll('2026年３月31日','2025年３月31日');
  expect(extractOrderDetails(orderDocument({raw}))).toMatchObject({rows:[],diagnostics:[{reason:'period-not-found'}]});
  const previous={startDate:'2024-04-01',endDate:'2025-03-31'};
  const r=extractOrderDetails(orderDocument({raw,declarations:[{tableIndex:0,period:previous,scope:'NonConsolidated'}]}));expect(r.rows).toHaveLength(3);expect(r.rows[0].period).toEqual(previous);
 });
 it.each(['2026年２月30日','2026年３月32日'])('原文の不正日付%sを採用しない',bad=>{
  expect(extractOrderDetails(orderDocument({raw:constructionOrders.replace('2026年３月31日',bad)})).rows).toEqual([]);
 });
 it('縦/横の連結表はDEI期間に一致する宣言のみ採用する',()=>{
  const d=consolidated();d.declarations=[{...d.declarations[0],period:{startDate:'2024-04-01',endDate:'2025-03-31'}}];expect(extractOrderDetails(d)).toMatchObject({rows:[],diagnostics:[{reason:'period-not-found'}]});
 });
 it.each([{standard:'IFRS'},{instant:'2025-01-01'},{start:'2026-04-01'},{end:'bad'}])('基準・context・DEIの不一致を採用しない %j',options=>{expect(extractOrderDetails(orderDocument(options)).rows).toEqual([]);});
 it('異なる本文hashは拒否する',()=>{const d=orderDocument();d.declarations=[{...d.declarations[0],rawSha256:'a'.repeat(64)}];expect(()=>extractOrderDetails(d)).toThrow('本文参照');});
 it.each([
  constructionOrders.replace('当期受注工事高(百万円)','当期受注工事高(千円)'),
  constructionOrders.replace('次期繰越工事高(百万円)','契約負債(百万円)'),
  verticalOrders.replace('前年同期比(％)','別の数値'),
  horizontalOrders.replace('（単位：百万円、％）','（単位：千円、％）'),
  horizontalOrders.replace('受注高 （注）２','受注見込高'),
 ])('不明な見出し/単位は推測しない #%#',raw=>{const d=raw.includes('期別')?orderDocument({raw}):consolidated(raw);expect(extractOrderDetails(d).rows).toEqual([]);});
 it('結合数値セルを重複採用しない',()=>{
  const raw=verticalOrders.replace('<td>300</td><td>100.0</td>','<td colspan="2">300</td>');const r=extractOrderDetails(consolidated(raw));expect(r.rows).toHaveLength(2);expect(r.diagnostics).toContainEqual({reason:'ambiguous-row',tableIndex:0,rowIndex:1});
 });
 it('数値を空白除去で連結せず、注記付きは欠損として残す',()=>{
  for(const text of ['1 2','1\n2','100(注)']){const r=extractOrderDetails(consolidated(verticalOrders.replace('300',text)));expect(r.rows[0].values.ordersReceivedJPY).toMatchObject({status:'unavailable',reason:'compound-or-unsupported-number',raw:text});}
 });
 it('取消変更等の負の受注表示を符号付きで保持する',()=>{
  const d=consolidated(verticalOrders.replace('300','△10'));expect(extractOrderDetails(d).rows[0].values.ordersReceivedJPY).toMatchObject({status:'numeric',decimal:'-10000000',raw:'△10'});expect(searchOrderDetails([d],{...query,scope:'Consolidated',condition:{operator:'lt',value:0}}).matched).toBe(1);
 });
 it('工事表に連結、セグメント表に単体を宣言しても採用しない',()=>{
  const a=orderDocument();a.declarations=[{...a.declarations[0],scope:'Consolidated'}];expect(extractOrderDetails(a).diagnostics[0].reason).toBe('unsupported-scope');
  const b=consolidated();b.declarations=[{...b.declarations[0],scope:'NonConsolidated'}];expect(extractOrderDetails(b).rows).toEqual([]);
 });
 it('存在しない表を説明する',()=>{const d=orderDocument();d.declarations=[{...d.declarations[0],tableIndex:20}];expect(extractOrderDetails(d)).toMatchObject({rows:[],diagnostics:[{reason:'unsupported-layout'}]});});
 it.each([null,{}, {tableIndex:-1,period:orderPeriod,scope:'NonConsolidated'}, {tableIndex:0,period:{startDate:'2025-02-30',endDate:'2026-03-31'},scope:'NonConsolidated'}, {tableIndex:0,period:orderPeriod,scope:'unknown'}])('不正宣言を入口で拒否する %j',value=>{const d=orderDocument();d.declarations=[value as never];expect(()=>extractOrderDetails(d)).toThrow();});
 it('同じ表/期間の重複宣言を拒否する',()=>{const d=orderDocument();d.declarations=[...d.declarations,...d.declarations];expect(()=>extractOrderDetails(d)).toThrow('重複');});
 it('取得結果の変更が再抽出に戻らない',()=>{const d=orderDocument(),a=extractOrderDetails(d);a.rows[0].label.raw='changed';expect(extractOrderDetails(d).rows[0].label.raw).toBe('屋内線工事');});
});
describe('受注明細の横断検索',()=>{
 it('役割・期間・範囲・指標を指定し、正確な金額で絞り込み/順序/ページを返す',()=>{
  const docs=[orderDocument({docID:'B'}),orderDocument({docID:'A'})];
  const r=searchOrderDetails(docs,{...query,condition:{operator:'gte',value:0},sort:'value-desc',offset:1,limit:2});expect(r.matched).toBe(4);expect(r.filtered).toBe(2);expect(r.rows.map(r=>r.row.values.ordersReceivedJPY)).toMatchObject([{decimal:'30000000'},{decimal:'0'}]);
  expect(searchOrderDetails(docs,{...query,role:'reported-total'}).matched).toBe(2);
  expect(searchOrderDetails(docs,{...query,metric:OrderMetric.SalesJPY})).toMatchObject({matched:0,excluded:expect.arrayContaining([expect.objectContaining({reason:'not-in-table'})])});
 });
 it.each([['gt',30000000,0],['gte',30000000,1],['lt',30000000,1],['lte',30000000,2],['eq',30000000,1]] as const)('%sの比較境界', (operator,value,count)=>{expect(searchOrderDetails([orderDocument()],{...query,condition:{operator,value}}).matched).toBe(count);});
 it('欠損とゼロ、期間/ラベルによる除外を分ける',()=>{
  const r=searchOrderDetails([orderDocument()],{...query,metric:OrderMetric.OpeningBacklogJPY});expect(r.matched).toBe(1);expect(r.excluded).toHaveLength(1);expect(r.excluded[0].reason).toBe('dash');
  expect(searchOrderDetails([orderDocument()],{...query,labelContains:'屋内'}).matched).toBe(1);
  expect(searchOrderDetails([orderDocument()],{...query,period:{startDate:'2024-04-01',endDate:'2025-03-31'}}).matched).toBe(0);
 });
 it('同一原本/提出者は訂正選択を要求する',()=>{
  const a=orderDocument();expect(()=>searchOrderDetails([a,a],query)).toThrow();expect(()=>searchOrderDetails([a,orderDocument({docID:'B',entity:'ORDERS-A'})],query)).toThrow('訂正系列');
 });
 it.each([{limit:0},{offset:-1},{condition:null},{condition:{operator:'bad',value:1}},{condition:{operator:'eq',value:NaN}},{labelContains:''},{metric:'other'},{role:'all'},{scope:'all'},{sort:'name'}])('不正条件を拒否する %j',change=>{expect(()=>searchOrderDetails([orderDocument()],{...query,...change} as never)).toThrow();});
 it('原本数/合計bytesの上限を検査する',()=>{expect(()=>searchOrderDetails(Array(101).fill(orderDocument()),query)).toThrow();const d=orderDocument();d.xml='x'.repeat(256*1024*1024+1);expect(()=>searchOrderDetails([d],query)).toThrow('合計上限');});
});
