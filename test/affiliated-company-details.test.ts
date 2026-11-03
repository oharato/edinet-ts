import {it,expect,describe} from 'vitest';
import {extractAffiliatedCompanies,searchAffiliatedCompanies,type AffiliatedCompanySearchOptions} from '../src/index';
import {affiliatedDocument as document,affiliatedTable as table,affiliatedRow as row,affiliatedSection as section,affiliatedHeader as header} from './fixtures/affiliated-companies';
const query:AffiliatedCompanySearchOptions={reportingPeriodEnd:'2026-03-31',relationship:'consolidated-subsidiary',entryKind:'named'};
describe('関係会社の区分・出典・異なる金額の単位',()=>{
 it('会社注番号を保持し、報告期末/提出日と関係の時点を混同しない',()=>{
  const r=extractAffiliatedCompanies(document());expect(r.rows).toHaveLength(1);expect(r.rows[0]).toMatchObject({relationship:'consolidated-subsidiary',company:{raw:'架空子会社（注）１'},identity:'unresolved',relationAsOf:'not-established',capital:{currency:'JPY',multiplier:1000000,amount:{status:'numeric',decimal:'1000000000'}},voting:{direction:'owned',reportedTotal:{decimal:'100.0'},indirectIncluded:{decimal:'40.0'}}});
  expect(r.source.source.period).toEqual({instant:'2026-06-24'});expect(r.reportingPeriodEnd).toBe('2026-03-31');expect(r.definitionVerification).toBe('declared-source-reference-matched');
 });
 it('継続表は明示参照と同じ見出しのときだけ区分を引き継ぐ',()=>{
  const tables=table()+table(row('同名子会社'));
  expect(extractAffiliatedCompanies(document('A',{tables,selection:[{tableIndex:0},{tableIndex:1,continuationOf:0}]})).rows).toHaveLength(2);
  const r=extractAffiliatedCompanies(document('A',{tables,selection:[{tableIndex:0},{tableIndex:1}]}));expect(r.rows).toHaveLength(1);expect(r.diagnostics[0].reason).toBe('relationship-unconfirmed');
 });
 it('同名を統合せず、持分比率だけで親子/持分法区分を変更しない',()=>{
  const r=extractAffiliatedCompanies(document('A',{tables:table(section()+row('同名','1','40')+section('持分法適用関連会社等')+row('同名','2','100'))}));
  expect(r.rows.map(r=>r.relationship)).toEqual(['consolidated-subsidiary','equity-method-affiliates-and-others']);expect(r.rows[0].rowKey).not.toBe(r.rows[1].rowKey);
 });
 it('親会社の被所有と子会社の所有、未知区分を区別する',()=>{
  const r=extractAffiliatedCompanies(document('A',{tables:table(section('親会社')+row('親会社','10','60')+section()+row('子会社')+section('未知の区分')+row('不明会社'))}));expect(r.rows.map(r=>r.voting.direction)).toEqual(['owned-by','owned']);expect(r.diagnostics[0].reason).toBe('unknown-section');
  expect(extractAffiliatedCompanies(document('A',{tables:table(section('親会社')+row('親会社'),'所有')})).rows[0].voting.direction).toBe('owned');
 });
 it('被所有だけの表と空欄を持つ個別会社を保持する',()=>{
  expect(extractAffiliatedCompanies(document('A',{tables:table(section('親会社')+row('親会社'),'被所有')})).rows[0].voting.direction).toBe('owned-by');
  const r=extractAffiliatedCompanies(document('A',{tables:table(section()+'<tr><td>個別会社</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>')}));expect(r.rows).toHaveLength(1);expect(r.rows[0].company.raw).toBe('個別会社');
 });
 it('同じ見出しの繰り返しは会社に数えず、途中の単位変更は採用しない',()=>{
  expect(extractAffiliatedCompanies(document('A',{tables:table(section()+row()+header()+row('会社B'))})).rows).toHaveLength(2);
  const r=extractAffiliatedCompanies(document('A',{tables:table(section()+row()+header().replace('百万円','千円')+row('会社B'))}));expect(r.rows).toHaveLength(1);expect(r.diagnostics[0].reason).toBe('unsupported-layout');
 });
 it('合計を個別会社に数えず、社数のないその他も集計記載にする',()=>{
  const r=extractAffiliatedCompanies(document('A',{tables:table(section()+row('合計','100','100')+row('その他','－','－'))}));expect(r.rows).toHaveLength(1);expect(r.rows[0].entryKind).toBe('aggregate');expect(r.diagnostics[0].reason).toBe('summary-row');
 });
 it('その他社数は個別法人に数えず、集計記載を保持する',()=>{
  const r=extractAffiliatedCompanies(document('A',{tables:table(section()+row()+row('その他 48社','－','－'))}));expect(r.rows[1]).toMatchObject({entryKind:'aggregate',aggregateCount:48});expect(searchAffiliatedCompanies([document('A',{tables:table(section()+row()+row('その他48社','－','－'))})],query).matched).toBe(1);
 });
 it('注記付き/括弧付きのその他社数を個別法人に数えない',()=>{
  for(const label of ['その他48社（注）１','（その他48社）']){const r=extractAffiliatedCompanies(document('A',{tables:table(section()+row(label,'－','－'))}));expect(r.rows[0]).toMatchObject({entryKind:'aggregate',aggregateCount:48});}
 });
 it.each([['492百万\nシンガポールドル','SGD','492000000'],['20万 アメリカ・ドル','USD','200000'],['1百万 リンギット','MYR','1000000'],['0百万 英ポンド','GBP','0'],['2,393百万ドン','VND','2393000000'],['100万ＵＳ＄','USD','1000000'],['百万\nルピア\n17,830','IDR','17830000000'],['千\nＵＳドル\n2,580','USD','2580000']])('外貨資本金%sをJPYへ置換せず換算する',(raw,currency,decimal)=>{
  const c=extractAffiliatedCompanies(document('A',{tables:table(section()+row('外国会社',raw))})).rows[0].capital;expect(c).toMatchObject({raw,currency,amount:{status:'numeric',decimal}});
 });
 it.each(['1百万ルピー','1百万ウォン','US$100','$100','ＵＳ＄100'])('曖昧な通貨%sを推測しない',capital=>{
  expect(extractAffiliatedCompanies(document('A',{tables:table(section()+row('外貨',capital))})).rows[0].capital).toMatchObject({currency:null,status:'unavailable'});
 });
 it.each(['1\n2','-1','1(20)'])('金額の複数値/負数%sを部分値で採用しない',capital=>{
  const c=extractAffiliatedCompanies(document('A',{tables:table(section()+row('資本金',capital))})).rows[0].capital;expect(c.currency).toBe('JPY');if(c.currency!==null)expect(c.amount.status).toBe('unavailable');
 });
 it('括弧の意味が未確認なら間接内数を採用しない',()=>{
  const r=extractAffiliatedCompanies(document('A',{definition:false}));expect(r.rows[0].voting.reportedTotal).toMatchObject({status:'unavailable',reason:'definition-unconfirmed'});expect(r.rows[0].voting.indirectIncluded.status).toBe('unavailable');
 });
 it.each(['1\n2','101','90(100)','40[60]（注）３','-1'])('割合%sを推測・加算・補正しない',voting=>{
  expect(extractAffiliatedCompanies(document('A',{tables:table(section()+row('会社','10',voting))})).rows[0].voting.reportedTotal.status).toBe('unavailable');
 });
 it('全角の注番号だけを構造として解釈し、割合の値は改変しない',()=>{
  expect(extractAffiliatedCompanies(document('A',{tables:table(section()+row('会社','1','40.0（注）３'))})).rows[0].voting.reportedTotal).toMatchObject({status:'numeric',decimal:'40.0'});
 });
 it('0とダッシュ、間接割合の記載なしを区別する',()=>{
  for(const voting of ['0','－','―']){const v=extractAffiliatedCompanies(document('A',{tables:table(section()+row('会社','0',voting))})).rows[0].voting;expect(v.reportedTotal.status).toBe(voting==='0'?'numeric':'unavailable');expect(v.indirectIncluded).toEqual({status:'missing',reason:'not-reported'});}
 });
 it('結合行を各会社の金額や割合へ複製しない',()=>{
  const raw=table(section()+row()+row('会社B')).replace('<td>1,000</td>','<td rowspan="2">1,000</td>').replace('<td>会社B</td><td>架空県 架空市</td><td>1,000</td>','<td>会社B</td><td>架空県 架空市</td>');
  const r=extractAffiliatedCompanies(document('A',{tables:raw}));expect(r.rows).toEqual([]);expect(r.diagnostics).toHaveLength(2);
 });
 it('会社概要の期末/基準/不正な提出日を正常値にしない',()=>{
  expect(extractAffiliatedCompanies({...document(),reportingPeriodEnd:'2025-03-31'})).toMatchObject({rows:[],diagnostics:[{reason:'unsupported-profile'}]});expect(extractAffiliatedCompanies(document('A',{standard:'IFRS'})).rows).toEqual([]);expect(extractAffiliatedCompanies(document('A',{date:'2026-02-01'})).rows).toEqual([]);
 });
 it('参照/hash/間接注記なしの宣言を拒否する',()=>{
  const d=document();expect(()=>extractAffiliatedCompanies({...d,proof:{...d.proof,rawSha256:'0'.repeat(64)}})).toThrow();expect(()=>extractAffiliatedCompanies(document('A',{notes:'<p>不明</p>'}))).toThrow();expect(()=>extractAffiliatedCompanies({...d,tables:[{tableIndex:0},{tableIndex:0}]})).toThrow();expect(()=>extractAffiliatedCompanies({...d,tables:[{tableIndex:2,continuationOf:0}]})).toThrow();
 });
 it('未知レイアウトや継続元の失敗を他区分で補わない',()=>{
  const tables=table().replace('会社の名称','不明な名称')+table(row());const r=extractAffiliatedCompanies(document('A',{tables,selection:[{tableIndex:0},{tableIndex:1,continuationOf:0}]}));expect(r.rows).toEqual([]);expect(r.diagnostics.map(d=>d.reason)).toEqual(['unsupported-layout','continuation-unavailable']);
 });
});
describe('関係会社の記載名・区分・通貨/議決権による検索',()=>{
 it.each([['gte',1000000000,1],['gt',1000000000,0],['lte',1000000000,1],['lt',1000000000,0],['eq',1000000000,1]] as const)('%sの円条件を厳密比較する',(operator,value,n)=>{expect(searchAffiliatedCompanies([document()],{...query,capital:{currency:'JPY',operator,value}}).matched).toBe(n);});
 it('内数と所有方向を揃えて検索し、名前だけなら欠損割合も残す',()=>{
  expect(searchAffiliatedCompanies([document()],{...query,voting:{direction:'owned',component:'indirectIncluded',operator:'gte',value:40}}).matched).toBe(1);
  const d=document('A',{tables:table(section()+row('会社','1','－'))});expect(searchAffiliatedCompanies([d],query).matched).toBe(1);expect(searchAffiliatedCompanies([d],{...query,voting:{direction:'owned',component:'reportedTotal',operator:'gte',value:0}}).excluded[0].reason).toBe('voting-unavailable');
 });
 it('異通貨を比較しない理由を保持する',()=>{const r=searchAffiliatedCompanies([document('A',{tables:table(section()+row('外貨','1百万米ドル'))})],{...query,capital:{currency:'JPY',operator:'gte',value:0}});expect(r.excluded[0].reason).toBe('capital-currency-mismatch');});
 it('表示名・所在地・事業、安定した名前順とページを扱う',()=>{
  const r=searchAffiliatedCompanies([document('B'),document('A')],{...query,nameContains:'架空',addressContains:'架空市',businessContains:'通信',sort:'name-desc',offset:1,limit:1});expect(r.matched).toBe(2);expect(r.extractions[r.rows[0].sourceIndex].source.source.docID).toBe('B');
 });
 it('原本/提出者/報告期末の重複や混在、過剰/不正条件を拒否',()=>{
  expect(()=>searchAffiliatedCompanies([document(),document()],query)).toThrow();expect(()=>searchAffiliatedCompanies([document(),document('B',{entity:'A'})],query)).toThrow();expect(()=>searchAffiliatedCompanies([document()],{...query,reportingPeriodEnd:'2025-03-31'})).toThrow();expect(()=>searchAffiliatedCompanies(Array(101).fill(document()),query)).toThrow();for(const changes of [{limit:0},{offset:-1},{capital:null},{voting:{direction:'owned',component:'reportedTotal',operator:'gte',value:NaN}}])expect(()=>searchAffiliatedCompanies([document()],{...query,...changes} as AffiliatedCompanySearchOptions)).toThrow();
 });
 it('空集合は0件',()=>{expect(searchAffiliatedCompanies([],query)).toMatchObject({matched:0,filtered:0,rows:[],excluded:[]});});
});

