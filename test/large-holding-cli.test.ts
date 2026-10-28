import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {largeDocument} from './fixtures/large-holding-report';
it('一次大量保有CLIは相対原本を読み、集計範囲と観測時点を保持する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'large-cli-'));try{
  const {xml,...rest}=largeDocument({two:true});writeFileSync(join(dir,'source.xbrl'),xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...rest}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'screen-large-holdings','--manifest',join(dir,'manifest.json'),'--cutoff','2026-10-28T00:00:00Z','--duty-date','2025-06-16','--scope','report','--metric','holdingPercent'];
  const run=(extra:string[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--condition','{"operator":"gte","value":5}']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,rows:[{row:{role:'reported-aggregate',values:{holdingPercent:{decimal:'5.0500',valueUnit:'percent'}}}}]});
  for(const extra of [['--condition','null'],['--offset','-1'],['--condition','{"operator":"eq","value":"SECRET-FIXTURE"}']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
