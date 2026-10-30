import {describe,it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {resolveFinancialReportingBasis as resolve,createAutomaticFinancialSnapshots as auto,EdinetXbrlParser} from '../src/index';
import {reportingInstance as xml} from './fixtures/financial-reporting-basis';
describe('DEIとcontextに基づく財務の基準・当期',()=>{
 it('日本基準・当期の主範囲・任意名のcontextを確定して出典を残す',()=>{
  const r=resolve(xml(),'A');expect(r).toMatchObject({status:'selected',metadata:{accountingStandard:'J-GAAP',scope:'Consolidated',edinetCode:'E12345',securityCode:'10010',periodType:'annual',period:{startDate:'2025-04-01',endDate:'2026-03-31'},instant:'2026-03-31',contexts:{duration:['arbitrary-duration'],instant:['arbitrary-instant'],blockedDuplicateContexts:[]}}});
  expect(r.inputXmlSha256).toBe(createHash('sha256').update(xml()).digest('hex'));expect(r.fields.accountingStandard).toMatchObject({status:'selected',raw:'Japan GAAP',source:{key:'d:AccountingStandardsDEI',contextRef:'filing'}});
 });
 it.each(['HY','Q1','Q2','Q3'])('%sを年度末へ延ばさず、累計期間として確定する',periodCode=>{
  const r=resolve(xml({periodCode,currentEnd:'2025-09-30',filing:'2025-11-10'}),'A');
  expect(r).toMatchObject({status:'selected',metadata:{reportingPeriodCode:periodCode,periodType:'ytd',period:{startDate:'2025-04-01',endDate:'2025-09-30'},fiscalYear:{endDate:'2026-03-31'}}});
 });
 it.each(['false','0','true','1'])('連結作成フラグ%sと実次元で主たる財務範囲を分ける',consolidated=>{
  expect(resolve(xml({consolidated}),'A')).toMatchObject({status:'selected',metadata:{scope:consolidated==='true'||consolidated==='1'?'Consolidated':'NonConsolidated',contexts:{duration:['arbitrary-duration']}}});
 });
 it('FYが12か月とは推測せず原日付を保持する',()=>{
  expect(resolve(xml({start:'2024-01-01'}),'A')).toMatchObject({status:'selected',metadata:{period:{startDate:'2024-01-01',endDate:'2026-03-31'}}});
 });
 it.each(['US GAAP','JMIS','J-GAAP','unknown'])('未対応基準%sを日本基準と推測しない',standard=>{
  expect(resolve(xml({standard}),'A')).toMatchObject({status:'unresolved',issues:expect.arrayContaining([{reason:'unsupported-standard',field:'accountingStandard'}])});
 });
 it.each(['AccountingStandardsDEI','EDINETCodeDEI','DocumentTypeDEI','WhetherConsolidatedFinancialStatementsArePreparedDEI','CurrentFiscalYearStartDateDEI','CurrentFiscalYearEndDateDEI','CurrentPeriodEndDateDEI','TypeOfCurrentPeriodDEI'])('%sの不在をタグやcontext名から補わない',omit=>{
  const r=resolve(xml({omit,durationId:'CurrentYearDuration'}),'A');expect(r.status).toBe('unresolved');
 });
 it('DEIの完全一致重複でも勝手に選ばない',()=>{
  expect(resolve(xml({duplicate:'AccountingStandardsDEI'}),'A')).toMatchObject({status:'unresolved',fields:{accountingStandard:{status:'ambiguous',reason:'multiple-facts'}}});
 });
 it('未知namespaceや提出者のDEI/entity不一致を採用しない',()=>{
  expect(resolve(xml({deiNamespace:'urn:unknown'}),'A').status).toBe('unresolved');
  expect(resolve(xml({entity:'E99999-000'}),'A')).toMatchObject({status:'unresolved',issues:expect.arrayContaining([{reason:'invalid-issuer'}])});
 });
 it('別の提出日contextにあるDEIを寄せ集めない',()=>{
  const raw=xml().replace('<d:AccountingStandardsDEI contextRef="filing">','<d:AccountingStandardsDEI contextRef="other">').replace('</xbrli:xbrl>','<xbrli:context id="other"><xbrli:entity><xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E12345-000</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-23</xbrli:instant></xbrli:period></xbrli:context></xbrli:xbrl>');
  expect(resolve(raw,'A')).toMatchObject({status:'unresolved',issues:expect.arrayContaining([{reason:'inconsistent-dei-context'}])});
 });
 it.each([{currentEnd:'2026-03-30'},{start:'2026-04-01'},{end:'2025-03-31'},{filing:'2026-03-30'},{periodCode:'HY',currentEnd:'2026-03-31'}])('期間の矛盾を採用しない %j',change=>{
  expect(resolve(xml(change),'A').status).toBe('unresolved');
 });
 it.each([{end:'2026-02-30'},{consolidated:'yes'},{periodCode:'FY2'},{form:'第二号様式'},{security:'1234'},{issuer:'Ebad'}])('未知値・不正値を採用しない %j',change=>{
  expect(resolve(xml(change),'A').status).toBe('unresolved');
 });
 it('証券コード不在/非上場でもDEIの基準・期間自体は保持する',()=>{
  const r=resolve(xml({security:null}),'A');expect(r.status).toBe('selected');expect(r.status==='selected'&&r.metadata.securityCode).toBeUndefined();expect(r.fields.securityCode).toMatchObject({status:'missing',reason:'nil'});
 });
 it('実際の期間が合わなければcontext名が一致しても採用候補にしない',()=>{
  expect(resolve(xml({durationId:'CurrentYearDuration',durationStart:'2024-04-01'}),'A')).toMatchObject({status:'selected',metadata:{contexts:{duration:[]}}});
 });
 it('重複した財務contextを正常候補へ戻さず理由を保持する',()=>{
  expect(resolve(xml({duplicateDuration:true}),'A')).toMatchObject({status:'selected',metadata:{contexts:{duration:[],blockedDuplicateContexts:[{contextRef:'arbitrary-duration',periodKind:'duration'}]}}});
 });
 it('object経由ではraw hashを作らず、返値変更を内部へ戻さない',()=>{
  const object=new EdinetXbrlParser().parse(xml(),'A'),a=object.selectFinancialReportingBasis();expect(a.inputXmlSha256).toBeUndefined();if(a.status==='selected')a.metadata.period.endDate='2020-01-01';expect(object.selectFinancialReportingBasis()).toMatchObject({metadata:{period:{endDate:'2026-03-31'}}});
 });
});
describe('自動判定から既存snapshotへの接続',()=>{
 it.each(['Japan GAAP','IFRS'])('%sのBS/当期明細を既存入口と同じ契約で作る',standard=>{
  const r=auto(xml({standard}),{docID:'A'});expect(r).toMatchObject({status:'resolved',targetCurrency:'JPY',balanceSheet:{status:'created'},details:{status:'created'}});
  if(r.status!=='resolved'||r.details.status!=='created')throw Error();
  expect(Object.keys(r.details.snapshot.selections)).toHaveLength(standard==='IFRS'?5:2);expect(r.details.snapshot.selections.costOfSales).toMatchObject({status:'selected',raw:'10'});
 });
 it('単体FYと四半期累計を連結や単四半期へ読み替えない',()=>{
  const r=auto(xml({consolidated:'false',periodCode:'Q2',currentEnd:'2025-09-30',filing:'2025-11-10'}),{docID:'A'});
  expect(r).toMatchObject({status:'resolved',accountingStandard:'J-GAAP',details:{snapshot:{metadata:{scope:'NonConsolidated',periodType:'ytd',period:{endDate:'2025-09-30'}}}}});
 });
 it('基準未確定・証券コード不在・IFRS単体は推測ルートへ入れない',()=>{
  expect(auto(xml({standard:'US GAAP'}),{docID:'A'})).toMatchObject({status:'unresolved',reason:'basis-unresolved'});
  expect(auto(xml({security:null}),{docID:'A'})).toMatchObject({status:'unresolved',reason:'security-code-unavailable'});
  expect(auto(xml({standard:'IFRS',consolidated:'false'}),{docID:'A'})).toMatchObject({status:'unresolved',reason:'unsupported-ifrs-scope'});
 });
 it('期間contextの不在と重複を区別し、もう一方のsnapshotは作れる',()=>{
  expect(auto(xml({noDuration:true}),{docID:'A'})).toMatchObject({status:'resolved',balanceSheet:{status:'created'},details:{status:'unavailable',reason:'current-period-context-absent'}});
  expect(auto(xml({duplicateDuration:true}),{docID:'A'})).toMatchObject({details:{status:'unavailable',reason:'duplicate-current-period-context'}});
  expect(auto(xml({noInstant:true}),{docID:'A'})).toMatchObject({balanceSheet:{status:'unavailable'},details:{status:'created'}});
 });
 it('JPYは抽出対象単位であり、USDを円へ換算しない',()=>{
  const r=auto(xml({standard:'IFRS',currency:'USD'}),{docID:'A'});expect(r).toMatchObject({status:'resolved',targetCurrency:'JPY'});if(r.status!=='resolved'||r.details.status!=='created')throw Error();
  expect(r.details.snapshot.selections.costOfSales).toMatchObject({status:'unsupported',reason:'unsupported-unit'});
 });
 it('期間型・基準にない投影や疎配列、未知設定を拒否する',()=>{
  for(const options of [{detailMetricIds:['noncurrentAssets']},{detailMetricIds:['incomeTaxExpense']},{detailMetricIds:['bad']},{detailMetricIds:Array(1)},{detailMetricIds:[]},{extra:true}])expect(()=>auto(xml(),{docID:'A',...options}as never)).toThrow();
 });
 it('BOMと入力hashを保持する',()=>{
  const text='\ufeff'+xml(),r=auto(text,{docID:'A'});expect(r.inputXmlSha256).toBe(createHash('sha256').update(text).digest('hex'));expect(r.basis.inputXmlSha256).toBe(r.inputXmlSha256);
 });
});
it('長すぎるDEI値の除外理由を候補にも残す',()=>{
 const r=resolve(xml({standard:'X'.repeat(2049)}),'A');expect(r.fields.accountingStandard).toMatchObject({status:'unsupported',reason:'invalid-field-value',evidence:[{reason:'invalid-field-value'}]});
});
it('半期の第五号様式と未上場の証券コードなしを保持する',()=>{
 expect(resolve(xml({periodCode:'HY',form:'第五号様式',currentEnd:'2025-09-30',filing:'2025-11-10',security:null}),'A')).toMatchObject({status:'selected',metadata:{documentType:'第五号様式',periodType:'ytd'}});
});
it('対象範囲と異なる業種コードを代用しない',()=>{
 const text=xml({extra:'<d:IndustryCodeWhenFinancialStatementsArePreparedInAccordanceWithIndustrySpecificRegulationsDEI contextRef="filing">CTE</d:IndustryCodeWhenFinancialStatementsArePreparedInAccordanceWithIndustrySpecificRegulationsDEI>'});
 const r=resolve(text,'A');expect(r.status).toBe('selected');expect(r.status==='selected'&&r.metadata.industryCode).toBeUndefined();
});
it('不正書類IDはXML解析より前に拒否する',()=>{
 expect(()=>resolve('<invalid>','')).toThrow('書類ID');
});
it('DEIのinstantをそのまま保持し、実際の提出日時や観測日時とは呼び替えない',()=>{
 const text=xml().replaceAll('id="filing"','id="arbitrary-dei-instant"').replaceAll('contextRef="filing"','contextRef="arbitrary-dei-instant"'),r=resolve(text,'A');
 expect(r).toMatchObject({status:'selected',metadata:{deiContextInstant:'2026-06-24'}});expect(r.status==='selected'&&'filingDate'in r.metadata).toBe(false);
});
it('重複したDEI contextから提出者・基準を確定しない',()=>{
 const input=xml(),cover=input.match(/<xbrli:context id="filing">[\s\S]*?<\/xbrli:context>/)![0];
 expect(resolve(input.replace('</xbrli:xbrl>',cover+'</xbrli:xbrl>'),'A')).toMatchObject({status:'unresolved',fields:{edinetCode:{status:'ambiguous',reason:'duplicate-context'}}});
});
it('複数entityの文書を主提出者の推測で通さない',()=>{
 const extra='<xbrli:context id="another-entity"><xbrli:entity><xbrli:identifier scheme="http://disclosure.edinet-fsa.go.jp">E99999-000</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-03-31</xbrli:instant></xbrli:period></xbrli:context>';
 expect(resolve(xml({extra}),'A')).toMatchObject({status:'unresolved',fields:{edinetCode:{status:'unsupported',reason:'unsupported-entity'}}});
});
it.each(['Japan GAAP','IFRS'])('年をまたぐ%sの単四半期も実contextから確認する',standard=>{
 const r=resolve(xml({standard,consolidated:'false',periodCode:'Q3',start:'2024-08-01',end:'2025-07-31',currentEnd:'2025-04-30',quarterStart:'2025-02-01'}),'A');
 expect(r).toMatchObject({status:'selected',metadata:{quarterPeriod:{startDate:'2025-02-01',endDate:'2025-04-30'},period:{startDate:'2024-08-01',endDate:'2025-04-30'},contexts:{duration:['arbitrary-duration']}}});
});
it('暦月計算で日付が繰り上がる変則開始日を単四半期として推測しない',()=>{
 const r=resolve(xml({periodCode:'Q2',start:'2025-01-31',end:'2026-01-30',currentEnd:'2025-07-30',quarterStart:'2025-05-01'}),'A');
 expect(r.status).toBe('selected');expect(r.status==='selected'&&r.metadata.quarterPeriod).toBeUndefined();
});
