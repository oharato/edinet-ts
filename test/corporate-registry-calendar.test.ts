import {it,expect} from 'vitest';import {createHash} from 'node:crypto';
import {parseCorporateRegistryPublicationCalendar as parse} from '../src/corporate-registry-calendar';
import {reconstructCorporateRegistryState as state,type CorporateRegistryDelivery} from '../src/corporate-registry';
import {registryCalendarFixture} from './fixtures/corporate-registry-calendar';
const query=(asOf:string)=>({corporateNumber:'1010001001202',asOf,knownAt:'2026-10-30T00:00:00Z',registryPurpose:'sample' as const});
const full=(day:string):CorporateRegistryDelivery=>({scope:'national',expectedParts:1,parts:[{xml:'<corporations/>',source:{sourceUrl:'https://example.test/full.xml',observedAt:'2026-10-29T00:00:00Z',dataDate:day,kind:'full',purpose:'sample'}}]});
const diff=(day:string):CorporateRegistryDelivery=>({...full(day),parts:full(day).parts.map(p=>({...p,source:{...p.source,kind:'diff'}}))});
it('公式方針とCSVの復号後hash・年範囲・祝日名を保持する',()=>{
 const input=registryCalendarFixture(),r=parse(input);expect(r).toMatchObject({rulesVersion:'nta-diff-no-publication-1',observedAt:'2026-10-30T00:00:00.000Z',firstYear:2017,lastYear:2027});expect(r.holidays).toContainEqual({date:'2019-05-01',name:'天皇の即位の日'});expect(r.sources.holidays.inputTextSha256).toBe(createHash('sha256').update(input.holidays.csv).digest('hex'));r.sources.policy.observedAt='changed';expect(input.policy.observedAt).toBe('2026-10-30T00:00:00Z');
});
it('週末を確認してから月曜差分を適用し、カレンダーなしの従来挙動も保つ',()=>{
 const docs=[full('2026-10-23'),diff('2026-10-26')];expect(state(docs,query('2026-10-26')).selection).toMatchObject({status:'unresolved',reason:'coverage-gap'});
 const r=state(docs,query('2026-10-26'),registryCalendarFixture());expect(r.selection).toEqual({status:'unavailable',reason:'not-in-baseline'});expect(r.coverage?.through).toBe('2026-10-26');expect(r.nonPublicationDays).toEqual([{date:'2026-10-24',reason:'weekend'},{date:'2026-10-25',reason:'weekend'}]);expect(r.appliedDeliveries).toEqual([0,1]);
});
it('振替休日・国民の休日をCSVで確認して飛ばす',()=>{
 const r=state([full('2026-09-18'),diff('2026-09-24')],query('2026-09-24'),registryCalendarFixture());expect(r.selection.status).toBe('unavailable');expect(r.nonPublicationDays?.map(d=>d.date)).toEqual(['2026-09-19','2026-09-20','2026-09-21','2026-09-22','2026-09-23']);expect(r.nonPublicationDays?.find(d=>d.date==='2026-09-22')).toEqual({date:'2026-09-22',reason:'holiday',holidayName:'休日'});
});
it('即位に伴う休日と年末年始を別の会社変更として捏造しない',()=>{
 const r=state([full('2019-04-26')],query('2019-05-02'),registryCalendarFixture());expect(r.selection.status).toBe('unavailable');expect(r.coverage?.through).toBe('2019-05-02');expect(r.nonPublicationDays?.find(d=>d.date==='2019-05-01')?.holidayName).toBe('天皇の即位の日');
 const end=state([full('2025-12-28')],query('2026-01-03'),registryCalendarFixture());expect(end.selection.status).toBe('unavailable');expect(end.nonPublicationDays).toHaveLength(6);expect(end.nonPublicationDays?.every(d=>d.reason==='year-end')).toBe(true);
});
it('五輪の特例で移動した祝日を固定日アルゴリズムへ戻さない',()=>{
 const moved=state([full('2020-07-22')],query('2020-07-26'),registryCalendarFixture());expect(moved.selection.status).toBe('unavailable');expect(moved.nonPublicationDays?.slice(0,2).map(d=>d.holidayName)).toEqual(['海の日','スポーツの日']);
 const ordinary=state([full('2020-07-19')],query('2020-07-20'),registryCalendarFixture());expect(ordinary.selection).toMatchObject({status:'unresolved',reason:'coverage-gap',gap:{from:'2020-07-20'}});
});
it('通常営業日の欠落を休日へ置換せず、予定休業日の実配布との矛盾も止める',()=>{
 const missing=state([full('2026-10-22'),diff('2026-10-26')],query('2026-10-26'),registryCalendarFixture());expect(missing.selection).toMatchObject({status:'unresolved',reason:'coverage-gap',gap:{from:'2026-10-23'}});
 expect(state([full('2026-10-23'),diff('2026-10-24')],query('2026-10-24'),registryCalendarFixture()).selection).toMatchObject({status:'unresolved',reason:'delivery-on-non-publication-day'});
});
it('カレンダーの未来観測・範囲外・未来asOfを現在の空白補完に使わない',()=>{
 const calendar=registryCalendarFixture();calendar.holidays.observedAt='2026-10-31T00:00:00Z';expect(state([full('2026-10-23')],query('2026-10-25'),calendar).selection).toMatchObject({status:'unresolved',reason:'calendar-after-cutoff'});
 expect(state([full('2026-10-23')],query('2028-01-01'),registryCalendarFixture()).selection).toMatchObject({status:'unresolved',reason:'calendar-outside-coverage'});
 expect(state([full('2026-10-29')],query('2026-10-31'),registryCalendarFixture()).selection).toMatchObject({status:'unresolved',reason:'as-of-after-cutoff'});
});
it.each(['wrong-url','bad-date','duplicate','order','header','year-hole','policy-change','policy-in-comment','extra','boxed'])('%sの不正カレンダーを拒否する',kind=>{
 const v:any=registryCalendarFixture();if(kind==='wrong-url')v.policy.sourceUrl='https://example.test/policy';if(kind==='bad-date')v.holidays.csv+='2027/2/30,誤日付\r\n';if(kind==='duplicate')v.holidays.csv+='2027/1/1,元日\r\n';if(kind==='order')v.holidays.csv+='2018/1/2,順序違反\r\n';if(kind==='header')v.holidays.csv=v.holidays.csv.replace('休日名称','別ヘッダー');if(kind==='year-hole')v.holidays.csv=v.holidays.csv.replace('2018/1/1,元日\r\n','');if(kind==='policy-change')v.policy.html='休止日が変更されました';if(kind==='policy-in-comment')v.policy.html='<!--'+v.policy.html+'-->';if(kind==='extra')v.surprise=true;if(kind==='boxed')v.holidays.csv=new String(v.holidays.csv);expect(()=>parse(v)).toThrow();
});
it('入力getterを一度固定し、再読で祝日や観測時刻を差し替えない',()=>{
 const input=registryCalendarFixture(),csv=input.holidays.csv;let reads=0;Object.defineProperty(input.holidays,'csv',{enumerable:true,get(){reads++;if(reads>1)throw Error('changed');return csv}});expect(parse(input).lastYear).toBe(2027);expect(reads).toBe(1);
});
