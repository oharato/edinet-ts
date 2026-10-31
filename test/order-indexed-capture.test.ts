import {it,expect} from 'vitest';
import {extractOrderDetails,searchOrderDetails,type OrderDetailDocument,type OrderSearchOptions} from '../src/index';
import {orderDocument,orderPeriod} from './fixtures/orders';
const options:OrderSearchOptions={period:orderPeriod,scope:'NonConsolidated',role:'detail',metric:'ordersReceivedJPY'};
it('空custom iteratorが配列indexの正常原本/宣言を隠せない',()=>{
 const d=orderDocument(),expected=extractOrderDetails(d);Object.defineProperty(d.declarations,Symbol.iterator,{value:function*(){}});
 expect(extractOrderDetails(d)).toEqual(expected);
 const docs=[d],normal=searchOrderDetails(docs,options);Object.defineProperty(docs,Symbol.iterator,{value:function*(){}});expect(searchOrderDetails(docs,options)).toEqual(normal);
});
it('iteratorを読むだけで失敗する原本/宣言もindexだけで捕捉する',()=>{
 const d=orderDocument();let reads=0;const reject=()=>{reads++;throw Error('unbounded iterator must never be requested');};
 Object.defineProperty(d.declarations,Symbol.iterator,{get:reject});const docs=[d];Object.defineProperty(docs,Symbol.iterator,{get:reject});
 expect(extractOrderDetails(d).rows).toHaveLength(3);expect(searchOrderDetails(docs,options).matched).toBe(2);expect(reads).toBe(0);
});
it('空iteratorで不正indexを隠して正常な空検索にしない',()=>{
 const docs=[null] as unknown as OrderDetailDocument[];Object.defineProperty(docs,Symbol.iterator,{value:function*(){}});expect(()=>searchOrderDetails(docs,options)).toThrow();
 const d=orderDocument();d.declarations=[null] as never;Object.defineProperty(d.declarations,Symbol.iterator,{value:function*(){}});expect(()=>extractOrderDetails(d)).toThrow();
});
it('疎配列はiteratorで補っても拒否する',()=>{
 const d=orderDocument();d.declarations=new Array(1);Object.defineProperty(d.declarations,Symbol.iterator,{value:function*(){yield orderDocument().declarations[0]}});expect(()=>extractOrderDetails(d)).toThrow('疎配列');
 const docs=new Array(1);Object.defineProperty(docs,Symbol.iterator,{value:function*(){yield orderDocument()}});expect(()=>searchOrderDetails(docs,options)).toThrow('疎配列');
});
it('lengthを各入口で一度だけ読み以後は固定indexを使う',()=>{
 const d=orderDocument(),raw=d.declarations;let declarationReads=0,documentReads=0;d.declarations=new Proxy(raw,{get(target,key,receiver){if(key==='length'){declarationReads++;if(declarationReads>1)throw Error('length read twice')}return Reflect.get(target,key,receiver)}});
 expect(extractOrderDetails(d).rows).toHaveLength(3);expect(declarationReads).toBe(1);
 declarationReads=0;const docs=new Proxy([d],{get(target,key,receiver){if(key==='length'){documentReads++;if(documentReads>1)throw Error('length read twice')}return Reflect.get(target,key,receiver)}});
 expect(searchOrderDetails(docs,options).matched).toBe(2);expect(documentReads).toBe(1);expect(declarationReads).toBe(1);
});
it('通常配列と0/100/101の上限を維持する',()=>{
 expect(searchOrderDetails([],options)).toMatchObject({matched:0,rows:[]});const empty=orderDocument();empty.declarations=[];expect(()=>extractOrderDetails(empty)).toThrow();
 const d=orderDocument({declarations:Array.from({length:100},(_,tableIndex)=>({tableIndex,period:orderPeriod,scope:'NonConsolidated' as const}))});expect(extractOrderDetails(d).rows).toHaveLength(3);d.declarations=[...d.declarations,{...d.declarations[0],tableIndex:100}];expect(()=>extractOrderDetails(d)).toThrow();
 const docs=Array.from({length:100},(_,index)=>orderDocument({docID:'ORDER-'+index}));expect(searchOrderDetails(docs,options).matched).toBe(200);docs.push(orderDocument({docID:'ORDER-100'}));expect(()=>searchOrderDetails(docs,options)).toThrow('100');
});

it.each([-1,1.5,NaN,Infinity])('Proxyの不正length %sを空配列扱いしない',length=>{
 const docs=new Proxy([],{get(target,key,receiver){return key==='length'?length:Reflect.get(target,key,receiver)}});expect(()=>searchOrderDetails(docs,options)).toThrow();
 const d=orderDocument();d.declarations=new Proxy(d.declarations,{get(target,key,receiver){return key==='length'?length:Reflect.get(target,key,receiver)}});expect(()=>extractOrderDetails(d)).toThrow();
});
