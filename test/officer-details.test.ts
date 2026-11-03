import {describe,it,expect} from 'vitest';
import {extractOfficerDetails as extract,searchOfficerDetails as search,extractDisclosureTables,type OfficerSearchOptions} from '../src/index';
import {officerDocument,officerTable,officerCurrent,officerProposed} from './fixtures/officers';
const all=officerCurrent+officerTable+officerProposed+officerTable;
const query:OfficerSearchOptions={status:'as-filed',rosterDate:'2026-06-24',role:'named',metric:'record'};
describe('役員の現任/予定と原表',()=>{
 it('提出日と予定株主総会日、個人と原表合計を分ける',()=>{
  const r=extract(officerDocument());expect(r.diagnostics).toEqual([]);expect(r.groups).toHaveLength(2);
  expect(r.groups[0]).toMatchObject({status:'as-filed',rosterDate:'2026-06-24',dateBasis:'filing-date-in-prefix'});
  expect(r.groups[1]).toMatchObject({status:'proposed',rosterDate:'2026-06-26',dateBasis:'scheduled-meeting-date-in-prefix'});
  expect(r.groups[0].rows[0]).toMatchObject({role:'named',identity:'unresolved',name:{raw:'架空　太郎'},reportedShares:{decimal:'1200',unit:'shares',multiplier:100}});
  expect(r.groups[0].rows[2]).toMatchObject({role:'reported-total',summaryLabel:{raw:'計'}});expect(r.groups[0].rows[2].name).toBeUndefined();
  expect(r.groups.flatMap(g=>g.rows).map(row=>row.rowKey)).toHaveLength(new Set(r.groups.flatMap(g=>g.rows).map(row=>row.rowKey)).size);
  for(const g of r.groups)for(const row of g.rows)for(const ref of [row.name,row.position,row.birthDate,row.biography,row.term,row.summaryLabel,row.reportedShares].filter(Boolean))expect(r.source.tables[g.tableIndex].cells[ref!.cellIndex].parsedText).toBe(ref!.raw);
 });
 it('略歴内の表を役員行へ重複計上せず本文として保持する',()=>{
  const r=extract(officerDocument());expect(r.source.tables).toHaveLength(2);const bio=r.groups[0].rows[0].biography!;
  expect(bio.raw).toContain('1983年４月');expect(bio.raw).toContain('架空会社入社');expect(r.source.tables[0].cells[bio.cellIndex].nestedTableCount).toBe(1);
 });
 it('既存の他領域では入れ子表を引き続き拒否する',()=>{
  const d=officerDocument(),xml=d.xml.replaceAll('InformationAboutOfficersTextBlock','MajorShareholdersTextBlock');
  expect(extractDisclosureTables(xml,{...d.selection,kind:'majorShareholders'})).toMatchObject({status:'unsupported',reason:'unsupported-fragment'});
 });
 it('略歴以外に入れ子表がある行を採用しない',()=>{
  const r=extract(officerDocument({raw:all.replaceAll('>12</td>','><table><tr><td>12</td></tr></table></td>')}));expect(r.groups[0].rows).toHaveLength(1);expect(r.diagnostics.some(d=>d.reason==='ambiguous-row')).toBe(true);
 });
 it('予定者を現任者に読み替えず、状態不明や別表の注記越しの参照を採用しない',()=>{
  const d=officerDocument();d.tables=d.tables.map(t=>({...t,status:'as-filed'}));expect(extract(d).groups).toHaveLength(1);
  const c=officerDocument({raw:officerCurrent+officerTable+'<p>補欠の役員です。</p>'+officerTable});c.tables=c.tables.map(t=>({...t,status:'as-filed',evidenceTableIndex:0}));expect(extract(c).groups).toHaveLength(1);
 });
 it('空の表外本文だけを越えて継続表を結べる',()=>{
  const d=officerDocument({raw:officerCurrent+officerTable+officerTable});d.tables=d.tables.map(t=>({...t,status:'as-filed',evidenceTableIndex:0}));expect(extract(d).groups).toHaveLength(2);
 });
 it.each(['2026年２月30日','2026年６月25日'])('不正または提出日不一致の現任日%sを選ばない',date=>{
  expect(extract(officerDocument({raw:all.replace('2026年６月24日',date)})).groups.every(g=>g.status!=='as-filed')).toBe(true);
 });
 it('過去の予定日や複数の予定日を確定しない',()=>{
  for(const text of ['2026年６月23日開催予定','2026年６月25日開催予定、2026年６月26日開催予定'])expect(extract(officerDocument({raw:all.replace('2026年６月26日開催予定',text)})).groups).toHaveLength(1);
 });
 it.each([['株',1],['百株',100],['千株',1000]] as const)('株数の%sと小数換算を検査する',(unit,multiplier)=>{
  const r=extract(officerDocument({raw:all.replaceAll('百株',unit).replaceAll('>12<','>1.5<')}));
  expect(r.groups[0].rows[0].reportedShares).toMatchObject(multiplier===1?{status:'unavailable',reason:'non-integer-shares'}:{status:'numeric',decimal:String(1.5*multiplier)+'.0'});
 });
 it.each(['1 2','1\n2','１２','△1','-1','1,00','1（注）'])('不正な株数%sを補正しない',raw=>{
  expect(extract(officerDocument({raw:all.replaceAll('>12<','>'+raw+'<')})).groups[0].rows[0].reportedShares.status).toBe('unavailable');
 });
 it('ダッシュ、空欄、実際の0と、戸籍名/任期の原文を保持する',()=>{
  const r=extract(officerDocument());expect(r.groups[0].rows[1]).toMatchObject({name:{raw:'架空　花子（旧姓：別姓）'},term:{raw:'（注）３'},reportedShares:{reason:'dash'}});
  expect(extract(officerDocument({raw:all.replaceAll('>12<','>0<')})).groups[0].rows[0].reportedShares).toMatchObject({decimal:'0'});
  expect(extract(officerDocument({raw:all.replaceAll('>12<','><')})).groups[0].rows[0].reportedShares).toMatchObject({reason:'blank'});
 });
 it.each([['所有株式数(百株)','所有株式数(口)'],['氏名','名義'],['生年月日','年齢'],['colspan="5"','colspan="4"']])('未知形式は選ばない %s',(before,after)=>{
  const r=extract(officerDocument({raw:all.replaceAll(before,after)}));
  expect(r.groups.length===0||r.groups[0].rows.every(r=>r.role!=='reported-total')).toBe(true);
 });
 it('hash、重複表、証拠参照の範囲を検査する',()=>{
  const d=officerDocument();expect(()=>extract({...d,tables:[{...d.tables[0],rawSha256:'a'.repeat(64)}]})).toThrow('本文');
  expect(()=>extract({...d,tables:[...d.tables,d.tables[0]]})).toThrow('重複');
  expect(()=>extract({...d,tables:[{...d.tables[0],evidenceTableIndex:1}]})).toThrow('参照');
 });
});
describe('役員の原文と株数検索',()=>{
 it('原文検索は株数未開示の人も返し、数値検索は理由付きで除外する',()=>{
  const d=officerDocument();expect(search([d],query).matched).toBe(2);
  expect(search([d],{...query,nameContains:'花子',biographyContains:'弁護士'}).matched).toBe(1);
  expect(search([d],{...query,metric:'reportedShares'})).toMatchObject({matched:1,excluded:[{reason:'dash'}]});
  expect(search([d],{...query,status:'proposed',rosterDate:'2026-06-26',role:'reported-total'}).matched).toBe(1);
  expect(search([d],{...query,positionContains:'社長',offset:1}).matched).toBe(1);
  expect(search([d],{...query,rosterDate:'2026-06-26'}).matched).toBe(0);
 });
 it.each([['gt',0],['gte',1],['lt',0],['lte',1],['eq',1]] as const)('株数の厳密%s境界',(operator,n)=>{expect(search([officerDocument()],{...query,metric:'reportedShares',condition:{operator,value:1200}}).matched).toBe(n);});
 it('同一提出者や同一原本を重ねない',()=>{
  expect(()=>search([officerDocument(),officerDocument()],query)).toThrow('重複');
  expect(()=>search([officerDocument(),officerDocument({docID:'B',entity:'MAJOR-A'})],query)).toThrow('訂正版');
 });
 it.each([{metric:'unknown'},{rosterDate:'2026-02-30'},{status:'current'},{role:'all'},{nameContains:''},{condition:null},{condition:{operator:'eq',value:NaN}},{sort:'value-desc'},{limit:0},{offset:-1}])('不正条件を拒否する %j',change=>{
  expect(()=>search([],{...query,...change} as never)).toThrow();
 });
});
it('入れ子の表も個数上限と安全な要素の検査対象にする',()=>{
 const nested='<table><tr><td>略歴</td></tr></table>'.repeat(201);
 const d=officerDocument({raw:all.replaceAll('弁護士登録',nested)});
 expect(extract(d).source).toMatchObject({status:'unsupported',reason:'unsupported-fragment'});
 const script=officerDocument({raw:all.replace('弁護士登録','<table><tr><td><script>bad</script></td></tr></table>')});
 expect(extract(script).source).toMatchObject({status:'unsupported',reason:'unsupported-fragment'});
});
it('予定節内に現任の説明も含む場合、予定表を現任へ変えない',()=>{
 const d=officerDocument({raw:officerCurrent+officerTable+officerCurrent+officerProposed+officerTable});
 d.tables=d.tables.map(t=>({...t,status:'as-filed'}));expect(extract(d).groups).toHaveLength(1);
});
