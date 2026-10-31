import {it,expect,vi} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,readdirSync,symlinkSync,linkSync,writeFileSync,chmodSync,truncateSync} from 'node:fs';
import {join} from 'node:path';import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {DuckDBInstance,DuckDBResult,DuckDBDataChunk} from '@duckdb/node-api';
import {DuckFinancialSnapshot} from '../src/db/duck-financial-snapshot';
import {DuckFinancialIndexBuild} from '../src/db/duck-financial-index-build';
import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';
import {ParsedFinancialStore} from '../src/db/parsed-financial-store';
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
async function fixture(fn:(path:string,dir:string)=>Promise<void>,complete=true){
 const dir=mkdtempSync(join(tmpdir(),'duck-snapshot-test-')),path=join(dir,'index.duckdb'),a=join(dir,'a.sqlite'),p=join(dir,'p.sqlite');
 const aw=new ObservedFinancialArchive(a),pw=new ParsedFinancialStore(p);aw.close();pw.close();const archive=new ObservedFinancialArchive(a,{readOnly:true}),parsed=new ParsedFinancialStore(p,{readOnly:true}),db=await DuckDBInstance.create(path,{threads:'1'}),c=await db.connect();
 try{const b=new DuckFinancialIndexBuild(c);await b.begin({id:'b',generation:'g',archiveSha256:archive.snapshotSha256(),options:{cutoff:'2026-10-28T00:00:00Z',extractorVersion:'test',sourceCommit:'a'.repeat(40)},population:{asOf:'2026-10-27',observedAt:'2026-10-27T00:00:00Z',source:'test',sourceSha256:'a'.repeat(64),edinetCodes:['E12345']}},parsed.snapshotSha256());if(complete){await b.runNext('b',archive,parsed);await b.finish('b')}}finally{c.closeSync();db.closeSync();archive.close();parsed.close()}
 try{await fn(path,dir)}finally{rmSync(dir,{recursive:true,force:true})}
}
it('完成候補の私有readOnlyコピーを保持し、元DBを変更しない',()=>fixture(async(path,dir)=>{
 const before=digest(path),names=readdirSync(dir),s=await DuckFinancialSnapshot.open(path);
 try{expect(await s.snapshotSha256()).toBe(before);expect(await s.rows('SELECT id FROM financial_generations')).toEqual([{id:'g'}]);await expect(s.rows('DELETE FROM financial_generations')).rejects.toThrow();expect(digest(path)).toBe(before);expect(readdirSync(dir)).toEqual(names);writeFileSync(path,'replaced');expect(await s.rows('SELECT id FROM financial_generations')).toEqual([{id:'g'}])}finally{await s.close()}
 await s.close();await expect(s.snapshotSha256()).rejects.toThrow('closed');
}));
it('未完成候補をreaderに渡さない',()=>fixture(async path=>{const before=digest(path);await expect(DuckFinancialSnapshot.open(path)).rejects.toThrow('incomplete');expect(digest(path)).toBe(before)},false));
it.each(['symlink','hardlink','wal','tmp'])('%sの入力を拒否する',mode=>fixture(async(path,dir)=>{
 let target=path;if(mode==='symlink'){target=join(dir,'link');symlinkSync(path,target)}else if(mode==='hardlink')linkSync(path,join(dir,'link'));else writeFileSync(path+(mode==='wal'?'.wal':'.tmp'),'sidecar');
 await expect(DuckFinancialSnapshot.open(target)).rejects.toThrow();
}));
it.each(['column','table','index','view','format'])('%sの変更を正常なschemaとして開かない',mode=>fixture(async path=>{
 const db=await DuckDBInstance.create(path,{threads:'1'}),c=await db.connect();try{await c.run(mode==='column'?'ALTER TABLE financial_rows ADD COLUMN unknown VARCHAR':mode==='table'?'CREATE TABLE unknown(id INTEGER)':mode==='index'?'CREATE INDEX unknown ON financial_values(metric_id)':mode==='view'?'CREATE VIEW unknown AS SELECT 1':"UPDATE duck_build_format SET kind='wrong'")}finally{c.closeSync();db.closeSync()}
 const before=digest(path);await expect(DuckFinancialSnapshot.open(path)).rejects.toThrow();expect(digest(path)).toBe(before);
}));
it('私有snapshotの切詰めを次のSQL実行前に拒否する',()=>fixture(async path=>{
 const s=await DuckFinancialSnapshot.open(path);try{const file=(s as any).file;chmodSync(file,0o600);truncateSync(file,32);await expect(s.rows('SELECT 1')).rejects.toThrow('changed')}finally{await s.close()}
}));
it('存在しないパス・通常DBでないファイルを変更しない',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'duck-unknown-'));try{const path=join(dir,'unknown');await expect(DuckFinancialSnapshot.open(path)).rejects.toThrow();expect(readdirSync(dir)).toEqual([]);writeFileSync(path,'unknown bytes');await expect(DuckFinancialSnapshot.open(path)).rejects.toThrow();expect(readFileSync(path,'utf8')).toBe('unknown bytes')}finally{rmSync(dir,{recursive:true,force:true})}
});

