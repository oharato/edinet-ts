import {mkdtempSync,rmSync,readFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive} from '../src/index';
it('固定指紋の原本をCLIで分割転送し、再投入と不正指紋を扱う',()=>{
 const dir=mkdtempSync(join(tmpdir(),'archive-transfer-cli-'));
 try{
 const source=join(dir,'source.sqlite'),target=join(dir,'target.sqlite'),a=new ObservedFinancialArchive(source),xml='<x>日本語</x>',hash=(s:string|Uint8Array)=>createHash('sha256').update(s).digest('hex');
 a.append([],['A','B'].map(docID=>({docID,availableAt:'2026-01-01T00:00:00Z',sourceSha256:hash(xml),xml})));a.close();const before=readFileSync(source),sha=hash(before);
 const run=(args:string[])=>spawnSync(process.execPath,['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'transfer-financial-archive-sources','--source',source,'--archive',target,...args],{cwd:'/tmp',encoding:'utf8'});
 const first=run(['--source-sha256',sha,'--limit','1']);expect(first.status,first.stderr).toBe(0);const page=JSON.parse(first.stdout);expect(page).toMatchObject({complete:false,insertedSources:1,insertedContents:1});
 const last=run(['--source-sha256',sha,'--after-id',page.nextAfterId]);expect(last.status,last.stderr).toBe(0);expect(JSON.parse(last.stdout)).toMatchObject({complete:true,insertedSources:1,insertedContents:0});
 const repeated=run(['--source-sha256',sha]);expect(repeated.status,repeated.stderr).toBe(0);expect(JSON.parse(repeated.stdout)).toMatchObject({complete:true,insertedSources:0,insertedContents:0});
 const absent=join(dir,'absent.sqlite'),bad=run(['--archive',absent,'--source-sha256','0'.repeat(64)]);expect(bad.status).toBe(1);expect(existsSync(absent)).toBe(false);expect(bad.stderr).not.toContain('00000000');expect(readFileSync(source)).toEqual(before);
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
