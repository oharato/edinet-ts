import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {DuckFinancialSearchIndex} from '../src/db/duck-financial-search-index';
import {DuckFinancialIndexBuild} from '../src/db/duck-financial-index-build';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {ParsedFinancialStore,parsedFinancialMappingVersions} from '../src/db/parsed-financial-store';
import {ParsedFinancialJob} from '../src/db/parsed-financial-job';
import {FinancialIndexBuild} from '../src/db/financial-index-build';
import {FinancialSearchIndex} from '../src/db/financial-search-index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const modulePath=process.env.DUCKDB_NODE_MODULE??'@duckdb/node-api';
const options={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'parser-1',sourceCommit:'a'.repeat(40)};
async function fixture(fn:(s:any)=>Promise<void>,count=2){
 const dir=mkdtempSync(join(tmpdir(),'duck-build-')),path=join(dir,'archive.sqlite'),parsedPath=join(dir,'parsed.sqlite');const {DuckDBInstance}=await import(modulePath),instance=await DuckDBInstance.create(join(dir,'index.duckdb'),{threads:'1'});let connection=await instance.connect();
 const writer=new ObservedFinancialArchive(path,{compression:'gzip'}),tasks=[];
 for(const i of Array.from({length:count},(_,n)=>n+1)){const docID='A'+i,edinetCode='E'+String(12000+i),secCode=String(1000+i)+'0',xml=reportingInstance({issuer:edinetCode,security:secCode,standard:i===2?'IFRS':'Japan GAAP'}),sourceSha256=createHash('sha256').update(xml).digest('hex'),availableAt='2026-07-01T00:00:00.000Z';
  writer.append([{observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,edinetCode,secCode,docTypeCode:'120',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID,availableAt,sourceSha256,xml}]);tasks.push({availableAt,identity:{docID,sourceSha256,extractorVersion:options.extractorVersion,sourceCommit:options.sourceCommit,mappingVersions:parsedFinancialMappingVersions()}})
 }writer.close();const archive=new ObservedFinancialArchive(path,{readOnly:true}),parsedWriter=new ParsedFinancialStore(parsedPath),job=new ParsedFinancialJob(':memory:');job.begin({id:'parse',archiveSha256:archive.snapshotSha256(),tasks});await job.runNext('parse',archive,parsedWriter,{limit:100});parsedWriter.close();job.close();const parsed=new ParsedFinancialStore(parsedPath,{readOnly:true});let builder=new DuckFinancialIndexBuild(connection);
 const input={id:'build',generation:'all',archiveSha256:archive.snapshotSha256(),options,population:{asOf:'2026-10-27',observedAt:'2026-10-27T15:30:00Z',source:'fixed fixture',sourceSha256:'a'.repeat(64),edinetCodes:Array.from({length:count+1},(_,n)=>'E'+String(12001+n))}};
 const s:any={dir,instance,archive,parsed,input,get connection(){return connection},get builder(){return builder},async reopen(){connection.closeSync();connection=await instance.connect();builder=new DuckFinancialIndexBuild(connection)}};
 try{await fn(s)}finally{connection.closeSync();instance.closeSync();parsed.close();archive.close();rmSync(dir,{recursive:true,force:true})}
}
it('会社単位の保存・再接続で残件再開し、既存索引と値・来歴が一致',()=>fixture(async s=>{
 await s.builder.begin(s.input,s.parsed.snapshotSha256());await expect(s.builder.finish('build')).rejects.toThrow('incomplete');
 expect(await s.builder.runNext('build',s.archive,s.parsed,{limit:1})).toMatchObject({completed:1,pending:2,finished:false});await s.reopen();
 expect(await s.builder.runNext('build',s.archive,s.parsed,{limit:2})).toMatchObject({completed:3,pending:0,rows:4});const report=await s.builder.finish('build');expect(await s.builder.finish('build')).toEqual(report);expect((await s.builder.progress('build')).finished).toBe(true);
 const legacy=new FinancialSearchIndex(':memory:'),state=new FinancialIndexBuild(':memory:');try{state.begin(s.input);state.runNext('build',s.archive,legacy);const expected=state.finish('build',legacy);expect(report.rows).toEqual(expected.rows);expect(report.selection).toEqual(expected.selection);expect(report.unavailableSources).toEqual(expected.unavailableSources);expect(report.provenance).toEqual(expected.provenance)}finally{legacy.close();state.close()}
 const counts=(await s.connection.runAndReadAll('SELECT COUNT(*) n FROM financial_rows')).getRowObjects();expect(Number(counts[0].n)).toBe(4);
}));
it('途中のDB書込失敗は会社全体をrollbackし、他社checkpointを維持',()=>fixture(async s=>{
 await s.builder.begin(s.input,s.parsed.snapshotSha256());await s.builder.runNext('build',s.archive,s.parsed,{limit:1});
 const original=s.connection.run.bind(s.connection);let fail=true;s.connection.run=async(sql:string,args:any[])=>{if(fail&&sql.startsWith('INSERT INTO financial_values')){fail=false;throw Error('disk failure')}return original(sql,args)};
 await expect(s.builder.runNext('build',s.archive,s.parsed,{limit:1})).rejects.toThrow('disk failure');s.connection.run=original;
 expect(await s.builder.progress('build')).toMatchObject({completed:1,rows:2});await s.reopen();await s.builder.runNext('build',s.archive,s.parsed);expect((await s.builder.finish('build')).rows).toHaveLength(4);
}));
it('company commit直後の中断でも再接続時に重複投入しない',()=>fixture(async s=>{
 await s.builder.begin(s.input,s.parsed.snapshotSha256());const original=s.connection.run.bind(s.connection);let interrupt=true;
 s.connection.run=async(sql:string,args:any[])=>{const result=await original(sql,args);if(sql==='COMMIT'&&interrupt){interrupt=false;throw Error('after commit')}return result};
 await expect(s.builder.runNext('build',s.archive,s.parsed,{limit:1})).rejects.toThrow('after commit');s.connection.run=original;await s.reopen();expect((await s.builder.progress('build')).completed).toBe(1);await s.builder.runNext('build',s.archive,s.parsed);await s.builder.finish('build');
}));
it('signal・同時実行・固定入力違い・異なる計画を拒否',()=>fixture(async s=>{
 await s.builder.begin(s.input,s.parsed.snapshotSha256());await expect(s.builder.begin({...s.input,generation:'other'},s.parsed.snapshotSha256())).rejects.toThrow('changed');
 const abort=new AbortController();abort.abort();expect(await s.builder.runNext('build',s.archive,s.parsed,{signal:abort.signal})).toMatchObject({completed:0,aborted:true});
 const running=s.builder.runNext('build',s.archive,s.parsed,{limit:1});await expect(s.builder.runNext('build',s.archive,s.parsed)).rejects.toThrow('running');await running;
 await s.connection.run("UPDATE duck_build_plan SET sha256='bad'");await expect(s.builder.progress('build')).rejects.toThrow('corrupt');
}));
it.each(['financial_values','financial_rows','duck_build_parts'])('%sの改変を完了世代へ昇格させない',table=>fixture(async s=>{
 await s.builder.begin(s.input,s.parsed.snapshotSha256());await s.builder.runNext('build',s.archive,s.parsed);
 await s.connection.run(table==='financial_values'?'UPDATE financial_values SET available=1-available':`UPDATE ${table} SET sha256='corrupt'`);await expect(s.builder.finish('build')).rejects.toThrow('corrupt');expect((await s.connection.runAndReadAll('SELECT * FROM financial_generations')).getRowObjects()).toEqual([]);
}));
it('無関係な既存DBへテーブルを書き加えない',async()=>{
 const {DuckDBInstance}=await import(modulePath),instance=await DuckDBInstance.create(':memory:'),connection=await instance.connect();try{await connection.run('CREATE TABLE user_data(id INTEGER)');const builder=new DuckFinancialIndexBuild(connection);await expect(builder.begin({id:'build',generation:'all',archiveSha256:'a'.repeat(64),options,population:{asOf:'2026-10-27',observedAt:'2026-10-27T15:30:00Z',source:'fixture',sourceSha256:'a'.repeat(64),edinetCodes:['E12001']}},'b'.repeat(64))).rejects.toThrow('schema');expect((await connection.runAndReadAll("SELECT table_name FROM information_schema.tables WHERE table_schema='main'")).getRowObjects()).toEqual([{table_name:'user_data'}])}finally{connection.closeSync();instance.closeSync()}
});

it('100件を超える行と指標をページ監査して完了できる',()=>fixture(async s=>{
 await s.builder.begin(s.input,s.parsed.snapshotSha256());await s.builder.runNext('build',s.archive,s.parsed,{limit:100});const report=await s.builder.finish('build');expect(report.rows).toHaveLength(102);expect((await s.builder.progress('build')).finished).toBe(true);await s.connection.run('CHECKPOINT');const reader=await DuckFinancialSearchIndex.open(join(s.dir,'index.duckdb'));try{expect((await reader.quality('all')).rows).toBe(102);expect((await reader.generation('all')).rows).toHaveLength(102)}finally{await reader.close()}
},51),30000);
