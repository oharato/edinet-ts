import {it,expect} from 'vitest';import {mkdtempSync,rmSync,writeFileSync,renameSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createHash} from 'node:crypto';
import {readCorporateRegistryFile,streamCorporateRegistryRecords as stream,CORPORATE_REGISTRY_RECORD_MAX_BYTES} from '../src/corporate-registry-stream';
import {parseCorporateRegistryDownloadXml} from '../src/corporate-registry';import {registryStreamSource as source,registryStreamXml as xml,registryStreamRow as row} from './fixtures/corporate-registry-stream';
async function* chunks(text:string,size=31){const b=Buffer.from(text);for(let i=0;i<b.length;i+=size)yield b.subarray(i,i+size);}
async function collect(iterator:ReturnType<typeof stream>){const rows=[];for(;;){const next=await iterator.next();if(next.done)return {rows,receipt:next.value};rows.push(next.value);}}
it.each([1,2,7,127,1024])('%i byte境界でUTF-8・タグ・参照が割れても既存パーサーと一致する',async size=>{
 const text='\uFEFF'+xml(row()+row({sequenceNumber:'2',corporateNumber:'1010001001210',process:'31'})),r=await collect(stream(chunks(text,size),source));expect(r.rows).toEqual(parseCorporateRegistryDownloadXml(text,source).records);expect(r.receipt).toMatchObject({bytes:Buffer.byteLength(text),records:2,source:{...source,inputXmlSha256:createHash('sha256').update(text).digest('hex')}});
});
it('全体64MiBを超えても全文配列を保持せず受理する',async()=>{
 const space=Buffer.alloc(1024*1024,32),hash=createHash('sha256');let bytes=0;
 async function* large(){for(const b of [Buffer.from('<corporations>'),...Array(65).fill(space),Buffer.from(row()+'</corporations>')]){hash.update(b);bytes+=b.length;yield b;}}
 const r=await collect(stream(large(),source));expect(bytes).toBeGreaterThan(64*1024*1024);expect(r.rows).toHaveLength(1);expect(r.receipt.bytes).toBe(bytes);expect(r.receipt.source.inputXmlSha256).toBe(hash.digest('hex'));
});
it.each(['<corporations>','<corporations/>x','<corporations/ >','<corporations/><corporations/>','<!DOCTYPE corporations><corporations/>','<corporations xmlns="urn:wrong"/>','<corporations><!-- note --></corporations>',' <?xml version="1.0"?><corporations/>','<?xml version="1.0" encoding="UTF-16"?><corporations/>','<corporations>text</corporations>'])('不正・非対応の構造を最後まで黙って受理しない %s',async text=>{await expect(collect(stream(chunks(text,1),source))).rejects.toThrow();});
it('不正UTF-8・記録/チャンク/全体容量の上限と中断を検査する',async()=>{
 async function* invalid(){yield Buffer.from([0x81])}await expect(collect(stream(invalid(),source))).rejects.toThrow();
 await expect(collect(stream(chunks(xml(row({name:'x'.repeat(CORPORATE_REGISTRY_RECORD_MAX_BYTES)}))),source))).rejects.toThrow();
 async function* huge(){yield Buffer.alloc(1024*1024+1)}await expect(collect(stream(huge(),source))).rejects.toThrow();await expect(collect(stream(chunks(xml()),source,{maxBytes:20}))).rejects.toThrow();
 const controller=new AbortController();async function* aborted(){yield Buffer.from('<corporations>'+row());controller.abort();yield Buffer.from('</corporations>')}
 await expect(collect(stream(aborted(),source,{signal:controller.signal}))).rejects.toThrow();
});
it('途中で消費を止めた時も入力iteratorを閉じ、完了receiptを作らない',async()=>{
 let closed=false;async function* input(){try{yield Buffer.from('<corporations>'+row()+row({sequenceNumber:'2'})+'</corporations>')}finally{closed=true}}
 const iterator=stream(input(),source);expect((await iterator.next()).done).toBe(false);await iterator.return(undefined as never);expect(closed).toBe(true);
});

it('読取中の原本変更とパス置換を、SHAが同じでも完了前に拒否する',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'registry-stream-identity-'));try{
  const file=join(dir,'data.xml'),text=xml(),sha=createHash('sha256').update(text).digest('hex');
  for(const replace of [false,true]){writeFileSync(file,text);const iterator=readCorporateRegistryFile(file,source,sha);expect((await iterator.next()).done).toBe(false);if(replace)renameSync(file,join(dir,'old.xml'));writeFileSync(file,text);await expect(collect(iterator)).rejects.toThrow();}
 }finally{rmSync(dir,{recursive:true,force:true})}
});
