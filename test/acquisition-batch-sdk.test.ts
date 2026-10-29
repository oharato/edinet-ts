import {mkdtempSync,rmSync,copyFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive,FinancialSourceJob} from '../src/index';
import {selectSourceBatch,countStalledBatches,withSourceDiskReserve,ACQUISITION_RESERVE_BYTES,ACQUISITION_MARGIN_BYTES} from '../scripts/roadmap/acquisition-batch-control.mjs';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const xml=reportingInstance(),input={id:'job',cutoff:'2026-07-01T00:00:00Z',population:{asOf:'2026-06-30',observedAt:'2026-06-30T00:00:00Z',source:'fixture',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']}};
function setup(total=130){const dir=mkdtempSync(join(tmpdir(),'batch-sdk-')),initial=join(dir,'initial.sqlite'),a=new ObservedFinancialArchive(initial);a.append(Array.from({length:total+9},(_,i)=>({observationId:'o'+i,observedAt:'2026-06-26T00:00:00Z',document:{docID:(i<total?'A':'Z')+String(i).padStart(3,'0'),parentDocID:null,docTypeCode:'120',edinetCode:'E12345',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',xbrlFlag:i<total?'1':'0'}})));a.close();
 const connections:{close():void}[]=[];
 return{dir,make(id:string){const path=join(dir,id+'-archive.sqlite');copyFileSync(initial,path);const frozen=new ObservedFinancialArchive(path,{readOnly:true}),state=new FinancialSourceJob(join(dir,id+'-state.sqlite'));try{state.begin(input,frozen);}finally{frozen.close();}const archive=new ObservedFinancialArchive(path);connections.push(state,archive);return{state,archive};},close(){for(const c of connections)c.close();rmSync(dir,{recursive:true,force:true});}};
}
it.each(['all-fail','first-success'])('実SDKの20件と100件で停止位置/全試行が一致する: %s',async mode=>{
 const s=setup();try{
 const results=[];
 for(const adaptive of [false,true]){const pair=s.make(adaptive?'new':'old');let p=pair.state.progress('job'),stalled=0;const calls:string[]=[],limits:number[]=[];
 while(!p.finished&&stalled<5){const selected=selectSourceBatch(p.tasks,stalled),limit=adaptive?selected.length:Math.min(20,selected.length);if(!limit)break;limits.push(limit);const previous=p;
 p=await pair.state.runNext('job',pair.archive,async id=>{calls.push(id);if(mode==='first-success'&&id==='A000')return xml;throw Error('offline')},{limit});
 stalled=adaptive?countStalledBatches(selected,p.tasks,stalled):p.completed>previous.completed?0:stalled+1;
 }
 results.push({p,stalled,calls,limits});}
 expect(results[1].calls).toEqual(results[0].calls);expect(results[1].calls).toHaveLength(mode==='all-fail'?100:120);expect(results[1].stalled).toBe(5);expect(results[1].limits).toEqual(mode==='all-fail'?[100]:[100,20]);
 for(const key of ['pending','failed','completed','unavailable','finished','planSha256'])expect(results[1].p[key as keyof typeof results[1]['p']]).toEqual(results[0].p[key as keyof typeof results[0]['p']]);
 expect(results[1].p.unavailable).toBe(9);expect(results[1].p.history.map(({docID,number,status,outcome,errorCode})=>({docID,number,status,outcome,errorCode}))).toEqual(results[0].p.history.map(({docID,number,status,outcome,errorCode})=>({docID,number,status,outcome,errorCode})));
 }finally{s.close();}
},30000);
it('3/2/2試行が混在しても、3試行済みの原本を4回目へ進めない',async()=>{
 const s=setup(3);try{const{state,archive}=s.make('cap');for(let i=0;i<2;i++)await state.runNext('job',archive,async()=>{throw Error('offline')},{limit:3});await state.runNext('job',archive,async()=>{throw Error('offline')},{limit:1});const before=state.progress('job');expect(before.tasks.filter(t=>t.status==='failed').map(t=>t.attempts)).toEqual([3,2,2]);
 const selected=selectSourceBatch(before.tasks,0);expect(selected).toHaveLength(2);const calls:string[]=[];const after=await state.runNext('job',archive,async id=>{calls.push(id);throw Error('offline')},{limit:selected.length});expect(calls).not.toContain('A000');expect(after.tasks.filter(t=>t.status==='failed').map(t=>t.attempts)).toEqual([3,3,3]);expect(selectSourceBatch(after.tasks,0)).toHaveLength(0);
 }finally{s.close();}
});
it('100件処理中に容量を割ったら受信済みXMLもcommitせず停止する',async()=>{
 const s=setup();try{const{state,archive}=s.make('disk');const minimum=ACQUISITION_RESERVE_BYTES+ACQUISITION_MARGIN_BYTES;let free=minimum,requests=0;const c=new AbortController();let reason:string|undefined;
 const fetch=withSourceDiskReserve(async()=>{requests++;free=minimum-1n;return xml},()=>free,c,()=>reason='disk-reserve');const p=await state.runNext('job',archive,fetch,{limit:100,signal:c.signal});expect(p).toMatchObject({completed:0,failed:1,pending:129,unavailable:9,aborted:true});expect(requests).toBe(1);expect(reason).toBe('disk-reserve');expect(p.history[0]).toMatchObject({status:'interrupted',errorCode:'source-acquisition-interrupted'});expect(archive.planSourceAcquisition({cutoff:input.cutoff}).items.some(i=>i.status==='stored')).toBe(false);
 }finally{s.close();}
});
