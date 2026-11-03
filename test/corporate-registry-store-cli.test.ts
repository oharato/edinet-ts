import {it,expect} from 'vitest';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';import {createHash} from 'node:crypto';
import {CorporateRegistryStore} from '../src/db/corporate-registry-store';import {registryStreamSource as source,registryStreamXml as xml} from './fixtures/corporate-registry-stream';
it('CLIで取込完了を待ち、再open検索とAPIの来歴・原値が一致する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'registry-store-cli-'));try{
  const text=xml(),db=join(dir,'store.sqlite'),manifest=join(dir,'manifest.json'),query=join(dir,'query.json');writeFileSync(join(dir,'source.xml'),text);writeFileSync(manifest,JSON.stringify({file:'source.xml',source,part:'diff.xml',sha256:createHash('sha256').update(text).digest('hex')}));const q={corporateNumber:'1010001001202',knownAt:source.observedAt,registryPurpose:'sample'};writeFileSync(query,JSON.stringify(q));
  const run=(command:string,args:string[])=>spawnSync(process.execPath,['--import','tsx',resolve('src/cli.ts'),command,'--db',db,...args],{encoding:'utf8'});
  const imported=run('import-corporate-registry-file',['--manifest',manifest]);expect(imported.status,imported.stderr).toBe(0);expect(JSON.parse(imported.stdout)).toMatchObject({status:'inserted',file:{records:1}});
  const result=run('query-corporate-registry-store',['--query',query]);expect(result.status,result.stderr).toBe(0);const reader=new CorporateRegistryStore(db,{readOnly:true});try{expect(JSON.parse(result.stdout)).toEqual(reader.query(q as never))}finally{reader.close()}
  writeFileSync(join(dir,'source.xml'),'<corporations>');const bad=run('import-corporate-registry-file',['--manifest',manifest]);expect(bad.status).toBe(1);expect(bad.stdout).toBe('');expect(bad.stderr).not.toContain(dir);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
