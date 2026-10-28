import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ifrsDetailDocument} from './fixtures/ifrs-financial-details';
it('IFRS明細CLIは負の支払CF・明示投影・BOMを保持し、失敗入力を表示しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'ifrs-detail-cli-'));try{
  const {xml,metadata}=ifrsDetailDocument();writeFileSync(join(dir,'source.xbrl'),'\ufeff'+xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',metadata}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'screen-ifrs-details','--manifest',join(dir,'manifest.json')];
  const run=(extra:string[]=[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--metrics','incomeTaxesPaidCashFlow','--conditions','[{"metric":"incomeTaxesPaidCashFlow","operator":"lt","value":0}]']);expect(r.status,r.stderr).toBe(0);
  expect(JSON.parse(r.stdout)).toMatchObject({total:1,rows:[{inputXmlSha256:createHash('sha256').update('\ufeff'+xml).digest('hex'),selections:{incomeTaxesPaidCashFlow:{status:'selected',raw:'-109'}}}]});
  const plain=run();expect(plain.status,plain.stderr).toBe(0);expect(Object.keys(JSON.parse(plain.stdout).rows[0].selections)).toHaveLength(5);
  for(const extra of [['--conditions','null'],['--metrics','costOfSales,costOfSales'],['--metrics','incomeTaxesPaidCashFlow','--conditions','[{"metric":"incomeTaxesPaidCashFlow","operator":"eq","value":"SECRET-FIXTURE"}]'],['--offset','-1']]){
   const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');
  }
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
