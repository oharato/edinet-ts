import {describe,it,expect} from 'vitest';
import {extractSubsidiaryHumanCapitalMetrics as extract,screenSubsidiaryHumanCapitalMetrics as screen,SubsidiaryHumanCapitalMetricId as M} from '../src/subsidiary-human-capital-metrics';
import {subsidiaryDocument} from './fixtures/subsidiary-metrics';
const conceal=<T>(items:T[],visible:T[])=>Object.assign(items,{[Symbol.iterator]:function*(){yield* visible;}});
const metric=M.FemaleManagerRatio;
describe('子会社人的資本の物理index検査',()=>{
 it('不正な指標をiteratorで隠せない',()=>{const d=subsidiaryDocument();expect(()=>extract(d.xml,d.metadata,conceal([metric,'invalid' as any],[metric]))).toThrow();});
 it('不正な注記をiteratorで隠せない',()=>{const d=subsidiaryDocument();expect(()=>extract(d.xml,d.metadata,[metric],conceal([{} as any],[]))).toThrow();});
 it('不正な書類をiteratorで隠せない',()=>{const d=subsidiaryDocument();expect(()=>screen(conceal([d,{} as any],[d]),metric)).toThrow();});
 it('不正な条件をiteratorで隠せない',()=>{const d=subsidiaryDocument();expect(()=>screen([d],metric,{conditions:conceal([{operator:'invalid' as any,value:0}],[])})).toThrow();});
 it('正しい物理要素を読むときiteratorへ触れない',()=>{
  const d=subsidiaryDocument(),ignore=<T>(a:T[])=>Object.defineProperty(a,Symbol.iterator,{get(){throw Error('iterator must not be read');}});
  expect(extract(d.xml,d.metadata,ignore([metric]),ignore([])).rows).toHaveLength(1);
  expect(screen(ignore([d]),metric,{conditions:ignore([{operator:'gte',value:0}])}).total).toBe(1);
 });
 it('lengthと各indexを一度だけ捕捉する',()=>{
  const d=subsidiaryDocument(),reads:Record<string,number>={};
  const once=<T>(a:T[],name:string)=>new Proxy(a,{get(target,key,receiver){if(key==='length'||key==='0')reads[name+String(key)]=(reads[name+String(key)]??0)+1;return Reflect.get(target,key,receiver);}});
  expect(screen(once([d],'documents'),metric,{conditions:once([{operator:'gte',value:0}],'conditions')}).total).toBe(1);
  expect(extract(d.xml,d.metadata,once([metric],'metrics'),once([],'annotations')).rows).toHaveLength(1);
  expect(reads).toEqual({documentslength:1,documents0:1,conditionslength:1,conditions0:1,metricslength:1,metrics0:1,annotationslength:1});
 });
 it.each([NaN,Infinity,-1,0.5,101])('不正な書類length %sをiteratorより先に拒否',length=>{
  let iteratorReads=0;
  const input=new Proxy([],{get(target,key,receiver){if(key==='length')return length;if(key===Symbol.iterator){iteratorReads++;throw Error('iterator touched');}return Reflect.get(target,key,receiver);}});
  expect(()=>screen(input,metric)).toThrow();expect(iteratorReads).toBe(0);
 });
 it('疎配列と既存上限超過を拒否する',()=>{
  const d=subsidiaryDocument();expect(()=>extract(d.xml,d.metadata,new Array(1))).toThrow();expect(()=>extract(d.xml,d.metadata,[metric],new Array(1))).toThrow();
  expect(()=>screen(new Array(1),metric)).toThrow();expect(()=>screen([d],metric,{conditions:new Array(1)})).toThrow();
  expect(()=>extract(d.xml,d.metadata,[metric],new Array(10001))).toThrow();expect(()=>screen([],metric,{conditions:new Array(101)})).toThrow();
  expect(()=>extract(d.xml,d.metadata,new Array(8).fill(metric))).toThrow();
 });
});
