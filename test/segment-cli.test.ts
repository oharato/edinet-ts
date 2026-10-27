import { mkdtempSync,writeFileSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { it,expect } from 'vitest';
import { segmentDocument,splitSegmentTables } from './fixtures/segments';
it('公開セグメントCLIは相対manifestで横分割表を検索し、失敗入力を表示しない',()=>{
 const dir=mkdtempSync(join(tmpdir(),'segment-cli-'));
 try{
  const {xml,...rest}=segmentDocument('A',{tables:splitSegmentTables(),indexes:[0,1]});writeFileSync(join(dir,'source.xbrl'),xml);writeFileSync(join(dir,'manifest.json'),JSON.stringify([{file:'source.xbrl',...rest}]));
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'search-segments','--manifest',join(dir,'manifest.json'),'--start','2025-04-01','--end','2026-03-31'];
  const run=(extra:string[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const result=run(['--role','adjustment','--conditions','[{"metric":"profitJPY","operator":"lt","value":0}]','--sort-by','profitJPY']);expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toMatchObject({matched:1,rows:[{column:{role:'adjustment',values:{profitJPY:{decimal:'-813000000'}}}}]});
  for(const extra of [['--role','all'],['--role','adjustment','--conditions','null'],['--role','adjustment','--offset','-1'],['--role','adjustment','--order','other']]){const bad=run(extra);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');}
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
