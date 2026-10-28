import {describe,it,expect} from 'vitest';
import {extractOfficerRemuneration as extract,searchOfficerRemuneration as search,type RemunerationSearchOptions} from '../src/index';
import {remunerationDocument,categoryRemuneration,individualRemuneration} from './fixtures/remuneration';
const raw=categoryRemuneration+individualRemuneration;
const query:RemunerationSearchOptions={kind:'category',period:{startDate:'2025-04-01',endDate:'2026-03-31'},role:'detail',metric:'total'};
describe('役員報酬の直接記載と定義',()=>{
 it('区分集計・原表合計と個人連結報酬、対象期間/人数/金額を分ける',()=>{
  const r=extract(remunerationDocument());expect(r.diagnostics).toEqual([]);expect(r.entries).toHaveLength(5);
  expect(r.entries[0]).toMatchObject({kind:'category',role:'detail',period:query.period,paymentBasis:'reported-not-verified-cash-payment',total:{decimal:'341000000',unit:'JPY'},recipientCount:{decimal:'10',unit:'people'}});
  expect(r.entries[2].role).toBe('reported-total');expect(r.entries[3]).toMatchObject({kind:'individual',name:{raw:'架空　太郎'},total:{decimal:'101000000'},contributions:[{company:{raw:'提出会社'}},{company:{raw:'別会社'}}]});
  expect(r.entries[0].total).toMatchObject({decimal:'341000000'}); // 内訳270へ補正しない
  expect(new Set(r.entries.map(e=>e.entryKey)).size).toBe(r.entries.length);
 });
 it('個人総額のrowspanを1回だけ保持し、会社別内訳へ複製しない',()=>{
  const r=extract(remunerationDocument()),person=r.entries[3];expect(person.kind).toBe('individual');if(person.kind!=='individual')throw Error();
  expect(person.contributions).toHaveLength(2);expect(person.contributions.every(c=>!('total'in c))).toBe(true);
  expect(search([remunerationDocument()],{...query,kind:'individual'}).matched).toBe(2);
 });
 it('親子の報酬見出しと社外役員の階層ラベルを保持する',()=>{
  const r=extract(remunerationDocument({three:true})),e=r.entries[1];expect(e.kind).toBe('category');if(e.kind!=='category')throw Error();
  expect(e.categories.map(c=>c.raw)).toEqual(['社外役員','社外取締役']);expect(e.components[0].path.map(c=>c.raw)).toEqual(['金銭報酬','基本報酬']);
  expect(search([remunerationDocument({three:true})],{...query,metric:'component',componentPath:['金銭報酬','賞与']}).matched).toBe(1);
 });
 it('全数値・見出し・ラベルの物理セル参照を保持する',()=>{
  const r=extract(remunerationDocument({three:true}));
  for(const e of r.entries){
   const table=r.source.tables[e.tableIndex],refs=[e.total,...(e.kind==='category'?[...e.categories,e.recipientCount,...e.components.flatMap(c=>[...c.path,c.value])]:[e.name,...e.contributions.flatMap(c=>[c.position,c.company,...c.components.flatMap(c=>[...c.path,c.value])])])];
   for(const ref of refs){expect(table.cells[ref.cellIndex].parsedText).toBe(ref.raw);if('headers'in ref)for(const h of ref.headers)expect(table.cells[h.cellIndex].parsedText).toBe(h.raw);}
  }
 });
 it('氏名の一致だけで複数の個人行を結合しない',()=>{
  const r=extract(remunerationDocument({raw:raw.replace('架空　花子','架空　太郎')}));expect(r.entries.filter(e=>e.kind==='individual')).toHaveLength(2);
 });
 it('ダッシュ・空欄・実際の0と丸め差を区別する',()=>{
  const r=extract(remunerationDocument());expect(r.entries[1].kind).toBe('category');if(r.entries[1].kind!=='category')throw Error();
  expect(r.entries[1].components[1].value).toMatchObject({reason:'dash'});expect(r.entries[4].total).toMatchObject({decimal:'0'});
  expect(extract(remunerationDocument({raw:raw.replace('>341<','><')})).entries[0].total).toMatchObject({reason:'blank'});
 });
 it.each(['1 2','1\n2','１２','NaN','1,00','△1','-1','1e3'])('報酬%sを推測変換しない',value=>{
  expect(extract(remunerationDocument({raw:raw.replace('>341<','>'+value+'<')})).entries[0].total.status).toBe('unavailable');
 });
 it('人数は整数、金額は小数を許容して原精度を保持する',()=>{
  const r=extract(remunerationDocument({raw:raw.replace('>341<','>1.25<').replace('>10<','>1.5<')}));
  expect(r.entries[0].total).toMatchObject({decimal:'1250000.00'});expect(r.entries[0]).toMatchObject({recipientCount:{reason:'non-integer-people'}});
 });
 it.each([['千円',1000],['円',1]] as const)('原金額単位%sを換算する',(unit,multiplier)=>{
  expect(extract(remunerationDocument({raw:raw.replaceAll('百万円',unit)})).entries[0].total).toMatchObject({multiplier,decimal:String(341*multiplier)});
 });
 it('個人名/総額の結合範囲が食い違う場合は個人全体を採用しない',()=>{
  const d=remunerationDocument({raw:raw.replace('<td rowspan="2">101</td>','<td>101</td>')});
  expect(extract(d).entries.filter(e=>e.kind==='individual'&&e.name.raw==='架空　太郎')).toHaveLength(0);
 });
 it.each([
  ['報酬等の総額(百万円)','報酬限度額(百万円)'],
  ['報酬等の種類別の総額(百万円)','報酬構成比(%)'],
  ['対象となる役員の員数(人)','期末役員数(人)'],
  ['固定報酬','固定報酬割合(%)'],
 ])('限度額や比率等の別定義を実績額へ採用しない %s',(a,b)=>{
  expect(extract(remunerationDocument({raw:raw.replace(a,b)})).entries.some(e=>e.kind==='category')).toBe(false);
 });
 it('異なる単位の親見出し・重複内訳名・明細へ延びる見出しを拒否する',()=>{
  for(const changed of [raw.replace('種類別の総額(百万円)','種類別の総額(千円)'),raw.replace('業績連動報酬','固定報酬'),raw.replace('rowspan="2">役員区分','rowspan="3">役員区分')]){
   expect(extract(remunerationDocument({raw:changed})).entries.some(e=>e.kind==='category')).toBe(false);
  }
 });
 it('本文hash、表重複、期間逆行、未来期末を検査する',()=>{
  const d=remunerationDocument();expect(()=>extract({...d,tables:[{...d.tables[0],rawSha256:'a'.repeat(64)}]})).toThrow('本文参照');
  expect(()=>extract({...d,tables:[...d.tables,d.tables[0]]})).toThrow('重複');
  expect(()=>extract({...d,period:{startDate:'2026-03-31',endDate:'2025-04-01'}})).toThrow();
  expect(extract(remunerationDocument({instant:'2025-06-24'})).diagnostics[0].reason).toBe('unsupported-context');
 });
 it('実2024原本で確認したtaxonomy2023-12-01も採用し、未知namespaceは採用しない',()=>{
  expect(extract(remunerationDocument({namespace:'http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2023-12-01/jpcrp_cor'})).entries).toHaveLength(5);
  expect(extract(remunerationDocument({namespace:'urn:other'})).source).toMatchObject({status:'unsupported',reason:'unknown-namespace'});
 });
});
describe('役員報酬の定義別検索',()=>{
 it('区分ラベル・個人総額・会社別内訳を分ける',()=>{
  const d=remunerationDocument();expect(search([d],query).matched).toBe(2);
  expect(search([d],{...query,labelContains:'社外役員'}).matched).toBe(1);
  expect(search([d],{...query,role:'reported-total'}).matched).toBe(1);
  expect(search([d],{...query,kind:'individual',metric:'component',componentPath:['株式報酬'],companyContains:'別会社'})).toMatchObject({matched:1,rows:[{contributionIndex:1,value:{decimal:'88000000'}}]});
  expect(search([d],{...query,metric:'component',componentPath:['基本報酬']})).toMatchObject({matched:0,excluded:[{reason:'component-not-reported'},{reason:'component-not-reported'}]});
  expect(search([d],{...query,metric:'component',componentPath:['業績連動報酬']})).toMatchObject({matched:1,excluded:[{reason:'dash'}]});
 });
 it('期間・順序・ページ・人数指標を指定する',()=>{
  const d=remunerationDocument();expect(search([d],{...query,sort:'value-desc',offset:1,limit:1}).rows[0].value).toMatchObject({decimal:'30000000'});
  expect(search([d],{...query,metric:'recipientCount',condition:{operator:'gte',value:5}}).matched).toBe(1);
  expect(search([d],{...query,period:{startDate:'2024-04-01',endDate:'2025-03-31'}}).matched).toBe(0);
 });
 it.each([['gt',0],['gte',1],['lt',0],['lte',1],['eq',1]] as const)('正確な円単位の%s境界',(operator,n)=>{expect(search([remunerationDocument()],{...query,labelContains:'取締役',condition:{operator,value:341000000}}).matched).toBe(n);});
 it('原本と同じ提出者を重複させない',()=>{
  expect(()=>search([remunerationDocument(),remunerationDocument()],query)).toThrow('重複');
  expect(()=>search([remunerationDocument(),remunerationDocument({docID:'B',entity:'MAJOR-A'})],query)).toThrow('訂正版');
 });
 it.each([{kind:'all'},{period:{startDate:'2025-04-01',endDate:'2026-02-30'}},{metric:'price'},{companyContains:'提出会社'},{metric:'component'},{componentPath:['固定報酬']},{kind:'individual',metric:'recipientCount'},{labelContains:''},{condition:null},{condition:{operator:'eq',value:NaN}},{sort:'name'},{offset:-1},{limit:0}])('不正条件を拒否する %j',change=>{
  expect(()=>search([],{...query,...change} as never)).toThrow();
 });
});
it('見出し行数を誤って明細まで含めると採用しない',()=>{
 const d=remunerationDocument();d.tables=d.tables.map(t=>({...t,headerRows:3}));expect(extract(d).entries).toHaveLength(0);
});
it('空の内訳階層や疎配列を検索条件として受理しない',()=>{
 for(const componentPath of [[],Array(1),['固定報酬','']])expect(()=>search([],{...query,metric:'component',componentPath})).toThrow();
});
