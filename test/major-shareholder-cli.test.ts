import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {majorDocument} from './fixtures/major-shareholders';
it('大株主CLIは日付の種類と引用を区別し、失敗入力を表示しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'major-cli-'));try{
  const {xml,...rest}=majorDocument();writeFileSync(join(dir,'source.xbrl'),xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...rest}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-major-shareholders','--manifest',join(dir,'manifest.json'),'--kind','large-holding-reference','--date-basis','public-inspection-date','--date','2026-05-12','--role','named','--metric','reportedCount'];
  const run=(extra:string[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--condition','{"operator":"gte","value":1000000}']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,rows:[{row:{holder:{raw:'甲信託銀行'},reportedCount:{unit:'reported-holding-equivalents'}}}]});
  for(const extra of [['--condition','null'],['--offset','-1'],['--condition','{"operator":"eq","value":"SECRET-FIXTURE"}']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
