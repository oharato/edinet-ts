import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {reportingInstance} from './fixtures/financial-reporting-basis';
it('観測財務CLIは選択原本だけ読み、hash/BOM/cutoffと保留理由を保持する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'observed-financial-cli-'));try{
  const input='\ufeff'+reportingInstance();writeFileSync(join(dir,'selected.xbrl'),input);
  const document={docID:'A',parentDocID:null,docTypeCode:'120',edinetCode:'E12345',secCode:'10010',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'};
  writeFileSync(join(dir,'observations.json'),JSON.stringify([{observationId:'A',observedAt:'2026-06-25T00:00:00Z',document}]));
  const source={docID:'A',availableAt:'2026-06-26T00:00:00Z',sourceSha256:createHash('sha256').update(input).digest('hex'),file:'selected.xbrl'};
  const manifest=(entry:unknown=source)=>writeFileSync(join(dir,'manifest.json'),JSON.stringify([entry,{...source,docID:'UNSELECTED',file:'absent.xbrl'}]));manifest();
  const args=['--import',resolve('node_modules/tsx/dist/loader.mjs'),resolve('src/cli.ts'),'observed-financial-snapshots','--manifest',join(dir,'manifest.json'),'--observations',join(dir,'observations.json'),'--cutoff','2026-10-28T00:00:00Z'];
  const run=(extra:string[]=[])=>spawnSync(process.execPath,[...args,...extra],{cwd:'/tmp',encoding:'utf8'});
  const r=run(['--detail-metrics','costOfSales']);expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({records:[{docID:'A',knownAt:'2026-06-26T00:00:00.000Z',sourceSha256:source.sourceSha256,result:{inputXmlSha256:source.sourceSha256,details:{snapshot:{selections:{costOfSales:{raw:'10'}}}}}}],unavailableSources:[]});
  for(const [entry,reason] of [[{...source,availableAt:'2026-10-29T00:00:00Z'},'not-available-at-cutoff'],[{...source,sourceSha256:'0'.repeat(64)},'source-hash-mismatch'],[{...source,file:'absent.xbrl'},'source-not-loaded']]){
   manifest(entry);const p=run();expect(p.status,p.stderr).toBe(0);expect(JSON.parse(p.stdout)).toMatchObject({records:[],unavailableSources:[{docID:'A',reason}]});
  }
  manifest();const bad=run(['--detail-metrics','SECRET-FIXTURE']);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).toContain('入力内容は非表示');expect(bad.stderr).not.toContain('SECRET-FIXTURE');
 }finally{rmSync(dir,{recursive:true,force:true});}
},30000);
