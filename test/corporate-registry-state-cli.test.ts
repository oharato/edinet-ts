import {it,expect} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {reconstructCorporateRegistryState} from '../src/corporate-registry';
it('CLIはAPIと同じ空の全国全件を返し、分割不足を読み込み前に拒否する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'registry-state-cli-'));try{
  const source={sourceUrl:'https://example.test/full.xml',observedAt:'2026-10-30T00:00:00Z',dataDate:'2026-10-29',kind:'full' as const,purpose:'sample' as const};
  const query={corporateNumber:'1010001001202',asOf:'2026-10-29',knownAt:source.observedAt,registryPurpose:'sample' as const};
  const manifest=[{scope:'national' as const,expectedParts:1,parts:[{file:'full.xml',source}]}];writeFileSync(join(dir,'full.xml'),'<corporations/>');writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));writeFileSync(join(dir,'query.json'),JSON.stringify(query));
  const run=()=>spawnSync(process.execPath,['--import','tsx',resolve('src/cli.ts'),'reconstruct-corporate-registry','--manifest',join(dir,'manifest.json'),'--query',join(dir,'query.json')],{encoding:'utf8'});
  let r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toEqual(reconstructCorporateRegistryState([{scope:'national',expectedParts:1,parts:[{xml:'<corporations/>',source}]}],query));
  manifest[0].expectedParts=2;writeFileSync(join(dir,'manifest.json'),JSON.stringify(manifest));r=run();expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).not.toContain(dir);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
