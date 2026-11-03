import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {it,expect} from 'vitest';
import {orderDocument} from './fixtures/orders';
it('受注CLIは相対原本を読み、失敗入力を表示しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'order-cli-'));try{
  const {xml,...rest}=orderDocument();writeFileSync(join(dir,'source.xbrl'),xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...rest}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-orders','--manifest',join(dir,'manifest.json'),'--start','2025-04-01','--end','2026-03-31','--scope','NonConsolidated','--role','detail','--metric','ordersReceivedJPY'];
  const run=(extra:string[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--condition','{"operator":"gte","value":10000000}']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,rows:[{row:{label:{raw:'屋内線工事'}}}]});
  for(const extra of [['--condition','null'],['--offset','-1'],['--condition','{"operator":"eq","value":"SECRET-FIXTURE"}']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
