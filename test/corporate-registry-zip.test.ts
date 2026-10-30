import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it.runIf(process.platform==='linux')('ZIP全entryと署名を照合し、不足・重複・余分なpath・改変・容量不足を拒否する',()=>{
 const result=spawnSync('python3',['test/corporate-registry-zip.py'],{encoding:'utf8',timeout:30000});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 expect(result.stderr).toContain('Ran 11 tests');
},30000);
