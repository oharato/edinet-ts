import {it,expect} from 'vitest';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {CorporateRegistryStore} from '../src/db/corporate-registry-store';import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource} from './fixtures/corporate-registry-stream';
it('保存DBのCLI再構成はAPIと同じ原SHAを返し、未知IDを拒否する',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'registry-stored-state-cli-')),db=join(dir,'registry.sqlite');try{
  const store=new CorporateRegistryStore(db),text=xml(row()),file=join(dir,'data.xml');writeFileSync(file,text);const receipt=await store.importFile({file,source:{...registryStreamSource,kind:'full'},part:'data.xml',sha256:createHash('sha256').update(text).digest('hex')});const manifest=[{scope:'national' as const,expectedParts:1,fileIds:[receipt.file.id]}],query={corporateNumber:'1010001001202',asOf:'2026-10-29',knownAt:registryStreamSource.observedAt,registryPurpose:'sample' as const},expected=store.reconstruct(manifest,query);store.close();
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));writeFileSync(join(dir,'query.json'),JSON.stringify(query));
  const run=()=>spawnSync(process.execPath,['--import','tsx',resolve('src/cli.ts'),'reconstruct-corporate-registry-store','--db',db,'--manifest',join(dir,'manifest.json'),'--query',join(dir,'query.json')],{encoding:'utf8'});
  let r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual(expected);manifest[0].fileIds=['0'.repeat(64)];writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));r=run();expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).not.toContain(dir);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
