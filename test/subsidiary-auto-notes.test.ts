import {describe,it,expect} from 'vitest';
import {extractSubsidiaryHumanCapitalMetrics as extract,screenSubsidiaryHumanCapitalMetrics as screen,SubsidiaryHumanCapitalMetricId as M} from '../src/subsidiary-human-capital-metrics';
import {EdinetXbrlObject} from '../src/edinet-xbrl-object';
import {parseDisclosureTableFragment} from '../src/disclosure-tables';
import {subsidiaryDocument,proof as fixtureProof} from './fixtures/subsidiary-metrics';
const women='「女性の職業生活における活躍の推進に関する法律」（平成27年法律第64号）の規定に基づき算出したものであります。';
const ordinance='「育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律」（平成3年法律第76号）の規定に基づき、「育児休業、介護休業等育児又は家族介護を行う労働者の福祉に関する法律施行規則」（平成3年労働省令第25号）第71条の6第2号における育児休業等及び育児目的休暇の取得割合を算出したものであります。';
function table(name='合成子会社',nil=false){return `<table><tr><td colspan="8">当事業年度</td></tr><tr><td rowspan="2">名称</td><td rowspan="2">管理的地位にある労働者に占める女性労働者の割合（％）（注）1</td><td colspan="3">男性労働者の育児休業取得率（％）（注）2</td><td colspan="3">労働者の男女の賃金の額の差異（％）（注）1、3</td></tr><tr><td>全労働者</td><td>正規労働者</td><td>非正規労働者</td><td>全労働者</td><td>うち正規労働者</td><td>うち非正規労働者</td></tr><tr><td>${name}</td><td>10</td><td>120</td><td>100</td><td>0</td><td>75</td><td>80</td><td>${nil?'－（注）5':'60'}</td></tr></table>`;}
function dual(left='120',right='150'){return `<table><tr><td colspan="7">当事業年度</td></tr><tr><td rowspan="2">名称</td><td rowspan="2">管理職に占める女性労働者の割合(％)(注1,2)</td><td colspan="2">男性労働者の育児休業取得率(％)(注2)</td><td colspan="3">労働者の男女の賃金の差異(％)(注1,2,4,5)</td></tr><tr><td>育児休業取得率(％)(注1)</td><td>育児休業等及び育児目的休暇の取得率(％)(注3)</td><td>全労働者</td><td>正規雇用労働者</td><td>パート・有期労働者</td></tr><tr><td>合成子会社</td><td>10</td><td>${left}</td><td>${right}</td><td>75</td><td>80</td><td>60</td></tr></table>`;}
function rowMethod(reference='（注）2'){return table().replace('colspan="8"','colspan="9"').replace('colspan="3">男性','colspan="4">男性').replace('非正規労働者</td><td>全労働者','非正規労働者</td><td></td><td>全労働者').replace('<td>0</td><td>75',`<td>0</td><td>${reference}</td><td>75`).replace('賃金の額','賃金');}
const rowNotes=`<p>（注）1　${women}</p><p>2　${ordinance.replace('第2号','第1号').replace('育児休業等及び育児目的休暇','育児休業等')}</p><p>3　${ordinance}</p>`;
const dualNotes=`<p>(注)1．${women}</p><p>2．当連結会計年度における実績です。</p><p>3．${ordinance}</p>`;
const notes=`<p>（注）1．${women}</p><p>2．${ordinance}</p><p>3．男女の賃金の差異です。</p><p>5．対象となる従業員はおりません。</p>`;
function doc(raw='<p>連結子会社</p>'+table()+notes,nil=false){
 const d=subsidiaryDocument('AUTO-A',[{name:'合成子会社',values:nil?{[M.GenderWageNonRegularRatio]:null}:{}}]);
 const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
 d.xml=d.xml.replace('合成注記。算出方法と対象者不在の説明を呼出元が確認。',escape(raw)).replace('xmlns:xsi=', 'xmlns:dei="http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor" xmlns:xsi=');
 d.xml=d.xml.replace('</xbrli:xbrl>','<dei:CurrentFiscalYearStartDateDEI contextRef="filing">2025-04-01</dei:CurrentFiscalYearStartDateDEI><dei:CurrentFiscalYearEndDateDEI contextRef="filing">2026-03-31</dei:CurrentFiscalYearEndDateDEI><dei:CurrentPeriodEndDateDEI contextRef="filing">2026-03-31</dei:CurrentPeriodEndDateDEI><dei:TypeOfCurrentPeriodDEI contextRef="filing">FY</dei:TypeOfCurrentPeriodDEI></xbrli:xbrl>');return d;
}
const run=(d=doc())=>extract(d.xml,d.metadata,Object.values(M),'auto');
describe('子会社注記の自動解釈',()=>{
 it.each([['（注）2','ordinance-item1'],['（注）3','ordinance-item2']])('9列の行別参照 %s から %s を選び、賃金の列位置も保つ',(reference,method)=>{const r=run(doc('<p>連結子会社</p>'+rowMethod(reference)+rowNotes));expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]).toMatchObject({status:'selected',declaration:{method}});expect(r.noteInterpretation?.matched).toHaveLength(3);expect(r.rows[0].selections[M.GenderWageAllRatio]).toMatchObject({status:'selected',raw:'0.75'});});
 it.each(['（注）2abc','（注）9','', '（注）2、3'])('9列の行別参照 %s が不明・複数なら方法を補わない',reference=>{const r=run(doc('<p>連結子会社</p>'+rowMethod(reference)+rowNotes));expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');});

 it('手動注記の確認cacheを異なるtaxonomyの行へ使い回さない',()=>{
  const d=subsidiaryDocument('MIXED',[{name:'2025会社'},{name:'2024会社'}]),ns='xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor"';
  d.xml=d.xml.replace('xmlns:xsi=',ns.replace('xmlns:jpcrp_cor=','xmlns:old=')+' xmlns:xsi=').replace(/<xbrli:context id="row2">[\s\S]*?<\/xbrli:context>/,context=>context.replaceAll('jpcrp_cor:','old:')).replace(/<jpcrp_cor:([^ >]+)([^>]*contextRef="row2"[^>]*)>([\s\S]*?)<\/jpcrp_cor:\1>/g,(_match,tag,attrs,text)=>`<old:${tag}${attrs}>${text}</old:${tag}>`);
  const base=extract(d.xml,d.metadata);expect(base.rows.filter(r=>r.label.status==='selected')).toHaveLength(2);
  const ordered=['2025-11-01','2024-11-01'].map(year=>base.rows.find(r=>r.label.dimensions?.[0]?.axisNamespaceURI.includes(year))!);
  const annotations=ordered.map(r=>({kind:'childcare-method' as const,rowKey:r.label.rowKey!,metric:M.MaleChildcareLeaveAllRatio,method:'ordinance-item2' as const,proof:fixtureProof}));
  expect(()=>extract(d.xml,d.metadata,Object.values(M),annotations)).toThrow(/注記/);
 });
 it('確認済み2024年版の行・数値・注記も同一taxonomy内で対応する',()=>{const d=doc();d.xml=d.xml.replaceAll('2025-11-01','2024-11-01');const r=run(d);expect(r.rows[0].label.status).toBe('selected');expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]).toMatchObject({status:'selected',declaration:{method:'ordinance-item2'}});expect(r.noteInterpretation?.matched).toHaveLength(3);});
 it.each(['metric','note','axis'])('2024/2025の%sが混在した根拠を対応させない',kind=>{const d=doc();d.xml=d.xml.replace('xmlns:xsi=','xmlns:old="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor" xmlns:xsi=');if(kind==='metric')d.xml=d.xml.replaceAll('jpcrp_cor:AllEmployeesRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfConsolidatedSubsidiaries','old:AllEmployeesRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfConsolidatedSubsidiaries');if(kind==='note')d.xml=d.xml.replace('<jpcrp_cor:InformationAboutEmployeesTextBlock ', '<jpcrp_cor:InformationAboutEmployeesTextBlock xmlns:jpcrp_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor" ');if(kind==='axis')d.xml=d.xml.replaceAll('jpcrp_cor:SequentialNumbersAxis','old:SequentialNumbersAxis').replaceAll('jpcrp_cor:Row1Member','old:Row1Member');const r=run(d);expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).not.toBe('selected');expect(r.noteInterpretation?.matched.filter(e=>e.metric===M.MaleChildcareLeaveAllRatio)).toHaveLength(0);});

 it('既定動作を変えず、列・注記・原値が一致した育休方法を付ける',()=>{
  const d=doc();expect(extract(d.xml,d.metadata).rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');
  const r=run(d);expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]).toMatchObject({status:'selected',declaration:{method:'ordinance-item2',origin:'automatic-rule'}});
  expect(r.noteInterpretation?.matched).toHaveLength(3);expect(r.noteInterpretation?.matched[0]).toMatchObject({tableIndex:0,row:3,noteNumber:2,proof:{contextRef:'filing'}});
 });
 it('nilセルに結ばれた非該当注記だけを採用する',()=>{const r=run(doc('<p>連結子会社</p>'+table('合成子会社',true)+notes,true));expect(r.rows[0].selections[M.GenderWageNonRegularRatio]).toMatchObject({status:'missing',disclosure:{state:'not-applicable',origin:'automatic-rule'}});});
 it('空の間隔で続く同じ見出しの表を一つの注記範囲へ結ぶ',()=>{const r=run(doc('<p>連結子会社</p>'+table()+table('対象外の会社')+notes));expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('selected');});
 it.each(['note','scope','value','period','duplicate-note','negation'])('%sの不一致を自動認定しない',kind=>{
  let raw='<p>連結子会社</p>'+table()+notes;if(kind==='note')raw=raw.replace('（注）2','（注）9');if(kind==='scope')raw=raw.replace('連結子会社','提出会社');if(kind==='value')raw=raw.replace('<td>120</td>','<td>121</td>');if(kind==='duplicate-note')raw+='<p>2．別の方法です。</p>';if(kind==='negation')raw=raw.replace('算出したものであります。</p><p>3','算出したものではありません。</p><p>3');
  const d=doc(raw);if(kind==='period')d.xml=d.xml.replaceAll('2026-03-31</dei:','2025-03-31</dei:');
  expect(run(d).rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');
 });
 it('同じラベルが複数の物理行にある場合は結合を推測しない',()=>{expect(run(doc('<p>連結子会社</p>'+table()+table()+notes)).rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');});
 it('曖昧な別行にも同じラベル候補があれば、一意の会社行だと推測しない',()=>{
  const d=doc(),extra=subsidiaryDocument('AUTO-A',[{name:'合成子会社'},{name:'合成子会社'}],'<jpcrp_cor:ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries contextRef="row2">別の会社</jpcrp_cor:ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries>');
  const contexts=/<xbrli:context id="row2">[\s\S]*?<\/xbrli:context>/.exec(extra.xml)![0];
  const facts=extra.xml.match(/<jpcrp_cor:ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries contextRef="row2">[\s\S]*?<\/jpcrp_cor:ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries>/g)!.join('');
  d.xml=d.xml.replace('</xbrli:xbrl>',contexts+facts+'</xbrli:xbrl>');expect(run(d).rows.find(r=>r.label.status==='selected')?.selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');
 });
 it('screenからもautoを使い、出典へ自動解釈の証拠を残す',()=>{const d=doc();const r=screen([{...d,annotations:'auto'}],M.MaleChildcareLeaveAllRatio,{childcareMethod:'ordinance-item2'});expect(r.total).toBe(1);expect(r.sources[0].noteInterpretation?.matched.length).toBe(3);});
 it.each([['120','150','womens-act'],['140','120','ordinance-item2']])('異なる算定列 %s/%s から一意な原値対応だけを採用する',(left,right,method)=>{
  const r=run(doc('<p>主要な連結子会社</p>'+dual(left,right)+dualNotes));expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]).toMatchObject({status:'selected',declaration:{method}});
 });
 it('異なる算定列が同値なら方法を推測しない',()=>{const r=run(doc('<p>主要な連結子会社</p>'+dual('120','120')+dualNotes));expect(r.rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');expect(r.noteInterpretation?.unresolved).toContainEqual(expect.objectContaining({metric:M.MaleChildcareLeaveAllRatio,reason:'ambiguous-column'}));});
 it('前の親会社注記で子会社の欠落注記を補わない',()=>{const raw='<p>(注)3．'+ordinance+'</p><p>主要な連結子会社</p>'+dual('140','120')+'<p>(注)1．'+women+'</p>';expect(run(doc(raw)).rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');});
 it.each(['1,20','1 20','①'])('表示数値 %s の区切りや記号を推測して数値化しない',display=>{
  const d=doc('<p>連結子会社</p>'+table().replace('<td>120</td>',`<td>${display}</td>`)+notes);
  if(display==='①')d.xml=d.xml.replace('>1.2</','>0.01</');
  expect(run(d).rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');
 });
 it.each([['.1','10'],['12','1,200'],['-0','0']])('十進原値 %s と百分率 %s を厳密に対応する',(raw,value)=>{const d=doc('<p>連結子会社</p>'+table().replace('<td>120</td>',`<td>${value}</td>`)+notes);d.xml=d.xml.replace('>1.2</',`>${raw}</`);expect(run(d).rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('selected');});
 it('原本のないObjectへautoを指定しても注記を推測しない',()=>{const r=new EdinetXbrlObject().selectSubsidiaryHumanCapitalMetrics({docID:'EMPTY',instant:'2026-03-31'},[M.MaleChildcareLeaveAllRatio],'auto');expect(r.noteInterpretation?.reason).toBe('note-unavailable');});
 it('未知見出し・危険fragment・DEI欠落は比較可能へ昇格させない',()=>{
  for(const raw of ['<p>連結子会社</p>'+table().replace('非正規 労働者','未知区分').replace('非正規労働者','未知区分')+notes,'<script>unknown</script><p>連結子会社</p>'+table()+notes])expect(run(doc(raw)).rows[0].selections[M.MaleChildcareLeaveAllRatio]?.status).toBe('reported');
  const d=doc();d.xml=d.xml.replace(/<dei:[^>]+>[\s\S]*?<\/dei:[^>]+>/g,'');expect(run(d).noteInterpretation?.reason).toBe('period-unbound');
 });
 it('auto同士では同じ期末でも会計年度の開始日が違えば比較しない',()=>{
  const a=doc(),b=doc();b.xml=b.xml.replaceAll('AUTO-A','AUTO-B').replace('2025-04-01</dei:','2025-05-01</dei:');b.metadata.docID='AUTO-B';
  const inputs=[{...a,annotations:'auto' as const},{...b,annotations:'auto' as const}];
  expect(()=>screen(inputs,M.MaleChildcareLeaveAllRatio,{childcareMethod:'ordinance-item2'})).toThrow(/会計年度/);
  expect(screen(inputs,M.FemaleManagerRatio).total).toBe(2);
 });
 it('autoで年次範囲が不明な賃金比率は検索から除外し、既定モードは維持する',()=>{
  const d=doc();d.xml=d.xml.replace(/<dei:CurrentFiscalYearStartDateDEI[^>]*>[\s\S]*?<\/dei:CurrentFiscalYearStartDateDEI>/,'');
  expect(screen([d],M.GenderWageAllRatio).total).toBe(1);
  const r=screen([{...d,annotations:'auto'}],M.GenderWageAllRatio);expect(r.total).toBe(0);expect(r.diagnostics).toContainEqual(expect.objectContaining({reason:'definition-unconfirmed'}));
 });
 it('末尾注記の取得は明示時だけで、先行表の注記と混ぜない',()=>{const raw='<p>前の文章</p><table><tr><td>1</td></tr></table><p>最後の注記</p>';expect(parseDisclosureTableFragment(raw)).not.toHaveProperty('trailingText');expect(parseDisclosureTableFragment(raw,true).trailingText).toBe('最後の注記');});
});

const populationDefinition='管理職に占める女性労働者の割合は当連結会計年度末時点、男性労働者の育児休業取得率及び労働者の男女の賃金の差異は当連結会計年度における実績を記載しており、集計対象には当社から他社への出向者を含み、他社から当社への出向者を除いております。';
const wageDefinition='賃金は、基本給、超過労働に対する報酬、賞与等を含み、退職手当、通勤手当等を除いて算出しております。パート・有期労働者は、有期の嘱託社員、臨時雇用者、パートタイマーを対象とし、パートタイマーについてはフルタイム換算をせず実際に支給した賃金に基づき算出しております。';
const definitionNotes=`<p>(注)1．${women}</p><p>2．${populationDefinition}</p><p>3．${ordinance}</p><p>4．${wageDefinition}</p>`;
describe('原文参照付きの対象者・賃金定義',()=>{
 it('出向者範囲・賃金の例示・パートタイマーだけの非FTE算定を区別して返す',()=>{
  const d=doc('<p>連結子会社</p>'+dual()+definitionNotes),r=run(d),definitions=r.noteInterpretation!.definitions;
  expect(r.noteInterpretation?.version).toBe('3');expect(definitions).toHaveLength(10);
  expect(definitions.filter(d=>d.definition.kind==='secondment-population')).toHaveLength(5);
  expect(definitions.filter(d=>d.definition.kind==='wage-composition')).toHaveLength(3);
  expect(definitions.filter(d=>d.definition.kind==='part-time-wage-basis').map(d=>d.metric)).toEqual([M.GenderWageAllRatio,M.GenderWageNonRegularRatio]);
  expect(definitions.find(d=>d.definition.kind==='part-time-wage-basis')).toMatchObject({noteNumber:4,noteText:wageDefinition,definition:{population:['有期の嘱託社員','臨時雇用者','パートタイマー'],partTimeBasis:'actual-paid-without-fte-adjustment'}});
  expect(definitions.every(d=>d.proof.rawSha256===r.noteInterpretation!.proof!.rawSha256&&d.rowKey===r.rows[0].label.rowKey&&d.cellIndex>=0)).toBe(true);
  const values=(e:ReturnType<typeof run>)=>e.rows.map(row=>Object.entries(row.selections).map(([id,s])=>({id,status:s!.status,raw:s!.raw})));
  expect(values(r)).toEqual(values(run(doc('<p>連結子会社</p>'+dual()+dualNotes))));
  expect(extract(d.xml,d.metadata).noteInterpretation).toBeUndefined();
  expect(screen([{...d,annotations:'auto'}],M.GenderWageAllRatio).sources[0].noteInterpretation?.definitions).toHaveLength(10);
 });
 it.each(['negation','duplicate','unlinked','parent','value','period'])('%sの注記を確認済み定義へ昇格させない',kind=>{
  let html='<p>連結子会社</p>'+dual()+definitionNotes;
  if(kind==='negation')html=html.replace('換算をせず','換算をせずとは限らず');
  if(kind==='duplicate')html+=`<p>4．${wageDefinition}</p>`;
  if(kind==='unlinked')html=html.replace('(注1,2,4,5)','(注1)');
  if(kind==='parent')html='<p>提出会社</p>'+dual()+definitionNotes;
  if(kind==='value')html=html.replace('<td>75</td>','<td>74</td>').replace('<td>80</td>','<td>79</td>').replace('<td>60</td>','<td>59</td>');
  const d=doc(html);if(kind==='period')d.xml=d.xml.replace('>2025-04-01</dei:CurrentFiscalYearStartDateDEI>','>2026-04-01</dei:CurrentFiscalYearStartDateDEI>');
  const definitions=run(d).noteInterpretation!.definitions;
  expect(definitions.filter(d=>d.metric.startsWith('genderWage')&&d.definition.kind!=='secondment-population')).toEqual([]);
 });
});

it('nilの賃金セルには数値の定義を付けず、正規雇用者へパートの非FTE算定を広げない',()=>{
 const d=doc('<p>連結子会社</p>'+dual().replace('<td>60</td>','<td>－</td>')+definitionNotes,true),r=run(d);
 expect(r.rows[0].selections[M.GenderWageNonRegularRatio]?.reason).toBe('nil');
 expect(r.noteInterpretation!.definitions.some(d=>d.metric===M.GenderWageNonRegularRatio)).toBe(false);
 expect(r.noteInterpretation!.definitions.filter(d=>d.definition.kind==='part-time-wage-basis').map(d=>d.metric)).toEqual([M.GenderWageAllRatio]);
});
