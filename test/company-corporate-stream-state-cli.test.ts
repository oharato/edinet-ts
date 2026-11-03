import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {linkCompanyMasterCorporateStreamStates as link} from '../src/company-corporate-state';
import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource as source} from './fixtures/corporate-registry-stream';
it('CLI/APIの全照合結果が一致し、相対パスを解決、不正hashを非公開で拒否、原本を保持する',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'company-stream-cli-')),sha=(v:string|Buffer)=>createHash('sha256').update(v).digest('hex');
 try{
  const text=xml(row()),file=join(dir,'full.xml');writeFileSync(file,text);
  const masters=[{asOf:'2026-10-29',observedAt:source.observedAt,sourceUrl:'https://example.test/master.csv',sourceSha256:'1'.repeat(64),records:[{entityId:'edinet:E00001',edinetCode:'E00001',corporateNumber:'1010001001202',name:'日本 & 会社',filerType:'内国法人',listingStatus:'listed' as const}]}],query={asOf:'2026-10-29',knownAt:source.observedAt,edinetCodes:['E00001'],registryPurpose:'sample' as const};
  const part={file:'full.xml',source:{...source,kind:'full' as const},sha256:sha(text)},manifest=[{scope:'national' as const,expectedParts:1,parts:[part]}];
  const expected=await link(masters,[{...manifest[0],parts:[{source:part.source,sha256:part.sha256,chunks:(async function*(){yield Buffer.from(text)})()}]}],query);
  for(const [name,value] of [['master',masters],['manifest',manifest],['query',query]])writeFileSync(join(dir,name+'.json'),JSON.stringify(value));
  const run=()=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','link-company-corporate-stream-states','--master',join(dir,'master.json'),'--manifest',join(dir,'manifest.json'),'--query',join(dir,'query.json')],{encoding:'utf8',timeout:30000});
  let r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual(expected);
  manifest[0].parts[0].sha256='0'.repeat(64);writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));r=run();expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).not.toContain(dir);expect(sha(readFileSync(file))).toBe(sha(text));
  writeFileSync(join(dir,'query.json'),'PRIVATE_INVALID');r=run();expect(r.status).toBe(1);expect(r.stderr).not.toContain('PRIVATE_INVALID');
 }finally{rmSync(dir,{recursive:true,force:true})}
},60000);
