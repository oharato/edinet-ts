import {createHash} from 'node:crypto';
import {majorDocument} from './major-shareholders';
import type {PolicyShareholdingDocument} from '../../src/index';
export const policySummary='<p>純投資目的以外の目的の株式 銘柄数及び貸借対照表計上額</p><table><tr><td></td><td>銘柄数(銘柄)</td><td>貸借対照表計上額の合計額(百万円)</td></tr><tr><td>非上場株式</td><td>2</td><td>0</td></tr><tr><td>非上場株式以外の株式</td><td>3</td><td>15</td></tr></table>';
export const policyTable='<table><tr><td rowspan="3">銘柄</td><td>当事業年度</td><td>前事業年度</td><td rowspan="3">保有目的、業務提携等の概要、定量的な保有効果及び株式数が増加した理由</td><td rowspan="3">当社の株式の保有の有無</td></tr><tr><td>株式数(株)</td><td>株式数(株)</td></tr><tr><td>貸借対照表計上額(百万円)</td><td>貸借対照表計上額(百万円)</td></tr><tr><td rowspan="2">架空電機（注１）</td><td>1,000</td><td>500</td><td rowspan="2">取引関係維持。株式分割による増加。</td><td rowspan="2">無（子会社は有）</td></tr><tr><td>10</td><td>8</td></tr><tr><td rowspan="2">架空銀行</td><td>－</td><td>100</td><td rowspan="2">退職給付信託</td><td rowspan="2">有</td></tr><tr><td>－</td><td>0</td></tr></table>';
export function policyDocument(options:{raw?:string;docID?:string;entity?:string;instant?:string}={}):PolicyShareholdingDocument{
 const raw=options.raw??policySummary+'<p>特定投資株式</p>'+policyTable+'<p>みなし保有株式</p>'+policyTable;
 const d=majorDocument({...options,raw});const xml=d.xml.replaceAll('MajorShareholdersTextBlock','ShareholdingsTextBlock');
 return {xml,selection:{...d.selection,kind:'policyShareholdings'},periodEnds:{current:'2026-03-31',previous:'2025-03-31'},tables:[{tableIndex:0,kind:'non-pure-summary',rawSha256:createHash('sha256').update(raw).digest('hex')},{tableIndex:1,kind:'specified',headingTableIndex:1,rawSha256:createHash('sha256').update(raw).digest('hex')},{tableIndex:2,kind:'deemed',headingTableIndex:2,rawSha256:createHash('sha256').update(raw).digest('hex')}]};
}
