import {spawnSync} from 'node:child_process';
import {expect,it} from 'vitest';

it.runIf(process.platform==='linux')('署名と取得hashを照合し、別鍵・改変・欠落・symlink・証跡上書きを拒否する',()=>{
 const result=spawnSync('python3',['test/corporate-registry-signature.py'],{encoding:'utf8',timeout:30000});
 expect(result.error).toBeUndefined();
 expect(result.status,result.stderr).toBe(0);
 expect(result.stderr).toContain('Ran 6 tests');
},30000);
