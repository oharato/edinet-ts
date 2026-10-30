import {CorporateRegistryStore,streamCorporateRegistryRecords,type CorporateRegistryStreamReceipt,type CorporateRegistryFileImport} from '../../dist/index.js';
declare const input:CorporateRegistryFileImport;
async function example(){
 const store=new CorporateRegistryStore('registry.sqlite');const result=await store.importFile(input);const receipt=store.file(result.file.id);const count:number=store.audit(receipt.id).records;
 const matches=store.query({corporateNumber:'1010001001202',knownAt:input.source.observedAt,registryPurpose:'sample'});const name:string|undefined=matches.rows[0]?.record.values.name;void [count,name];store.close();
 async function* chunks(){yield new Uint8Array()}
 const reader=streamCorporateRegistryRecords(chunks(),input.source);const next=await reader.next();if(next.done){const source:CorporateRegistryStreamReceipt=next.value;void source;}
}
void example;
// @ts-expect-error 保存時は原本の期待SHAを必須にする。
const missing:CorporateRegistryFileImport={file:'data.xml',source:input.source,part:'part.xml'};void missing;
