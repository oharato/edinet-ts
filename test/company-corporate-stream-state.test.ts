import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {linkCompanyMasterCorporateStreamStates as link} from '../src/company-corporate-state';
import {registryStreamXml as xml,registryStreamRow as row,registryStreamSource as source} from './fixtures/corporate-registry-stream';
import type {CompanyMasterSnapshot} from '../src/company-master';
const number='1010001001202',hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const master=():CompanyMasterSnapshot=>({asOf:'2026-10-29',observedAt:source.observedAt,sourceUrl:'https://example.test/master.csv',sourceSha256:'1'.repeat(64),records:[{entityId:'edinet:E00001',edinetCode:'E00001',corporateNumber:number,name:'日本 & 会社',filerType:'内国法人',listingStatus:'listed'}]});
const q={edinetCodes:['E00001'],asOf:'2026-10-29',knownAt:source.observedAt,registryPurpose:'sample' as const};
function input(text=xml(row()),visit=()=>{}){return [{scope:'national' as const,expectedParts:1,parts:[{source:{...source,kind:'full' as const},sha256:hash(text),chunks:(async function*(){visit();yield Buffer.from(text)})()}]}]}
it('複数社の原本を一度だけ読み、番号・原名称一致だけを結合し出典とIDを保つ',async()=>{
 const m=master();m.records.push({...m.records[0],entityId:'edinet:E00002',edinetCode:'E00002',corporateNumber:'2010001001201',name:'別会社'});
 let visits=0;const result=await link([m],input(xml(row()+row({sequenceNumber:'2',corporateNumber:'2010001001201',name:'別会社'})),()=>visits++),{...q,edinetCodes:['E00001','E00002','E99999']});
 expect(visits).toBe(1);expect(result.rows.map(r=>r.reason)).toEqual(['exact-number-and-name','exact-number-and-name']);expect(result.scan).toMatchObject({allPartsCompleted:true,records:2,selectedRecords:2});expect(result.rows[0].company.entityId).toBe('edinet:E00001');expect(result.rows[0].state?.sources[0].inputXmlSha256).toBeTruthy();expect(result.absentEdinetCodes).toEqual(['E99999']);expect(result).toMatchObject({entityIdentity:'not-established',mergedEntities:false,followedSuccessor:false});
});
it.each([['名称 ',{},'registry-name-mismatch'],['日本 & 会社',{closeDate:'2026-10-29',closeCause:'01',process:'21'},'closed-corporation']])('名称相違・閉鎖を保留する: %s',async(name,patch,reason)=>{
 const m=master();m.records[0].name=name as string;const result=await link([m],input(xml(row(patch as Record<string,string>))),q);expect(result.rows[0]).toMatchObject({reason,status:'unresolved'});
});
it('マスターフィルタの外にある同番号所有者も保留し、照合対象がなければ原本を読まない',async()=>{
 const m=master();m.records.push({...m.records[0],entityId:'edinet:E00002',edinetCode:'E00002',listingStatus:'unlisted'});let visits=0;
 const result=await link([m],input(undefined,()=>visits++),{...q,listingStatus:'listed'});expect(result.rows[0].reason).toBe('shared-corporate-number');expect(visits).toBe(0);expect(result.scan).toBeUndefined();
 delete m.records[0].corporateNumber;expect((await link([m],[],q)).rows[0].reason).toBe('corporate-number-missing');
});
it('差分の空白を全件記録の一致で埋めず、未取得とcutoffを区別する',async()=>{
 expect((await link([master()],input(),{...q,asOf:'2026-10-30'})).rows[0]).toMatchObject({reason:'registry-state-unresolved',state:{selection:{reason:'coverage-gap'}}});
 expect((await link([master()],[],q)).rows[0].reason).toBe('registry-state-unavailable');
});
it('対象外法人の破損・不一致hashでも部分成功を返さず、入力をawait前に固定する',async()=>{
 const m=master(),query={...q};const pending=link([m],input(),query);m.records[0].name='書換';query.edinetCodes=[];expect((await pending).rows[0].reason).toBe('exact-number-and-name');
 const bad=input();bad[0].parts[0].sha256='0'.repeat(64);await expect(link([master()],bad,q)).rejects.toThrow();
 await expect(link([master()],input(xml(row()+row({sequenceNumber:'2',corporateNumber:'2010001001201',latest:'BAD'}))),q)).rejects.toThrow();
});
it('100社を超える全マスター指定と件数上限を検証し、疎配列・重複・未知条件・中断を拒否する',async()=>{
 const ids=Array.from({length:11432},(_,i)=>'E'+String(i).padStart(5,'0'));const result=await link([master()],input(),{...q,edinetCodes:ids});expect(result.total).toBe(1);
 for(const edinetCodes of [new Array(1),['E00001','E00001'],Array.from({length:20001},(_,i)=>'E'+String(i).padStart(5,'0'))])await expect(link([master()],[],{...q,edinetCodes})).rejects.toThrow();
 await expect(link([master()],[],{...q,unknown:true} as never)).rejects.toThrow();
 const controller=new AbortController();controller.abort();await expect(link([],[],q,undefined,{signal:controller.signal})).rejects.toThrow();await expect(link([],[],q,undefined,{extra:true} as never)).rejects.toThrow();
});

it('1万番号を超える入力は全国原本を読む前に拒否する',async()=>{
 const m=master();m.records=Array.from({length:10001},(_,i)=>({...m.records[0],entityId:'edinet:E'+String(i).padStart(5,'0'),edinetCode:'E'+String(i).padStart(5,'0'),corporateNumber:String(1000000000000+i)}));let visits=0;
 await expect(link([m],input(undefined,()=>visits++),{...q,edinetCodes:m.records.map(c=>c.edinetCode)})).rejects.toThrow();expect(visits).toBe(0);
});
