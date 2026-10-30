import {createHash} from 'node:crypto';
import {parseDocumentTimestamp} from './document-timestamp';
export interface CorporateRegistryCalendarSource {sourceUrl:string;observedAt:string;}
export interface CorporateRegistryPublicationCalendarInput {
    policy:CorporateRegistryCalendarSource&{html:string};
    /** 内閣府の原CSVを呼出元でShift_JISから復号します。 */
    holidays:CorporateRegistryCalendarSource&{csv:string};
}
export interface CorporateRegistryPublicationCalendar {
    rulesVersion:'nta-diff-no-publication-1';observedAt:string;firstYear:number;lastYear:number;
    sources:{policy:CorporateRegistryCalendarSource&{inputTextSha256:string};holidays:CorporateRegistryCalendarSource&{inputTextSha256:string}};
    holidays:{date:string;name:string}[];
}
const object=(v:unknown):v is Record<string,unknown>=>!!v&&typeof v==='object'&&!Array.isArray(v);
const validDate=(v:string)=>/^\d{4}-\d{2}-\d{2}$/.test(v)&&parseDocumentTimestamp(v+'T00:00:00Z',true)!==undefined;
function invalid():never{throw Error('国税庁の未作成日方針と内閣府祝日CSVの保存入力を確認してください');}
/** 保存した公式方針とCSVを検査。取得・外部認証・祝日の推測計算は行いません。 */
export function parseCorporateRegistryPublicationCalendar(input:CorporateRegistryPublicationCalendarInput):CorporateRegistryPublicationCalendar {
    const data=structuredClone(input);
    if(!object(data)||Object.keys(data).some(k=>!['policy','holidays'].includes(k)))invalid();
    const capture=(v:unknown,key:'html'|'csv',url:string)=>{
        if(!object(v)||Object.keys(v).some(k=>![key,'sourceUrl','observedAt'].includes(k))||v.sourceUrl!==url||typeof v.observedAt!=='string'||parseDocumentTimestamp(v.observedAt,true)===undefined||typeof v[key]!=='string')invalid();
        const text=v[key] as string;if(Buffer.byteLength(text)>1024*1024)invalid();
        return {text,source:{sourceUrl:url,observedAt:v.observedAt,inputTextSha256:createHash('sha256').update(text).digest('hex')}};
    };
    const policy=capture(data.policy,'html','https://www.houjin-bangou.nta.go.jp/download/sabun/'),csv=capture(data.holidays,'csv','https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv');
    const text=policy.text.replace(/<!--[\s\S]*?-->/g,'').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi,'').replace(/<[^>]*>/g,'').normalize('NFKC').replace(/\s/g,'');
    if(!text.includes('休日・祝日と12月29日から1月3日は、差分ダウンロードファイルの作成を行いません。'))invalid();
    const lines=csv.text.replace(/^\uFEFF/,'').replace(/\r\n/g,'\n').split('\n');if(lines.at(-1)==='')lines.pop();
    if(lines.shift()!=='国民の祝日・休日月日,国民の祝日・休日名称'||!lines.length||lines.length>10000)invalid();
    let previous='';const holidays=lines.map(line=>{
        const match=/^(\d{4})\/(\d{1,2})\/(\d{1,2}),([^,\r\n\x00-\x1f\x7f]+)$/.exec(line);if(!match)invalid();
        const date=match[1]+'-'+match[2].padStart(2,'0')+'-'+match[3].padStart(2,'0'),name=match[4];
        if(!validDate(date)||date<=previous||name!==name.trim()||name.length>100)invalid();previous=date;return {date,name};
    });
    const firstYear=Number(holidays[0].date.slice(0,4)),lastYear=Number(holidays.at(-1)!.date.slice(0,4)),days=new Set(holidays.map(h=>h.date));
    if(firstYear<1955)invalid();
    for(let year=firstYear;year<=lastYear;year++)if(!days.has(String(year)+'-01-01'))invalid();
    return {rulesVersion:'nta-diff-no-publication-1',observedAt:new Date(Math.max(parseDocumentTimestamp(policy.source.observedAt,true)!,parseDocumentTimestamp(csv.source.observedAt,true)!)).toISOString(),firstYear,lastYear,sources:{policy:policy.source,holidays:csv.source},holidays};
}


export interface CorporateRegistryNonPublicationDay {date:string;reason:'year-end'|'weekend'|'holiday';holidayName?:string;}
export interface CorporateRegistryDifferencePlanQuery {from:string;through:string;knownAt:string;}
export interface CorporateRegistryDifferencePlan {
    query:CorporateRegistryDifferencePlanQuery;
    calendar:Omit<CorporateRegistryPublicationCalendar,'holidays'>;
    expectedDates:string[];
    nonPublicationDays:CorporateRegistryNonPublicationDay[];
}
/** 内部用。再構成と取得計画で同じ未作成日判定を使います。 */
export function registryNonPublicationDay(day:string,holidays:ReadonlyMap<string,string>):CorporateRegistryNonPublicationDay|undefined {
    const monthDay=day.slice(5),weekday=new Date(day+'T00:00:00Z').getUTCDay();
    if(monthDay>='12-29'||monthDay<='01-03')return {date:day,reason:'year-end'};
    if(weekday===0||weekday===6)return {date:day,reason:'weekend'};
    const name=holidays.get(day);return name?{date:day,reason:'holiday',holidayName:name}:undefined;
}
/** 保存した公式カレンダーで、最大100日を取得予定日と未作成日に分けます。通信は行いません。 */
export function planCorporateRegistryDifferences(input:CorporateRegistryPublicationCalendarInput,query:CorporateRegistryDifferencePlanQuery):CorporateRegistryDifferencePlan {
    const q=structuredClone(query);
    if(!object(q)||Object.keys(q).some(k=>!['from','through','knownAt'].includes(k))||typeof q.from!=='string'||typeof q.through!=='string'||!validDate(q.from)||!validDate(q.through)||q.from>q.through||parseDocumentTimestamp(q.knownAt,true)===undefined)invalid();
    const from=Date.parse(q.from+'T00:00:00Z'),through=Date.parse(q.through+'T00:00:00Z'),cutoff=parseDocumentTimestamp(q.knownAt,true)!;
    if((through-from)/86400000>=100)invalid();
    const calendar=parseCorporateRegistryPublicationCalendar(input),{holidays,...metadata}=calendar;
    if(parseDocumentTimestamp(calendar.observedAt,true)!>cutoff||Number(q.from.slice(0,4))<calendar.firstYear||Number(q.through.slice(0,4))>calendar.lastYear||q.through>new Date(cutoff+9*3600000).toISOString().slice(0,10))invalid();
    const expectedDates:string[]=[],nonPublicationDays:CorporateRegistryNonPublicationDay[]=[],dates=new Map(holidays.map(h=>[h.date,h.name]));
    for(let day=from;day<=through;day+=86400000){const date=new Date(day).toISOString().slice(0,10),closed=registryNonPublicationDay(date,dates);if(closed)nonPublicationDays.push(closed);else expectedDates.push(date);}
    return {query:q,calendar:metadata,expectedDates,nonPublicationDays};
}
