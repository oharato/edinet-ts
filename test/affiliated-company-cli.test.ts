import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {affiliatedDocument} from './fixtures/affiliated-companies';
it('関係会社CLIは明示区分で逆引きし、失敗入力を非表示にする',()=>{
 const dir=mkdtempSync(join(tmpdir(),'affiliated-cli-'));try{
  const {xml,...rest}=affiliatedDocument();writeFileSync(join(dir,'source.xbrl'),xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...rest}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-affiliated-companies','--manifest',join(dir,'manifest.json'),'--period-end','2026-03-31','--relationship','consolidated-subsidiary','--entry-kind','named'];
  const run=(extra:string[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--voting','{"direction":"owned","component":"indirectIncluded","operator":"gte","value":40}','--capital','{"currency":"JPY","operator":"gte","value":1000000000}']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,rows:[{row:{identity:'unresolved',relationship:'consolidated-subsidiary'}}]});
  for(const extra of [['--capital','null'],['--offset','-1'],['--voting','{"direction":"owned","component":"indirectIncluded","operator":"gte","value":"SECRET-FIXTURE"}']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
