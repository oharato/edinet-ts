import {describe,it,expect} from 'vitest';
import {extractShareholderCategories,searchShareholderCategories,ShareholderCategory,ShareholderCategoryMetric,type ShareholderCategorySearchOptions} from '../src/index';
import {shareholderDocument,shareholderTable} from './fixtures/shareholder-categories';
const query:ShareholderCategorySearchOptions={asOf:'2026-03-31',category:ShareholderCategory.ForeignNonIndividuals,metric:ShareholderCategoryMetric.OwnershipPercent};
const extract=(raw:string)=>extractShareholderCategories(shareholderDocument({raw}));
describe('所有者別状況の分類と単位',()=>{
 it('外国法人等の内訳・合計・単元未満を別にし、原文と出典を保持する',()=>{
  const r=extractShareholderCategories(shareholderDocument());expect(r.diagnostics).toEqual([]);expect(r.groups).toHaveLength(1);
  const g=r.groups[0];expect(g).toMatchObject({asOf:'2026-03-31',shareClassIdentification:'not-established',sharesPerLot:{decimal:'100'},percentageDenominator:{basis:'reported-whole-lot-total',raw:'1,500'},asOfEvidence:{basis:'single-table-text'}});
  expect(g.entries.map(e=>e.category)).toEqual(Object.values(ShareholderCategory));
  expect(g.entries[4].headers.map(h=>h.raw)).toEqual(['外国法人等','個人以外']);expect(g.entries[5].headers.map(h=>h.raw)).toEqual(['外国法人等','個人']);
  expect(g.entries[4].values).toMatchObject({shareholderCount:{unit:'persons',decimal:'4'},ownedLots:{unit:'lots',decimal:'400'},ownedShares:{unit:'shares',decimal:'40000',calculation:{formula:'ownedLots*sharesPerLot'}},ownershipPercent:{unit:'percent',decimal:'26.67'}});
  expect(g.entries[7]).toMatchObject({role:'reported-total',values:{ownedShares:{decimal:'150000'}}});
  expect(g.entries[8]).toMatchObject({role:'odd-lots',values:{ownedShares:{decimal:'99'},shareholderCount:{status:'missing'},ownedLots:{status:'missing'},ownershipPercent:{status:'missing'}}});
  expect(g.entries[0].values.ownedLots).toMatchObject({status:'unavailable',reason:'dash'});expect(g.entries[5].values.ownedShares).toMatchObject({status:'numeric',decimal:'0'});
  for(const e of g.entries)for(const v of Object.values(e.values))if('source'in v)expect(r.source.tables[0].cells[v.source.cellIndex].parsedText).toBe(v.source.raw);
 });
 it('表内の日付セルと改行・全角見出しを保持する',()=>{
  const raw=shareholderTable.replace('<table>','<table><tr><td colspan="10">2026年３月31日現在</td></tr>').replace('その他の法人','その他の<br/>法人');const r=extract(raw);expect(r.diagnostics).toEqual([]);expect(r.groups[0].asOfEvidence).toMatchObject({basis:'table-date-cell',rawCell:'2026年３月31日現在'});expect(r.groups[0].entries[3].headers[0].raw).toContain('\n');
 });
 it('100株以外の単元数も整数で正確に換算し、割合を再計算しない',()=>{
  const raw='<p>2026年３月31日現在</p>'+shareholderTable.replace('100株','1000株').replace('26.67','26.66');const g=extract(raw).groups[0];expect(g.entries[4].values.ownedShares).toMatchObject({decimal:'400000'});expect(g.entries[4].values.ownershipPercent).toMatchObject({decimal:'26.66'});expect(g.entries[8].values.ownedShares).toMatchObject({decimal:'99'});
 });
 it('巨大な株数を丸めず、安全なnumberを付けない',()=>{const g=extract('<p>2026年３月31日現在</p>'+shareholderTable.replace('<td>400</td>','<td>9007199254740993</td>')).groups[0];expect(g.entries[4].values.ownedShares).toMatchObject({decimal:'900719925474099300'});expect(g.entries[4].values.ownedShares).not.toHaveProperty('safeNumber',expect.any(Number));});
 it.each(['1 2','1\n2','１００','100(注)','△1','-1','1.5','1.0'])('数値%sを整数の保有数へ変換しない',text=>{
  const r=extract('<p>2026年３月31日現在</p>'+shareholderTable.replace('<td>400</td>','<td>'+text+'</td>'));expect(r.groups[0].entries[4].values.ownedLots.status).toBe('unavailable');expect(r.groups[0].entries[4].values.ownedShares).toMatchObject({status:'unavailable',reason:'owned-lots-unavailable'});
 });
 it.each(['101','100.01','-0.1','△1'])('範囲外の割合%sを採用しない',text=>{expect(extract('<p>2026年３月31日現在</p>'+shareholderTable.replace('26.67',text)).groups[0].entries[4].values.ownershipPercent.status).toBe('unavailable');});
 it('空欄・ダッシュ・零と表に適用されない指標を分離する',()=>{const e=extract('<p>2026年３月31日現在</p>'+shareholderTable.replace('<td>400</td>','<td></td>')).groups[0].entries;expect(e[4].values.ownedLots).toMatchObject({reason:'blank'});expect(e[0].values.ownedLots).toMatchObject({reason:'dash'});expect(e[5].values.ownedLots).toMatchObject({decimal:'0'});expect(e[8].values.ownedLots).toMatchObject({reason:'not-applicable-to-odd-lots'});});
 it.each([
  '<p>2026年３月30日現在</p>'+shareholderTable,
  '<p>2026年２月30日現在</p>'+shareholderTable,
  '<p>2026年３月31日現在 2025年３月31日現在</p>'+shareholderTable,
  shareholderTable,
 ])('不一致・複数・不正・不在の日付を本文contextで埋めない #%#',raw=>{expect(extract(raw)).toMatchObject({groups:[],diagnostics:[{reason:'unsupported-as-of'}]});});
 it('提出時点より後の基準日やduration contextを採用しない',()=>{
  expect(extractShareholderCategories(shareholderDocument({instant:'2026-03-01'})).groups).toEqual([]);
  expect(extractShareholderCategories(shareholderDocument({contextPeriod:'<xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate>'})).groups).toEqual([]);
 });
 it.each(['0','01','1000000000','100,000','一百'])('不明な単元株式数%sを推測しない',size=>{expect(extract('<p>2026年３月31日現在</p>'+shareholderTable.replace('100株',size+'株')).groups).toEqual([]);});
 it.each([
  shareholderTable.replace('所有株式数(単元)','所有株式数(株)'),
  shareholderTable.replace('株主数(人)','株主数(千人)'),
  shareholderTable.replace('個人以外','法人のみ'),
  shareholderTable.replace('外国法人等','外国法人'),
  shareholderTable.replace('<td>400</td><td>0</td>','<td colspan="2">400</td>'),
  shareholderTable.replace('<td rowspan="2">金融機関</td>','<td rowspan="2" colspan="2">金融機関</td>'),
 ])('未知の分類/単位や結合を採用しない #%#',raw=>{expect(extract('<p>2026年３月31日現在</p>'+raw).groups).toEqual([]);});
 it('データセルの日付を表全体の基準日として使わない',()=>{const raw=shareholderTable.replace('<td>400</td>','<td>2026年３月31日現在</td>');expect(extract(raw).groups).toEqual([]);});
 it('2年度の記載を別時点で保持し、他年度を検索へ混ぜない',()=>{
  const old=shareholderDocument({docID:'OLD',asOf:'2025-03-31',raw:'<p>2025年３月31日現在</p>'+shareholderTable.replace('26.67','30.01')});
  expect(extractShareholderCategories(old).groups[0].asOf).toBe('2025-03-31');expect(searchShareholderCategories([old,shareholderDocument()],query)).toMatchObject({matched:1,filtered:17});
 });
 it('異なる比率の原本を条件/順序で区別する',()=>{
  const b=shareholderDocument({docID:'B',raw:'<p>2026年３月31日現在</p>'+shareholderTable.replace('26.67','30.01')});
  const r=searchShareholderCategories([shareholderDocument(),b],{...query,sort:'value-desc'});expect(r.rows.map(r=>r.entry.values.ownershipPercent)).toMatchObject([{decimal:'30.01'},{decimal:'26.67'}]);
 });
 it('日付が表外にしかない複数表を結び付けない',()=>{const d=shareholderDocument({raw:'<p>2026年３月31日現在</p>'+shareholderTable+shareholderTable});expect(extractShareholderCategories(d).groups).toEqual([]);});
 it('表内の出典がある複数表は別グループで保持する',()=>{
  const table=shareholderTable.replace('<table>','<table><tr><td colspan="10">2026年３月31日現在</td></tr>'),d=shareholderDocument({raw:table+table});d.declarations=[d.declarations[0],{...d.declarations[0],tableIndex:1}];const r=extractShareholderCategories(d);expect(r.groups).toHaveLength(2);expect(r.groups[0].entries[0].entryKey).not.toBe(r.groups[1].entries[0].entryKey);
 });
 it('本文参照・表重複・種類を入口で検証する',()=>{const d=shareholderDocument();expect(()=>extractShareholderCategories({...d,declarations:[{...d.declarations[0],rawSha256:'a'.repeat(64)}]})).toThrow('本文参照');expect(()=>extractShareholderCategories({...d,declarations:[...d.declarations,...d.declarations]})).toThrow('重複');expect(()=>extractShareholderCategories({...d,selection:{...d.selection,kind:'facilities'}})).toThrow();});
 it('未知namespaceと不存在表を理由付きで返す',()=>{expect(extractShareholderCategories(shareholderDocument({namespace:'urn:extension'})).source).toMatchObject({status:'unsupported',reason:'unknown-namespace'});const d=shareholderDocument();d.declarations=[{...d.declarations[0],tableIndex:10}];expect(extractShareholderCategories(d).diagnostics[0].reason).toBe('unsupported-layout');});
 it('取得結果の変更を再抽出へ戻さない',()=>{const d=shareholderDocument(),r=extractShareholderCategories(d);r.groups[0].entries[0].headers[0].raw='change';expect(extractShareholderCategories(d).groups[0].entries[0].headers[0].raw).not.toBe('change');});
});
describe('分類別の横断検索',()=>{
 it('原本順を安定させ、正確な割合条件とページを返す',()=>{const docs=[shareholderDocument({docID:'B'}),shareholderDocument({docID:'A'})];const r=searchShareholderCategories(docs,{...query,condition:{operator:'gte',value:26.67},sort:'value-desc',offset:1,limit:1});expect(r.matched).toBe(2);expect(r.rows).toHaveLength(1);expect(r.rows[0].sourceIndex).toBe(1);expect(r.filtered).toBe(16);});
 it.each([['gt',0],['gte',1],['lt',0],['lte',1],['eq',1]] as const)('%sの境界を比較する',(operator,n)=>{expect(searchShareholderCategories([shareholderDocument()],{...query,condition:{operator,value:26.67}}).matched).toBe(n);});
 it('単元数ではなく換算株数の条件を適用する',()=>{expect(searchShareholderCategories([shareholderDocument()],{...query,metric:'ownedShares',condition:{operator:'gte',value:40000}}).matched).toBe(1);});
 it('単元未満の株数と合計は異なる分類で返す',()=>{const d=shareholderDocument();expect(searchShareholderCategories([d],{...query,category:'odd-lots',metric:'ownedShares'}).rows[0].entry.values.ownedShares).toMatchObject({decimal:'99'});expect(searchShareholderCategories([d],{...query,category:'reported-total',metric:'ownedShares'}).rows[0].entry.values.ownedShares).toMatchObject({decimal:'150000'});expect(searchShareholderCategories([d],{...query,category:'odd-lots',metric:'ownershipPercent'}).excluded[0].reason).toBe('not-applicable-to-odd-lots');});
 it('数値不明と条件外/異なる基準日を分ける',()=>{const docs=[shareholderDocument()];expect(searchShareholderCategories(docs,{...query,category:'government'})).toMatchObject({matched:0,excluded:[{reason:'dash'}]});expect(searchShareholderCategories(docs,{...query,asOf:'2025-03-31'})).toMatchObject({matched:0,filtered:9,excluded:[]});});
 it('原本/提出者の重複は先に訂正選択を要求する',()=>{const a=shareholderDocument();expect(()=>searchShareholderCategories([a,a],query)).toThrow();expect(()=>searchShareholderCategories([a,shareholderDocument({docID:'B',entity:'HOLDERS-A'})],query)).toThrow('訂正系列');});
 it.each([{category:'foreign'},{metric:'revenue'},{asOf:'2026-02-30'},{condition:null},{condition:{operator:'eq',value:NaN}},{condition:{operator:'bad',value:1}},{sort:'name'},{offset:-1},{limit:0},{limit:1001}])('不正条件を拒否する %j',change=>{expect(()=>searchShareholderCategories([shareholderDocument()],{...query,...change} as never)).toThrow();});
 it('上限を検査する',()=>{expect(()=>searchShareholderCategories(Array(101).fill(shareholderDocument()),query)).toThrow();const d=shareholderDocument();d.xml='x'.repeat(256*1024*1024+1);expect(()=>searchShareholderCategories([d],query)).toThrow('上限');});
});
