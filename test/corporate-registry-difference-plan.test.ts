import {expect,it} from 'vitest';
import {planCorporateRegistryDifferences as plan} from '../src/corporate-registry-calendar';
import {registryCalendarFixture} from './fixtures/corporate-registry-calendar';
const query={from:'2026-09-18',through:'2026-09-24',knownAt:'2026-10-30T01:00:00Z'};

it('全日を取得予定日と根拠付き未作成日に分ける',()=>{
 const result=plan(registryCalendarFixture(),query);
 expect(result.expectedDates).toEqual(['2026-09-18','2026-09-24']);
 expect(result.nonPublicationDays.map(d=>d.date)).toEqual(['2026-09-19','2026-09-20','2026-09-21','2026-09-22','2026-09-23']);
 expect(result.nonPublicationDays[3]).toEqual({date:'2026-09-22',reason:'holiday',holidayName:'休日'});
 expect(result.calendar.sources.holidays.inputTextSha256).toMatch(/^[a-f0-9]{64}$/);
 expect(result.calendar).not.toHaveProperty('holidays');expect(result.query).toEqual(query);
});
it('年末年始・五輪特例・即位の休日を保存CSVから判定する',()=>{
 expect(plan(registryCalendarFixture(),{...query,from:'2025-12-29',through:'2026-01-03'}).nonPublicationDays.every(d=>d.reason==='year-end')).toBe(true);
 expect(plan(registryCalendarFixture(),{...query,from:'2020-07-20',through:'2020-07-26'}).expectedDates).toEqual(['2020-07-20','2020-07-21','2020-07-22']);
 expect(plan(registryCalendarFixture(),{...query,from:'2019-04-29',through:'2019-05-02'}).nonPublicationDays).toHaveLength(4);
});
it.each([
 {...query,from:'2026-02-30'}, {...query,from:'2026-09-25'}, {...query,from:'2016-12-31'},
 {...query,through:'2028-01-01'}, {...query,through:'2026-10-31'}, {...query,knownAt:'2026-10-29T00:00:00Z'},
 {...query,from:'2026-01-01',through:'2026-04-11'}, {...query,extra:true}, {...query,from:new String(query.from)},
])('不正期間・範囲外・未来観測・未知キーを拒否する',q=>expect(()=>plan(registryCalendarFixture(),q as any)).toThrow());
it('100日境界と一回の入力捕捉を守る',()=>{
 const q={...query,from:'2026-01-01',through:'2026-04-10'};
 const result=plan(registryCalendarFixture(),q);expect(result.expectedDates.length+result.nonPublicationDays.length).toBe(100);
 let reads=0;const captured:any={...query};Object.defineProperty(captured,'from',{enumerable:true,get(){if(++reads>1)throw Error();return query.from}});
 expect(plan(registryCalendarFixture(),captured).query.from).toBe(query.from);expect(reads).toBe(1);
});
