import {describe,it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
const fixtures=(action:(file:string,run:()=>ReturnType<typeof spawnSync>)=>void)=>{const d=mkdtempSync(join(tmpdir(),'edinet-relations-cli-')),f=join(d,'input.json');try{const run=()=>spawnSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'explain-document-relations','--file',f],{cwd:'/tmp',encoding:'utf8'});action(f,run);}finally{rmSync(d,{recursive:true,force:true});}};
describe('書類関係を明示JSONから説明するCLI',()=>{
 it('原本に触れず、親未収録と複数観測を返す',()=>fixtures((file,run)=>{writeFileSync(file,JSON.stringify([{observationId:'a',document:{docID:'SYNTHETIC-A',parentDocID:null}},{observationId:'a2',document:{docID:'SYNTHETIC-A',docInfoEditStatus:'2'}},{observationId:'b',document:{docID:'SYNTHETIC-B',parentDocID:'SYNTHETIC-A'}},{observationId:'c',document:{docID:'SYNTHETIC-C',parentDocID:'SYNTHETIC-MISSING'}}]));const before=readFileSync(file),r=run();expect(r.status,String(r.stderr)).toBe(0);const out=JSON.parse(String(r.stdout));expect(out.summary.observations).toBe(4);expect(out.relations.find(x=>x.observationId==='b').resolution).toBe('multiple-observations');expect(out.relations.find(x=>x.observationId==='c').resolution).toBe('not-in-input');expect(readFileSync(file)).toEqual(before);}));
 it('不正JSONの内容をstderrへ出さない',()=>fixtures((file,run)=>{writeFileSync(file,'{"secret-example":');const r=run();expect(r.status).toBe(1);expect(String(r.stderr)).not.toContain('secret-example');expect(String(r.stdout)).toBe('');}));
 it('不正な区分値を0や空一覧へ置き換えない',()=>fixtures((file,run)=>{writeFileSync(file,JSON.stringify([{observationId:'a',document:{docID:'SYNTHETIC',withdrawalStatus:'9'}}]));const r=run();expect(r.status).toBe(1);expect(String(r.stdout)).toBe('');}));
});
