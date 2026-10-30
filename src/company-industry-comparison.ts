import {screenCompanyFinancials,type CompanyFinancialScreeningOptions,type CompanyFinancialScreeningResult} from './company-financial-screening';
import {queryCompanyMaster,type CompanyMasterSnapshot} from './company-master';
import {compareFractions,decimalFraction,reduceFraction,type DecimalFraction} from './decimal-fraction';
import type {FinancialIndexMetricId} from './db/financial-search-index';

export interface CompanyIndustryComparisonOptions {
    cohort:CompanyFinancialScreeningOptions['cohort'];
    company:CompanyFinancialScreeningOptions['company'];
    metricIds:readonly FinancialIndexMetricId[];
}
export interface IndustryExactValue {numerator:string;denominator:string;}
export interface IndustryMetricStatistics {
    metric:FinancialIndexMetricId;count:number;
    sum:IndustryExactValue;mean:IndustryExactValue;median:IndustryExactValue;
    min:number;max:number;
}
export interface CompanyIndustryGroup {
    /** 原表記。空欄・不明はnull。 */
    industry:string|null;
    masterCompanies:number;usableCompanies:number;excludedCompanies:number;unrepresentedCompanies:number;
    metrics:IndustryMetricStatistics[];
}
export interface CompanyIndustryComparisonResult extends CompanyFinancialScreeningResult {
    sample:'complete-case';metricIds:readonly FinancialIndexMetricId[];industries:CompanyIndustryGroup[];
}
const exact=(value:DecimalFraction):IndustryExactValue=>({numerator:String(value.numerator),denominator:String(value.denominator)});
const add=(a:DecimalFraction,b:DecimalFraction)=>reduceFraction(a.numerator*b.denominator+b.numerator*a.denominator,a.denominator*b.denominator);

/** 同一cohort・全指定項目が利用可能な共通企業集合で比較。欠損を補完せず、出典行も返します。 */
export function compareCompanyFinancialsByIndustry(indexFile:string,snapshots:readonly CompanyMasterSnapshot[],options:CompanyIndustryComparisonOptions):CompanyIndustryComparisonResult {
    if(!options||typeof options!=='object'||Array.isArray(options)||Object.keys(options).some(k=>!['cohort','company','metricIds'].includes(k))||!Array.isArray(snapshots))throw Error('比較集合・企業条件・指標を指定してください');
    const input=structuredClone(options),masters:CompanyMasterSnapshot[]=structuredClone(Array.from({length:snapshots.length},(_,i)=>snapshots[i]));
    const result=screenCompanyFinancials(indexFile,masters,{cohort:input.cohort,company:input.company,search:{metricIds:input.metricIds}});
    const master=queryCompanyMaster(masters,{...input.company,knownAt:result.cutoff});
    const groups=new Map<string|null,{members:Set<string>;rows:CompanyFinancialScreeningResult['rows'];excluded:Set<string>}>();
    const industry=(value:string|undefined)=>value?.trim()?value:null;
    if(master.status==='available')for(const company of master.rows){
        const key=industry(company.industry);if(!groups.has(key))groups.set(key,{members:new Set(),rows:[],excluded:new Set()});
        groups.get(key)!.members.add(company.edinetCode);
    }
    for(const row of result.rows)groups.get(industry(row.company.industry))!.rows.push(row);
    for(const d of result.diagnostics)if(d.required)groups.get(industry(d.company.industry))!.excluded.add(d.company.edinetCode);
    const industries=[...groups].sort(([a],[b])=>a===null?b===null?0:1:b===null?-1:a<b?-1:a>b?1:0).map(([industry,g]):CompanyIndustryGroup=>{
        const represented=new Set([...g.rows.map(r=>r.company.edinetCode),...g.excluded]);
        const metrics=g.rows.length?input.metricIds.map(metric=>{
            const values=g.rows.map(r=>{const s=r.financial.snapshot.selections[metric];if(s?.status!=='selected'||s.safeNumber===undefined)throw Error('比較対象の採用値がありません');return s.safeNumber}).sort((a,b)=>compareFractions(decimalFraction(a),decimalFraction(b)));
            const sum=values.reduce((s,v)=>add(s,decimalFraction(v)),{numerator:0n,denominator:1n});
            const n=values.length,mid=Math.floor(n/2),middle=n%2?decimalFraction(values[mid]):add(decimalFraction(values[mid-1]),decimalFraction(values[mid]));
            return {metric,count:n,sum:exact(sum),mean:exact(reduceFraction(sum.numerator,sum.denominator*BigInt(n))),median:exact(n%2?middle:reduceFraction(middle.numerator,middle.denominator*2n)),min:values[0],max:values[n-1]};
        }):[];
        return {industry,masterCompanies:g.members.size,usableCompanies:g.rows.length,excludedCompanies:g.excluded.size,unrepresentedCompanies:g.members.size-represented.size,metrics};
    });
    return {...result,sample:'complete-case',metricIds:input.metricIds,industries};
}
