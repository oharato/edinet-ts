import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn,type ChildProcess} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {DedicatedSqliteDatabase} from '../src/db/dedicated-sqlite';

class Samples extends DedicatedSqliteDatabase{
 constructor(file:string,options:{readOnly?:boolean}={}){super(file,options,{table:'busy_format',kind:'busy-test',schema:{busy_format:'CREATE TABLE busy_format(kind TEXT NOT NULL)',samples:'CREATE TABLE samples(value TEXT NOT NULL)'}})}
 put(value:string){return this.transaction(()=>this.run('INSERT INTO samples VALUES(?)',[value]))}
 values(){return this.rows('SELECT value FROM samples ORDER BY rowid').map(row=>row.value)}
 timeout(){return this.rows('PRAGMA busy_timeout')[0].timeout}
}
const readerScript=`
import {Database} from 'node:sqlite';
import {writeFileSync} from 'node:fs';
const [file,mode,marker]=process.argv.slice(1),db=new Database(file,{readOnly:true});
let released=false;
function release(){if(released)return;released=true;db.exec('COMMIT');db.close();writeFileSync(marker,'released');process.disconnect();}
db.exec('BEGIN');const statement=db.prepare('SELECT count(*) FROM samples');statement.get();statement.close();
process.on('message',message=>{if(message==='release')release();if(message==='release-soon')setTimeout(release,400)});
process.on('disconnect',()=>{if(!released){db.close();process.exitCode=1}});
process.send('locked');
`;
async function lockReader(file:string,marker:string){
 const child=spawn(process.execPath,['--input-type=module','-e',readerScript,file,'hold',marker],{stdio:['ignore','ignore','pipe','ipc']});
 let stderr='';child.stderr?.on('data',bytes=>{stderr+=bytes.toString()});
 const closed=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',(code,signal)=>code===0?resolve():reject(Error('Reader failed: '+(stderr||signal||code))))});
 // Install the rejection handler before waiting for readiness, including spawn errors.
 void closed.catch(()=>{});
 await new Promise<void>((resolve,reject)=>{child.once('message',message=>message==='locked'?resolve():reject(Error('Unexpected reader response')));child.once('error',reject);child.once('exit',code=>reject(Error('Reader exited before readiness: '+code+' '+stderr)))});
 return {child,closed};
}
async function release(reader:{child:ChildProcess;closed:Promise<void>}|undefined){
 if(!reader)return;
 if(reader.child.connected)reader.child.send('release');
 await reader.closed;
}

it('新規・memory・既存write・readonly検査copyの全接続を5000msへ揃える',()=>{
 const directory=mkdtempSync(join(tmpdir(),'dedicated-busy-options-')),file=join(directory,'samples.sqlite');
 let db:Samples|undefined;
 try{
  db=new Samples(':memory:');expect(db.timeout()).toBe(5000);db.close();
  db=new Samples(file);expect(db.timeout()).toBe(5000);db.put('original');db.close();
  const before=readFileSync(file);
  db=new Samples(file,{readOnly:true});expect(db.timeout()).toBe(5000);expect(db.values()).toEqual(['original']);db.close();expect(readFileSync(file)).toEqual(before);
  db=new Samples(file);expect(db.timeout()).toBe(5000);db.close();expect(readFileSync(file)).toEqual(before);
 }finally{db?.close();rmSync(directory,{recursive:true,force:true})}
});

it('別processの短いread transactionが解放されればwriter commitが待って成功する',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'dedicated-busy-short-')),file=join(directory,'samples.sqlite'),marker=join(directory,'released');
 const db=new Samples(file);let reader:Awaited<ReturnType<typeof lockReader>>|undefined;
 try{
  db.put('original');reader=await lockReader(file,marker);expect(existsSync(marker)).toBe(false);
  reader.child.send('release-soon');const started=performance.now();db.put('committed');
  expect(performance.now()-started).toBeGreaterThanOrEqual(100);expect(existsSync(marker)).toBe(true);
  expect(db.values()).toEqual(['original','committed']);await reader.closed;reader=undefined;
 }finally{await release(reader);db.close();rmSync(directory,{recursive:true,force:true})}
},15_000);

it('永続read lockでは有限時間で失敗してrollbackし、元bytesを保護したまま再開する',async()=>{
 const directory=mkdtempSync(join(tmpdir(),'dedicated-busy-held-')),file=join(directory,'samples.sqlite'),marker=join(directory,'released');
 const db=new Samples(file);let reader:Awaited<ReturnType<typeof lockReader>>|undefined;
 try{
  db.put('original');const before=readFileSync(file);reader=await lockReader(file,marker);
  const started=performance.now();expect(()=>db.put('rolled-back')).toThrow(/locked|busy/i);const elapsed=performance.now()-started;
  expect(elapsed).toBeGreaterThanOrEqual(4500);expect(elapsed).toBeLessThan(12_000);
  expect(existsSync(marker)).toBe(false);expect(db.values()).toEqual(['original']);expect(readFileSync(file)).toEqual(before);
  expect(existsSync(file+'-journal')).toBe(false);
  await release(reader);reader=undefined;db.put('after-release');expect(db.values()).toEqual(['original','after-release']);
 }finally{await release(reader);db.close();rmSync(directory,{recursive:true,force:true})}
},20_000);