it('親会社実表の別方向列・明示接頭辞と結合所在地を保持する',()=>{
 const two='<table><tr><td rowspan="2">名称</td><td rowspan="2">住所</td><td rowspan="2">資本金(百万円)</td><td rowspan="2">主要な事業の内容</td><td colspan="2">議決権の所有(被所有)割合</td><td rowspan="2">関係内容</td></tr><tr><td>所有割合(％)</td><td>被所有割合(％)</td></tr>'+section('親会社')+'<tr><td>親会社</td><td>架空市</td><td>100</td><td>電機</td><td>5</td><td>51.5</td><td>関係本文</td></tr></table>';
 const first=extractAffiliatedCompanies(document('A',{tables:two})).rows[0];expect(first.voting).toMatchObject({direction:'owned-by',reportedTotal:{decimal:'51.5'}});expect(first.counterVoting).toMatchObject({direction:'owned',reportedTotal:{decimal:'5'}});
 expect(searchAffiliatedCompanies([document('A',{tables:two})],{...query,relationship:'parent',voting:{direction:'owned',component:'reportedTotal',operator:'eq',value:5}}).matched).toBe(1);
 for(const combined of [false,true]){
  const headers=combined?'<td>会社名（住所）</td><td>資本金（百万円）</td><td>主要な事業の内容</td><td>議決権の所有又は被所有割合（％）</td><td>関係内容</td>':'<td>名称</td><td>住所</td><td>資本金（百万円）</td><td>主要な事業の内容</td><td>議決権の所有割合又は被所有割合（％）</td><td>関係内容</td>';
  const data=combined?'<td>親会社（架空市）</td><td>100</td><td>建設</td><td>（被所有）50.67（8.36）</td><td>本文</td>':'<td>親会社</td><td>架空市</td><td>100</td><td>建設</td><td>被所有 50.2</td><td>本文</td>';
  const d=document('A',{tables:'<table><tr>'+headers+'</tr><tr><td colspan="'+(combined?5:6)+'">（親会社）</td></tr><tr>'+data+'</tr></table>'}),r=extractAffiliatedCompanies(d);
  expect(r.rows[0].voting).toMatchObject({direction:'owned-by',directionBasis:'explicit-prefix',reportedTotal:{status:'numeric'}});expect(r.rows[0].companyAndAddressCombined).toBe(combined);
  if(combined){expect(r.rows[0].address).toEqual({status:'unavailable',reason:'not-separated'});expect(searchAffiliatedCompanies([d],{...query,relationship:'parent',addressContains:'架空'}).excluded[0].reason).toBe('address-unavailable');}
 }
});
