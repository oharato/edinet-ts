import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive,FinancialSourceJob,recoverDedicatedSqliteSnapshot} from '../src/index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
import {crashDatabase} from './fixtures/sqlite-crash';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
it('取得checkpointのSIGKILL後にAPI/CLIで復旧し、全履歴を保って残件から再開',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sqlite-recovery-job-')),archivePath=join(dir,'archive.sqlite'),statePath=join(dir,'state.sqlite'),xml=reportingInstance();
 let archive:ObservedFinancialArchive|undefined,state:FinancialSourceJob|undefined;
 try{
 archive=new ObservedFinancialArchive(archivePath);archive.append(['A1','A2','A3'].map(docID=>({observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}})));archive.close();
 const frozen=new ObservedFinancialArchive(archivePath,{readOnly:true});state=new FinancialSourceJob(statePath);try{state.begin({id:'job',cutoff:'2026-07-01T00:00:00Z',population:{asOf:'2026-06-30',observedAt:'2026-06-30T00:00:00Z',source:'fixture',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']}},frozen);}finally{frozen.close();}
 archive=new ObservedFinancialArchive(archivePath);await state.runNext('job',archive,async()=>xml,{limit:1});await state.runNext('job',archive,async()=>{throw Error('offline')},{limit:1});const before=state.progress('job');expect(before).toMatchObject({completed:1,failed:1,pending:1});state.close();archive.close();
 const committed=readFileSync(statePath),archiveBefore=hash(readFileSync(archivePath));await crashDatabase(statePath,dir,"UPDATE source_job_tasks SET body=body||printf('%0500000d',1)");const databaseSha256=hash(readFileSync(statePath)),journalSha256=hash(readFileSync(statePath+'-journal'));
 const recovered=recoverDedicatedSqliteSnapshot({source:statePath,outputDirectory:join(dir,'api'),kind:'financial-source-job',databaseSha256,journalSha256});expect(readFileSync(recovered.output.path).equals(committed)).toBe(true);expect(recovered.applicationRecordsValidated).toBe(false);
 const command=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'recover-sqlite-snapshot','--source',statePath,'--output-directory',join(dir,'cli'),'--kind','financial-source-job','--database-sha256',databaseSha256,'--journal-sha256',journalSha256];
 const cli=spawnSync(process.execPath,command,{cwd:'/tmp',encoding:'utf8'});expect(cli.status,cli.stderr).toBe(0);const manifest=JSON.parse(cli.stdout);expect(manifest.output.sha256).toBe(recovered.output.sha256);expect(readFileSync(manifest.output.path).equals(committed)).toBe(true);
 const bad=spawnSync(process.execPath,[...command,'--output-directory',join(dir,'bad'),'--journal-sha256','SECRET'],{cwd:'/tmp',encoding:'utf8'});expect(bad.status).toBe(1);expect(bad.stderr).not.toContain('SECRET');expect(existsSync(join(dir,'bad'))).toBe(false);
 expect(hash(readFileSync(archivePath))).toBe(archiveBefore);
 state=new FinancialSourceJob(recovered.output.path);expect(state.progress('job')).toEqual(before);archive=new ObservedFinancialArchive(archivePath);const calls:string[]=[];const done=await state.runNext('job',archive,async id=>{calls.push(id);return xml});expect(calls).toEqual(['A3','A2']);expect(done).toMatchObject({completed:3,finished:true});expect(done.history.filter(a=>a.docID==='A2').map(a=>a.status)).toEqual(['failed','complete']);expect(done.tasks.find(t=>t.docID==='A1')).toEqual(before.tasks.find(t=>t.docID==='A1'));
 archive.close();const finalArchive=new ObservedFinancialArchive(archivePath,{readOnly:true});try{expect(state.finish('job',finalArchive).documents).toBe(3);}finally{finalArchive.close();}
 expect(hash(readFileSync(statePath))).toBe(databaseSha256);expect(hash(readFileSync(statePath+'-journal'))).toBe(journalSha256);
 }finally{state?.close();archive?.close();rmSync(dir,{recursive:true,force:true});}
},30000);
