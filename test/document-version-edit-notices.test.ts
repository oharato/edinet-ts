import {it,expect} from 'vitest';
import {selectDocumentVersions,type DocumentVersionObservation} from '../src/index';
const cutoff='2026-10-30T00:00:00Z';
function pair():[DocumentVersionObservation,DocumentVersionObservation]{
 const main:DocumentVersionObservation={observationId:'original-list',observedAt:'2026-10-29T12:00:00Z',listDate:'2025-05-14',document:{docID:'A',parentDocID:null,docTypeCode:'160',edinetCode:'E12345',secCode:'10010',submitDateTime:'2025-05-14 15:34',opeDateTime:null,withdrawalStatus:'0',disclosureStatus:'0',docInfoEditStatus:'2',periodStart:'2024-10-01',periodEnd:'2025-03-31',xbrlFlag:'1'}};
 const notice=structuredClone(main);notice.observationId='immutable-notice';notice.document.docInfoEditStatus='1';notice.document.opeDateTime='2025-05-14 16:00';notice.document.periodEnd='2025-09-30';return [main,notice];
}
it('同時刻に確認した修正済み元一覧を過去の固定通知と混同せず、両観測の証跡を残す',()=>{
 const [main,notice]=pair();const result=selectDocumentVersions([main,notice],cutoff);
 expect(result.selected).toHaveLength(1);expect(result.selected[0]).toMatchObject({observation:{observationId:'original-list'},observationIds:['immutable-notice','original-list'],targetPeriod:{startDate:'2024-10-01',endDate:'2025-03-31'}});
 expect(selectDocumentVersions([notice,main],cutoff)).toEqual(result);
});
it.each(['unedited','missing-original-date','wrong-original-date','main-operation','missing-operation','future-operation','same-day-operation','wrong-notice-date','issuer','parent','format','withdrawal','disclosure'] as const)('%sでは通知の競合を推測解消しない',kind=>{
 const [main,notice]=pair();
 if(kind==='unedited')main.document.docInfoEditStatus='0';if(kind==='missing-original-date')delete main.listDate;if(kind==='wrong-original-date')main.listDate='2025-05-15';if(kind==='main-operation')main.document.opeDateTime='2025-05-14 15:00';if(kind==='missing-operation')notice.document.opeDateTime=null;if(kind==='future-operation')notice.document.opeDateTime='2026-10-30 09:00';if(kind==='same-day-operation'){notice.document.opeDateTime='2026-10-29 09:00';notice.listDate='2026-10-29'}if(kind==='wrong-notice-date')notice.listDate='2025-05-15';if(kind==='issuer')notice.document.edinetCode='E99999';if(kind==='parent')notice.document.parentDocID='OTHER';if(kind==='format')notice.document.xbrlFlag='0';if(kind==='withdrawal')main.document.withdrawalStatus=notice.document.withdrawalStatus='2';if(kind==='disclosure')main.document.disclosureStatus=notice.document.disclosureStatus='2';
 expect(selectDocumentVersions([main,notice],cutoff).selected).toEqual([]);expect(selectDocumentVersions([notice,main],cutoff).selected).toEqual([]);
});
it('後から観測した通知で古い元一覧を採用せず、同時刻でも元一覧同士の矛盾を隠さない',()=>{
 const [main,notice]=pair();notice.observedAt='2026-10-29T12:00:01Z';expect(selectDocumentVersions([main,notice],cutoff).selected).toEqual([]);
 const [base,event]=pair(),other=structuredClone(base);other.observationId='conflicting-original';other.document.periodEnd='2025-09-30';expect(selectDocumentVersions([base,event,other],cutoff).selected).toEqual([]);
});
