import {CorporateRegistryStore,streamCorporateRegistryRecords,type CorporateRegistryStreamReceipt,type CorporateRegistryFileImport,type CorporateRegistryStoredDelivery,type CorporateRegistryStoredStateResult} from '../../dist/index.js';
declare const input:CorporateRegistryFileImport;
async function example(){
 const store=new CorporateRegistryStore('registry.sqlite');const result=await store.importFile(input);const receipt=store.file(result.file.id);const count:number=store.audit(receipt.id).records;
 const deliveries:CorporateRegistryStoredDelivery[]=[{scope:'national',expectedParts:1,fileIds:[receipt.id]}];
 const state:CorporateRegistryStoredStateResult=store.reconstruct(deliveries,{corporateNumber:'1010001001202',asOf:input.source.dataDate,knownAt:input.source.observedAt,registryPurpose:'sample'});
 const originalSha:string|undefined=state.storage.files[0]?.sha256;void originalSha;
 const matches=store.query({corporateNumber:'1010001001202',knownAt:input.source.observedAt,registryPurpose:'sample'});const name:string|undefined=matches.rows[0]?.record.values.name;void [count,name];store.close();
 async function* chunks(){yield new Uint8Array()}
 const reader=streamCorporateRegistryRecords(chunks(),input.source);const next=await reader.next();if(next.done){const source:CorporateRegistryStreamReceipt=next.value;void source;}
}
void example;
// @ts-expect-error 保存時は原本の期待SHAを必須にする。
const missing:CorporateRegistryFileImport={file:'data.xml',source:input.source,part:'part.xml'};void missing;
