import type {CorporateRegistryPublicationCalendarInput} from '../../src/corporate-registry-calendar';
export function registryCalendarFixture():CorporateRegistryPublicationCalendarInput {
 const dates=new Map<string,string>();for(let y=2017;y<=2027;y++)dates.set(y+'/1/1','元日');
 for(const [date,name] of [['2017/5/3','憲法記念日'],['2017/5/4','みどりの日'],['2017/5/5','こどもの日'],['2019/4/29','昭和の日'],['2019/4/30','休日'],['2019/5/1','天皇の即位の日'],['2019/5/2','休日'],['2020/7/23','海の日'],['2020/7/24','スポーツの日'],['2021/7/22','海の日'],['2021/7/23','スポーツの日'],['2021/8/9','休日'],['2026/9/21','敬老の日'],['2026/9/22','休日'],['2026/9/23','秋分の日']])dates.set(date,name);
 const sorted=[...dates].sort(([a],[b])=>Date.parse(a)-Date.parse(b));
 return {policy:{html:'<p>休日・祝日と12月29日から１月３日は、差分ダウンロードファイルの作成を行いません。</p>',sourceUrl:'https://www.houjin-bangou.nta.go.jp/download/sabun/',observedAt:'2026-10-30T00:00:00Z'},holidays:{csv:'国民の祝日・休日月日,国民の祝日・休日名称\r\n'+sorted.map(([d,n])=>d+','+n).join('\r\n')+'\r\n',sourceUrl:'https://www8.cao.go.jp/chosei/shukujitsu/syukujitsu.csv',observedAt:'2026-10-29T23:00:00Z'}};
}
