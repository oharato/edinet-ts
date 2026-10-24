import { createCompanyProfile, CompanyProfileFieldId, type CompanyProfile, type CompanyProfileDiagnostic,
    type CompanyProfileSelection } from "./company-profile";
import { SortOrder } from "./financial-options";

/** 原文の文字列比較。数値化・正規表現・表記統一はしません。 */
export const CompanyProfileOperator = Object.freeze({ Equal: "eq", Contains: "contains" } as const);
export type CompanyProfileOperator = typeof CompanyProfileOperator[keyof typeof CompanyProfileOperator];
export interface CompanyDocument { xml: string; docID: string; }
export interface CompanyProfileCondition { field: CompanyProfileFieldId; operator: CompanyProfileOperator; value: string; }
export interface CompanyScreeningOptions {
    conditions?: readonly CompanyProfileCondition[];
    fiscalYearEndMonth?: number;
    sortBy?: CompanyProfileFieldId;
    order?: SortOrder;
    offset?: number;
    limit?: number;
}
export interface CompanyScreeningDiagnostic {
    docID: string;
    reason: "incomplete" | "inconsistent";
    /** 採用できなかった項目と、その候補・理由。 */
    fields: readonly CompanyProfileSelection[];
    consistencyDiagnostics: readonly CompanyProfileDiagnostic[];
}
export interface CompanyScreeningResult {
    rows: (CompanyProfile & { sourceXmlHash: string })[];
    /** ページ指定前の条件一致件数。 */
    total: number;
    excludedRows: number;
    /** 6項目を採用できたが、条件に一致しなかった行数。 */
    filteredRows: number;
    diagnostics: readonly CompanyScreeningDiagnostic[];
    /** 項目数ではなく、除外した行数。 */
    reasonCounts: Record<CompanyScreeningDiagnostic["reason"], number>;
}
const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const fields = Object.values(CompanyProfileFieldId);
const knownField = (value: unknown): value is CompanyProfileFieldId => typeof value === "string" && fields.includes(value as CompanyProfileFieldId);
const compareRaw = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

/** 明示した原本集合だけを読む会社属性検索。企業結合・最新選択・財務比較・外部取得はしません。 */
export function screenCompanyDocuments(documents: readonly CompanyDocument[], options: CompanyScreeningOptions = {}): CompanyScreeningResult {
    if (!Array.isArray(documents) || !record(options) || Object.keys(options).some(key =>
        !["conditions", "fiscalYearEndMonth", "sortBy", "order", "offset", "limit"].includes(key))) throw new Error("不正な会社情報検索の入力です");
    if (options.conditions !== undefined && !Array.isArray(options.conditions)) throw new Error("conditionsは配列です");
    const conditions = Array.from(options.conditions ?? []);
    for (const condition of conditions) {
        if (!record(condition) || Object.keys(condition).some(key => !["field", "operator", "value"].includes(key)) ||
            !knownField(condition.field) || !Object.values(CompanyProfileOperator).includes(condition.operator) ||
            typeof condition.value !== "string" || condition.value.length === 0) throw new Error("不正な会社情報の文字列条件です");
    }
    if (options.sortBy !== undefined && !knownField(options.sortBy) || options.order !== undefined && !Object.values(SortOrder).includes(options.order)) throw new Error("不正な会社情報の並び指定です");
    for (const value of [options.offset, options.limit]) if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    if (options.fiscalYearEndMonth !== undefined && (!Number.isInteger(options.fiscalYearEndMonth) || options.fiscalYearEndMonth < 1 || options.fiscalYearEndMonth > 12)) throw new Error("決算月は1から12の整数です");

    const seenDocs = new Set<string>();
    const captured: CompanyDocument[] = [];
    for (const document of documents) {
        if (!record(document) || Object.keys(document).some(key => !["xml", "docID"].includes(key))) throw new Error("xmlと空白のない明示docIDが必要です");
        // getter等が再読取で値を変えても、検査した入力と解析・hashする入力を一致させます。
        const { xml, docID } = document;
        if (typeof xml !== "string" || typeof docID !== "string" || !docID || /[\s\x00-\x1f\x7f]/.test(docID)) throw new Error("xmlと空白のない明示docIDが必要です");
        if (seenDocs.has(docID)) throw new Error("同一docIDの複数原本は指定できません");
        seenDocs.add(docID);
        captured.push({ xml, docID });
    }
    const profiles = captured.map(document => createCompanyProfile(document.xml, document.docID));
    const eligible: CompanyScreeningResult["rows"] = [], diagnostics: CompanyScreeningDiagnostic[] = [];
    const reasonCounts: CompanyScreeningResult["reasonCounts"] = { incomplete: 0, inconsistent: 0 };
    const seenEdinetCodes = new Set<string>(), seenEntities = new Set<string>();
    const raw = (profile: CompanyProfile, field: CompanyProfileFieldId): string => profile.fields[field].raw!;
    for (const profile of profiles) {
        const unavailable = fields.map(field => profile.fields[field]).filter(selection => selection.status !== "selected");
        if (unavailable.length || profile.consistency.status !== "consistent") {
            const reason = profile.consistency.status === "inconsistent" ? "inconsistent" : "incomplete";
            diagnostics.push({ docID: profile.docID, reason, fields: unavailable, consistencyDiagnostics: profile.consistency.diagnostics });
            reasonCounts[reason]++;
            continue;
        }
        const edinetCode = raw(profile, CompanyProfileFieldId.EdinetCode);
        const entity = profile.fields.edinetCode.source!.entity!;
        const entityKey = JSON.stringify([entity.scheme, entity.identifier]);
        // 条件で片方が消える場合も、同じ会社の別原本を黙って選択しません。
        if (seenEdinetCodes.has(edinetCode) || seenEntities.has(entityKey)) throw new Error("同一EDINETコードまたは同一entityの複数候補は指定できません");
        seenEdinetCodes.add(edinetCode); seenEntities.add(entityKey);
        eligible.push(profile);
    }
    const rows = eligible.filter(profile => conditions.every(condition => condition.operator === CompanyProfileOperator.Equal
        ? raw(profile, condition.field) === condition.value : raw(profile, condition.field).includes(condition.value)) &&
        (options.fiscalYearEndMonth === undefined || Number(raw(profile, CompanyProfileFieldId.FiscalYearEndDate).slice(5, 7)) === options.fiscalYearEndMonth));
    const sortBy = options.sortBy ?? CompanyProfileFieldId.EdinetCode, direction = options.order === SortOrder.Descending ? -1 : 1;
    rows.sort((left, right) => compareRaw(raw(left, sortBy), raw(right, sortBy)) * direction ||
        compareRaw(raw(left, CompanyProfileFieldId.EdinetCode), raw(right, CompanyProfileFieldId.EdinetCode)) || compareRaw(left.docID, right.docID));
    diagnostics.sort((left, right) => compareRaw(left.docID, right.docID));
    const offset = options.offset ?? 0;
    return { rows: rows.slice(offset, options.limit === undefined ? undefined : offset + options.limit), total: rows.length,
        excludedRows: diagnostics.length, filteredRows: eligible.length - rows.length, diagnostics, reasonCounts };
}
