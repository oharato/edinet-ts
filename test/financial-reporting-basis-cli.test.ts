import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {reportingInstance} from './fixtures/financial-reporting-basis';
it('財務基準CLIはDEIから判定してsnapshotへ接続し、推測や入力漏えいをしない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'reporting-basis-cli-'));try{
  const xml='\ufeff'+reportingInstance({standard:'IFRS'});writeFileSync(join(dir,'source.xbrl'),xml);
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'financial-reporting-basis','--file',join(dir,'source.xbrl'),'--doc-id','A'];
  const run=(extra:string[]=[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({status:'selected',inputXmlSha256:createHash('sha256').update(xml).digest('hex'),metadata:{accountingStandard:'IFRS',periodType:'annual'}});
  const s=run(['--with-snapshots','--detail-metrics','costOfSales']);expect(s.status,s.stderr).toBe(0);expect(JSON.parse(s.stdout)).toMatchObject({status:'resolved',details:{status:'created',snapshot:{selections:{costOfSales:{status:'selected',raw:'10'}}}}});
  writeFileSync(join(dir,'source.xbrl'),reportingInstance({standard:'US GAAP'}));const unresolved=run(['--with-snapshots']);expect(unresolved.status).toBe(0);expect(JSON.parse(unresolved.stdout)).toMatchObject({status:'unresolved',reason:'basis-unresolved'});
  for(const extra of [['--detail-metrics','costOfSales'],['--with-snapshots','--detail-metrics','SECRET-FIXTURE'],['--doc-id','']]){
   const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
