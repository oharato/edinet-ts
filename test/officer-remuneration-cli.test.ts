import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {remunerationDocument} from './fixtures/remuneration';
it('役員報酬CLIは個人総額と会社別内訳を分け、不正入力を表示しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'remuneration-cli-'));try{
  const {xml,...metadata}=remunerationDocument();writeFileSync(join(dir,'source.xbrl'),'\ufeff'+xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...metadata}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-officer-remuneration','--manifest',join(dir,'manifest.json'),'--kind','individual','--period-start','2025-04-01','--period-end','2026-03-31','--role','detail','--metric','total'];
  const run=(extra:string[]=[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:2,extractions:[{source:{inputXmlSha256:createHash('sha256').update('\ufeff'+xml).digest('hex')}}],rows:[{value:{decimal:'101000000'}},{value:{decimal:'0'}}]});
  const component=run(['--metric','component','--component-path','["株式報酬"]','--company-contains','別会社']);expect(component.status,component.stderr).toBe(0);expect(JSON.parse(component.stdout)).toMatchObject({matched:1,rows:[{contributionIndex:1,value:{decimal:'88000000'}}]});
  for(const extra of [['--condition','null'],['--offset','-1'],['--condition','{"operator":"eq","value":"SECRET-FIXTURE"}'],['--component-path','null']]){
   const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
