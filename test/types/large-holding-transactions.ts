import {extractLargeHoldingTransactions,searchLargeHoldingTransactions,LARGE_HOLDING_TRANSACTIONS_VERSION,type LargeHoldingDocument,type LargeHoldingTransactionSearchOptions} from '../../src/index';
declare const document:LargeHoldingDocument;
export const version:'1'=LARGE_HOLDING_TRANSACTIONS_VERSION;
export const result=extractLargeHoldingTransactions(document);
export const unit:'not-stated'=result.rows[0].quantity.unit;
export const semantics:'reported-calendar-only'=result.dateSemantics;
export const query:LargeHoldingTransactionSearchOptions={cutoff:'2026-10-31T00:00:00Z',reportedStartDate:'2025-04-23',instrument:'ordinary-shares'};
export const search=searchLargeHoldingTransactions([document],query);
// @ts-expect-error displayed quantity is not authenticated shares
export const shares:'shares'=result.rows[0].quantity.unit;
// @ts-expect-error the caller explicitly queries reported dates
query.startDate='2025-04-23';
// @ts-expect-error this is not a holdings metric projection
query.metric='heldEquivalents';

import {LargeHoldingStore} from 'edinet-ts';
const transactionStore=new LargeHoldingStore(':memory:');
const storedTransactions=transactionStore.searchTransactions({cutoff:'2026-10-29T00:00:00Z',action:'acquisition'});
const storedOriginalXml:false=storedTransactions.storage.originalXmlStored;
const storedMatched:number=storedTransactions.matched;
transactionStore.close();
void storedOriginalXml;void storedMatched;
