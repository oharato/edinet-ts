import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {CorporateRegistryStore} from '../src/db/corporate-registry-store';
import {linkCompanyMasterCorporateStates} from '../src/company-corporate-state';
import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource as source} from './fixtures/corporate-registry-stream';
it('CLI/APIで同じ状態・出典を返し、不正な要求でも元DBを変えない',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'company-state-cli-')),hash=(v:Buffer|string)=>createHash('sha256').update(v).digest('hex');
 try{
  const db=join(dir,'registry.sqlite'),file=join(dir,'full.xml'),text=xml(row());writeFileSync(file,text);const store=new CorporateRegistryStore(db),receipt=await store.importFile({file,source:{...source,kind:'full'},part:'full.xml',sha256:hash(text)});
  const manifest=[{scope:'national' as const,expectedParts:1,fileIds:[receipt.file.id]}],q={edinetCodes:['E00001'],asOf:'2026-10-29',knownAt:source.observedAt,registryPurpose:'sample' as const};
  const masters=[{asOf:'2026-10-29',observedAt:source.observedAt,sourceUrl:'https://example.test/master.csv',sourceSha256:'1'.repeat(64),records:[{entityId:'edinet:E00001',edinetCode:'E00001',corporateNumber:'1010001001202',name:'日本 & 会社',filerType:'内国法人',listingStatus:'listed' as const}]}];
  const expected=linkCompanyMasterCorporateStates(masters,store,manifest,q);store.close();expect(expected.rows[0].status).toBe('number-and-name-matched');
  for(const [name,value] of [['master',masters],['manifest',manifest],['query',q]])writeFileSync(join(dir,name+'.json'),JSON.stringify(value));const before=hash(readFileSync(db));
  const run=()=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','link-company-corporate-states','--db',db,'--master',join(dir,'master.json'),'--manifest',join(dir,'manifest.json'),'--query',join(dir,'query.json')],{encoding:'utf8',timeout:30000});
  let r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual(expected);writeFileSync(join(dir,'query.json'),'PRIVATE_INVALID_JSON');r=run();expect(r.status).toBe(1);expect(r.stderr).not.toContain('PRIVATE_INVALID_JSON');expect(hash(readFileSync(db))).toBe(before);
 }finally{rmSync(dir,{recursive:true,force:true})}
},60000);
