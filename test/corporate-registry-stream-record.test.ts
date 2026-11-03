import {expect,it} from 'vitest';
import {CORPORATE_REGISTRY_FIELDS as fields,parseCorporateRegistryDownloadXml as generic,parseCorporateRegistryStreamRecord as fast} from '../src/corporate-registry';
const source={sourceUrl:'https://example.test/data.xml',observedAt:'2026-10-31T00:00:00Z',dataDate:'2026-10-30',kind:'full' as const,purpose:'sample' as const};
const values:Record<string,string>={sequenceNumber:'1',corporateNumber:'1010001001202',process:'01',correct:'0',updateDate:'2026-10-30',changeDate:'2015-10-05',name:'日本法人',kind:'301',assignmentDate:'2015-10-05',latest:'1',hihyoji:'0'};
const xml=(patch:Record<string,string>={})=>'<corporation>'+fields.map(k=>'<'+k+'>'+({...values,...patch}[k]??'')+'</'+k+'>').join('')+'</corporation>';
function compare(text:string){let expected;try{expected=generic('<corporations>'+text+'</corporations>',source).records[0]}catch{expect(()=>fast(text,source)).toThrow();return;}expect(fast(text,source)).toEqual(expected)}
it.each(['日本語','0','  空白  ','改行\n\t文字','A\r\nB','A\rB','&amp;lt;','&#65;','&#x1F600;','&quot;&apos;&gt;&lt;&amp;','😀','𠮷','A\u0000B','A\ud800B','A\ufffeB',']]>', '&invalid;','&amp','A&B','<![CDATA[<日本語>]]>','A<!--comment-->B'])('名称%sは汎用XML入口と受理/拒否・原値が一致する',name=>compare(xml({name})));
it.each([{sequenceNumber:'0'},{sequenceNumber:'0001'},{sequenceNumber:'100000000'},{corporateNumber:'123'},{process:'1'},{process:'00'},{kind:'bad'},{correct:'2'},{latest:'2'},{hihyoji:'2'},{updateDate:'2026-10-31'},{changeDate:'2026-02-30'},{assignmentDate:''},{closeDate:'bad'},{successorCorporateNumber:'1'},{name:''},{name:'',nameImageId:'7'}])('処理/日付/フラグ境界は既存検査と一致する %j',patch=>compare(xml(patch)));
it('セルフクローズ・項目順序・重複/未知項目も既存入口と同じ扱いにする',()=>{
 const original=xml();for(const text of [original.replace('<enName></enName>','<enName />'),original.replace('<name>日本法人</name>','<name >日本法人</name >'),original.replace('<correct>0</correct>','<correct>0</correct><correct>0</correct>'),original.replace('</corporation>','<unknown/></corporation>'),'<corporation>'+[...fields].reverse().map(k=>'<'+k+'>'+(values[k]??'')+'</'+k+'>').join('')+'</corporation>'])compare(text);
});
