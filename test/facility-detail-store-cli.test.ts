import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {facilityDocument} from './fixtures/facility-details';
it('CLIの設備投入と原XMLなしの再検索、失敗時の原DB保護を確認する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'facility-store-cli-')),run=(...args:string[])=>spawnSync(process.execPath,['--import','tsx','src/cli.ts',...args],{encoding:'utf8',timeout:30000}),hash=(v:Buffer)=>createHash('sha256').update(v).digest('hex');
 try{
  const {xml,...metadata}=facilityDocument(),db=join(dir,'store.sqlite'),manifest=join(dir,'manifest.json'),source=join(dir,'original.xml');writeFileSync(source,xml);writeFileSync(manifest,JSON.stringify([{file:'original.xml',...metadata}]));
  let r=run('import-facility-details','--db',db,'--manifest',manifest);expect(r.status,r.stderr).toBe(0);const saved=JSON.parse(r.stdout);expect(saved.inserted).toBe(1);rmSync(source);const before=hash(readFileSync(db));
  r=run('search-facility-detail-store','--db',db,'--as-of-date','2026-03-31','--snapshot-ids',saved.snapshotIds[0],'--conditions',JSON.stringify([{field:'landAreaM2',operator:'gte',value:100}]));expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout).matched).toBe(1);expect(hash(readFileSync(db))).toBe(before);
  r=run('search-facility-detail-store','--db',db,'--as-of-date','2026-03-31','--conditions','PRIVATE_BAD_INPUT');expect(r.status).toBe(1);expect(r.stderr).not.toContain('PRIVATE_BAD_INPUT');expect(hash(readFileSync(db))).toBe(before);
 }finally{rmSync(dir,{recursive:true,force:true})}
},60000);
