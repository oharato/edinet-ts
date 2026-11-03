import {instance,fact,context,period,standalone} from './metric-boundaries';
import type {IfrsFinancialDetailMetadata,IfrsFinancialDetailDocument} from '../../src/index';
export const ifrsDetailMappings=[
 ['costOfSales','CostOfSalesIFRS'],['grossProfit','GrossProfitIFRS'],['sellingGeneralAndAdministrativeExpenses','SellingGeneralAndAdministrativeExpensesIFRS'],['profitBeforeTax','ProfitLossBeforeTaxIFRS'],['incomeTaxExpense','IncomeTaxExpenseIFRS'],
 ['depreciationAndAmortizationCashFlow','DepreciationAndAmortizationOpeCFIFRS'],['depreciationExpenseCashFlow','DepreciationExpenseOpeCFIFRS'],['propertyPlantEquipmentPurchaseCashFlow','PurchaseOfPropertyPlantAndEquipmentInvCFIFRS'],['propertyPlantEquipmentAndIntangiblesPurchaseCashFlow','PurchaseOfPropertyPlantAndEquipmentAndIntangibleAssetsInvCFIFRS'],['incomeTaxesPaidCashFlow','IncomeTaxesPaidOpeCFIFRS'],['incomeTaxesRefundCashFlow','IncomeTaxesRefundOpeCFIFRS'],['netIncomeTaxesRefundPaidCashFlow','IncomeTaxesRefundPaidOpeCFIFRS'],['dividendsPaidCashFlow','DividendsPaidFinCFIFRS'],['dividendsPaidToOwnersOfParentCashFlow','DividendsPaidToOwnersOfParentFinCFIFRS'],['longTermBorrowingsRepaymentCashFlow','RepaymentsOfLongTermBorrowingsFinCFIFRS'],['bondsAndLongTermBorrowingsRepaymentCashFlow','RedemptionOfBondsAndRepaymentsOfLongTermBorrowingsFinCFIFRS'],['leaseObligationsRepaymentCashFlow','RepaymentsOfLeaseObligationsFinCFIFRS']
] as const;
export const ifrsDetailMetadata=(secCode='1001'):IfrsFinancialDetailMetadata=>({secCode,docID:'IFRS-'+secCode,accountingStandard:'IFRS',scope:'Consolidated',currency:'JPY',periodType:'annual',period:{...period}});
export function ifrsDetailDocument(code='1001',options:{raw?:string;absent?:string;nil?:string;duplicate?:string;unit?:string;namespace?:string;scope?:'NonConsolidated';extra?:string}={}):IfrsFinancialDetailDocument{
 const facts=ifrsDetailMappings.filter(([id])=>id!==options.absent).map(([id,tag],i)=>{
  const raw=options.raw??String(i<5?100+i:-100-i),f=fact(id===options.nil?'':raw,id===options.nil?'xsi:nil="true"':'','jpigp_cor:'+tag);
  return f+(id===options.duplicate?f:'');
 }).join('')+(options.extra??'');
 const xml=instance(facts,context('current',options.scope?standalone:'').replace('>TEST<','>'+code+'<'),'<xbrli:unit id="money"><xbrli:measure>'+ (options.unit??'iso4217:JPY')+'</xbrli:measure></xbrli:unit>').replace('<xbrli:xbrl ','<xbrli:xbrl xmlns:jpigp_cor="'+(options.namespace??'http://disclosure.edinet-fsa.go.jp/taxonomy/jpigp/2025-11-01/jpigp_cor')+'" ');
 return {xml,metadata:ifrsDetailMetadata(code)};
}
