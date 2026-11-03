import {it,expect,vi} from 'vitest';import fs from 'node:fs';import {join} from 'node:path';import {syncBuiltinESMExports} from 'node:module';
import {buildDuckFinancialCycle,type DuckFinancialCycleInput} from '../src/duck-financial-cycle';import {DuckFinancialSearchIndex} from '../src/db/duck-financial-search-index';import {createHash} from 'node:crypto';import {ObservedFinancialArchive} from '../src/db/observed-financial-archive';import {reportingInstance} from './fixtures/financial-reporting-basis';
import {EdinetXbrlParser} from '../src/edinet-xbrl-parser';import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
import {tmpdir} from 'node:os';
async function config(s:Parameters<Parameters<typeof fixture>[0]>[0]):Promise<DuckFinancialCycleInput>{const r=await s.duck.generation('all');return {version:1,archivePath:join(s.dir,'a.sqlite'),parsedStorePath:join(s.dir,'shared-parsed.sqlite'),outputDirectory:join(s.dir,'cycle'),build:{id:'cycle',generation:'cycle-all',archiveSha256:r.assembly!.archiveSha256,population:r.assembly!.population,options:{cutoff:r.selection.cutoff,extractorVersion:'cycle-test',sourceCommit:'a'.repeat(40)}}}}
it('解析→構築を分割再開し、cache時は再解析せず同じ結果を返す',()=>fixture(async s=>{
 const input=await config(s),first=await buildDuckFinancialCycle(input,{maxDocuments:1,maxCompanies:1});expect(first).toMatchObject({status:'partial',phase:'parse',progress:{pending:3}});const second=await buildDuckFinancialCycle(input,{maxDocuments:100,maxCompanies:1});expect(second).toMatchObject({status:'partial',phase:'build',progress:{completed:1,pending:3}});
 const parse=vi.spyOn(EdinetXbrlParser.prototype,'parse').mockImplementation(()=>{throw Error('must reuse')});let built:any;try{built=await buildDuckFinancialCycle(input,{maxDocuments:100,maxCompanies:100});expect(parse).not.toHaveBeenCalled()}finally{parse.mockRestore()}
 expect(built).toMatchObject({status:'built',financialValuesValidated:false,publicationEligible:false,quality:{rows:8}});expect(await buildDuckFinancialCycle(input)).toEqual(built);const reader=await DuckFinancialSearchIndex.open(built.indexPath);try{const c={generation:'cycle-all',group:'details',accountingStandard:'J-GAAP',scope:'Consolidated',currency:'JPY',period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual'} as const;expect(await reader.screen(c,{metricIds:['costOfSales']})).toEqual(await s.duck.screen({...c,generation:'all'},{metricIds:['costOfSales']}))}finally{await reader.close()}
}),30000);
it('別入力・未知出力先・不正batchを拒否し、既存ファイルを変更しない',()=>fixture(async s=>{
 const input=await config(s);await buildDuckFinancialCycle(input,{maxDocuments:1});await expect(buildDuckFinancialCycle({...input,build:{...input.build,generation:'changed'}})).rejects.toThrow('differs');const output=join(s.dir,'unknown');fs.mkdirSync(output);fs.writeFileSync(join(output,'important'),'keep');await expect(buildDuckFinancialCycle({...input,outputDirectory:output})).rejects.toThrow('Unowned');expect(fs.readFileSync(join(output,'important'),'utf8')).toBe('keep');await expect(buildDuckFinancialCycle(input,{maxCompanies:0})).rejects.toThrow('batch');
}));
it.each(['output','temporary'])('%sだけが容量不足でも解析・DuckDBへの書込を始めない',area=>fixture(async s=>{
 const input=await config(s),lowPath=area==='output'?input.outputDirectory:tmpdir(),stat=vi.spyOn(fs,'statfsSync').mockImplementation(path=>({bavail:String(path)===lowPath?1n:100n*1024n**3n,bsize:1n}) as any);syncBuiltinESMExports();try{await expect(buildDuckFinancialCycle(input)).rejects.toThrow('reserve');expect(stat.mock.calls.some(([path])=>String(path)===lowPath)).toBe(true);expect(fs.existsSync(input.parsedStorePath)).toBe(false);expect(fs.existsSync(join(input.outputDirectory,'index.duckdb'))).toBe(false)}finally{stat.mockRestore();syncBuiltinESMExports()}
}));
it('原本指紋不一致・中断を拒否する',()=>fixture(async s=>{
 const input=await config(s);await expect(buildDuckFinancialCycle({...input,build:{...input.build,archiveSha256:'b'.repeat(64)}})).rejects.toThrow('archive differs');const another={...input,outputDirectory:join(s.dir,'another')},controller=new AbortController();controller.abort();await expect(buildDuckFinancialCycle(another,{signal:controller.signal})).rejects.toThrow();
}));

it('完成receiptのhash・検証フラグ改変を拒否する',()=>fixture(async s=>{
 const input=await config(s);await buildDuckFinancialCycle(input,{maxDocuments:100,maxCompanies:100});const file=join(input.outputDirectory,'build.json'),saved=JSON.parse(fs.readFileSync(file,'utf8'));saved.sha256='bad';fs.writeFileSync(file,JSON.stringify(saved));await expect(buildDuckFinancialCycle(input)).rejects.toThrow('receipt differs');const canonical=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);saved.body.financialValuesValidated=true;saved.sha256=createHash('sha256').update(canonical([saved.inputSha256,saved.body])).digest('hex');fs.writeFileSync(file,JSON.stringify(saved));await expect(buildDuckFinancialCycle(input)).rejects.toThrow('Completed');
}),30000);

it('翌日追加分だけ解析し、共有Store更新後も旧候補の固定snapshotから再開する',()=>fixture(async s=>{
 const input=await config(s);expect(await buildDuckFinancialCycle(input,{maxDocuments:100,maxCompanies:1})).toMatchObject({status:'partial',phase:'build'});
 const nextArchive=join(s.dir,'next-archive.sqlite');fs.copyFileSync(input.archivePath,nextArchive);const writer=new ObservedFinancialArchive(nextArchive),xml=reportingInstance({issuer:'E12005',security:'10050'});try{writer.append([{observationId:'A5',observedAt:'2026-10-28T15:00:00Z',document:{docID:'A5',parentDocID:null,edinetCode:'E12005',secCode:'10050',docTypeCode:'120',periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-10-28 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID:'A5',availableAt:'2026-10-28T15:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex'),xml}])}finally{writer.close()}
 const ro=new ObservedFinancialArchive(nextArchive,{readOnly:true});let archiveSha256:string;try{archiveSha256=ro.snapshotSha256()}finally{ro.close()}
 const next={...input,archivePath:nextArchive,outputDirectory:join(s.dir,'next'),build:{...input.build,id:'next',generation:'next',archiveSha256,population:{...input.build.population,asOf:'2026-10-28',observedAt:'2026-10-28T15:00:00Z',edinetCodes:[...input.build.population.edinetCodes,'E12005']},options:{...input.build.options,cutoff:'2026-10-29T00:00:00Z'}}};
 const parse=vi.spyOn(EdinetXbrlParser.prototype,'parse');try{expect(await buildDuckFinancialCycle(next,{maxDocuments:100,maxCompanies:100})).toMatchObject({status:'built',quality:{rows:10}});expect(parse).toHaveBeenCalledTimes(1);parse.mockClear();expect(await buildDuckFinancialCycle(input,{maxDocuments:100,maxCompanies:100})).toMatchObject({status:'built',quality:{rows:8}});expect(parse).not.toHaveBeenCalled()}finally{parse.mockRestore()}
}),30000);

it('複数バッチは同じ原本・Store・native接続のまま処理する',()=>fixture(async s=>{
 const input=await config(s);expect(await buildDuckFinancialCycle(input,{maxDocuments:1,maxCompanies:1,maxBatches:4})).toMatchObject({status:'built',quality:{rows:8}});
}),30000);

it('解析計画は会社別の訂正系列を読み、全一覧の10,000観測制限に依存しない',()=>fixture(async s=>{
 const input=await config(s),original=ObservedFinancialArchive.prototype.readObservations;
 const read=vi.spyOn(ObservedFinancialArchive.prototype,'readObservations').mockImplementation(function(this:ObservedFinancialArchive,codes?:readonly string[]){if(codes===undefined)throw Error('Unbounded archive selection');expect(codes).toHaveLength(1);return original.call(this,codes)});
 try{expect(await buildDuckFinancialCycle(input,{maxDocuments:1})).toMatchObject({status:'partial',phase:'parse',progress:{pending:3}});expect(read).toHaveBeenCalledTimes(input.build.population.edinetCodes.length)}finally{read.mockRestore()}
}),30000);
