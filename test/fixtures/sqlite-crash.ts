import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
/** 私有DBの書込をcacheからspillさせてからSIGKILLします。 */
export async function crashDatabase(source:string,dir:string,sql:string){
 const script=join(dir,'crash.mjs');writeFileSync(script,`import{Database}from'node:sqlite';const d=new Database(${JSON.stringify(source)});d.exec("PRAGMA journal_mode=DELETE;PRAGMA synchronous=FULL;PRAGMA cache_size=4;BEGIN IMMEDIATE;");d.exec(${JSON.stringify(sql)});process.stdout.write('READY\\n');setInterval(()=>{},1000);`);
 const child=spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']}),closed=new Promise<void>(ok=>child.once('close',()=>ok()));
 try{
 await new Promise<void>((ok,fail)=>{let output='',errors='';const timer=setTimeout(()=>fail(Error('crash worker timeout')),10000);child.stdout.on('data',b=>{output+=b;if(output.includes('READY')){clearTimeout(timer);ok()}});child.stderr.on('data',b=>{errors=(errors+b).slice(0,2000)});child.once('error',e=>{clearTimeout(timer);fail(e)});child.once('exit',code=>{clearTimeout(timer);fail(Error('early worker exit '+code+': '+errors))});});
 }finally{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await closed;}
}
