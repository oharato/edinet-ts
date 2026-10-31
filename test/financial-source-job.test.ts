import {mkdtempSync,rmSync,readFileSync,copyFileSync,writeFileSync}from'node:fs';
import {spawn}from'node:child_process';import {resolve}from'node:path';
import {tmpdir}from'node:os';import {join}from'node:path';import {createHash}from'node:crypto';
import {it,expect,vi}from'vitest';
import {ObservedFinancialArchive,FinancialSourceJob,type FinancialSourceJobInput}from'../src/index';
import {Database}from'../src/db/node-sqlite';
import {reportingInstance}from'./fixtures/financial-reporting-basis';
const xml=reportingInstance(),cutoff='2026-07-01T00:00:00Z';
const input:FinancialSourceJobInput={id:'job',cutoff,population:{asOf:'2026-06-30',observedAt:'2026-06-30T00:00:00Z',source:'fixture',sourceSha256:'a'.repeat(64),edinetCodes:['E12345','E12346']}};
async function fixture(fn:(s:ReturnType<typeof setup>)=>Promise<void>){const s=setup();try{await fn(s);}finally{s.close();}}
function setup(){const dir=mkdtempSync(join(tmpdir(),'source-job-')),archivePath=join(dir,'archive.sqlite'),statePath=join(dir,'state.sqlite');let archive=new ObservedFinancialArchive(archivePath),state=new FinancialSourceJob(statePath);
archive.append(['A1','A2','A3'].map(docID=>({observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}})));archive.close();const frozen=new ObservedFinancialArchive(archivePath,{readOnly:true});archive=new ObservedFinancialArchive(archivePath);
return{dir,archivePath,statePath,frozen,get archive(){return archive},get state(){return state},reopen(){archive.close();state.close();archive=new ObservedFinancialArchive(archivePath);state=new FinancialSourceJob(statePath)},close(){archive.close();state.close();frozen.close();rmSync(dir,{recursive:true,force:true})}};}
it('固定母集団を計画し、再open後に未処理から再開し、履歴と完了指紋を返す',()=>fixture(async s=>{
 const p=s.state.begin(input,s.frozen);expect(p).toMatchObject({pending:3,completed:0,finished:false});expect(s.state.begin({...input,population:{...input.population,edinetCodes:['E12346','E12345']}},s.frozen)).toEqual(p);
 const fetcher=vi.fn(async()=>xml);expect((await s.state.runNext('job',s.archive,fetcher,{limit:1})).completed).toBe(1);s.reopen();const last=await s.state.runNext('job',s.archive,fetcher);expect(last).toMatchObject({completed:3,finished:true});expect(last.history.map(a=>a.outcome)).toEqual(['downloaded','downloaded','downloaded']);expect(fetcher).toHaveBeenCalledTimes(3);expect((await s.state.runNext('job',s.archive,fetcher)).finished).toBe(true);expect(fetcher).toHaveBeenCalledTimes(3);
 s.archive.close();const ro=new ObservedFinancialArchive(s.archivePath,{readOnly:true});try{const result=s.state.finish('job',ro);expect(result).toMatchObject({documents:3,selectionCutoff:cutoff});expect(result.archiveSha256).toBe(createHash('sha256').update(readFileSync(s.archivePath)).digest('hex'));}finally{ro.close();}
}));
it('失敗を永続化し、未処理を先に進めてから失敗を再試行する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);let fail=true;const f=vi.fn(async(id:string)=>{if(id==='A1'&&fail)throw Error('SECRET-KEY');return xml});let p=await s.state.runNext('job',s.archive,f,{limit:1});expect(p).toMatchObject({failed:1,pending:2});expect(JSON.stringify(p)).not.toContain('SECRET');s.reopen();p=await s.state.runNext('job',s.archive,f,{limit:2});expect(p).toMatchObject({failed:1,completed:2,pending:0});fail=false;p=await s.state.runNext('job',s.archive,f);expect(p.finished).toBe(true);expect(p.tasks[0].attempts).toBe(2);expect(p.history.filter(a=>a.docID==='A1').map(a=>a.status)).toEqual(['failed','complete']);
}));
it('原本commit後の状態書込失敗はstartedを残し、再起動で原本を再利用する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);const internal=s.state as unknown as{writeTask:(...args:any[])=>void},original=internal.writeTask;let failed=false;
 internal.writeTask=function(...args){if(args[1].status==='complete'&&!failed){failed=true;throw Error('checkpoint');}return original.apply(s.state,args)};
 const f=vi.fn(async()=>xml);await expect(s.state.runNext('job',s.archive,f,{limit:1})).rejects.toThrow('checkpoint');expect(s.state.progress('job')).toMatchObject({running:1});s.reopen();const p=await s.state.runNext('job',s.archive,f,{limit:3});expect(p.finished).toBe(true);expect(f).toHaveBeenCalledTimes(3);expect(p.history.filter(a=>a.docID==='A1').map(a=>[a.status,a.outcome])).toEqual([['interrupted',undefined],['complete','reused']]);
}));
it('開始時の原本不在を許しつつ、一覧観測の追加・変更では再開しない',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);s.archive.append([{observationId:'new',observedAt:'2026-06-26T00:00:00Z',document:{docID:'NEW',docTypeCode:'180'}}]);const f=vi.fn(async()=>xml);await expect(s.state.runNext('job',s.archive,f)).rejects.toThrow('一覧観測');expect(f).not.toHaveBeenCalled();
}));
it('保存済み原本もcheckpointと実byteを検査し、別アーカイブで完了としない',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);await s.state.runNext('job',s.archive,async()=>xml);const otherPath=join(s.dir,'other.sqlite');copyFileSync(s.archivePath,otherPath);const db=new Database(otherPath);db.exec('DELETE FROM archive_contents');db.close();const other=new ObservedFinancialArchive(otherPath);try{await expect(s.state.runNext('job',other,async()=>xml)).rejects.toThrow('完了checkpoint');}finally{other.close();}
}));
it('受信中の中断は履歴へ残し、同じ書類から再試行する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);const c=new AbortController();let p=await s.state.runNext('job',s.archive,async()=>{c.abort();return xml},{signal:c.signal});expect(p).toMatchObject({aborted:true,failed:1,pending:2});expect(p.history[0].status).toBe('interrupted');p=await s.state.runNext('job',s.archive,async()=>xml);expect(p.finished).toBe(true);
}));
it('同じ接続の並行実行・closeを止め、他の状態DB接続からの二重取得も排他する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);const second=new FinancialSourceJob(s.statePath);let release!:(v:string)=>void;const waiting=new Promise<string>(resolve=>release=resolve);const running=s.state.runNext('job',s.archive,async()=>waiting,{limit:1});
 // await transaction開始まで進めます。
 await Promise.resolve();expect(()=>s.state.close()).toThrow('実行終了');await expect(s.state.runNext('job',s.archive,async()=>xml)).rejects.toThrow('実行中');expect(()=>s.state.progress('job')).toThrow('実行中');const f=vi.fn(async()=>xml);await expect(second.runNext('job',s.archive,f)).rejects.toThrow();expect(f).not.toHaveBeenCalled();second.close();release(xml);expect((await running).completed).toBe(1);
}),15000);
it.each(['source_job_plans','source_job_tasks','source_job_attempts'])('%s破損を成功扱いしない',table=>fixture(async s=>{
 s.state.begin(input,s.frozen);await s.state.runNext('job',s.archive,async()=>xml,{limit:1});s.state.close();const db=new Database(s.statePath);db.exec(`UPDATE ${table} SET sha256='bad'`);db.close();const bad=new FinancialSourceJob(s.statePath);try{expect(()=>bad.progress('job')).toThrow('hash');}finally{bad.close();}
}));
it('不正入力・readOnly・未完了finishを拒否する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);expect(()=>s.state.finish('job',s.frozen)).toThrow('全件');for(const changed of [{...input,cutoff:'2026-07-02T00:00:00Z'},{...input,population:{...input.population,edinetCodes:['E12345']}}])expect(()=>s.state.begin(changed,s.frozen)).toThrow('変更');
 const f=vi.fn(async()=>xml);for(const opts of [{limit:0},{limit:101},{signal:{}},{other:1}])await expect(s.state.runNext('job',s.archive,f,opts as never)).rejects.toThrow();await expect(s.state.runNext('job',s.frozen,f)).rejects.toThrow('readOnly');expect(f).not.toHaveBeenCalled();
}));

