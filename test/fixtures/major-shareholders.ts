import {createHash} from 'node:crypto';
import {DisclosureTableKind,type MajorShareholderDocument} from '../../src/index';
export const majorTable = '<table><tr><td colspan="4">2026年３月31日現在</td></tr><tr><td>氏名又は名称</td><td>住所</td><td>所有株式数(千株)</td><td>発行済株式(自己株式を除く。)の総数に対する所有株式数の割合(％)</td></tr><tr><td>甲信託銀行（信託口）</td><td>架空市本町</td><td>1,000</td><td>16.90</td></tr><tr><td>甲信託銀行（別口）</td><td>架空市本町</td><td>200</td><td>3.38</td></tr><tr><td colspan="2">計</td><td>1,200</td><td>20.28</td></tr></table>';
export const referenceNote = '<p>１．2026年５月12日付で公衆の縦覧に供されている大量保有報告書（変更報告書）において、甲信託銀行が2026年４月30日現在で以下の株式を所有している旨が記載されているものの、当社として2026年３月31日現在における実質所有株式数の確認ができないため、上記大株主の状況には含めておりません。</p>';
export const referenceTable = '<table><tr><td>氏名又は名称</td><td>住所</td><td>保有株券等の数(千株)</td><td>株券等保有割合(％)</td></tr><tr><td>甲信託銀行</td><td>架空市本町</td><td>1,300</td><td>21.00</td></tr><tr><td>共同保有者</td><td>架空市南町</td><td>0</td><td>0.00</td></tr><tr><td colspan="2">合計</td><td>1,300</td><td>21.00</td></tr></table>';
export function majorDocument(options:{raw?:string;docID?:string;entity?:string;instant?:string;tables?:MajorShareholderDocument['tables'];namespace?:string;contextPeriod?:string}={}):MajorShareholderDocument{
 const {raw=majorTable+referenceNote+referenceTable,docID='MAJOR-A',entity=docID,instant='2026-06-24',namespace='http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor',contextPeriod=`<xbrli:instant>${instant}</xbrli:instant>`}=options;
 const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;');
 const xml=`<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:j="${namespace}"><xbrli:context id="filing"><xbrli:entity><xbrli:identifier scheme="fixture">${entity}</xbrli:identifier></xbrli:entity><xbrli:period>${contextPeriod}</xbrli:period></xbrli:context><j:MajorShareholdersTextBlock contextRef="filing">${escape(raw)}</j:MajorShareholdersTextBlock></xbrli:xbrl>`;
 return {xml,selection:{docID,kind:DisclosureTableKind.MajorShareholders,contextRef:'filing'},tables:options.tables??[0,1].map(tableIndex=>({tableIndex,rawSha256:createHash('sha256').update(raw).digest('hex')}))};
}
