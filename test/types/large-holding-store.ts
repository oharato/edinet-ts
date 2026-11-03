import {LargeHoldingStore,LARGE_HOLDING_STORE_VERSION,type LargeHoldingStoreAppendResult,type LargeHoldingStoreSearchResult} from '../../dist/index.js';
const store=new LargeHoldingStore('holdings.sqlite',{readOnly:true});
const result:LargeHoldingStoreSearchResult=store.search({cutoff:'2026-10-29T00:00:00Z',dutyDate:'2025-06-16',scope:'report',metric:'holdingPercent'});
const append:LargeHoldingStoreAppendResult=store.append([],[]);
const version:string=LARGE_HOLDING_STORE_VERSION;
const noXML:false=result.storage.originalXmlStored;
void [append,version,noXML,store.audit()];
store.close();
