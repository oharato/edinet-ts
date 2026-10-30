import {linkCompanyMasterCorporateStates,CorporateRegistryStore,type CompanyCorporateStateQuery,type CompanyCorporateStateResult,type CompanyCorporateStateLink} from '../../dist/index.js';
const query:CompanyCorporateStateQuery={asOf:'2026-10-29',knownAt:'2026-10-30T00:00:00Z',registryPurpose:'download',edinetCodes:['E00001']};
const store=new CorporateRegistryStore('registry.sqlite',{readOnly:true});
const result:CompanyCorporateStateResult=linkCompanyMasterCorporateStates([],store,[],query);
const identity:'not-established'=result.entityIdentity;
const rows:CompanyCorporateStateLink[]=result.rows;
void [identity,rows];store.close();

import {linkCompanyMasterCorporateStreamStates,type CompanyCorporateStreamStateResult,type CorporateRegistryStateResult} from '../../dist/index.js';
async function checkStream(){
 const result:CompanyCorporateStreamStateResult=await linkCompanyMasterCorporateStreamStates([],[],query);
 const state:CorporateRegistryStateResult|undefined=result.rows[0]?.state;
 const completed:true|undefined=result.scan?.allPartsCompleted;
 void [state,completed];
}
void checkStream;
