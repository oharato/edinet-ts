import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {policyDocument} from './fixtures/policy-shareholdings';
it('政策保有CLIは相対原本と期間/種類を保持し、失敗入力を表示しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'policy-cli-'));try{
  const {xml,...metadata}=policyDocument();writeFileSync(join(dir,'source.xbrl'),'\ufeff'+xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...metadata}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-policy-shareholdings','--manifest',join(dir,'manifest.json'),'--kind','specified','--period-end','2026-03-31','--metric','reportedAmount'];
  const run=(extra:string[]=[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({matched:1,extractions:[{source:{inputXmlSha256:createHash('sha256').update('\ufeff'+xml).digest('hex')}}],rows:[{entry:{kind:'specified',periodEnd:'2026-03-31',values:{reportedAmount:{decimal:'10000000',unit:'JPY'}}}}]});
  for(const extra of [['--condition','null'],['--offset','-1'],['--condition','{"operator":"eq","value":"SECRET-FIXTURE"}']]){
   const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
