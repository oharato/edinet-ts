import {it,expect,vi} from 'vitest';
import {EdinetRepository} from '../dist/db/edinet-repository.js';
import {collectDailyMetadata,canStartDailyMetadata} from '../scripts/roadmap/daily-metadata-control.mjs';
const initial=()=>({version:1,throughDate:'2026-10-28',budget:{date:'2026-10-30',requests:0}});
async function fixture(fn:(repo:EdinetRepository)=>Promise<void>){vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-30T01:00:00.000Z'));const repo=new EdinetRepository(':memory:');try{await fn(repo)}finally{repo.close();vi.useRealTimers()}}
it('当日probe後に7日を再観測し、同日再投入は通信しない',()=>fixture(async repo=>{
 const state=initial(),saved:any[]=[],fetch=vi.fn(async()=>[]);const save=(s:any)=>{saved.push(s)};
 expect(await collectDailyMetadata(repo,fetch,state,save)).toEqual({status:'complete',throughDate:'2026-10-29'});
 expect(fetch.mock.calls.map((c:any)=>c[0])).toEqual(['2026-10-30',...Array.from({length:7},(_,i)=>`2026-10-${23+i}`)]);
 expect(saved[1].budget.requests).toBe(1);expect(saved[2].active.probe).toMatchObject({date:'2026-10-30',documents:0});
 expect(repo.hasCompleteListForDate('2026-10-30')).toBe(false);expect(await collectDailyMetadata(repo,fetch,state,save)).toEqual({status:'already-complete'});expect(fetch).toHaveBeenCalledTimes(8);
}));
it('probe失敗は過去日を変更せず、予約を永続化できない場合は通信しない',()=>fixture(async repo=>{
 const state=initial(),fetch=vi.fn(async()=>{throw Error('SECRET')});expect(await collectDailyMetadata(repo,fetch,state,()=>{})).toEqual({status:'probe-failed'});expect(fetch).toHaveBeenCalledTimes(1);expect(state.budget.requests).toBe(1);
 const other=initial(),noFetch=vi.fn(async()=>[]);let saves=0;await expect(collectDailyMetadata(repo,noFetch,other,()=>{if(++saves===2)throw Error('disk')})).rejects.toThrow('disk');expect(noFetch).not.toHaveBeenCalled();
}));
it('保存直後の停止は同じ開始時刻で再開し、保存済みの日を取得し直さない',()=>fixture(async repo=>{
 const state=initial();let checkpoint:any;let crash=true;const fetch=vi.fn(async(date:string)=>{if(date==='2026-10-24'&&crash)throw Error('network');return[]});
 expect(await collectDailyMetadata(repo,fetch,state,(s:any)=>{checkpoint=s})).toEqual({status:'fetch-failed',date:'2026-10-24'});
 const watermark=checkpoint.active.refreshAfter;vi.setSystemTime(new Date('2026-10-30T02:00:00Z'));crash=false;fetch.mockClear();
 expect((await collectDailyMetadata(repo,fetch,checkpoint,()=>{})).status).toBe('complete');expect(fetch.mock.calls.map((c:any)=>c[0])).toEqual(Array.from({length:6},(_,i)=>`2026-10-${24+i}`));expect(repo.hasCompleteListForDate('2026-10-23',watermark)).toBe(true);
}));
it('API呼出し前に日次上限を保存し、翌日に同じ実行時刻と新しいprobeで再開する',()=>fixture(async repo=>{
 const state=initial();state.budget.requests=31;let checkpoint:any;const fetch=vi.fn(async()=>[]);
 expect(await collectDailyMetadata(repo,fetch,state,(s:any)=>{checkpoint=s})).toEqual({status:'budget-exhausted'});expect(fetch).toHaveBeenCalledTimes(1);expect(checkpoint.budget.requests).toBe(32);const start=checkpoint.active.refreshAfter;
 vi.setSystemTime(new Date('2026-10-31T01:00:00Z'));fetch.mockClear();expect((await collectDailyMetadata(repo,fetch,checkpoint,()=>{})).status).toBe('complete');expect(fetch.mock.calls[0][0]).toBe('2026-10-31');expect(checkpoint.throughDate).toBe('2026-10-29');expect(checkpoint.completedDay).toBeUndefined();expect(repo.hasCompleteListForDate('2026-10-29',start)).toBe(true);
}));
it('最終commit後のcheckpoint失敗を再開時に認識し、予算0でも完了する',()=>fixture(async repo=>{
 const state=initial();let checkpoint:any;const fetch=vi.fn(async()=>[]);
 await expect(collectDailyMetadata(repo,fetch,state,(s:any)=>{if(!s.active)throw Error('disk');checkpoint=s})).rejects.toThrow('disk');checkpoint.budget.requests=32;fetch.mockClear();expect((await collectDailyMetadata(repo,fetch,checkpoint,()=>{})).status).toBe('complete');expect(fetch).not.toHaveBeenCalled();
}));
it('直近7日より古い未取得期間も飛ばさず、翌日も再観測する',()=>fixture(async repo=>{
 const state={...initial(),throughDate:'2026-10-19'},fetch=vi.fn(async()=>[]);await collectDailyMetadata(repo,fetch,state,()=>{});expect(fetch.mock.calls[1][0]).toBe('2026-10-20');
 vi.setSystemTime(new Date('2026-10-31T01:00:00Z'));fetch.mockClear();await collectDailyMetadata(repo,fetch,state,()=>{});expect(fetch.mock.calls.map((c:any)=>c[0])).toEqual(['2026-10-31',...Array.from({length:7},(_,i)=>`2026-10-${24+i}`)]);
}));
it('不正checkpoint・未来・巻戻った時計を通信前に拒否する',()=>fixture(async repo=>{
 const fetch=vi.fn(async()=>[]);for(const changed of [{version:2},{throughDate:'bad'},{throughDate:'2026-10-30'},{budget:{date:'2026-10-31',requests:0}},{budget:{date:'2026-10-30',requests:33}},{active:{startDate:'2026-10-23',endDate:'2026-10-29',refreshAfter:'2026-10-31T01:00:00.000Z'}}])await expect(collectDailyMetadata(repo,fetch,{...initial(),...changed},()=>{})).rejects.toThrow();expect(fetch).not.toHaveBeenCalled();
}));
it('日付跨ぎと中断は新たな取得を止める',()=>fixture(async repo=>{
 const state=initial(),c=new AbortController(),fetch=vi.fn(async()=>{c.abort();return[]});expect(await collectDailyMetadata(repo,fetch,state,()=>{},{signal:c.signal})).toEqual({status:'aborted'});expect(fetch).toHaveBeenCalledTimes(1);
 const other=initial(),cross=vi.fn(async()=>{vi.setSystemTime(new Date('2026-10-30T15:00:00Z'));return[]});expect(await collectDailyMetadata(repo,cross,other,()=>{})).toEqual({status:'day-changed'});expect(cross).toHaveBeenCalledTimes(1);
}));

it('年次取得が固定計画・全件完了・停止を満たすまでは日次通信を開始しない',()=>{
 const expected={planSha256:'plan',workerSha256:'worker'},summary={planSha256:'plan',executionScriptSha256:'worker',finished:true,pending:0,failed:0,running:0,completed:7328,unavailable:9,documents:7337};
 expect(canStartDailyMetadata(summary,'inactive',expected)).toBe(true);
 for(const changed of [{planSha256:'old'},{executionScriptSha256:'old'},{finished:false},{pending:1},{failed:1},{running:1},{completed:7327},{unavailable:-1},{documents:0}])expect(canStartDailyMetadata({...summary,...changed},'inactive',expected)).toBe(false);
 for(const status of ['active','activating','failed'])expect(canStartDailyMetadata(summary,status,expected)).toBe(false);
 expect(canStartDailyMetadata(undefined,'inactive',expected)).toBe(false);
});
