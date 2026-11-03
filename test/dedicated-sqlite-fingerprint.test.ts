import * as fs from 'node:fs';
import{tmpdir}from'node:os';import{join}from'node:path';import{createHash}from'node:crypto';
import{it,expect,vi}from'vitest';import{DedicatedSqliteDatabase}from'../src/db/dedicated-sqlite';
vi.mock('node:fs',async()=>{const actual=await vi.importActual<typeof import('node:fs')>('node:fs');return{...actual,readSync:vi.fn(actual.readSync)};});
const format={table:'fingerprint_format',kind:'fingerprint-test',schema:{fingerprint_format:'CREATE TABLE fingerprint_format(kind TEXT NOT NULL)',content:'CREATE TABLE content(value TEXT)'}};
class Fixture extends DedicatedSqliteDatabase{constructor(path:string,readOnly=false){super(path,{readOnly},format);}fingerprint(){return this.readOnlySnapshotSha256();}add(){this.transaction(()=>this.run('INSERT INTO content VALUES (?)',['changed']));}}
function fixture(fn:(s:{path:string,source:Fixture,probe:string,dir:string})=>void){const dir=fs.mkdtempSync(join(tmpdir(),'fingerprint-test-')),path=join(dir,'source.sqlite');const writer=new Fixture(path);writer.add();writer.close();const source=new Fixture(path,true);try{fn({path,source,dir,probe:(source as unknown as{snapshotFile:string}).snapshotFile});}finally{source.close();fs.rmSync(dir,{recursive:true,force:true});}}
it('私有snapshotのhashを一致確認し、同じ実体の再呼出しでは本文を読み直さない',()=>fixture(({path,source})=>{
 const expected=createHash('sha256').update(fs.readFileSync(path)).digest('hex');vi.mocked(fs.readSync).mockClear();expect(source.fingerprint()).toBe(expected);const calls=vi.mocked(fs.readSync).mock.calls.length;expect(calls).toBeGreaterThan(0);expect(source.fingerprint()).toBe(expected);expect(vi.mocked(fs.readSync).mock.calls).toHaveLength(calls);
}));
it('元ファイルの変更は固定済みcopyに混ぜず、新しくopenしたsnapshotは新hashになる',()=>fixture(({path,source})=>{
 const before=source.fingerprint(),writer=new Fixture(path);writer.add();writer.close();expect(source.fingerprint()).toBe(before);const updated=new Fixture(path,true);try{expect(updated.fingerprint()).not.toBe(before);}finally{updated.close();}
}));
it.each(['rewrite','replace','truncate','hardlink','symlink']as const)('固定済み私有copyの%sを再利用しない',action=>fixture(({source,probe,dir})=>{
 source.fingerprint();const bytes=fs.readFileSync(probe);if(action==='rewrite')fs.writeFileSync(probe,bytes);else if(action==='truncate')fs.truncateSync(probe,0);else if(action==='hardlink')fs.linkSync(probe,join(dir,'link'));else{const replacement=join(dir,'replacement');fs.writeFileSync(replacement,bytes);fs.unlinkSync(probe);if(action==='replace')fs.renameSync(replacement,probe);else fs.symlinkSync(replacement,probe);}expect(()=>source.fingerprint()).toThrow();
}));
it('cacheの有無にかかわらずclose済み/書込用DBでの指紋取得を拒否する',()=>fixture(({path,source})=>{
 source.fingerprint();source.close();expect(()=>source.fingerprint()).toThrow();const writer=new Fixture(path);try{expect(()=>writer.fingerprint()).toThrow();}finally{writer.close();}
}));
