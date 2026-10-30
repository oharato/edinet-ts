import {reconstructCorporateRegistryState,type CorporateRegistryDelivery,type CorporateRegistryStateResult} from '../../dist/index.js';
const deliveries:CorporateRegistryDelivery[]=[];
const result:CorporateRegistryStateResult=reconstructCorporateRegistryState(deliveries,{corporateNumber:'1010001001202',asOf:'2026-10-29',knownAt:'2026-10-30T00:00:00Z',registryPurpose:'sample'});
if(result.selection.status==='available'){const sourceIndex:number=result.selection.record.sourceIndex;void sourceIndex;}
// @ts-expect-error 全国全分割を確認した宣言を必要とする。
const invalid:CorporateRegistryDelivery={scope:'regional',expectedParts:1,parts:[]};void invalid;

import {parseCorporateRegistryPublicationCalendar,type CorporateRegistryPublicationCalendarInput} from '../../dist/index.js';
declare const calendar:CorporateRegistryPublicationCalendarInput;
const parsed=parseCorporateRegistryPublicationCalendar(calendar);const first:number=parsed.firstYear;
const withCalendar=reconstructCorporateRegistryState(deliveries,result.query,calendar);
const reason:'year-end'|'weekend'|'holiday'|undefined=withCalendar.nonPublicationDays?.[0]?.reason;void [first,reason];
