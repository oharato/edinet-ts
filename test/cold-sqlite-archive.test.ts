import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it.runIf(process.platform==='linux')('SQLite全byteの圧縮復元を確認し、改変・利用中・不明プロセス・容量不足・上書きを拒否する',()=>{
 const result=spawnSync('python3',['test/cold-sqlite-archive.py'],{encoding:'utf8',timeout:30000});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 expect(result.stderr).toContain('Ran 14 tests');
},30000);
