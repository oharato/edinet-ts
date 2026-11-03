import { createHash } from 'node:crypto';
import { DisclosureTableKind, type SegmentDetailDocument, type SegmentPeriod } from '../../src/index';
export const currentSegmentPeriod: SegmentPeriod = {startDate:'2025-04-01',endDate:'2026-03-31'};
export const previousSegmentPeriod: SegmentPeriod = {startDate:'2024-04-01',endDate:'2025-03-31'};
export function segmentRows(values: string[][] = [['100','200','300','－','300'],['5','6','11','△11','－'],['105','206','311','△11','300'],['10','20','35,081','△813','34,267'],['1000','2000','3000','△500','2500'],['1','2','3','－','3'],['3','4','7','－','7']]): string[][] {
 return [['売上高',...Array(values[0].length).fill('')],['外部顧客への売上高',...values[0]],['セグメント間の内部売上高又は振替高',...values[1]],['計',...values[2]],['セグメント利益',...values[3]],['セグメント資産',...values[4]],['その他の項目',...Array(values[0].length).fill('')],['減価償却費',...values[5]],['有形固定資産及び無形固定資産の増加額',...values[6]]];
}
const renderRows=(rows:string[][])=>rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('');
export function combinedSegmentTable(rows=segmentRows()):string {
 return '<table><tbody><tr><td colspan="6">（単位：百万円）</td></tr><tr><td rowspan="2"></td><td colspan="2">報告セグメント</td><td rowspan="2">合計</td><td rowspan="2">調整額</td><td rowspan="2">連結財務諸表計上額</td></tr><tr><td>通信</td><td>設備</td></tr>'+renderRows(rows)+'</tbody></table>';
}
export function splitSegmentTables(rows=segmentRows()):string {
 const left=rows.map(row=>row.slice(0,3)),right=rows.map(row=>[row[0],...row.slice(3)]);
 return '<table><tbody><tr><td colspan="3">（単位：百万円）</td></tr><tr><td rowspan="2"></td><td colspan="2">報告セグメント</td></tr><tr><td>通信</td><td>設備</td></tr>'+renderRows(left)+'</tbody></table>'+ '<table><tbody><tr><td></td><td>合計</td><td>調整額（注）１</td><td>連結財務諸表計上額（注）２</td></tr>'+renderRows(right)+'</tbody></table>';
}
export function segmentDocument(docID='A',options:{tables?:string;indexes?:number[];period?:SegmentPeriod;contextPeriod?:string;dimensions?:string;namespace?:string;entity?:string}={}):SegmentDetailDocument{
 const {tables=combinedSegmentTable(),indexes=[0],period=currentSegmentPeriod,contextPeriod='<xbrli:startDate>2025-04-01</xbrli:startDate><xbrli:endDate>2026-03-31</xbrli:endDate>',dimensions='',entity=docID,namespace='http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor'}=options;
 const raw='<p>前連結会計年度 自2024年4月1日 至2025年3月31日 当連結会計年度 自2025年4月1日 至2026年3月31日</p>'+tables;
 const escaped=raw.replaceAll('&','&amp;').replaceAll('<','&lt;');
 return {xml:`<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:j="${namespace}" xmlns:p="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2025-11-01/jppfs_cor"><xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="fixture">${entity}</xbrli:identifier></xbrli:entity><xbrli:period>${contextPeriod}</xbrli:period>${dimensions?'<xbrli:scenario>'+dimensions+'</xbrli:scenario>':''}</xbrli:context><j:NotesSegmentInformationEtcConsolidatedFinancialStatementsTextBlock contextRef="current">${escaped}</j:NotesSegmentInformationEtcConsolidatedFinancialStatementsTextBlock></xbrli:xbrl>`,
 selection:{docID,kind:DisclosureTableKind.Segments,contextRef:'current'},accountingStandard:'J-GAAP',declarations:[{period,tableIndexes:indexes,rawSha256:createHash('sha256').update(raw).digest('hex')}]};
}
