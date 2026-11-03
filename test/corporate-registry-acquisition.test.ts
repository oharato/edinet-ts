import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it.runIf(process.platform==='linux')('公式XML欄の選択・取得・署名・再開・排他と原本保護を検証する',()=>{
 const result=spawnSync('python3',['test/corporate-registry-acquisition.py'],{encoding:'utf8',timeout:30000});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 expect(result.stderr).toContain('Ran 13 tests');
},30000);
