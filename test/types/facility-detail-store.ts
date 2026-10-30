import {FacilityDetailStore,FACILITY_DETAIL_STORE_VERSION,type FacilityDetailStoreAppendResult,type FacilityDetailStoreSearchOptions,type FacilityDetailStoreSearchResult} from '../../dist/index.js';
const store=new FacilityDetailStore('facilities.sqlite',{readOnly:true});
const query:FacilityDetailStoreSearchOptions={asOfDate:'2026-03-31',sort:{field:'landAreaM2',order:'asc'}};
const result:FacilityDetailStoreSearchResult=store.search(query);
const appended:FacilityDetailStoreAppendResult=store.append([]);
const noXML:false=result.storage.originalXmlStored;
const version:string=FACILITY_DETAIL_STORE_VERSION;
void [appended,noXML,version,store.audit()];store.close();
