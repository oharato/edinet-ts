import {it,expect,describe} from 'vitest';
import {extractPolicyShareholdings as extract,searchPolicyShareholdings as search,type PolicyShareholdingSearchOptions} from '../src/index';
import {policyDocument,policySummary,policyTable} from './fixtures/policy-shareholdings';
const query:PolicyShareholdingSearchOptions={kind:'specified',periodEnd:'2026-03-31',metric:'reportedAmount'};
describe('政策保有の直接記載',()=>{
 it('集計・特定投資・みなし保有、前期と当期、分割説明を区別する',()=>{
  const r=extract(policyDocument());expect(r.diagnostics).toEqual([]);expect(r.entries).toHaveLength(10);
  expect(r.entries[0]).toMatchObject({kind:'non-pure-summary',listingClass:'non-listed',values:{issueCount:{decimal:'2'},reportedAmount:{decimal:'0'}}});
  expect(r.entries[1].listingClass).toBe('other-than-non-listed');
  expect(r.entries[2]).toMatchObject({kind:'specified',identity:'unresolved',listingClass:'not-established',periodEnd:'2026-03-31',values:{shares:{decimal:'1000',unit:'shares'},reportedAmount:{decimal:'10000000',unit:'JPY',multiplier:1000000}},reciprocalHolding:{raw:'無（子会社は有）'}});
  expect(r.entries[3]).toMatchObject({period:'previous',periodEnd:'2025-03-31',values:{shares:{decimal:'500'}}});expect(r.entries[6].kind).toBe('deemed');
  expect(r.entries[2].purpose?.raw).toContain('株式分割');
  expect(new Set(r.entries.map(e=>e.rowKey)).size).toBe(10);
  for(const e of r.entries)for(const ref of [e.name,e.purpose,e.reciprocalHolding,...Object.values(e.values)].filter(Boolean))expect(r.source.tables[e.tableIndex].cells[ref!.cellIndex].parsedText).toBe(ref!.raw);
 });
 it('同名の特定投資とみなし保有を名寄せ/合算しない',()=>{const r=extract(policyDocument());expect(r.entries.filter(e=>e.name.raw==='架空電機（注１）')).toHaveLength(4);});
 it('継続表は空の表外本文だけを越えて同じ見出しを参照できる',()=>{
  const d=policyDocument({raw:policySummary+'<p>特定投資株式</p>'+policyTable+policyTable});d.tables=d.tables.map((t,i)=>i===2?{...t,kind:'specified',headingTableIndex:1}:t);
  expect(extract(d).entries).toHaveLength(10);
  const bad=policyDocument({raw:policySummary+'<p>特定投資株式</p>'+policyTable+'<p>純投資目的へ変更</p>'+policyTable});bad.tables=d.tables.map(t=>({...t,rawSha256:bad.tables[0].rawSha256}));
  expect(extract(bad).diagnostics).toContainEqual({reason:'unconfirmed-kind',tableIndex:2,rowIndex:undefined});
 });
 it('見出しの誤分類と純投資の集計は採用しない',()=>{
  const d=policyDocument();d.tables=d.tables.map(t=>t.kind==='specified'?{...t,kind:'deemed'}:t);expect(extract(d).diagnostics.some(x=>x.reason==='unconfirmed-kind')).toBe(true);
  const r=extract(policyDocument({raw:(policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable).replace('純投資目的以外','純投資目的')}));expect(r.entries.some(e=>e.kind==='non-pure-summary')).toBe(false);
 });
 it.each(['1 000','1\n000','１００','1,00','-1','△1','1.5'])('株数%sを推測補正しない',raw=>{
  const r=extract(policyDocument({raw:(policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable).replaceAll('1,000',raw)}));expect(r.entries[2].values.shares?.status).toBe('unavailable');
 });
 it('千株は整数株へ換算し、金額の小数を保持する',()=>{
  const r=extract(policyDocument({raw:(policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable).replaceAll('株式数(株)','株式数(千株)').replaceAll('1,000','1.5').replaceAll('>10<','>1.25<')}));
  expect(r.entries[2].values).toMatchObject({shares:{decimal:'1500.0',multiplier:1000},reportedAmount:{decimal:'1250000.00'}});
 });
 it('ダッシュ、空欄、0を区別する',()=>{
  const r=extract(policyDocument());expect(r.entries[4].values.shares).toMatchObject({reason:'dash'});expect(r.entries[5].values.reportedAmount).toMatchObject({decimal:'0'});
  const d=policyDocument({raw:(policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable).replaceAll('>1,000<','><')});expect(extract(d).entries[2].values.shares).toMatchObject({reason:'blank'});
 });
 it.each([
  ['前事業年度','翌事業年度'],['株式数(株)','株式数(口)'],['貸借対照表計上額(百万円)','時価(百万円)'],['当社の株式の保有の有無','関連会社保有'],['rowspan="2">架空電機','rowspan="1">架空電機'],
 ])('未知の意味/結合を採用しない %s',(a,b)=>{
  const r=extract(policyDocument({raw:(policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable).replaceAll(a,b)}));
  expect(r.entries.filter(e=>e.kind==='specified'&&e.name.raw==='架空電機（注１）')).toHaveLength(0);
 });
 it('hash/表重複/期間逆行/未来contextを検査する',()=>{
  const d=policyDocument();expect(()=>extract({...d,tables:[{...d.tables[0],rawSha256:'a'.repeat(64)}]})).toThrow('本文参照');
  expect(()=>extract({...d,tables:[...d.tables,d.tables[0]]})).toThrow('重複');
  expect(()=>extract({...d,periodEnds:{current:'2025-03-31',previous:'2026-03-31'}})).toThrow();
  expect(extract(policyDocument({instant:'2025-06-23'})).diagnostics[0].reason).toBe('unsupported-context');
 });
});
describe('政策保有の逆引き',()=>{
 it('種類・期間・名前・指標を限定し、円と株数を混ぜず条件/ページ検索する',()=>{
  const d=policyDocument();expect(search([d],query).matched).toBe(1);
  expect(search([d],{...query,metric:'shares',nameContains:'架空電機',condition:{operator:'eq',value:1000}}).matched).toBe(1);
  expect(search([d],{...query,periodEnd:'2025-03-31',sort:'value-desc',offset:1,limit:1}).rows[0].entry.name.raw).toBe('架空銀行');
  expect(search([d],{kind:'non-pure-summary',periodEnd:'2026-03-31',metric:'issueCount',listingClass:'non-listed'}).rows[0].entry.values.issueCount).toMatchObject({decimal:'2'});
  expect(search([d],{...query,listingClass:'other-than-non-listed'}).matched).toBe(0);
  expect(search([d],query).excluded[0].reason).toBe('dash');
 });
 it.each([['gt',0],['gte',1],['lt',0],['lte',1],['eq',1]] as const)('十進の%s境界',(operator,n)=>{expect(search([policyDocument()],{...query,condition:{operator,value:10000000}}).matched).toBe(n);});
 it('原本と同一提出者の重複を拒否する',()=>{const d=policyDocument();expect(()=>search([d,d],query)).toThrow('重複');expect(()=>search([d,policyDocument({docID:'B',entity:'MAJOR-A'})],query)).toThrow('訂正版');});
 it.each([{periodEnd:'2026-02-30'},{kind:'unknown'},{metric:'issueCount'},{listingClass:'listed'},{nameContains:''},{condition:null},{condition:{operator:'eq',value:NaN}},{offset:-1},{limit:0},{sort:'name'}])('不正な検索条件を拒否する %j',change=>{expect(()=>search([],{...query,...change} as never)).toThrow();});
});
it('みなし保有の注番号付き見出しと金額定義を保持し、簿価や相互保有判定へ読み替えない',()=>{
 const raw=policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable.replaceAll('株式数(株)','株式数(株)（注１）').replaceAll('貸借対照表計上額(百万円)','貸借対照表計上額(百万円)（注２）')+'<p>（注）１．議決権行使の対象となる株式数。２．時価に株式数を乗じた額。</p>';
 const r=extract(policyDocument({raw})),e=r.entries[6];
 expect(e).toMatchObject({kind:'deemed',ownerScope:'not-established',amountDefinition:'deemed-holding-reported-amount',values:{shares:{rawHeader:'株式数(株)（注１）'},reportedAmount:{rawHeader:'貸借対照表計上額(百万円)（注２）'}}});
 expect(r.source.outsideTableText).toContain('時価に株式数');expect(r.entries[2].amountDefinition).toBe('balance-sheet-carrying-amount');
});
it('金額の千円/円の原単位を保持する',()=>{
 for(const [unit,multiplier] of [['千円',1000],['円',1]] as const){
  const d=policyDocument({raw:(policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable).replaceAll('百万円',unit)});
  expect(extract(d).entries[2].values.reportedAmount).toMatchObject({multiplier,decimal:String(10*multiplier)});
 }
});
