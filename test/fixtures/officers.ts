import {createHash} from 'node:crypto';
import {majorDocument} from './major-shareholders';
import type {OfficerDocument} from '../../src/index';
export const officerCurrent='<p>2026年６月24日（有価証券報告書提出日）現在の当社の役員の状況は、以下のとおりです。</p>';
export const officerProposed='<p>2026年６月26日開催予定の定時株主総会の当該議案が承認可決されると、以下のとおりとなる予定です。</p>';
export const officerTable='<table><tr><td>役職名</td><td>氏名</td><td>生年月日</td><td>略歴</td><td>任期</td><td>所有株式数(百株)</td></tr><tr><td>代表取締役社長</td><td>架空　太郎</td><td>1960年１月１日生</td><td><table><tr><td>1983年４月</td><td>架空会社入社</td></tr><tr><td>2026年６月</td><td>当社取締役</td></tr></table></td><td>（注）２</td><td>12</td></tr><tr><td>取締役</td><td>架空　花子（旧姓：別姓）</td><td>1970年２月３日</td><td>弁護士登録</td><td>（注）３</td><td>－</td></tr><tr><td colspan="5">計</td><td>12</td></tr></table>';
export function officerDocument(options:{raw?:string;docID?:string;entity?:string;instant?:string}={}):OfficerDocument{
 const raw=options.raw??officerCurrent+officerTable+officerProposed+officerTable;
 const d=majorDocument({...options,raw}),hash=createHash('sha256').update(raw).digest('hex');
 return {xml:d.xml.replaceAll('MajorShareholdersTextBlock','InformationAboutOfficersTextBlock'),selection:{...d.selection,kind:'officers'},tables:[{tableIndex:0,rawSha256:hash,status:'as-filed',evidenceTableIndex:0},{tableIndex:1,rawSha256:hash,status:'proposed',evidenceTableIndex:1}]};
}
