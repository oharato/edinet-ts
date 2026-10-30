import {mkdtempSync,rmSync,readFileSync,writeFileSync,mkdirSync,existsSync,symlinkSync,linkSync,unlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {crashDatabase} from './fixtures/sqlite-crash';
import {createHash} from 'node:crypto';
import {beforeAll,afterAll,it,expect} from 'vitest';
import {ObservedFinancialArchive,FinancialSourceJob,FinancialIndexBuild,FinancialSearchIndex,FinancialIndexPublication,CompanyMasterStore,CorporateRegistryStore,CorporateRegistryBlockStore,LargeHoldingStore,FacilityDetailStore,recoverDedicatedSqliteSnapshot,type DedicatedSqliteRecoveryKind} from '../src/index';
const hash=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const formats=[['observed-financial-archive',ObservedFinancialArchive,'archive_format'],['financial-source-job',FinancialSourceJob,'source_job_format'],['financial-index-build',FinancialIndexBuild,'financial_build_format'],['financial-search-index',FinancialSearchIndex,'financial_index_format'],['financial-index-publication',FinancialIndexPublication,'publication_format'],['company-master-store',CompanyMasterStore,'master_format'],['corporate-registry-store',CorporateRegistryStore,'registry_format'],['corporate-registry-block-store',CorporateRegistryBlockStore,'block_format'],['large-holding-store',LargeHoldingStore,'holding_format'],['facility-detail-store',FacilityDetailStore,'facility_format']] as const;
function openSource(dir:string){const source=join(dir,'source.sqlite'),outputDirectory=join(dir,'candidate');return{source,outputDirectory,kind:'observed-financial-archive' as const,databaseSha256:hash(readFileSync(source)),journalSha256:hash(readFileSync(source+'-journal'))};}
let fixtureDir:string,main:Buffer,journal:Buffer,original:Buffer;
beforeAll(async()=>{
 fixtureDir=mkdtempSync(join(tmpdir(),'sqlite-recovery-fixture-'));const file=join(fixtureDir,'source.sqlite'),a=new ObservedFinancialArchive(file);a.append(Array.from({length:100},(_,i)=>({observationId:'o'+i,observedAt:'2026-10-28T00:00:00Z',document:{docID:'A'+i}})));a.close();original=readFileSync(file);
 await crashDatabase(file,fixtureDir,"UPDATE archive_observations SET body=body||printf('%050000d',1)");main=readFileSync(file);journal=readFileSync(file+'-journal');expect(main.equals(original)).toBe(false);expect(journal.subarray(0,8).toString('hex')).toBe('d9d505f920a163d7');
},20000);
afterAll(()=>rmSync(fixtureDir,{recursive:true,force:true}));
function fixture(run:(options:ReturnType<typeof openSource>,dir:string)=>void){const dir=mkdtempSync(join(tmpdir(),'sqlite-recovery-'));try{writeFileSync(join(dir,'source.sqlite'),main);writeFileSync(join(dir,'source.sqlite-journal'),journal);run(openSource(dir),dir);}finally{rmSync(dir,{recursive:true,force:true});}}
it('SIGKILL後の複数区画をrollbackし、元DB/journalと全観測を保持',()=>fixture(options=>{
 const result=recoverDedicatedSqliteSnapshot(options);expect(result).toMatchObject({integrityCheck:'ok',schemaCheck:'matched',applicationRecordsValidated:false,journal:{ignoredUnsyncedTail:true}});expect(result.journal.segments).toBeGreaterThan(1);expect(result.output.sha256).toBe(hash(original));expect(readFileSync(result.output.path).equals(original)).toBe(true);expect(readFileSync(options.source).equals(main)).toBe(true);expect(readFileSync(options.source+'-journal').equals(journal)).toBe(true);
 expect(JSON.parse(readFileSync(join(options.outputDirectory,'manifest.json'),'utf8'))).toEqual(result);const a=new ObservedFinancialArchive(result.output.path,{readOnly:true});try{expect(a.observation('o99')!.document.docID).toBe('A99');expect(a.observationsSha256()).toHaveLength(64);}finally{a.close();}
 expect(()=>recoverDedicatedSqliteSnapshot(options)).toThrow();expect(readFileSync(result.output.path).equals(original)).toBe(true);
}));
it.each(formats)('%sの固定schemaを検査して復旧する',async(kind,Constructor,table)=>{
 const dir=mkdtempSync(join(tmpdir(),'sqlite-recovery-kind-'));try{
 const source=join(dir,'source.sqlite'),db=new Constructor(source);db.close();const before=readFileSync(source);await crashDatabase(source,dir,`UPDATE ${table} SET kind=kind||printf('%0500000d',1)`);
 const result=recoverDedicatedSqliteSnapshot({...openSource(dir),kind});expect(readFileSync(result.output.path).equals(before)).toBe(true);const restored=new Constructor(result.output.path,{readOnly:true});restored.close();
 }finally{rmSync(dir,{recursive:true,force:true});}
},20000);
it.each(['checksum','short','header','page','sector','count','duplicate','originalPages','pageSize'])('破損journal %sは候補を残さない',kind=>fixture((options)=>{
 let bytes=Buffer.from(journal);if(kind==='short')bytes=bytes.subarray(0,520);else if(kind==='checksum')bytes[512+4+4096-200]^=1;else if(kind==='header')bytes[0]=0;else if(kind==='page')bytes.writeUInt32BE(0,512);else if(kind==='sector')bytes.writeUInt32BE(3,20);else if(kind==='count')bytes.writeUInt32BE(0xfffffffe,8);else if(kind==='originalPages')bytes.writeUInt32BE(0xffffffff,16);else if(kind==='pageSize')bytes.writeUInt32BE(3,24);else {const sector=bytes.readUInt32BE(20),page=bytes.readUInt32BE(24),count=bytes.readUInt32BE(8),next=Math.ceil((sector+count*(page+8))/sector)*sector;bytes.writeUInt32BE(bytes.readUInt32BE(sector),next+sector);}writeFileSync(options.source+'-journal',bytes);options.journalSha256=hash(bytes);
 expect(()=>recoverDedicatedSqliteSnapshot(options)).toThrow();expect(existsSync(options.outputDirectory)).toBe(false);expect(readFileSync(options.source+'-journal').equals(bytes)).toBe(true);
}));
it('super-journalの外部パスをSQLiteへ渡さず、外部ファイルも保持',()=>fixture((options,dir)=>{
 const victim=join(dir,'victim-mj123456900');writeFileSync(victim,'untouched external file');const name=Buffer.from(victim),footer=Buffer.alloc(16);footer.writeUInt32BE(name.length,0);footer.writeUInt32BE([...name].reduce((n,b)=>n+b,0),4);Buffer.from('d9d505f920a163d7','hex').copy(footer,8);const bytes=Buffer.concat([journal,name,footer]);writeFileSync(options.source+'-journal',bytes);options.journalSha256=hash(bytes);
 expect(()=>recoverDedicatedSqliteSnapshot(options)).toThrow('単独DB');expect(readFileSync(victim,'utf8')).toBe('untouched external file');expect(existsSync(options.outputDirectory)).toBe(false);
}));
it.each(['-wal','-shm'])('WAL系副ファイル%sを変更せず拒否',suffix=>fixture((options)=>{
 writeFileSync(options.source+suffix,'keep');expect(()=>recoverDedicatedSqliteSnapshot(options)).toThrow('WAL');expect(readFileSync(options.source+suffix,'utf8')).toBe('keep');expect(existsSync(options.outputDirectory)).toBe(false);
}));
it.each(['source-symlink','journal-symlink','source-hardlink','journal-hardlink'])('%sを拒否し元内容を保持',type=>fixture((options,dir)=>{
 const source=type.startsWith('source')?options.source:options.source+'-journal',other=join(dir,'other'),before=readFileSync(source);if(type.endsWith('symlink')){writeFileSync(other,before);unlinkSync(source);symlinkSync(other,source);}else linkSync(source,other);
 expect(()=>recoverDedicatedSqliteSnapshot(options)).toThrow();expect(readFileSync(other).equals(before)).toBe(true);expect(existsSync(options.outputDirectory)).toBe(false);
}));
it('異なる指紋/形式・不正入力を拒否し既存出力先を保持',()=>fixture((options)=>{
 for(const changed of [{databaseSha256:'0'.repeat(64)},{journalSha256:'0'.repeat(64)},{kind:'financial-source-job'},{kind:'toString'},{kind:'unknown'},{extra:true}]){expect(()=>recoverDedicatedSqliteSnapshot({...options,...changed} as never)).toThrow();expect(existsSync(options.outputDirectory)).toBe(false);}
 mkdirSync(options.outputDirectory);writeFileSync(join(options.outputDirectory,'keep'),'keep');expect(()=>recoverDedicatedSqliteSnapshot(options)).toThrow();expect(readFileSync(join(options.outputDirectory,'keep'),'utf8')).toBe('keep');expect(readFileSync(options.source).equals(main)).toBe(true);expect(readFileSync(options.source+'-journal').equals(journal)).toBe(true);
}));

it('同期前の次headerが途中で切れても、同期済み区画だけで復旧する',()=>fixture(options=>{
 const sector=journal.readUInt32BE(20),bytes=journal.subarray(0,journal.length-sector+4);writeFileSync(options.source+'-journal',bytes);options.journalSha256=hash(bytes);
 const result=recoverDedicatedSqliteSnapshot(options);expect(result.journal.ignoredUnsyncedTail).toBe(true);expect(readFileSync(result.output.path).equals(original)).toBe(true);
}));

it('gzip保存方式の識別子をhot journal復旧後も保持する',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'sqlite-recovery-gzip-'));
 try{
  const source=join(dir,'source.sqlite'),db=new ObservedFinancialArchive(source,{compression:'gzip'});db.close();const before=readFileSync(source);
  await crashDatabase(source,dir,"UPDATE archive_format SET kind=kind||printf('%0500000d',1)");
  const result=recoverDedicatedSqliteSnapshot(openSource(dir));expect(readFileSync(result.output.path)).toEqual(before);
  const restored=new ObservedFinancialArchive(result.output.path,{readOnly:true});restored.close();
 }finally{rmSync(dir,{recursive:true,force:true})}
},20000);
