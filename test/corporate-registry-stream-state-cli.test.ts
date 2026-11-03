import {expect,it} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource as source} from './fixtures/corporate-registry-stream';
import {reconstructCorporateRegistryStreamStates} from '../src/corporate-registry-stream-state';
import {readCorporateRegistryFileChunks} from '../src/corporate-registry-stream';
it('固定FDのCLI全量検査がAPIと一致し、対象発見後のhash不一致を拒否する',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'registry-stream-state-cli-'));
 try{
  const file=join(dir,'data.xml'),text=xml(row()),part={file,source:{...source,kind:'full' as const},sha256:createHash('sha256').update(text).digest('hex')};writeFileSync(file,text);
  const manifest=[{scope:'national' as const,expectedParts:1,parts:[part]}],query={corporateNumbers:['1010001001202'],asOf:source.dataDate,knownAt:source.observedAt,registryPurpose:source.purpose};
  writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));writeFileSync(join(dir,'query.json'),JSON.stringify(query));const expected=await reconstructCorporateRegistryStreamStates([{...manifest[0],parts:[{source:part.source,sha256:part.sha256,chunks:readCorporateRegistryFileChunks(file)}]}],query);
  const run=()=>spawnSync(process.execPath,['--import','tsx','src/cli.ts','reconstruct-corporate-registry-streams','--manifest',join(dir,'manifest.json'),'--query',join(dir,'query.json')],{encoding:'utf8',timeout:30000});let r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual(expected);part.sha256='0'.repeat(64);writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));r=run();expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(readFileSync(file,'utf8')).toBe(text);
 }finally{rmSync(dir,{recursive:true,force:true})}
},60000);

it('ZIPからの送出は全byte/CRC/hash/固定FDを検査する',()=>{
 const result=spawnSync('python3',['test/fixtures/corporate-registry-zip-stream.py'],{encoding:'utf8',timeout:30000});expect(result.status,result.stderr).toBe(0);expect(result.stderr).toContain('Ran 8 tests');
},30000);