it('実processが受信待ちで強制終了してもstartedから復旧する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);s.state.close();s.archive.close();const script=join(s.dir,'worker.ts');
 writeFileSync(script,`import {FinancialSourceJob,ObservedFinancialArchive} from ${JSON.stringify(resolve('src/index.ts'))};const state=new FinancialSourceJob(${JSON.stringify(s.statePath)}),archive=new ObservedFinancialArchive(${JSON.stringify(s.archivePath)});state.runNext('job',archive,async()=>{process.stdout.write('READY\\n');setInterval(()=>{},1000);return new Promise<string>(()=>{});},{limit:1});`);
 const child=spawn(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),script],{stdio:['ignore','pipe','pipe']});
 try{await new Promise<void>((ok,fail)=>{const timer=setTimeout(()=>fail(Error('worker startup timeout')),10000);let output='';child.stdout.on('data',b=>{output+=b.toString();if(output.includes('READY')){clearTimeout(timer);ok();}});child.on('error',fail);child.on('exit',()=>{clearTimeout(timer);fail(Error('worker exited early'));});});}
 finally{child.kill('SIGKILL');await new Promise<void>(ok=>child.once('close',()=>ok()));}
 s.reopen();expect(s.state.progress('job').running).toBe(1);const p=await s.state.runNext('job',s.archive,async()=>xml);expect(p.finished).toBe(true);expect(p.history.filter(a=>a.docID==='A1').map(a=>a.status)).toEqual(['interrupted','complete']);
}),20000);
it('保存済みだけの計画と書類0件の母集団を取得不要として分離する',()=>fixture(async s=>{
 for(const docID of ['A1','A2','A3'])s.archive.appendAcquiredSource(docID,xml);s.archive.close();const ro=new ObservedFinancialArchive(s.archivePath,{readOnly:true});s.reopen();try{
  const p=s.state.begin(input,ro);expect(p).toMatchObject({completed:3,finished:true,history:[]});const f=vi.fn(async()=>xml);expect((await s.state.runNext('job',s.archive,f)).finished).toBe(true);expect(f).not.toHaveBeenCalled();expect(s.state.finish('job',ro).documents).toBe(3);
  expect(s.state.begin({...input,id:'empty',population:{...input.population,edinetCodes:['E12346']}},ro)).toMatchObject({finished:true,completed:0,tasks:[]});
 }finally{ro.close();}
}));
it('100社・10,000観測の単回上限を越える入力でも会社別の固定計画を作る',()=>fixture(async s=>{
 const extra=Array.from({length:10000},(_,i)=>({observationId:'extra'+i,observedAt:'2026-06-26T00:00:00Z',document:{docID:'OTHER',docTypeCode:'180',edinetCode:'E99999'}}));s.archive.append(extra);s.archive.close();const ro=new ObservedFinancialArchive(s.archivePath,{readOnly:true});s.reopen();try{
  expect(()=>ro.planSourceAcquisition({cutoff})).toThrow('10,000');const population={...input.population,edinetCodes:['E12345',...Array.from({length:100},(_,i)=>'E'+(20000+i))]};const plan=s.state.begin({...input,population},ro);expect(plan.plan.population.edinetCodes).toHaveLength(101);expect(plan.pending).toBe(3);expect((await s.state.runNext('job',s.archive,async()=>xml)).finished).toBe(true);
 }finally{ro.close();}
}));
it('失敗だけが残っても試行数の少ない書類から再試行する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);const f=vi.fn(async()=>{throw Error('offline')});for(let i=0;i<5;i++)await s.state.runNext('job',s.archive,f,{limit:1});expect(s.state.progress('job').tasks.map(t=>t.attempts)).toEqual([2,2,1]);
}));
it('完了後の新しい原本観測を同じcheckpointの内容に読み替えない',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);await s.state.runNext('job',s.archive,async()=>xml);s.archive.append([],[{docID:'A1',availableAt:'2099-01-01T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex'),xml}]);const f=vi.fn(async()=>xml);await expect(s.state.runNext('job',s.archive,f)).rejects.toThrow('完了checkpoint');expect(f).not.toHaveBeenCalled();
}));
it('XBRL未提供を取得成功に数えず根拠付きで完了し、fetchしない',()=>fixture(async s=>{
 s.archive.append(['A1','A2','A3'].map(docID=>({observationId:docID+'-formats',observedAt:'2026-06-27T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0',xbrlFlag:'0',pdfFlag:'1'}})));
 s.archive.close();const ro=new ObservedFinancialArchive(s.archivePath,{readOnly:true});s.reopen();try{
 const p=s.state.begin(input,ro);expect(p).toMatchObject({unavailable:3,completed:0,pending:0,finished:true,history:[]});
 expect(p.tasks.every(t=>t.status==='unavailable'&&t.attempts===0&&t.sourceSha256===undefined)).toBe(true);
 const fetcher=vi.fn(async()=>xml);expect((await s.state.runNext('job',s.archive,fetcher)).finished).toBe(true);expect(fetcher).not.toHaveBeenCalled();
 expect(s.state.finish('job',ro)).toMatchObject({documents:0,unavailableDocuments:expect.arrayContaining([expect.objectContaining({docID:'A1',reason:'xbrl-not-provided'})])});
 }finally{ro.close();}
}));
it('形式宣言のない旧版1計画を変更せず再開できる',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);s.state.close();const db=new Database(s.statePath);
 try{
 const row=db.prepare('SELECT body FROM source_job_plans WHERE id=?').get('job') as {body:string};
 const plan=JSON.parse(row.body);plan.jobVersion='1';const body=JSON.stringify(plan);db.prepare('UPDATE source_job_plans SET body=?,sha256=? WHERE id=?').run(body,createHash('sha256').update(body).digest('hex'),'job');
 }finally{db.close();}
 s.reopen();expect(s.state.progress('job').plan.jobVersion).toBe('1');expect((await s.state.runNext('job',s.archive,async()=>xml)).completed).toBe(3);s.archive.close();const finishedArchive=new ObservedFinancialArchive(s.archivePath,{readOnly:true});try{expect(s.state.finish('job',finishedArchive).unavailableDocuments).toEqual([]);}finally{finishedArchive.close();}
}));
function withAudit(s:ReturnType<typeof setup>,fn:(state:FinancialSourceJob,archive:ObservedFinancialArchive,options:{planSha256:string;archiveSha256:string})=>void){
 s.state.close();s.archive.close();const state=new FinancialSourceJob(s.statePath,{readOnly:true}),archive=new ObservedFinancialArchive(s.archivePath,{readOnly:true});
 try{fn(state,archive,{planSha256:state.progress('job').planSha256,archiveSha256:archive.snapshotSha256()});}finally{archive.close();state.close();}
}
it('未完了checkpointをreadOnlyで監査し、完了/財務品質と区別する',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);await s.state.runNext('job',s.archive,async()=>xml,{limit:1});
 expect(()=>s.state.audit('job',s.frozen,{planSha256:s.state.progress('job').planSha256,archiveSha256:s.frozen.snapshotSha256()})).toThrow('readOnly');
 withAudit(s,(state,archive,options)=>{
 const stateBefore=readFileSync(s.statePath),archiveBefore=readFileSync(s.archivePath),audit=state.audit('job',archive,options);
 expect(audit).toMatchObject({auditVersion:'1',id:'job',completed:1,pending:2,failed:0,running:0,unavailable:0,documents:3,attempts:1,finished:false,financialValuesValidated:false,...options});expect(audit.stateSha256).toBe(createHash('sha256').update(stateBefore).digest('hex'));expect(audit.observationsSha256).toBe(state.progress('job').plan.observationsSha256);
 expect(readFileSync(s.statePath).equals(stateBefore)).toBe(true);expect(readFileSync(s.archivePath).equals(archiveBefore)).toBe(true);
 for(const changed of [{planSha256:'0'.repeat(64)},{archiveSha256:'0'.repeat(64)},{planSha256:'bad'},{extra:true}])expect(()=>state.audit('job',archive,{...options,...changed} as never)).toThrow();
 });
}));
it.each(['missing','corrupt'])('checkpointの保存原本が%sなら監査を失敗させる',mode=>fixture(async s=>{
 s.state.begin(input,s.frozen);await s.state.runNext('job',s.archive,async()=>xml,{limit:1});s.archive.close();const raw=new Database(s.archivePath);try{raw.exec(mode==='missing'?'DELETE FROM archive_contents':"UPDATE archive_contents SET xml=x'00'");}finally{raw.close();}
 withAudit(s,(state,archive,options)=>expect(()=>state.audit('job',archive,options)).toThrow(mode==='missing'?'完了checkpoint':'hash'));
}));
it('監査時点の原本指紋が正しくても一覧観測の追加を受け入れない',()=>fixture(async s=>{
 s.state.begin(input,s.frozen);s.archive.append([{observationId:'extra',observedAt:'2026-06-26T00:00:00Z',document:{docID:'EXTRA'}}]);
 withAudit(s,(state,archive,options)=>expect(()=>state.audit('job',archive,options)).toThrow('一覧観測'));
}));
it('未提供の根拠を監査し、取得済み原本件数へ足さない',()=>fixture(async s=>{
 s.archive.append(['A1','A2','A3'].map(docID=>{const o=s.frozen.observation(docID)!;return{...o,observationId:docID+'-flag',observedAt:'2026-06-27T00:00:00Z',document:{...o.document,xbrlFlag:'0'}}}));s.archive.close();const planned=new ObservedFinancialArchive(s.archivePath,{readOnly:true});try{s.state.begin(input,planned);}finally{planned.close();}
 withAudit(s,(state,archive,options)=>expect(state.audit('job',archive,options)).toMatchObject({completed:0,unavailable:3,pending:0,documents:3,attempts:0,finished:true,financialValuesValidated:false}));
}));
it.each(['sourceSha256','availableAt','status'])('計画時保存済みtaskの%sをrecord hashごと変えても採用しない',field=>fixture(async s=>{
 for(const docID of ['A1','A2','A3'])s.archive.appendAcquiredSource(docID,xml);s.archive.close();const planned=new ObservedFinancialArchive(s.archivePath,{readOnly:true});let planSha256:string;try{planSha256=s.state.begin(input,planned).planSha256;}finally{planned.close();}s.state.close();
 const db=new Database(s.statePath);try{
 const task=JSON.parse(String(db.prepare("SELECT body FROM source_job_tasks WHERE job='job' AND doc_id='A1'").get()!.body));task[field]=field==='sourceSha256'?'f'.repeat(64):field==='availableAt'?'2099-01-01T00:00:00Z':'pending';
 const body=JSON.stringify(Object.fromEntries(Object.keys(task).sort().map(k=>[k,task[k]]))),digest=createHash('sha256').update(JSON.stringify(['job','A1',task.status,body])).digest('hex');db.prepare("UPDATE source_job_tasks SET status=?,body=?,sha256=? WHERE job='job' AND doc_id='A1'").run(task.status,body,digest);
 }finally{db.close();}
 const state=new FinancialSourceJob(s.statePath,{readOnly:true}),archive=new ObservedFinancialArchive(s.archivePath,{readOnly:true});try{expect(()=>state.progress('job')).toThrow('計画時の保存済み');expect(()=>state.audit('job',archive,{planSha256:planSha256!,archiveSha256:archive.snapshotSha256()})).toThrow('計画時の保存済み');}finally{archive.close();state.close();}
}));
