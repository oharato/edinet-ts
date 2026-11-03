import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it.runIf(process.platform==='linux')('全国XMLの全分割を取得し、留保容量を保って署名検証と再開を行う',()=>{
 const result=spawnSync('python3',['test/corporate-registry-full.py'],{encoding:'utf8',timeout:30000});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 expect(result.stderr).toContain('Ran 11 tests');
},30000);
