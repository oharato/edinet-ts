import { AccountingStandard } from "./metric-registry";
import { FinancialPeriodType, ConsolidationScope } from "./financial-options";
type CommonMetadata = { secCode: string; docID: string; scope: ConsolidationScope; accountingStandard: AccountingStandard; currency: "JPY" };
export type FinancialDetailMetadata = CommonMetadata & (
    { period: { instant: string; startDate?: never; endDate?: never }; periodType?: never } |
    { period: { startDate: string; endDate: string; instant?: never }; periodType: FinancialPeriodType }
);
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const validDate = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v;
export function normalizeFinancialDetailMetadata(value: FinancialDetailMetadata): FinancialDetailMetadata {
    if (!record(value) || Object.keys(value).some(key => !["secCode","docID","scope","accountingStandard","currency","period","periodType"].includes(key)) ||
        typeof value.secCode !== "string" || !/^[0-9A-Z]{4}0?$/.test(value.secCode) || typeof value.docID !== "string" || !value.docID.trim() ||
        !Object.values(ConsolidationScope).includes(value.scope) || !Object.values(AccountingStandard).includes(value.accountingStandard) || value.currency !== "JPY" || !record(value.period)) throw new Error("不正な財務明細metadataです");
    const period = value.period;
    if (Object.keys(period).some(key => !["instant","startDate","endDate"].includes(key)) || (period.instant !== undefined ?
        !validDate(period.instant) || period.startDate !== undefined || period.endDate !== undefined || value.periodType !== undefined :
        !validDate(period.startDate) || !validDate(period.endDate) || period.startDate > period.endDate || !Object.values(FinancialPeriodType).includes(value.periodType!))) throw new Error("明示した正しい時点、または開始/終了日と期間分類が必要です");
    return { ...value, secCode: value.secCode.length === 4 ? value.secCode + "0" : value.secCode, period: { ...period } } as FinancialDetailMetadata;
}