it('開始済みのSQLを完了してからcloseし、新しいSQLは拒否する',()=>fixture(async path=>{
 const s=await DuckFinancialSnapshot.open(path),reads=Array.from({length:5},()=>s.rows('SELECT id FROM financial_generations')),closed=s.close();await expect(s.rows('SELECT 1')).rejects.toThrow('closed');expect(await Promise.all(reads)).toEqual(Array.from({length:5},()=>[{id:'g'}]));await closed;await s.close();
}));

it('新しい行のbigintだけを安全な整数へ正規化し、他の値と返却間の独立性を保つ',()=>fixture(async path=>{
 const snapshot=await DuckFinancialSnapshot.open(path);try{
  const sql="SELECT 9007199254740991::BIGINT AS maximum, -9007199254740991::BIGINT AS minimum, 1.25::DOUBLE AS fraction, 'あ😀'::VARCHAR AS text, NULL::VARCHAR AS missing",expected={maximum:Number.MAX_SAFE_INTEGER,minimum:Number.MIN_SAFE_INTEGER,fraction:1.25,text:'あ😀',missing:null};
  const first=await snapshot.rows(sql);expect(first).toEqual([expected]);first[0].text='changed';expect(await snapshot.rows(sql)).toEqual([expected]);
  for(const value of ['9007199254740992','-9007199254740992'])await expect(snapshot.rows(`SELECT ${value}::BIGINT AS unsafe`)).rejects.toThrow('Unsafe DuckDB integer');
 }finally{await snapshot.close()}
}));

it('列単位の読取でも重複列名・行順・空結果はnativeの行APIと一致する',()=>fixture(async path=>{
 const db=await DuckDBInstance.create(':memory:'),connection=await db.connect(),snapshot=await DuckFinancialSnapshot.open(path),sql="SELECT 1::BIGINT AS duplicate, 2::BIGINT AS duplicate, NULL::VARCHAR AS missing, '日本語😀' AS text UNION ALL SELECT 3, 4, NULL, 'é' ORDER BY 1";
 try{const expected=(await connection.runAndReadAll(sql)).getRowObjects().map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?Number(value):value])));expect(await snapshot.rows(sql)).toEqual(expected);expect(await snapshot.rows('SELECT 1 AS empty WHERE false')).toEqual([]);}finally{await snapshot.close();connection.closeSync();db.closeSync()}
}));

it('準備済みSQLを再利用しても型変更・不足引数・失敗後の再実行で値が漏れない',()=>fixture(async path=>{
 const snapshot=await DuckFinancialSnapshot.open(path),sql='WITH v AS (SELECT count(*) AS n FROM financial_rows) SELECT ? AS value FROM v WHERE ?=?';
 try{
  expect(await snapshot.rows(sql,['first',1,1])).toEqual([{value:'first'}]);
  await expect(snapshot.rows(sql,['hidden',1])).rejects.toThrow();
  expect(await snapshot.rows(sql,[42,1,1])).toEqual([{value:42}]);
  expect((snapshot as any).statements.size).toBe(1);
  const reads=[snapshot.rows(sql,['queued',1,1]),snapshot.rows(sql,[null,1,1])],closed=snapshot.close();
  expect(await Promise.all(reads)).toEqual([[{value:'queued'}],[{value:null}]]);await closed;
  expect((snapshot as any).statements.size).toBe(0);
 }finally{await snapshot.close()}
}));

it('結果は成功・整数検査失敗のどちらでも直ちに解放し、次のSQLを実行できる',()=>fixture(async path=>{
 const snapshot=await DuckFinancialSnapshot.open(path),close=vi.spyOn(DuckDBResult.prototype,'closeSync');
 try{
  expect(await snapshot.rows('SELECT ?::VARCHAR AS value',['日本語😀'])).toEqual([{value:'日本語😀'}]);expect(close).toHaveBeenCalledTimes(1);
  await expect(snapshot.rows('SELECT ?::BIGINT AS unsafe',['9007199254740992'])).rejects.toThrow('Unsafe DuckDB integer');expect(close).toHaveBeenCalledTimes(2);
  expect(await snapshot.rows('SELECT ?::VARCHAR AS value',['again'])).toEqual([{value:'again'}]);expect(close).toHaveBeenCalledTimes(3);
 }finally{close.mockRestore();await snapshot.close()}
}));

it('取得済みチャンクを直ちに解放しても複数チャンクの順序・文字列・BLOB・リストを保つ',()=>fixture(async path=>{
 const snapshot=await DuckFinancialSnapshot.open(path),db=await DuckDBInstance.create(':memory:'),connection=await db.connect(),sql="SELECT i::BIGINT AS ordinal, repeat('日本語😀',32)||i::VARCHAR AS text, encode('日本語'||i::VARCHAR) AS blob, [i::BIGINT,NULL] AS items FROM range(5001) t(i) ORDER BY i";
 try{
  const result=await connection.runAndReadAll(sql),expected=result.getRowObjects().map(row=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='bigint'?Number(value):value])));result.closeSync();
  const reset=vi.spyOn(DuckDBDataChunk.prototype,'reset');let actual;
  try{actual=await snapshot.rows(sql);expect(reset.mock.calls.length).toBeGreaterThanOrEqual(3)}finally{reset.mockRestore()}
  await snapshot.close();expect(actual).toEqual(expected);expect(actual![5000].ordinal).toBe(5000);
 }finally{await snapshot.close();connection.closeSync();db.closeSync()}
}));
