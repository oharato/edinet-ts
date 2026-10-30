import {CorporateRegistryBlockStore,CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES,linkCompanyMasterCorporateStates,type CorporateRegistryChunkImport,type CorporateRegistryStoredStateResult} from '../../dist/index.js';
const store=new CorporateRegistryBlockStore('registry-blocks.sqlite',{readOnly:true});
const result:CorporateRegistryStoredStateResult=store.reconstruct([],{corporateNumber:'1010001001202',asOf:'2026-10-30',knownAt:'2026-10-31T00:00:00Z',registryPurpose:'download'});
linkCompanyMasterCorporateStates([],store,[],{edinetCodes:['E00001'],asOf:'2026-10-30',knownAt:'2026-10-31T00:00:00Z',registryPurpose:'download'});
const input:CorporateRegistryChunkImport={source:{sourceUrl:'https://example.test/full.zip',observedAt:'2026-10-31T00:00:00Z',dataDate:'2026-10-30',kind:'full',purpose:'download'},part:'first.xml',sha256:'0'.repeat(64),chunks:(async function*(){yield new Uint8Array()})()};
void [input,result,CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES];store.close();

import type {DedicatedSqliteRecoveryKind} from '../../dist/index.js';
const kind:DedicatedSqliteRecoveryKind='corporate-registry-block-store';void kind;
