import {reconstructCorporateRegistryStreamStates,type CorporateRegistryStreamStateQuery,type CorporateRegistryStreamPart,type CorporateRegistryStreamStateResult} from '../../dist/index.js';
async function example(part:CorporateRegistryStreamPart){
 const query:CorporateRegistryStreamStateQuery={corporateNumbers:['1010001001202'],asOf:'2026-10-30',knownAt:'2026-10-31T00:00:00Z',registryPurpose:'download'};
 const result:CorporateRegistryStreamStateResult=await reconstructCorporateRegistryStreamStates([{scope:'national',expectedParts:1,parts:[part]}],query);
 const complete:true=result.scan.allPartsCompleted;void complete;
}
void example;
