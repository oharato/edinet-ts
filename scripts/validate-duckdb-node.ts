/** Experimental read-path validation; does not change production exports or dependencies. */
import {strict as assert} from 'node:assert';
import {createHash} from 'node:crypto';
import {copyFileSync,readFileSync,writeFileSync,mkdirSync,statSync,existsSync} from 'node:fs';
import {resolve,dirname,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {Database} from '../src/db/node-sqlite';
import {FinancialSearchIndex} from '../src/db/financial-search-index';
import {FinancialIndexPublication} from '../src/db/financial-index-publication';
import {Project,SyntaxKind} from 'ts-morph';

const root=process.cwd(), output=resolve(process.env.DUCKDB_NODE_OUTPUT??'data/benchmarks/duckdb-node'),
    modulePath=process.env.DUCKDB_NODE_MODULE??'/tmp/edinet-duckdb-node-validation/node_modules/@duckdb/node-api/lib/index.js',
    original=resolve('data/roadmap/daily-financial-compressed-v2/2026-10-30/candidate/reconstructed/index.sqlite'),
    previous=resolve('data/benchmarks/duckdb-2-production'), script=resolve('scripts/validate-duckdb-node.ts');
const sha=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const json=(v:any)=>JSON.stringify(v);
const median=(v:number[])=>[...v].sort((a,b)=>a-b)[Math.floor(v.length/2)];
const duckModule=()=>import(pathToFileURL(modulePath).href);
const memory=()=>({rss:process.memoryUsage().rss,heapUsed:process.memoryUsage().heapUsed,maxRSS:process.resourceUsage().maxRSS*1024});

async function main(){
if(!process.env.DUCKDB_NODE_ENGINE){
    assert(!existsSync(output),'Use a fresh DUCKDB_NODE_OUTPUT directory');mkdirSync(output,{recursive:true});
    const before=sha(readFileSync(original));
    const sqlite=join(output,'index.sqlite'),duck=join(output,'index.duckdb');
    copyFileSync(join(previous,'projection.sqlite'),sqlite);copyFileSync(join(previous,'projection.duckdb'),duck);
    const src=new Database(original,{readOnly:true}), meta=src.prepare('SELECT * FROM financial_generations ORDER BY length(body) DESC LIMIT 1'), declaration=meta.get()!;meta.close();src.close();
    const local=new Database(sqlite);
    local.exec('CREATE TABLE financial_index_format(kind TEXT NOT NULL); CREATE TABLE financial_generations(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)');
    local.exec("INSERT INTO financial_index_format VALUES('edinet-ts-financial-search-index-v1')");
    const insert=local.prepare('INSERT INTO financial_generations VALUES(?,?,?)');insert.run(declaration.id,declaration.body,declaration.sha256);insert.close();
    const {DuckDBInstance}=await duckModule(),instance=await DuckDBInstance.create(duck,{threads:'1'}),connection=await instance.connect();
    await connection.run('CREATE TABLE financial_generations(id VARCHAR PRIMARY KEY,body VARCHAR NOT NULL,sha256 VARCHAR NOT NULL)');
    await connection.run('INSERT INTO financial_generations VALUES(?,?,?)',[declaration.id,declaration.body,declaration.sha256]);
    await connection.run('CHECKPOINT');connection.closeSync();instance.closeSync();
    // Reuse read algorithms verbatim; make DB calls asynchronous, translate the SQLite index hint and unbounded LIMIT.
    const sourcePath=resolve('src/db/financial-search-index.ts'),source=readFileSync(sourcePath,'utf8'),project=new Project({useInMemoryFileSystem:true}),file=project.createSourceFile('/index.ts',source),cls=file.getClassOrThrow('FinancialSearchIndex');
    const methods=['audit','generation','quality','screen'].map(name=>{
        const method=cls.getMethodOrThrow(name), temp=project.createSourceFile('/'+name+'.ts','class ReadPath {'+method.getText()+'}'),m=temp.getClassOrThrow('ReadPath').getMethods()[0];
        m.setIsAsync(true);
        const returnType=m.getReturnTypeNode()?.getText();if(returnType)m.setReturnType('Promise<'+returnType+'>');
        for(const arrow of m.getDescendantsOfKind(SyntaxKind.ArrowFunction))
            if(arrow.getParentIfKind(SyntaxKind.CallExpression)?.getExpression().getText()==='this.transaction')arrow.setIsAsync(true);
        const calls=m.getDescendantsOfKind(SyntaxKind.CallExpression).filter(call=>['this.rows','this.audit','this.transaction'].includes(call.getExpression().getText())).sort((a,b)=>b.getStart()-a.getStart());
        for(const call of calls)call.replaceWithText('(await '+call.getText()+')');
        return m.getText();
    }).join('\n');
    const prefix=source.slice(0,source.indexOf('/** 観測アーカイブを入力に'))
        .replace(/from (["'])(\.[^"']+)\1/g,(_match,quote,path)=>'from '+quote+resolve(dirname(sourcePath),path)+'.ts'+quote);
    const generated=prefix+`\nexport class DuckValidationIndex {\nconstructor(private connection:any) {}\nasync rows(sql:string,args:any[]=[]){\n if(sql.endsWith('LIMIT ? OFFSET ?')&&args.at(-2)===-1){sql=sql.slice(0,-'LIMIT ? OFFSET ?'.length)+'LIMIT ALL OFFSET ?';args=[...args.slice(0,-2),args.at(-1)]}\n const result=await this.connection.runAndReadAll(sql.replace(/ INDEXED BY financial_metric_range/g,''),args);\n return result.getRowObjects().map((row:any)=>Object.fromEntries(Object.entries(row).map(([k,v])=>{if(typeof v==='bigint'){const n=Number(v);if(!Number.isSafeInteger(n))throw Error('Unsafe bigint');return [k,n]}return [k,v]})));\n}\nasync transaction(fn:any,_write=false){await this.connection.run('BEGIN');try{const result=await fn();await this.connection.run('COMMIT');return result}catch(e){await this.connection.run('ROLLBACK');throw e}}\n${methods}\n}\n`;
    writeFileSync(join(output,'duck-read-path.ts'),generated);
    const groupStatement=local.prepare('SELECT group_id,standard,scope,currency,period_start,period_end,period_type,COUNT(*) AS n FROM financial_rows GROUP BY 1,2,3,4,5,6,7 ORDER BY n DESC'),groups=groupStatement.all();groupStatement.close();
    const chosen:any[]=[];
    for(const group of groups)if(!chosen.some(c=>c.standard===group.standard&&c.group_id===group.group_id)&&chosen.length<4)chosen.push(group);
    assert.equal(chosen.length,4,'Need J-GAAP/IFRS BS/details');
    const cases:any[]=[];
    for(const g of chosen){
        const clause='group_id=? AND standard=? AND scope=? AND currency=? AND period_start=? AND period_end=? AND period_type=?',params=[g.group_id,g.standard,g.scope,g.currency,g.period_start,g.period_end,g.period_type];
        const statement=local.prepare('SELECT doc_id,edinet_code,sec_code FROM financial_rows WHERE '+clause+' ORDER BY sec_code,doc_id'),rows=statement.all(...params);statement.close();
        const seen=new Set(),docs=[];
        for(const row of rows)if(!seen.has(row.edinet_code)&&!seen.has(row.sec_code)&&docs.length<1000){docs.push(row.doc_id);seen.add(row.edinet_code);seen.add(row.sec_code)}
        const ms=local.prepare('SELECT metric_id FROM financial_values WHERE row_id=(SELECT row_id FROM financial_rows WHERE doc_id=? AND group_id=? LIMIT 1) ORDER BY metric_order'),metrics=ms.all(docs[0],g.group_id).map(r=>r.metric_id);ms.close();
        const cohort={generation:declaration.id,group:g.group_id,accountingStandard:g.standard,scope:g.scope,currency:g.currency,period:g.group_id==='balanceSheet'?{instant:g.period_end}:{startDate:g.period_start,endDate:g.period_end},...(g.group_id==='details'?{periodType:g.period_type}:{}),docIDs:docs};
        const name=g.standard+'/'+g.group_id;
        cases.push({name:name+'/ranking',cohort,options:{metricIds:metrics,sortBy:metrics[0],order:'desc',limit:100}});
        cases.push({name:name+'/multi-page',cohort,options:{metricIds:metrics,conditions:metrics.slice(0,2).map(metric=>({metric,operator:'gte',value:0})),sortBy:metrics[0],order:'asc',offset:5,limit:20}});
        cases.push({name:name+'/empty',cohort,options:{metricIds:metrics,conditions:[{metric:metrics[0],operator:'gt',value:Number.MAX_SAFE_INTEGER}],limit:10}});
    }
    const validation={generation:declaration.id,cases,original,originalSha256:before,readSourceSha256:sha(source),copiedTables:['financial_generations','financial_rows','financial_values'],nodePackageVersion:'2.0.0-r.1'};
    writeFileSync(join(output,'input.json'),json(validation));local.close();
    for(const engine of ['sqlite','duckdb']){
        const child=spawnSync(process.execPath,['--import','tsx',script],{cwd:root,env:{...process.env,DUCKDB_NODE_OUTPUT:output,DUCKDB_NODE_ENGINE:engine},stdio:'inherit'});assert.equal(child.status,0,engine+' worker failed');
    }
    const s=JSON.parse(readFileSync(join(output,'sqlite.json'),'utf8')),d=JSON.parse(readFileSync(join(output,'duckdb.json'),'utf8'));
    assert.deepEqual(d.outputs,s.outputs);assert.deepEqual(d.measurements.boundaryResults,s.measurements.boundaryResults);for(const result of Object.values(d.measurements.boundaryResults) as any[])assert.equal(result.ok,true);assert.equal(d.qualitySha256,s.qualitySha256);assert.equal(d.generationSha256,s.generationSha256);
    assert.equal(sha(readFileSync(original)),before);assert.equal(sha(readFileSync(sourcePath)),sha(source),'Read-path source changed during validation');
    const summary={node:process.version,sourceUnchanged:true,allSearchOutputsEqual:true,allBoundaryOutputsEqual:true,qualityAndGenerationEqual:true,sourceCodeSha256:sha(source),sqlite:s.measurements,duckdb:d.measurements,lifecycle:d.lifecycle,duckdbExistingPublicationAccepted:d.existingPublicationAccepted,bytes:{sqlite:statSync(sqlite).size,duckdb:statSync(duck).size},cases:cases.map(c=>({name:c.name,companies:c.cohort.docIDs.length}))};
    writeFileSync(join(output,'results.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary,null,2));return;
}
const engine=process.env.DUCKDB_NODE_ENGINE,input=JSON.parse(readFileSync(join(output,'input.json'),'utf8'));
const beforeMemory=memory(),started=performance.now();let index:any,connection:any,instance:any,cleanup:any;
if(engine==='sqlite'){index=new FinancialSearchIndex(join(output,'index.sqlite'),{readOnly:true});cleanup=()=>index.close();}
else{
    // Match the SQLite reader's private-copy lifetime; validate the exact known input bytes.
    const copy=join(output,'reader.duckdb');copyFileSync(join(output,'index.duckdb'),copy);assert.equal(sha(readFileSync(copy)),sha(readFileSync(join(output,'index.duckdb'))));
    const {DuckDBInstance}=await duckModule();instance=await DuckDBInstance.create(copy,{access_mode:'READ_ONLY',threads:'1'});connection=await instance.connect();
    const {DuckValidationIndex}=await import(pathToFileURL(join(output,'duck-read-path.ts')).href);index=new DuckValidationIndex(connection);cleanup=()=>{connection.closeSync();instance.closeSync()};
}
const openMs=performance.now()-started,afterOpen=memory(),generation=await index.generation(input.generation),qualityStart=performance.now(),quality=await index.quality(input.generation),qualityMs=performance.now()-qualityStart;
const outputs:any={},measurements:any={openMs,beforeMemory,afterOpen,qualityMs,cases:{}};
for(const c of (process.env.DUCKDB_NODE_BOUNDARIES_ONLY?[]:input.cases)){
    const first=await index.screen(c.cohort,c.options);outputs[c.name]=first;
    const times=[];
    for(let i=0;i<5;i++){const start=performance.now(),result=await index.screen(c.cohort,c.options);times.push(performance.now()-start);assert.deepEqual(result,first)}
    measurements.cases[c.name]={medianMs:median(times),samplesMs:times,rows:first.rows.length,total:first.total,excludedRows:first.excludedRows,diagnostics:first.diagnostics.length};
    console.log(engine,c.name,measurements.cases[c.name].medianMs.toFixed(1)+' ms');
}
const profile:any={audit:{ms:0,calls:0},rows:{ms:0,calls:0}};
if(process.env.DUCKDB_NODE_BOUNDARIES_ONLY)for(const method of ['audit','rows']){
    const originalMethod=index[method].bind(index);
    index[method]=(...args:any[])=>{const start=performance.now(),finish=()=>{profile[method].ms+=performance.now()-start;profile[method].calls++};try{const value=originalMethod(...args);if(value instanceof Promise)return value.finally(finish);finish();return value}catch(e){finish();throw e}};
}
// Boundary options often differ between SQL engines; preserve failures as evidence.
const boundaryResults:any={};
for(const [name,options] of Object.entries({unbounded:{metricIds:input.cases[0].options.metricIds},zeroLimit:{...input.cases[0].options,limit:0},offsetOnly:{metricIds:input.cases[0].options.metricIds,offset:5}})){
    try{const result=await index.screen(input.cases[0].cohort,options);boundaryResults[name]={ok:true,sha256:sha(json(result)),rows:result.rows.length}}
    catch(e){boundaryResults[name]={ok:false,error:(e as Error).message}}
}
measurements.boundaryResults=boundaryResults;measurements.boundaryProfile=profile;
const invalid=structuredClone(input.cases[0]);invalid.options.metricIds=['unknown'];await assert.rejects(async()=>index.screen(invalid.cohort,invalid.options));
measurements.afterQueries=memory();let lifecycle:any,existingPublicationAccepted:any;
if(engine==='duckdb'&&!process.env.DUCKDB_NODE_BOUNDARIES_ONLY){
    const catalog=new FinancialIndexPublication(':memory:');
    try{catalog.prepare('duck-test',index,input.generation);existingPublicationAccepted=true}catch(e){existingPublicationAccepted=false;assert.match((e as Error).message,/財務索引/)}finally{catalog.close()}
    // Experimental reader lifecycle. Two real company-part generations exercise differing snapshots.
    const src=new Database(original,{readOnly:true}),stmt=src.prepare('SELECT id FROM financial_generations g WHERE id<>? AND EXISTS(SELECT 1 FROM financial_rows r WHERE r.generation=g.id) ORDER BY id LIMIT 2'),parts=stmt.all(input.generation).map(r=>r.id);stmt.close();assert.equal(parts.length,2);
    cleanup();
    const {DuckDBInstance}=await duckModule(),writerInstance=await DuckDBInstance.create(join(output,'lifecycle.duckdb'),{threads:'1'}),writer=await writerInstance.connect();
    for(const table of ['financial_generations','financial_rows','financial_values']){
        const cols=src.prepare('PRAGMA table_info('+table+')'),info=cols.all();cols.close();const types:any={TEXT:'VARCHAR',INTEGER:'BIGINT',REAL:'DOUBLE'};
        await writer.run('CREATE TABLE '+table+' ('+info.map(c=>'"'+c.name+'" '+types[c.type as string]).join(',')+')');
        const statement=src.prepare('SELECT * FROM '+table+' WHERE '+(table==='financial_generations'?'id':'generation')+' IN (?,?)'),rows=statement.all(...parts);statement.close();
        for(const row of rows)await writer.run('INSERT INTO '+table+' VALUES('+Object.keys(row).map(()=>'?').join(',')+')',Object.values(row));
    }
    src.close();await writer.run('CHECKPOINT');writer.closeSync();writerInstance.closeSync();
    const nextInstance=await DuckDBInstance.create(join(output,'lifecycle.duckdb'),{access_mode:'READ_ONLY',threads:'1'}),nextConnection=await nextInstance.connect(),{DuckValidationIndex}=await import(pathToFileURL(join(output,'duck-read-path.ts')).href),nextIndex=new DuckValidationIndex(nextConnection);
    let active:any;const reload=async(id:string,candidate:any=nextIndex)=>{const report=await candidate.generation(id),q=await candidate.quality(id);active={id,generationSha256:sha(json(report)),qualitySha256:sha(json(q))};return structuredClone(active)};
    const a=await reload(parts[0]),b=await reload(parts[1]);assert.notEqual(a.id,b.id);await assert.rejects(()=>reload('missing-generation'));assert.deepEqual(active,b);assert.deepEqual(await reload(parts[0]),a);
    const corruptFile=join(output,'corrupt.duckdb');copyFileSync(join(output,'lifecycle.duckdb'),corruptFile);
    const corruptWriterInstance=await DuckDBInstance.create(corruptFile,{threads:'1'}),corruptWriter=await corruptWriterInstance.connect();
    await corruptWriter.run('UPDATE financial_values SET available=1-available WHERE (generation,row_id,metric_id) IN (SELECT generation,row_id,metric_id FROM financial_values LIMIT 1)');
    await corruptWriter.run('CHECKPOINT');corruptWriter.closeSync();corruptWriterInstance.closeSync();
    const corruptInstance=await DuckDBInstance.create(corruptFile,{access_mode:'READ_ONLY',threads:'1'}),corruptConnection=await corruptInstance.connect(),corruptIndex=new DuckValidationIndex(corruptConnection);
    const badGeneration=(await corruptConnection.runAndReadAll('SELECT generation FROM financial_values LIMIT 1')).getRowObjects()[0].generation;
    await assert.rejects(()=>reload(badGeneration,corruptIndex),/不整合/);assert.deepEqual(active,a);
    corruptConnection.closeSync();corruptInstance.closeSync();
    lifecycle={experimentalOnly:true,twoActualCompanyParts:true,switch:true,failedReloadKeepsPrevious:true,rollback:true,corruptValueRejected:true,existingPublishedReaderCompatible:false,synchronousApiCompatible:false};
    nextConnection.closeSync();nextInstance.closeSync();cleanup=()=>{};
}
measurements.afterLifecycle=memory();cleanup();
writeFileSync(join(output,engine+(process.env.DUCKDB_NODE_BOUNDARIES_ONLY?'-boundaries':'')+'.json'),JSON.stringify({outputs,qualitySha256:sha(json(quality)),generationSha256:sha(json(generation)),measurements,lifecycle,existingPublicationAccepted}));
}
main().catch(e=>{console.error(e);process.exitCode=1});
