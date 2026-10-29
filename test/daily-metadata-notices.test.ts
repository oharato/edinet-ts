import {it,expect,vi} from 'vitest';
import {EdinetRepository} from '../dist/db/edinet-repository.js';
import {scanDailyMetadataNotices,assertDailyNoticeState} from '../scripts/roadmap/daily-metadata-notices.mjs';
import {collectDailyMetadata} from '../scripts/roadmap/daily-metadata-control.mjs';
const empty=()=>({afterSequence:0,seen:[] as string[],pending:[] as {date:string;notBefore:string}[],unresolved:[] as number[]});
const doc=(docID:string,extra:any={})=>({docID,secCode:'10010',edinetCode:'E12345',docDescription:'fixture',docTypeCode:'120',submitDateTime:'2026-09-01 09:00',periodStart:'2025-04-01',periodEnd:'2026-03-31',withdrawalStatus:'0',docInfoEditStatus:0,disclosureStatus:'0',...extra});
const edit=(id='A',extra:any={})=>doc(id,{docInfoEditStatus:1,opeDateTime:'2026-10-29 09:00',...extra});
const withdrawal=(id='NOTICE',parent='B')=>doc(id,{docTypeCode:null,withdrawalStatus:'1',parentDocID:parent});
const old=()=>vi.setSystemTime(new Date('2026-10-29T00:00:00Z'));
const now=()=>vi.setSystemTime(new Date('2026-10-30T01:00:00Z'));
const daily=()=>({version:1,throughDate:'2026-10-28',budget:{date:'2026-10-30',requests:0}});
async function fixture(fn:(repo:EdinetRepository)=>Promise<void>){vi.useFakeTimers({toFake:['Date']});now();const repo=new EdinetRepository(':memory:');try{await fn(repo)}finally{repo.close();vi.useRealTimers()}}
it('修正/取下通知を過去の既知一覧日へ結び付け、不明通知の原観測番号を残す',()=>fixture(async repo=>{
 old();repo.saveDocumentList([doc('A')],'2026-09-01');repo.saveDocumentList([doc('B')],'2026-09-02');now();repo.saveDocumentList([edit(),withdrawal(),edit('UNKNOWN')],'2026-10-29');const state=empty();
 const count=repo.getLastObservationSequence();await scanDailyMetadataNotices(repo,state,()=>{});
 expect(state).toMatchObject({afterSequence:5,pending:[{date:'2026-09-01',notBefore:'2026-10-30T01:00:00.000Z'},{date:'2026-09-02',notBefore:'2026-10-30T01:00:00.000Z'}],unresolved:[5]});expect(state.seen).toHaveLength(3);expect(repo.getLastObservationSequence()).toBe(count);
}));
it('同じ通知を再観測しても新しい取得時刻だけでは再追加せず、異なる操作時刻は新イベントにする',()=>fixture(async repo=>{
 old();repo.saveDocumentList([doc('A')],'2026-09-01');now();repo.saveDocumentList([edit()],'2026-10-29');const state=empty();await scanDailyMetadataNotices(repo,state,()=>{});
 vi.setSystemTime(new Date('2026-10-30T02:00:00Z'));repo.saveDocumentList([edit('A',{docInfoEditStatus:'1'})],'2026-10-29');await scanDailyMetadataNotices(repo,state,()=>{});expect(state.seen).toHaveLength(1);expect(state.pending[0].notBefore).toBe('2026-10-30T01:00:00.000Z');
 repo.saveDocumentList([edit('A',{opeDateTime:'2026-10-29 10:00'})],'2026-10-29');await scanDailyMetadataNotices(repo,state,()=>{});expect(state.seen).toHaveLength(2);expect(state.pending[0].notBefore).toBe('2026-10-30T02:00:00.000Z');
}));
it('元docIDの検索も通知cursorも1000行を跨いで読み切る',()=>fixture(async repo=>{
 old();repo.saveDocumentList(Array.from({length:1000},()=>doc('A')),'2026-10-29');repo.saveDocumentList([doc('A')],'2026-09-01');now();repo.saveDocumentList([edit()],'2026-10-29');const state=empty(),saved:any[]=[];
 const result=await scanDailyMetadataNotices(repo,state,(s:any)=>saved.push(s));expect(result).toMatchObject({complete:true,readObservations:1002,newNotices:1});expect(saved.map(s=>s.afterSequence)).toEqual([1000,1002]);expect(state.pending[0].date).toBe('2026-09-01');
}));
it('通知page保存の失敗後は最後の永続cursorから再開し、page境界の通知を落とさない',()=>fixture(async repo=>{
 old();repo.saveDocumentList([doc('A')],'2026-09-01');now();const rows=Array.from({length:1000},(_,i)=>doc('F'+i));rows[998]=edit();rows[999]=edit('UNKNOWN');repo.saveDocumentList(rows,'2026-10-29');let saved:any;
 await expect(scanDailyMetadataNotices(repo,empty(),(s:any)=>{if(s.afterSequence>1000)throw Error('disk');saved=s})).rejects.toThrow('disk');expect(saved.afterSequence).toBe(1000);
 await scanDailyMetadataNotices(repo,saved,()=>{});expect(saved.afterSequence).toBe(1001);expect(saved.seen).toHaveLength(2);expect(saved.pending).toHaveLength(1);expect(saved.unresolved).toEqual([1001]);
}));
it('後から元書類が観測された不明通知を解決し、既に新しい元一覧は取り直さない',()=>fixture(async repo=>{
 repo.saveDocumentList([withdrawal('NOTICE','A')],'2026-10-29');const state=empty();await scanDailyMetadataNotices(repo,state,()=>{});expect(state.unresolved).toEqual([1]);
 vi.setSystemTime(new Date('2026-10-30T02:00:00Z'));repo.saveDocumentList([doc('A')],'2026-09-01');await scanDailyMetadataNotices(repo,state,()=>{});expect(state.unresolved).toEqual([]);expect(state.pending).toEqual([]);expect(state.seen).toHaveLength(1);
}));
it('page保存直後の中断でも保存済みcursorを残して再開できる',()=>fixture(async repo=>{
 repo.saveDocumentList(Array.from({length:1001},(_,i)=>doc('F'+i)),'2026-10-29');const state=empty(),controller=new AbortController();expect(await scanDailyMetadataNotices(repo,state,()=>controller.abort(),{signal:controller.signal})).toMatchObject({aborted:true,complete:false});expect(state.afterSequence).toBe(1000);await scanDailyMetadataNotices(repo,state,()=>{});expect(state.afterSequence).toBe(1001);
}));
it('不正cursor/重複/未来の対象日/過大状態を拒否する',()=>fixture(async repo=>{
 for(const changed of [{afterSequence:1},{seen:['bad']},{seen:['a'.repeat(64),'a'.repeat(64)]},{pending:[{date:'2026-10-30',notBefore:'2026-10-30T01:00:00.000Z'}]},{unresolved:[1]},{seen:Array(100001).fill('a'.repeat(64))}])expect(()=>assertDailyNoticeState({...empty(),...changed},repo)).toThrow();
}));
it('7日より古い対象日を日次収集へ加え、同じ実行の再投入では通信しない',()=>fixture(async repo=>{
 old();repo.saveDocumentList([doc('A')],'2026-09-01');now();const state:any=daily(),fetch=vi.fn(async(date:string)=>date==='2026-10-24'?[edit()]:date==='2026-09-01'?[doc('A')]:[]);
 expect(await collectDailyMetadata(repo,fetch,state,()=>{})).toEqual({status:'complete',throughDate:'2026-10-29'});expect(fetch.mock.calls.map(c=>c[0])).toEqual(['2026-10-30',...Array.from({length:7},(_,i)=>`2026-10-${23+i}`),'2026-09-01']);expect(state.version).toBe(3);expect(state.notices.pending).toEqual([]);expect(state.notices.seen).toHaveLength(1);
 fetch.mockClear();expect(await collectDailyMetadata(repo,fetch,state,()=>{})).toEqual({status:'already-complete'});expect(fetch).not.toHaveBeenCalled();expect(repo.getDocumentObservations({docID:'A'})[0].observedAt).toBe('2026-10-29T00:00:00.000Z');
}));
it('日別commit後・通知cursor保存前の停止でも、元一覧を再取得せず対象日を復元する',()=>fixture(async repo=>{
 old();repo.saveDocumentList([doc('A')],'2026-09-01');now();let saved:any;const fetch=vi.fn(async(date:string)=>date==='2026-10-24'?[edit()]:[]);
 await expect(collectDailyMetadata(repo,fetch,daily(),(s:any)=>{if(s.notices.afterSequence>1)throw Error('crash');saved=s})).rejects.toThrow('crash');expect(saved.notices.afterSequence).toBe(1);expect(repo.getLastObservationSequence()).toBe(2);
 await collectDailyMetadata(repo,fetch,saved,()=>{});expect(fetch.mock.calls.filter(c=>c[0]==='2026-10-24')).toHaveLength(1);expect(fetch.mock.calls.filter(c=>c[0]==='2026-09-01')).toHaveLength(1);expect(saved.notices.afterSequence).toBe(2);
}));
it('不明通知を完了後も保持し、解決できた通知と同じ扱いにしない',()=>fixture(async repo=>{
 const state:any=daily(),fetch=vi.fn(async(date:string)=>date==='2026-10-29'?[withdrawal('NOTICE','MISSING')]:[]);expect(await collectDailyMetadata(repo,fetch,state,()=>{})).toEqual({status:'complete',throughDate:'2026-10-29',unresolvedNotices:1});expect(state.notices.unresolved).toEqual([1]);fetch.mockClear();expect(await collectDailyMetadata(repo,fetch,state,()=>{})).toEqual({status:'already-complete',unresolvedNotices:1});expect(fetch).not.toHaveBeenCalled();
}));
it('通知の対象日で取得失敗しても、同じ開始時刻と対象日を保存して再開する',()=>fixture(async repo=>{
 old();repo.saveDocumentList([doc('A')],'2026-09-01');now();const state:any=daily();let fail=true;const fetch=vi.fn(async(date:string)=>{if(date==='2026-10-24')return[edit()];if(date==='2026-09-01'&&fail)throw Error('SECRET');return[]});
 expect(await collectDailyMetadata(repo,fetch,state,()=>{})).toEqual({status:'fetch-failed',date:'2026-09-01',pendingNoticeDates:1});const watermark=state.active.refreshAfter;fail=false;fetch.mockClear();expect((await collectDailyMetadata(repo,fetch,state,()=>{})).status).toBe('complete');expect(fetch.mock.calls.map(c=>c[0])).toEqual(['2026-09-01']);expect(state.notices.pending).toEqual([]);expect(repo.hasCompleteListForDate('2026-09-01',watermark)).toBe(true);
}));

it('残り9要求でprobe・7日・通知対象1日を完了し、予算を使い切っても再投入で追加取得しない',()=>fixture(async repo=>{
 old();repo.saveDocumentList([doc('A')],'2026-09-01');now();const state:any=daily();state.budget.requests=247;
 const fetch=vi.fn(async(date:string)=>date==='2026-10-24'?[edit()]:[]);expect((await collectDailyMetadata(repo,fetch,state,()=>{})).status).toBe('complete');expect(state.budget.requests).toBe(256);expect(fetch).toHaveBeenCalledTimes(9);fetch.mockClear();expect((await collectDailyMetadata(repo,fetch,state,()=>{})).status).toBe('already-complete');expect(fetch).not.toHaveBeenCalled();
}));
