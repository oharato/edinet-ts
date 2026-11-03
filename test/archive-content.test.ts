import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {encodeArchiveContent,decodeArchiveContent} from '../src/db/archive-content';
const raw=Buffer.from('\ufeff<x>日本語と原文の空白  </x>\n'.repeat(1000)),hash=createHash('sha256').update(raw).digest('hex');
it.each(['plain','gzip'] as const)('%s保存はBOM・空白・UTF-8 byte列とhashを保持する',encoding=>{
 const encoded=encodeArchiveContent(raw,encoding,hash);expect(decodeArchiveContent(encoded,encoding,hash)).toEqual(raw);if(encoding==='gzip')expect(encoded.length).toBeLessThan(raw.length/10);
 encoded[0]^=1;expect(()=>decodeArchiveContent(encoded,encoding,hash)).toThrow();expect(raw[0]).toBe(0xef);
});
it('切断・別原本hash・未知の保存方式を採用しない',()=>{
 const encoded=encodeArchiveContent(raw,'gzip',hash);expect(()=>decodeArchiveContent(encoded.subarray(0,-3),'gzip',hash)).toThrow();
 expect(()=>decodeArchiveContent(encoded,'gzip','0'.repeat(64))).toThrow('hash');expect(()=>encodeArchiveContent(raw,'plain','0'.repeat(64))).toThrow('hash');expect(()=>decodeArchiveContent(encoded,'other' as never,hash)).toThrow();
});
