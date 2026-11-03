import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {financialIndexGenerationSha256,financialIndexBuildPartId,type FinancialIndexGeneration} from '../src/db/financial-search-index';
const legacy=(v:unknown):string=>JSON.stringify(v,(_k,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const sha=(v:string)=>createHash('sha256').update(v).digest('hex');
const cases:unknown[]=[null,{},[],[null,undefined,true,false,0,-0,NaN,Infinity,-Infinity,'漢字😀\"\\\n'],[['b','a'],[1,null]],{z:1,a:{z:2,a:3}},{a:1,z:{a:2,z:3}},{'10':'ten','2':'two',z:undefined,a:null},new Date('2026-10-31T00:00:00Z'),Buffer.from('abc'),{toJSON(){return {z:1,a:2}}},Object.assign([1,2],{toJSON(){return {z:1,a:2}}}),Object.assign(function(){},{toJSON(){return {z:1,a:2}}})];
for(let n=0;n<80;n++)cases.push({[`z${n}`]:[n,{b:'text'+n,a:[n%2===0,null]}],[`a${n}`]:{'10':n,'2':n+1},empty:undefined});
it.each(cases.map((value,index)=>({index,value})))('JSON正規化の保存hash互換性 $index',({value})=>{
 const report={id:'compat',value} as unknown as FinancialIndexGeneration;
 expect(financialIndexGenerationSha256(report)).toBe(sha(legacy([report.id,legacy(report)])));
});
it('BigIntのJSON拒否も維持する',()=>{const report={id:'compat',value:1n} as unknown as FinancialIndexGeneration;expect(()=>financialIndexGenerationSha256(report)).toThrow(TypeError)});

it('配列のevery上書きでobject正規化を迂回できない',()=>{
 const tuple=Object.assign([{z:1,a:2}],{every(){return true}});
 expect(financialIndexBuildPartId(tuple as unknown as string,'code')).toBe('buildpart:'+sha(legacy([tuple,'code'])));
});
