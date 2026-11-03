import {it,expect} from 'vitest';
import {mkdtempSync,openSync,ftruncateSync,closeSync,rmSync,writeFileSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {assertRegularFileByteBudget as check,readRegularFile,LOCAL_IMPORT_LIMITS as limits} from '../src/local-balance-sheet-import';
it('通常ファイルだけのサイズを集計し、重複指定も数え、上限ぴったりは受け付ける',()=>{
 const dir=mkdtempSync(join(tmpdir(),'source-budget-'));
 try{const large=join(dir,'large'),fd=openSync(large,'w');try{ftruncateSync(fd,limits.sourceBytes)}finally{closeSync(fd)}
  expect(()=>check(Array(4).fill(large))).not.toThrow();expect(()=>check(Array(5).fill(large))).toThrow('byte上限');expect(()=>check([dir])).toThrow('通常');expect(()=>check([join(dir,'missing')])).toThrow();
  const over=join(dir,'over'),big=openSync(over,'w');try{ftruncateSync(big,limits.sourceBytes+1)}finally{closeSync(big)}expect(()=>check([over])).toThrow('byte上限');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
it('事前検査後の成長を信用せず、実読取りで再び容量を検査する',()=>{
 const dir=mkdtempSync(join(tmpdir(),'source-budget-change-')),file=join(dir,'source');
 try{writeFileSync(file,'ok');check([file]);writeFileSync(file,'grown');expect(()=>readRegularFile(file,2)).toThrow('byte上限');expect(readFileSync(file,'utf8')).toBe('grown')}
 finally{rmSync(dir,{recursive:true,force:true})}
});
