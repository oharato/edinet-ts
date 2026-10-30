import {it,expect} from 'vitest';import {mkdtempSync,rmSync,writeFileSync} from 'node:fs';import {join,resolve} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {registryCalendarFixture} from './fixtures/corporate-registry-calendar';
it('CLIは原Shift_JISの祝日CSVを読み、未作成日と観測情報を保持する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'registry-calendar-cli-'));try{
  const source={sourceUrl:'https://example.test/source.xml',observedAt:'2026-10-29T00:00:00Z',dataDate:'2026-10-23',kind:'full',purpose:'sample'},query={corporateNumber:'1010001001202',asOf:'2026-10-26',knownAt:'2026-10-30T00:00:00Z',registryPurpose:'sample'};
  const docs=[{scope:'national',expectedParts:1,parts:[{file:'empty.xml',source}]},{scope:'national',expectedParts:1,parts:[{file:'empty.xml',source:{...source,kind:'diff',dataDate:'2026-10-26'}}]}];
  const cal=registryCalendarFixture(),manifest={policy:{file:'policy.html',sourceUrl:cal.policy.sourceUrl,observedAt:cal.policy.observedAt},holidays:{file:'holidays.csv',sourceUrl:cal.holidays.sourceUrl,observedAt:cal.holidays.observedAt}};
  writeFileSync(join(dir,'empty.xml'),'<corporations/>');writeFileSync(join(dir,'deliveries.json'),JSON.stringify(docs));writeFileSync(join(dir,'query.json'),JSON.stringify(query));writeFileSync(join(dir,'calendar.json'),JSON.stringify(manifest));writeFileSync(join(dir,'policy.html'),cal.policy.html);
  writeFileSync(join(dir,'holidays.csv'),Buffer.from('8d9196af82cc8f6a93fa81458b7893fa8c8e93fa2c8d9196af82cc8f6a93fa81458b7893fa96bc8fcc0d0a323032362f312f312c8cb393fa0d0a','hex'));
  const run=()=>spawnSync(process.execPath,['--import','tsx',resolve('src/cli.ts'),'reconstruct-corporate-registry','--manifest',join(dir,'deliveries.json'),'--query',join(dir,'query.json'),'--calendar',join(dir,'calendar.json')],{encoding:'utf8'});
  let r=run();expect(r.status,r.stderr).toBe(0);expect(JSON.parse(r.stdout)).toMatchObject({selection:{status:'unavailable',reason:'not-in-baseline'},coverage:{through:'2026-10-26'},calendar:{status:'available',firstYear:2026,lastYear:2026},nonPublicationDays:[{date:'2026-10-24',reason:'weekend'},{date:'2026-10-25',reason:'weekend'}]});
  writeFileSync(join(dir,'holidays.csv'),Buffer.from([0x81]));r=run();expect(r.status).toBe(1);expect(r.stdout).toBe('');expect(r.stderr).not.toContain(dir);
 }finally{rmSync(dir,{recursive:true,force:true})}
});
