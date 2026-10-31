import {it,expect} from 'vitest';import {join} from 'node:path';import {readFileSync,existsSync,writeFileSync,symlinkSync} from 'node:fs';import {createHash} from 'node:crypto';
import {Database} from '../src/db/node-sqlite';
import {ParsedFinancialStore} from '../src/db/parsed-financial-store';import {ParsedFinancialJob} from '../src/db/parsed-financial-job';import {recoverManagedSqliteJournal} from '../src/db/managed-sqlite-recovery';import {FinancialIndexPublication,type FinancialIndexPublicationPolicy} from '../src/db/financial-index-publication';
import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';import {crashDatabase} from './fixtures/sqlite-crash';
const hash=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
it.each(['store','job','catalog'] as const)('%sの実SIGKILL後に私有復旧を検査し、原本を保持して管理DBを戻す',kind=>fixture(async({duck,dir})=>{
 const source=join(dir,kind+'.sqlite'),archiveBefore=hash(join(dir,'a.sqlite'));
 if(kind==='store'){const input=new ParsedFinancialStore(join(dir,'p.sqlite'),{readOnly:true}),out=new ParsedFinancialStore(source);try{for(const {id,...record}of input.page().records)out.put(record)}finally{input.close();out.close()}}
 if(kind==='job'){const from=new ParsedFinancialStore(join(dir,'p.sqlite'),{readOnly:true}),out=new ParsedFinancialJob(source);try{out.begin({id:'job',archiveSha256:'a'.repeat(64),tasks:from.page().records.map(r=>({identity:r.identity,availableAt:'2026-07-01T00:00:00Z'}))})}finally{from.close();out.close()}}
 if(kind==='catalog'){const out=new FinancialIndexPublication(source),policy:FinancialIndexPublicationPolicy={minimumCompaniesWithUsableValues:4,maxUnavailableSources:0,maxUnresolvedSelections:0,maxUnavailableSelections:0,maxUnresolvedRecords:0,maxUnavailableGroups:0,maxDuplicateCohortIdentifiers:0,maxUnavailableValues:100};try{await out.prepareAsync('current',duck,'all',policy);await out.activateAsync('current',duck,{expectedActive:null})}finally{out.close()}}
 const committed=hash(source),table=kind==='store'?'parsed_extractions':kind==='job'?'parsed_job_plans':'publication_candidates';await crashDatabase(source,dir,`UPDATE ${table} SET body=body||printf('%0500000d',1)`);expect(readFileSync(source+'-journal').subarray(0,8).toString('hex')).toBe('d9d505f920a163d7');const databaseSha=hash(source),journalSha=hash(source+'-journal');
 const result=recoverManagedSqliteJournal(source,kind==='store'?'parsed-financial-store':kind==='job'?'parsed-financial-job':'financial-index-publication',dir)!;expect(hash(source)).toBe(committed);expect(existsSync(source+'-journal')).toBe(false);expect(hash(join(result.backup,'database.sqlite'))).toBe(databaseSha);expect(hash(join(result.backup,'database.sqlite-journal'))).toBe(journalSha);expect(result.applicationRecordsValidated).toBe(true);expect(recoverManagedSqliteJournal(source,result.kind,dir)).toBeUndefined();expect(hash(join(dir,'a.sqlite'))).toBe(archiveBefore);
 if(kind==='store'){const s=new ParsedFinancialStore(source,{readOnly:true});try{expect(s.page().records).toHaveLength(4)}finally{s.close()}}
 if(kind==='job'){const j=new ParsedFinancialJob(source,{readOnly:true});try{expect(j.plan('job').tasks).toHaveLength(4)}finally{j.close()}}
 if(kind==='catalog'){const c=new FinancialIndexPublication(source,{readOnly:true});try{expect((await c.resolveAsync(duck))?.id).toBe('current');expect(c.history()).toHaveLength(1)}finally{c.close()}}
}),30000);
it('壊れたjournalは元DBを変更せず、復旧を拒否する',()=>fixture(async({dir})=>{
 const source=join(dir,'p.sqlite'),committed=hash(source);await crashDatabase(source,dir,"UPDATE parsed_extractions SET body=body||printf('%0500000d',1)");const before=hash(source),bytes=readFileSync(source+'-journal');bytes[0]^=1;writeFileSync(source+'-journal',bytes);const journal=hash(source+'-journal');expect(()=>recoverManagedSqliteJournal(source,'parsed-financial-store',dir)).toThrow();expect(hash(source)).toBe(before);expect(hash(source+'-journal')).toBe(journal);expect(before).not.toBe(committed);
}),30000);
it('未spillのcold journalは有効なmainを検査し、退避後に排他下で外す',()=>fixture(async({dir})=>{
 const source=join(dir,'p.sqlite'),before=hash(source);await crashDatabase(source,dir,"UPDATE parsed_format SET kind='uncommitted'");expect(readFileSync(source+'-journal').subarray(0,8).every(b=>b===0)).toBe(true);const journal=hash(source+'-journal');const result=recoverManagedSqliteJournal(source,'parsed-financial-store',dir)!;expect(result.proof.recoveryVersion).toBe('inactive-journal-1');expect(hash(source)).toBe(before);expect(hash(join(result.backup,'database.sqlite-journal'))).toBe(journal);expect(existsSync(source+'-journal')).toBe(false);
}),30000);
it('空のjournalでもmainの全検査・backupを経て再開する',()=>fixture(async({dir})=>{
 const source=join(dir,'p.sqlite'),before=hash(source);writeFileSync(source+'-journal','');expect(recoverManagedSqliteJournal(source,'parsed-financial-store',dir)!.proof.recoveryVersion).toBe('inactive-journal-1');expect(hash(source)).toBe(before);expect(existsSync(source+'-journal')).toBe(false);
}));

it.each(['wal-mode','dangling-wal'])('cold journalでも%sは元ファイルを変えずに拒否',mode=>fixture(async({dir})=>{
 const source=join(dir,'p.sqlite');if(mode==='wal-mode'){const db=new Database(source);try{db.exec('PRAGMA journal_mode=WAL')}finally{db.close()}}else symlinkSync(join(dir,'missing'),source+'-wal');writeFileSync(source+'-journal','');const before=hash(source);expect(()=>recoverManagedSqliteJournal(source,'parsed-financial-store',dir)).toThrow();expect(hash(source)).toBe(before);expect(existsSync(source+'-journal')).toBe(true);
}));
