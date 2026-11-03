import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it.runIf(process.platform==='linux')('取得予算付き複数日収集を再開し、未作成日と失敗・未取得を分ける',()=>{
 const result=spawnSync('python3',['test/corporate-registry-collection.py'],{encoding:'utf8',timeout:30000});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 expect(result.stderr).toContain('Ran 7 tests');
},30000);
