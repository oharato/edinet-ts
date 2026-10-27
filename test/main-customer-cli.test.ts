import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { customerDocument } from './fixtures/main-customer';
it('主要顧客CLIはmanifest相対の保存原本を逆引きし、入力エラーを非表示にする',()=>{
 const dir=mkdtempSync(join(tmpdir(),'main-customer-cli-'));
 try{
  const {xml,...rest}=customerDocument();writeFileSync(join(dir,'source.xbrl'),xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...rest}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-main-customers','--manifest',join(dir,'manifest.json'),'--start','2025-04-01','--end','2026-03-31','--scope','Consolidated'];
  const run=(extra:string[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--customer-contains','旧社','--revenue','{"operator":"gte","value":1000000000}','--sort','revenue-desc']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,rows:[{row:{rowSpan:2,revenueJPY:{decimal:'1234500000.0'}}}]});
  for(const extra of [['--offset','-1'],['--revenue','null'],['--customer-contains','']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
