import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {officerDocument} from './fixtures/officers';
it('役員CLIは入れ子略歴と現任/予定を保持し、失敗入力を表示しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'officer-cli-'));try{
  const {xml,...metadata}=officerDocument();writeFileSync(join(dir,'source.xbrl'),'\ufeff'+xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...metadata}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-officers','--manifest',join(dir,'manifest.json'),'--status','as-filed','--roster-date','2026-06-24','--role','named','--metric','record'];
  const run=(extra:string[]=[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:2,extractions:[{source:{inputXmlSha256:createHash('sha256').update('\ufeff'+xml).digest('hex')}}],rows:[{row:{status:'as-filed',reportedShares:{decimal:'1200'}}},{row:{reportedShares:{reason:'dash'}}}]});
  const shares=run(['--metric','reportedShares','--condition','{"operator":"gte","value":1200}']);expect(shares.status,shares.stderr).toBe(0);expect(JSON.parse(shares.stdout)).toMatchObject({matched:1,excluded:[{reason:'dash'}]});
  for(const extra of [['--condition','null'],['--offset','-1'],['--condition','{"operator":"eq","value":"SECRET-FIXTURE"}']]){
   const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
