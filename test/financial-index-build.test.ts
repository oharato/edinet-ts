import {mkdtempSync,rmSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {it,expect} from 'vitest';
import {ObservedFinancialArchive,FinancialSearchIndex,FinancialIndexBuild,type FinancialIndexBuildInput,type FinancialIndexPopulation} from '../src/index';
import {Database} from '../src/db/node-sqlite';
import {financialIndexBuildPartId} from '../src/db/financial-search-index';
import {reportingInstance} from './fixtures/financial-reporting-basis';
const options={cutoff:'2026-10-28T00:00:00Z',extractorVersion:'build-test-1'};
const population=(codes=['E12001','E12002','E12003']):FinancialIndexPopulation=>({asOf:'2026-10-27',observedAt:'2026-10-27T15:30:00Z',source:'reviewed fixture population',sourceSha256:'a'.repeat(64),edinetCodes:codes});
function withBuild(fn:(s:ReturnType<typeof setup>)=>void){const s=setup();try{fn(s);}finally{s.close();}}
function setup(){
 const dir=mkdtempSync(join(tmpdir(),'financial-index-build-')),sourcePath=join(dir,'source.sqlite'),indexPath=join(dir,'index.sqlite'),statePath=join(dir,'state.sqlite');
 let writer=new ObservedFinancialArchive(sourcePath);for(const i of [1,2]){const docID='A'+i,edinetCode='E1200'+i,secCode='100'+i+'0',xml=reportingInstance({issuer:edinetCode,security:secCode});writer.append([{observationId:docID,observedAt:'2026-06-26T00:00:00Z',document:{docID,parentDocID:null,docTypeCode:'120',edinetCode,secCode,periodStart:'2025-04-01',periodEnd:'2026-03-31',submitDateTime:'2026-06-24 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID,availableAt:'2026-06-27T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex'),xml}]);}writer.close();
 const source=new ObservedFinancialArchive(sourcePath,{readOnly:true}),index=new FinancialSearchIndex(indexPath);let state=new FinancialIndexBuild(statePath);const input:FinancialIndexBuildInput={id:'build',generation:'all',archiveSha256:source.snapshotSha256(),population:population(),options};
 return {dir,sourcePath,indexPath,statePath,source,index,input,get state(){return state;},reopen(){state.close();state=new FinancialIndexBuild(statePath);},close(){state.close();index.close();source.close();rmSync(dir,{recursive:true,force:true});}};
}
const cohort={generation:'all',group:'details' as const,accountingStandard:'J-GAAP' as const,scope:'Consolidated' as const,currency:'JPY' as const,period:{startDate:'2025-04-01',endDate:'2026-03-31'},periodType:'annual' as const};
it('母集団を固定して会社別checkpointから再開し、一つの検索世代へ集約する',()=>withBuild(s=>{
 const p=s.state.begin(s.input);expect(p).toMatchObject({pending:3,completed:0,finished:false});expect(s.source.snapshotSha256()).toBe(createHash('sha256').update(readFileSync(s.sourcePath)).digest('hex'));
 expect(()=>s.state.finish('build',s.index)).toThrow('全件');let progress=s.state.runNext('build',s.source,s.index,{limit:1});expect(progress.completed).toBe(1);expect(progress.pending).toBe(2);s.reopen();progress=s.state.runNext('build',s.source,s.index,{limit:2});expect(progress).toMatchObject({completed:3,pending:0,failed:0,companiesWithRows:2,rowCount:4,finished:false});
 const report=s.state.finish('build',s.index);expect(report.assembly).toMatchObject({archiveSha256:s.input.archiveSha256,population:{edinetCodes:population().edinetCodes},parts:expect.any(Array)});expect(report.assembly!.parts).toHaveLength(3);expect(report.rows).toHaveLength(4);expect(s.index.screen(cohort,{metricIds:['costOfSales']})).toMatchObject({total:2,excludedRows:0});expect(s.state.progress('build').finished).toBe(true);expect(s.state.finish('build',s.index)).toEqual(report);expect(s.state.runNext('build',s.source,s.index).completed).toBe(3);
}));
it('同じ計画の再投入を許可し、異なる入力/指紋/母集団で上書きしない',()=>withBuild(s=>{
 s.state.begin(s.input);expect(s.state.begin({...s.input,population:population(['E12003','E12002','E12001'])}).pending).toBe(3);
 for(const input of [{...s.input,generation:'different'},{...s.input,archiveSha256:'b'.repeat(64)},{...s.input,population:population(['E12001'])},{...s.input,options:{...options,extractorVersion:'changed'}}])expect(()=>s.state.begin(input)).toThrow('変更');expect(s.state.progress('build').completed).toBe(0);
}));
it('会社の失敗を他社から分離し、未処理を先に進めてから再試行する',()=>withBuild(s=>{
 s.state.begin(s.input);const original=s.index.materialize.bind(s.index);let fail=true;(s.index as unknown as {materialize:typeof s.index.materialize}).materialize=(...args)=>{if(fail&&args[2].edinetCodes?.[0]==='E12001')throw Error('SECRET-FIXTURE');return original(...args);};
 let p=s.state.runNext('build',s.source,s.index,{limit:2});expect(p).toMatchObject({failed:1,completed:1,pending:1});expect(p.tasks[0]).toMatchObject({status:'failed',attempts:1,lastErrorCode:'company-materialization-failed'});expect(JSON.stringify(p)).not.toContain('SECRET-FIXTURE');expect(()=>s.state.finish('build',s.index)).toThrow('全件');p=s.state.runNext('build',s.source,s.index,{limit:1});expect(p.completed).toBe(2);expect(p.failed).toBe(1);fail=false;p=s.state.runNext('build',s.source,s.index,{limit:1});expect(p).toMatchObject({completed:3,failed:0});expect(p.tasks[0].attempts).toBe(2);s.state.finish('build',s.index);
}));
it('索引commit後にcheckpoint書込が失敗しても同じ会社世代で再開する',()=>withBuild(s=>{
 s.state.begin(s.input);const unsafe=s.state as unknown as {writeTask:(...args:unknown[])=>void},original=unsafe.writeTask;let fail=true;unsafe.writeTask=function(...args){if(fail){fail=false;throw Error('checkpoint interrupted');}original.apply(s.state,args);};let p=s.state.runNext('build',s.source,s.index,{limit:1});expect(p.failed).toBe(1);const part=s.index.generation(p.tasks[0].partID);expect(part.rows).toHaveLength(2);unsafe.writeTask=original;s.reopen();p=s.state.runNext('build',s.source,s.index,{limit:3});expect(p.completed).toBe(3);expect(s.index.generation(p.tasks[0].partID)).toEqual(part);s.state.finish('build',s.index);
}));
it('原本が差し替わった後の再開を止め、同じbyteのコピーなら再開する',()=>withBuild(s=>{
 s.state.begin(s.input);const copy=join(s.dir,'copy.sqlite');writeFileSync(copy,readFileSync(s.sourcePath));const cloned=new ObservedFinancialArchive(copy,{readOnly:true});try{expect(s.state.runNext('build',cloned,s.index,{limit:1}).completed).toBe(1);}finally{cloned.close();}
 const writer=new ObservedFinancialArchive(s.sourcePath);writer.append([{observationId:'extra',observedAt:'2026-07-01T00:00:00Z',document:{docID:'EXTRA',parentDocID:null,docTypeCode:'180'}}]);writer.close();const changed=new ObservedFinancialArchive(s.sourcePath,{readOnly:true});try{expect(()=>s.state.runNext('build',changed,s.index)).toThrow('指紋');expect(s.state.progress('build').completed).toBe(1);}finally{changed.close();}
}));
it('未完了の全母集団を別の任意subsetとして完成扱いにしない',()=>withBuild(s=>{
 const p=s.state.begin(s.input);s.state.runNext('build',s.source,s.index,{limit:1});const task=s.state.progress('build').tasks[0];expect(()=>s.index.combine('partial',[task.partID],{planSha256:p.planSha256,archiveSha256:s.input.archiveSha256,population:s.input.population})).toThrow('母集団');expect(()=>s.index.generation('partial')).toThrow('未収録');
}));
it('入力のない会社も行数0として完了し、財務値の充足と区別する',()=>withBuild(s=>{
 s.state.begin({...s.input,population:population(['E12003'])});const p=s.state.runNext('build',s.source,s.index);expect(p).toMatchObject({completed:1,companiesWithRows:0,rowCount:0});const report=s.state.finish('build',s.index);expect(report.rows).toEqual([]);expect(report.assembly!.population.edinetCodes).toEqual(['E12003']);
}));
it('完了世代の書換え/別の索引で完了と偽らない',()=>withBuild(s=>{
 s.state.begin(s.input);s.state.runNext('build',s.source,s.index);const other=new FinancialSearchIndex(':memory:');try{expect(()=>s.state.finish('build',other)).toThrow('未収録');expect(s.state.progress('build').finished).toBe(false);}finally{other.close();}s.state.finish('build',s.index);
}));
it('母集団の実観測とJSTの基準日をcutoffと照合する',()=>withBuild(s=>{
 const valid={...s.input,population:{...population(),asOf:'2026-10-28',observedAt:'2026-10-27T15:30:00Z'},options:{...options,cutoff:'2026-10-27T16:00:00Z'}};expect(s.state.begin(valid).pending).toBe(3);
 for(const p of [{...population(),observedAt:'2026-10-29T00:00:00Z'},{...population(),asOf:'2026-10-29'},population([]),population(['E12001','E12001']),population(['bad'])])expect(()=>s.state.begin({...s.input,id:'invalid',population:p})).toThrow();
}));
it('readOnly状態と原本の指紋取得は元ファイルを変更しない',()=>withBuild(s=>{
 s.state.begin(s.input);s.reopen();const before=readFileSync(s.statePath),ro=new FinancialIndexBuild(s.statePath,{readOnly:true});try{expect(ro.progress('build').pending).toBe(3);expect(()=>ro.runNext('build',s.source,s.index)).toThrow('readOnly');expect(()=>ro.begin(s.input)).toThrow('readOnly');}finally{ro.close();}expect(readFileSync(s.statePath)).toEqual(before);const writable=new ObservedFinancialArchive(':memory:');try{expect(()=>writable.snapshotSha256()).toThrow('readOnly');}finally{writable.close();}
}));
it.each(['financial_build_plans','financial_build_tasks','financial_build_completions'])('%sの破損を正常な再開/完了として返さない',table=>withBuild(s=>{
 s.state.begin(s.input);s.state.runNext('build',s.source,s.index);s.state.finish('build',s.index);s.reopen();const raw=new Database(s.statePath);raw.exec(`UPDATE ${table} SET sha256='corrupt'`);raw.close();expect(()=>s.state.progress('build')).toThrow('hash');
}));
it('不正なbatch指定・未知属性・別形式DBを拒否する',()=>withBuild(s=>{
 s.state.begin(s.input);for(const o of [{limit:0},{limit:101},{limit:NaN},{extra:true}])expect(()=>s.state.runNext('build',s.source,s.index,o as never)).toThrow();expect(()=>s.state.begin({...s.input,extra:true}as never)).toThrow();expect(()=>new FinancialIndexBuild(s.sourcePath)).toThrow('schema');
}));
it('新しい訂正入力は別の計画/世代に保持し、旧世代の財務値を残す',()=>withBuild(s=>{
 s.state.begin(s.input);s.state.runNext('build',s.source,s.index);s.state.finish('build',s.index);const old=s.index.screen(cohort,{metricIds:['costOfSales']});const writer=new ObservedFinancialArchive(s.sourcePath),xml=reportingInstance({issuer:'E12001',security:'10010'}).replace('>10</jppfs_cor:CostOfSales>','>30</jppfs_cor:CostOfSales>');
 writer.append([{observationId:'correction',observedAt:'2026-06-30T00:00:00Z',document:{docID:'B1',parentDocID:'A1',docTypeCode:'130',edinetCode:'E12001',secCode:'10010',periodStart:null,periodEnd:null,submitDateTime:'2026-06-28 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}],[{docID:'B1',availableAt:'2026-07-01T00:00:00Z',sourceSha256:createHash('sha256').update(xml).digest('hex'),xml}]);writer.close();const updated=new ObservedFinancialArchive(s.sourcePath,{readOnly:true});try{
  s.state.begin({...s.input,id:'updated',generation:'after',archiveSha256:updated.snapshotSha256()});s.state.runNext('updated',updated,s.index);s.state.finish('updated',s.index);expect(s.index.screen(cohort,{metricIds:['costOfSales']})).toEqual(old);const after=s.index.screen({...cohort,generation:'after'},{metricIds:['costOfSales']});expect(after.rows.map(r=>r.snapshot.selections.costOfSales!.raw)).toEqual(['30','10']);expect(after.rows[0].chainDocIDs).toEqual(['A1','B1']);
 }finally{updated.close();}
}));
it('集約索引commit後に完了markerが失敗しても、部分世代を公開せず再実行できる',()=>withBuild(s=>{
 s.state.begin(s.input);s.state.runNext('build',s.source,s.index);const unsafe=s.state as unknown as {run:(sql:string,args?:unknown[])=>void},original=unsafe.run;unsafe.run=function(sql,args){if(sql.startsWith('INSERT INTO financial_build_completions'))throw Error('completion interrupted');original.call(s.state,sql,args);};try{expect(()=>s.state.finish('build',s.index)).toThrow('interrupted');}finally{unsafe.run=original;}
 expect(s.state.progress('build').finished).toBe(false);expect(s.index.screen(cohort,{metricIds:['costOfSales']}).total).toBe(2);s.state.finish('build',s.index);expect(s.state.progress('build').finished).toBe(true);
}));
it('他社を名乗る訂正の共有診断を重複集計せず、元の財務値を採用しない',()=>withBuild(s=>{
 const writer=new ObservedFinancialArchive(s.sourcePath);writer.append([{observationId:'wrong-company-correction',observedAt:'2026-07-01T00:00:00Z',document:{docID:'WRONG',parentDocID:'A1',docTypeCode:'130',edinetCode:'E12002',secCode:'10020',periodStart:null,periodEnd:null,submitDateTime:'2026-06-30 10:00',withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'0'}}]);writer.close();const source=new ObservedFinancialArchive(s.sourcePath,{readOnly:true});try{s.state.begin({...s.input,archiveSha256:source.snapshotSha256()});s.state.runNext('build',source,s.index);const r=s.state.finish('build',s.index);expect(r.selection.decisions.filter(d=>d.rootDocID==='A1')).toHaveLength(1);expect(r.selection.decisions).toContainEqual(expect.objectContaining({rootDocID:'A1',reason:'unresolved-correction'}));expect(s.index.screen(cohort,{metricIds:['costOfSales']}).rows.map(r=>r.edinetCode)).toEqual(['E12002']);}finally{source.close();}
}));
it('原観測が一回の上限を超えていても会社別集合で全母集団を完了できる',()=>withBuild(s=>{
 const writer=new ObservedFinancialArchive(s.sourcePath);writer.append(Array.from({length:10000},(_,i)=>({observationId:'extra-'+i,observedAt:'2026-06-26T00:00:00Z',document:{docID:'OTHER',parentDocID:null,edinetCode:'E99999',docTypeCode:'180'}})));writer.close();const source=new ObservedFinancialArchive(s.sourcePath,{readOnly:true});try{expect(()=>source.createSnapshots(options)).toThrow('10,000');s.state.begin({...s.input,archiveSha256:source.snapshotSha256(),population:population(['E12001','E12002','E12003','E99999'])});expect(s.state.runNext('build',source,s.index).completed).toBe(4);const r=s.state.finish('build',s.index);expect(r.rows).toHaveLength(4);expect(r.selection.ignored).toHaveLength(10000);}finally{source.close();}
}));

it.each([undefined,'2','3','4'])('一覧とDEIの照合契約が異なる未完了計画へ新しい結果を混ぜない: %s',version=>withBuild(s=>{
 const p=s.state.begin(s.input);expect(p.plan.provenance.mappingVersions.observed).toBe('5');
 const old=structuredClone(p.plan) as any;if(version===undefined)delete old.provenance.mappingVersions.observed;else old.provenance.mappingVersions.observed=version;
 const canonical=(v:unknown)=>JSON.stringify(v,(_key,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x),body=canonical(old);
 const digest=(text:string)=>createHash('sha256').update(text).digest('hex'),planSha256=digest(body);
 const unsafe=s.state as unknown as {run:(sql:string,args:unknown[])=>void};unsafe.run('UPDATE financial_build_plans SET body=?,sha256=? WHERE id=?',[body,planSha256,s.input.id]);
 // 旧計画に対応するcheckpointも揃え、破損ではなく抽出版の違いを検証します。
 for(const task of p.tasks){
  const oldTask={...task,partID:financialIndexBuildPartId(planSha256,task.edinetCode)},taskBody=canonical(oldTask);
  unsafe.run('UPDATE financial_build_tasks SET body=?,sha256=? WHERE build=? AND edinet_code=?',[taskBody,digest(canonical([s.input.id,task.edinetCode,task.status,taskBody])),s.input.id,task.edinetCode]);
 }
 expect(()=>s.state.runNext(s.input.id,s.source,s.index)).toThrow('版');expect(s.state.progress(s.input.id).completed).toBe(0);
}));
