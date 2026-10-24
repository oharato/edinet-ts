import {analyzeDocumentRelations,DocumentWithdrawalStatus,DocumentInfoEditStatus,DocumentDisclosureStatus,type DocumentRelationObservation,type DocumentRelationsResult} from '../../src/index';
const observations: DocumentRelationObservation[]=[{observationId:'synthetic-a',listDate:'2025-06-30',document:{docID:'SYNTHETIC-A',parentDocID:null,withdrawalStatus:DocumentWithdrawalStatus.Other,docInfoEditStatus:DocumentInfoEditStatus.Other,disclosureStatus:DocumentDisclosureStatus.Other}}];
const result:DocumentRelationsResult=analyzeDocumentRelations(observations);
const ids:readonly string[]=result.groups[0].observationIds;
void ids;
