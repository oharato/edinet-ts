import {it,expect,vi} from 'vitest';
import {selectSourceBatch,countStalledBatches,withSourceDiskReserve,ACQUISITION_RESERVE_BYTES,ACQUISITION_MARGIN_BYTES} from '../scripts/roadmap/acquisition-batch-control.mjs';
const task=(i:number,status='pending',attempts=0)=>({docID:'A'+String(i).padStart(3,'0'),status,attempts});
it('取得順と残り停止枠を保ち、完了/未提供/3試行済みを除外する',()=>{
 const tasks=[task(9,'failed',2),task(2),task(3,'running',1),task(1),task(4,'failed',3),task(5,'complete',0),task(6,'unavailable',0)];
 expect(selectSourceBatch(tasks,0).map(t=>t.docID)).toEqual(['A001','A002','A003','A009']);
 const many=Array.from({length:120},(_,i)=>task(i));expect(selectSourceBatch(many,0)).toHaveLength(100);expect(selectSourceBatch(many,4)).toHaveLength(20);for(const invalid of [-1,5,1.5])expect(()=>selectSourceBatch(many,invalid)).toThrow();
});
it('最初の20件に成功があり、後の80件が失敗なら次の上限は20件になる',()=>{
 const before=Array.from({length:100},(_,i)=>task(i)),after=before.map((t,i)=>({...t,attempts:1,status:i===0?'complete':'failed'}));
 const stalled=countStalledBatches(before,after,0);expect(stalled).toBe(4);expect(selectSourceBatch(Array.from({length:100},(_,i)=>task(i+100)),stalled)).toHaveLength(20);
 expect(countStalledBatches(before,after.map(t=>({...t,status:'failed'})),0)).toBe(5);
});
it('途中中断の未試行部分を失敗batchとして加算しない',()=>{
 const before=Array.from({length:100},(_,i)=>task(i)),after=before.map((t,i)=>i<3?{...t,attempts:1,status:'failed'}:t);expect(countStalledBatches(before,after,0)).toBe(1);
 expect(()=>countStalledBatches(before,[],0)).toThrow();
});
it.each(['before','after','abort','success'])('本文取得の%sで容量/中断を確認する',async mode=>{
 const minimum=ACQUISITION_RESERVE_BYTES+ACQUISITION_MARGIN_BYTES;let free=mode==='before'?minimum-1n:minimum;const controller=new AbortController(),low=vi.fn();if(mode==='abort')controller.abort();
 const fetch=vi.fn(async()=>{if(mode==='after')free=minimum-1n;return '<x/>'});const guarded=withSourceDiskReserve(fetch,()=>free,controller,low);
 if(mode==='success'){await expect(guarded('A',{})).resolves.toBe('<x/>');expect(controller.signal.aborted).toBe(false);}else{await expect(guarded('A',{})).rejects.toThrow();expect(controller.signal.aborted).toBe(true);}
 expect(fetch).toHaveBeenCalledTimes(['before','abort'].includes(mode)?0:1);expect(low).toHaveBeenCalledTimes(['before','after'].includes(mode)?1:0);
});
it('cacheから即座に本文が戻っても、停止signalを処理して本文を採用しない',async()=>{
 const c=new AbortController(),fetch=vi.fn(async()=>'<x/>'),guard=withSourceDiskReserve(fetch,()=>ACQUISITION_RESERVE_BYTES+ACQUISITION_MARGIN_BYTES,c,()=>{}),pending=guard('A',{});setImmediate(()=>c.abort());await expect(pending).rejects.toThrow('interrupted');expect(c.signal.aborted).toBe(true);
});
it('構築待機は古いsummary/PID/類似パスを新しい取得workerと誤認しない',async()=>{
 const{isSourceReady}=await import('../scripts/roadmap/acquisition-batch-control.mjs'),expected={planSha256:'plan',workerSha256:'script',scriptPath:'/runtime/source.mts'},summary={pid:123,planSha256:'plan',executionScriptSha256:'script'},argv=['/node','/runtime/source.mts'];expect(isSourceReady(summary,123,expected,argv)).toBe(true);
 for(const changed of [{pid:12},{planSha256:'other'},{executionScriptSha256:'old'}])expect(isSourceReady({...summary,...changed},123,expected,argv)).toBe(false);expect(isSourceReady(summary,0,expected,argv)).toBe(false);expect(isSourceReady(summary,123,expected,['/runtime/source.mts-old'])).toBe(false);expect(isSourceReady(undefined,123,expected,argv)).toBe(false);
});
