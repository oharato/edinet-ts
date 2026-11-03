import {describe,it,expect} from 'vitest';
import {extractOfficerRemuneration,searchOfficerRemuneration} from '../src/officer-remuneration';
import {extractPolicyShareholdings,searchPolicyShareholdings} from '../src/policy-shareholdings';
import {remunerationDocument} from './fixtures/remuneration';
import {policyDocument} from './fixtures/policy-shareholdings';
const cases=[
 {name:'報酬',document:remunerationDocument,extract:extractOfficerRemuneration,search:searchOfficerRemuneration,query:{kind:'category',period:{startDate:'2025-04-01',endDate:'2026-03-31'},role:'detail',metric:'total'}},
 {name:'政策保有',document:policyDocument,extract:extractPolicyShareholdings,search:searchPolicyShareholdings,query:{kind:'specified',periodEnd:'2026-03-31',metric:'reportedAmount'}},
] as const;
describe.each(cases)('$nameの配列件数を一度だけ固定する',c=>{
 it('表宣言lengthが後から0になっても最初の不正indexを検査する',()=>{
  let reads=0;const tables=new Proxy([null],{get(target,key,receiver){if(key==='length')return ++reads===1?1:0;return Reflect.get(target,key,receiver);}});
  expect(()=>c.extract({...c.document(),tables}as never)).toThrow();expect(reads).toBe(1);
 });
 it('書類lengthが後から0になっても最初の不正indexを検査する',()=>{
  let reads=0;const documents=new Proxy([null],{get(target,key,receiver){if(key==='length')return ++reads===1?1:0;return Reflect.get(target,key,receiver);}});
  expect(()=>c.search(documents as never,c.query as never)).toThrow();expect(reads).toBe(1);
 });
 it('正常な表宣言は件数/indexを一度だけ読みiteratorを参照しない',()=>{
  const d=c.document(),expected=c.extract(d as never),counts=new Map<string|symbol,number>();
  const tables=new Proxy(d.tables,{get(target,key,receiver){if(key===Symbol.iterator)throw Error('iterator must not be read');if(key==='length'||/^\d+$/.test(String(key)))counts.set(key,(counts.get(key)??0)+1);return Reflect.get(target,key,receiver);}});
  expect(c.extract({...d,tables}as never)).toEqual(expected);expect(counts.get('length')).toBe(1);for(let i=0;i<d.tables.length;i++)expect(counts.get(String(i))).toBe(1);
 });
 it('疎配列・継承index・件数上限を拒否する',()=>{
  const d=c.document(),inherited=[]as unknown[];Object.setPrototypeOf(inherited,{0:d.tables[0]});inherited.length=1;
  for(const tables of [Array(1),inherited,Array(201).fill(d.tables[0])])expect(()=>c.extract({...d,tables}as never)).toThrow();
  for(const docs of [Array(1),Array(101).fill(d)])expect(()=>c.search(docs as never,c.query as never)).toThrow();
 });
});
