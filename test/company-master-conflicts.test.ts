import {it,expect} from 'vitest';
import {queryCompanyMaster,type CompanyMasterSnapshot} from '../src/index';
const query={asOf:'2026-10-29',knownAt:'2026-10-30T00:00:00Z'};
function snapshot():CompanyMasterSnapshot{return{asOf:'2026-10-29',observedAt:'2026-10-29T00:00:00Z',sourceUrl:'https://example.test/master.csv',sourceSha256:'a'.repeat(64),records:[{edinetCode:'E12345',entityId:'edinet:E12345',name:'会社A',filerType:'内国法人',listingStatus:'listed',industry:'建設業'}]}}
it.each(['contents','source','date'])('宣言hashが同じでも%sの矛盾を検索順で選ばない',kind=>{
 const a=snapshot(),b=structuredClone(a);if(kind==='contents')b.records=[{...b.records[0],industry:'化学'}];if(kind==='source')b.sourceUrl='https://other.test/master.csv';if(kind==='date')b.asOf='2026-10-28';
 expect(()=>queryCompanyMaster([a,b],query)).toThrow();expect(()=>queryCompanyMaster([b,a],query)).toThrow();
});
it('同じCSVを別の時刻に観測でき、行順・属性順だけの差は競合にしない',()=>{
 const a=snapshot();a.records=[...a.records,{...a.records[0],edinetCode:'E54321',entityId:'edinet:E54321',name:'会社B'}];const b=structuredClone(a);b.observedAt='2026-10-29T01:00:00Z';b.records=[...b.records].reverse();expect(queryCompanyMaster([a,b],query).total).toBe(2);
});
it('観測を固定してから検査し、records getterの再読込で未検査行を返さない',()=>{
 const a=snapshot(),good=a.records;let reads=0;Object.defineProperty(a,'records',{enumerable:true,get(){reads++;return reads<=2?good:[{...good[0],edinetCode:'BAD',entityId:'BAD'}]}});const r=queryCompanyMaster([a],query);expect(reads).toBe(1);expect(r.rows[0].edinetCode).toBe('E12345');
});
it('未来の別内容は過去の業種へ遡及せず、疎配列も受理しない',()=>{
 const a=snapshot(),b=structuredClone(a);b.observedAt='2026-11-01T00:00:00Z';b.sourceSha256='b'.repeat(64);b.records=[{...b.records[0],industry:'化学'}];expect(queryCompanyMaster([a,b],query).rows[0].industry).toBe('建設業');expect(()=>queryCompanyMaster([,a] as any,query)).toThrow();
});

it.each(['sourceSha256','sourceUrl','edinetCode','securityCode','corporateNumber'])('boxed文字列の%sで型検査やEDINET IDの重複検査を迂回させない',field=>{
 const a:any=snapshot();if(field==='sourceSha256'||field==='sourceUrl')a[field]=new String(a[field]);else a.records=[{...a.records[0],[field]:new String(field==='securityCode'?'10010':field==='corporateNumber'?'1234567890123':'E12345')}];expect(()=>queryCompanyMaster([a],query)).toThrow();
});

it('knownAt getterの再読込で未来の業種を採用しない',()=>{
 const a=snapshot(),b=structuredClone(a);b.observedAt='2026-11-01T00:00:00Z';b.sourceSha256='b'.repeat(64);b.records=[{...b.records[0],industry:'化学'}];let reads=0;const q={asOf:'2026-11-01',get knownAt(){reads++;return reads===1?query.knownAt:'2026-12-01T00:00:00Z'}};
 expect(queryCompanyMaster([a,b],q).rows[0].industry).toBe('建設業');expect(reads).toBe(1);expect(()=>queryCompanyMaster([a],{...query,securityCode:new String('10010')} as any)).toThrow();
});
