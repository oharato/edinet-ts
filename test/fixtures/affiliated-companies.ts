import {createHash} from 'node:crypto';
import {DisclosureTableKind,type AffiliatedCompanyDocument} from '../../src/index';
export const affiliatedHeader=(mode='所有(又は被所有)')=>`<tr><td rowspan="2">会社の名称</td><td rowspan="2">住所</td><td rowspan="2">資本金（百万円）</td><td rowspan="2">主要な事業の内容</td><td rowspan="2">議決権の${mode}割合（％）</td><td colspan="2">関係内容</td></tr><tr><td>役員の兼任（名）</td><td>資金援助</td></tr>`;
export const affiliatedRow=(name='架空子会社（注）１',capital='1,000',voting='100.0\n（40.0）')=>`<tr><td>${name}</td><td>架空県 架空市</td><td>${capital}</td><td>通信事業</td><td>${voting}</td><td>有</td><td>－</td></tr>`;
export const affiliatedSection=(name='連結子会社')=>`<tr><td colspan="7">（${name}）</td></tr>`;
export const affiliatedTable=(body=affiliatedSection()+affiliatedRow(),mode='所有(又は被所有)')=>'<table>'+affiliatedHeader(mode)+body+'</table>';
export function affiliatedDocument(docID='A',options:{tables?:string;selection?:AffiliatedCompanyDocument['tables'];definition?:boolean;entity?:string;fiscalEnd?:string;standard?:string;date?:string;notes?:string}={}):AffiliatedCompanyDocument{
 const {tables=affiliatedTable(),entity=docID,fiscalEnd='2026-03-31',standard='Japan GAAP',date='2026-06-24',notes='<p>議決権の（内数）は間接所有割合です。</p>'}=options;
 const raw=notes+tables,escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
 const xml=`<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:j="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor" xmlns:d="http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2025-11-01/jpdei_cor"><xbrli:context id="filing"><xbrli:entity><xbrli:identifier scheme="fixture">${entity}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period></xbrli:context><d:CurrentFiscalYearEndDateDEI contextRef="filing">${fiscalEnd}</d:CurrentFiscalYearEndDateDEI><d:AccountingStandardsDEI contextRef="filing">${standard}</d:AccountingStandardsDEI><j:OverviewOfAffiliatedEntitiesTextBlock contextRef="filing">${escape(raw)}</j:OverviewOfAffiliatedEntitiesTextBlock></xbrli:xbrl>`;
 return {xml,selection:{docID,kind:DisclosureTableKind.AffiliatedEntities,contextRef:'filing'},reportingPeriodEnd:fiscalEnd,accountingStandard:'J-GAAP',proof:{rawSha256:createHash('sha256').update(raw).digest('hex'),indirectIncluded:options.definition??true},tables:options.selection??[{tableIndex:0}]};
}
