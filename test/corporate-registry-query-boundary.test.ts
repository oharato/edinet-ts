import {it,expect} from 'vitest';
import {queryCorporateRegistryDownloads} from '../src/corporate-registry';
it('法人番号は文字列プリミティブだけを受け入れる',()=>{
 expect(()=>queryCorporateRegistryDownloads([],{corporateNumber:new String('1010001001202') as never,knownAt:'2026-10-29T00:00:00Z'})).toThrow();
});
