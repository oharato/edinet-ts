import {it,expect} from 'vitest';
import {join} from 'node:path';
import {FinancialIndexPublication,type FinancialIndexAsyncReader,type FinancialIndexPublicationPolicy} from '../src/db/financial-index-publication';
import {duckFinancialReaderFixture as fixture} from './fixtures/duck-financial-reader';
const policy:FinancialIndexPublicationPolicy={minimumCompaniesWithUsableValues:4,maxUnavailableSources:0,maxUnresolvedSelections:0,maxUnavailableSelections:0,maxUnresolvedRecords:0,maxUnavailableGroups:0,maxDuplicateCohortIdentifiers:0,maxUnavailableValues:100};
const catalogFixture=(fn:(s:Parameters<Parameters<typeof fixture>[0]>[0],c:FinancialIndexPublication)=>Promise<void>)=>fixture(async s=>{const c=new FinancialIndexPublication(join(s.dir,'catalog.sqlite'));try{await fn(s,c)}finally{c.close()}});
it('実DuckDBの品質をSQLite catalogへ保存し、CAS切替・復帰・再openできる',()=>catalogFixture(async({duck,dir},c)=>{
 const old=await c.prepareAsync('old',duck,'all',policy);expect(old.eligible).toBe(true);expect(await c.prepareAsync('old',duck,'all',policy)).toEqual(old);await c.activateAsync('old',duck,{expectedActive:null});expect(await c.resolveAsync(duck)).toEqual(old);
 await c.prepareAsync('new',duck,'all',policy);await c.activateAsync('new',duck,{expectedActive:'old'});await c.activateAsync('old',duck,{expectedActive:'new'});expect(c.history().map(h=>h.publication)).toEqual(['old','new','old']);await c.activateAsync('old',duck,{expectedActive:'old'});expect(c.history()).toHaveLength(3);
 const copy=new FinancialIndexPublication(join(dir,'catalog.sqlite'),{readOnly:true});try{expect(await copy.resolveAsync(duck)).toEqual(old)}finally{copy.close()}
}));
it('既定条件未達と同じIDの条件変更を拒否しactiveを保持',()=>catalogFixture(async({duck},c)=>{
 await c.prepareAsync('old',duck,'all',policy);await c.activateAsync('old',duck,{expectedActive:null});const blocked=await c.prepareAsync('blocked',duck,'all');expect(blocked.eligible).toBe(false);await expect(c.activateAsync('blocked',duck,{expectedActive:'old'})).rejects.toThrow('公開条件');await expect(c.prepareAsync('old',duck,'all',{...policy,maxUnavailableValues:99})).rejects.toThrow('変更');expect(c.current()?.id).toBe('old');
}));
it('待機中の他候補切替をCASで拒否する',()=>catalogFixture(async({duck},c)=>{
 await c.prepareAsync('old',duck,'all',policy);await c.prepareAsync('new',duck,'all',policy);await c.activateAsync('old',duck,{expectedActive:null});
 let release!:()=>void,started!:()=>void;const waiting=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);const delayed:FinancialIndexAsyncReader={generation:id=>duck.generation(id),snapshotSha256:()=>duck.snapshotSha256(),quality:async id=>{started();await waiting;return duck.quality(id)}};
 const pending=c.activateAsync('new',delayed,{expectedActive:'old'});await entered;await c.activateAsync('new',duck,{expectedActive:'old'});release();await expect(pending).rejects.toThrow('切り替わり');expect(c.history()).toHaveLength(2);
}));
it('指紋が変わるreaderと不整合な世代・品質を拒否する',()=>catalogFixture(async({duck},c)=>{
 let n=0;const changed:FinancialIndexAsyncReader={generation:id=>duck.generation(id),quality:id=>duck.quality(id),snapshotSha256:async()=> (++n===1?'a':'b').repeat(64)};await expect(c.prepareAsync('bad',changed,'all',policy)).rejects.toThrow('変化');
 const wrong:FinancialIndexAsyncReader={generation:async id=>{const r=await duck.generation(id);r.id='other';return r},quality:id=>duck.quality(id),snapshotSha256:()=>duck.snapshotSha256()};await expect(c.prepareAsync('bad',wrong,'all',policy)).rejects.toThrow('不一致');expect(c.current()).toBeUndefined();
}));
it('pointer書込失敗をrollbackし、閉じたreaderも受け付けない',()=>catalogFixture(async({duck},c)=>{
 await c.prepareAsync('old',duck,'all',policy);await c.activateAsync('old',duck,{expectedActive:null});await c.prepareAsync('new',duck,'all',policy);const raw=c as any,run=raw.run.bind(c);raw.run=(sql:string,args:any[])=>{if(sql.startsWith('INSERT INTO publication_active'))throw Error('disk failed');return run(sql,args)};await expect(c.activateAsync('new',duck,{expectedActive:'old'})).rejects.toThrow('disk failed');raw.run=run;expect(c.history()).toHaveLength(1);expect(c.current()?.id).toBe('old');await duck.close();await expect(c.activateAsync('new',duck,{expectedActive:'old'})).rejects.toThrow('closed');
}));
it('非同期待機中に呼出側が変更したpolicy/CASを採用しない',()=>catalogFixture(async({duck},c)=>{
 const p={...policy},prepared=c.prepareAsync('old',duck,'all',p);p.minimumCompaniesWithUsableValues=1000;expect((await prepared).policy).toEqual(policy);const options={expectedActive:null as string|null},activation=c.activateAsync('old',duck,options);options.expectedActive='changed';await activation;expect(c.current()?.id).toBe('old');
}));
