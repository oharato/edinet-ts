import { createHash } from "node:crypto";
import type { EdinetContext } from "./edinet-context";
import type { EdinetData } from "./edinet-xbrl-object";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";

/** 財務の科目IDとは分けた、会社情報の項目名。 */
export const CompanyProfileFieldId = Object.freeze({
    FilerName: "filerName", EdinetCode: "edinetCode", SecurityCode: "securityCode",
    AccountingStandard: "accountingStandard", FiscalYearStartDate: "fiscalYearStartDate", FiscalYearEndDate: "fiscalYearEndDate"
} as const);
export type CompanyProfileFieldId = typeof CompanyProfileFieldId[keyof typeof CompanyProfileFieldId];
export const COMPANY_PROFILE_SELECTION_VERSION = "1";
const tags: Record<CompanyProfileFieldId, string> = {
    filerName: "FilerNameInJapaneseDEI", edinetCode: "EDINETCodeDEI", securityCode: "SecurityCodeDEI",
    accountingStandard: "AccountingStandardsDEI", fiscalYearStartDate: "CurrentFiscalYearStartDateDEI", fiscalYearEndDate: "CurrentFiscalYearEndDateDEI"
};
export type CompanyProfileReason = "selected" | "tag-absent" | "nil" | "empty-value" | "unknown-namespace" |
    "unknown-context" | "duplicate-context" | "multiple-facts" | "unsupported-context" | "unsupported-dimensions" |
    "unsupported-entity" | "unsupported-unit" | "raw-unavailable" | "invalid-date";
export interface CompanyProfileEvidence {
    docID: string; key: string; namespaceURI?: string; contextRef: string;
    entity?: EdinetContext["entity"]; period?: EdinetContext["period"];
    dimensions?: readonly string[]; rawDimensions?: unknown;
    raw?: string; nil: boolean; unitRef: string; reason: CompanyProfileReason;
}
export type CompanyProfileSelection = {
    fieldId: CompanyProfileFieldId; reason: CompanyProfileReason; evidence: readonly CompanyProfileEvidence[];
} & ({ status: "selected"; raw: string; source: CompanyProfileEvidence } |
    { status: "missing" | "unsupported" | "ambiguous"; raw?: never; source?: never });
export interface CompanyProfileDiagnostic {
    reason: "entity-mismatch" | "instant-mismatch" | "fiscal-year-reversed";
    fields: readonly CompanyProfileFieldId[];
}
export interface CompanyProfile {
    /** 呼出側が指定した書類ID。原本との対応を自動で保証する値ではありません。 */
    docID: string;
    /** Object単体は元のXMLを保持しないためundefined。createCompanyProfileではSHA-256。 */
    sourceXmlHash?: string;
    selectionVersion: string;
    fields: Record<CompanyProfileFieldId, CompanyProfileSelection>;
    consistency: { status: "consistent" | "inconsistent" | "incomplete"; diagnostics: readonly CompanyProfileDiagnostic[] };
}
const validDate = (value: string): boolean => /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const standardNamespace = (uri: string | undefined): boolean => {
    const match = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpdei\/(\d{4}-\d{2}-\d{2})\/jpdei_cor$/.exec(uri ?? "");
    return !!match && validDate(match[1]);
};

/** 内部の解析結果だけを読み、会社の結合・会計基準の変換・外部取得はしません。 */
export function selectCompanyProfile(docID: string, facts: ReadonlyMap<string, readonly EdinetData[]>,
    contexts: ReadonlyMap<string, EdinetContext>, duplicateContexts: ReadonlySet<string>): CompanyProfile {
    const entities = new Set(Array.from(contexts.values(), context => context.entity?.scheme.trim() && context.entity.identifier.trim()
        ? JSON.stringify([context.entity.scheme, context.entity.identifier]) : ""));
    const singleEntity = entities.size === 1 && !entities.has("");
    const fields = {} as CompanyProfile["fields"];
    for (const fieldId of Object.values(CompanyProfileFieldId)) {
        const evidence: CompanyProfileEvidence[] = [];
        for (const [key, list] of facts) {
            if (key.split(":").at(-1) !== tags[fieldId]) continue;
            for (const fact of list) {
                const context = contexts.get(fact.contextRef);
                const item: CompanyProfileEvidence = {
                    docID, key, namespaceURI: fact.namespaceURI, contextRef: fact.contextRef,
                    entity: context?.entity ? { ...context.entity } : undefined,
                    period: context ? { ...context.period } : undefined,
                    dimensions: context ? [...context.dimensions] : undefined,
                    rawDimensions: context?.rawDimensions === undefined ? undefined : structuredClone(context.rawDimensions),
                    raw: fact.rawValue, nil: fact.nil, unitRef: fact.unitRef, reason: "selected"
                };
                if (!standardNamespace(fact.namespaceURI)) item.reason = "unknown-namespace";
                else if (!context) item.reason = "unknown-context";
                else if (duplicateContexts.has(context.id)) item.reason = "duplicate-context";
                else if (!context.namespaceVerified || !context.periodValid || !context.period.instant ||
                    !validDate(context.period.instant) || context.period.startDate !== undefined || context.period.endDate !== undefined) item.reason = "unsupported-context";
                else if (!singleEntity) item.reason = "unsupported-entity";
                else if (context.unsupportedDimensions || context.dimensions.length !== 0) item.reason = "unsupported-dimensions";
                else if (fact.unitRef !== "") item.reason = "unsupported-unit";
                else if (fact.nil) item.reason = "nil";
                else if (fact.rawValue === undefined) item.reason = "raw-unavailable";
                else if (fact.rawValue.trim() === "") item.reason = "empty-value";
                else if ((fieldId === "fiscalYearStartDate" || fieldId === "fiscalYearEndDate") && !validDate(fact.rawValue)) item.reason = "invalid-date";
                evidence.push(item);
            }
        }
        const finish = (status: "missing" | "unsupported" | "ambiguous", reason: CompanyProfileReason): CompanyProfileSelection =>
            ({ fieldId, status, reason, evidence });
        if (evidence.some(e => e.reason === "duplicate-context")) fields[fieldId] = finish("ambiguous", "duplicate-context");
        else if (evidence.length > 1) fields[fieldId] = finish("ambiguous", "multiple-facts");
        else if (!evidence.length) fields[fieldId] = finish("missing", "tag-absent");
        else {
            const source = evidence[0];
            fields[fieldId] = source.reason === "selected" ? { fieldId, status: "selected", reason: "selected", raw: source.raw!, source, evidence } :
                finish(source.reason === "nil" || source.reason === "empty-value" ? "missing" : "unsupported", source.reason);
        }
    }
    const selected = Object.values(fields).filter((field): field is CompanyProfileSelection & { status: "selected" } => field.status === "selected");
    const diagnostics: CompanyProfileDiagnostic[] = [];
    if (new Set(selected.map(field => JSON.stringify(field.source.entity))).size > 1) diagnostics.push({ reason: "entity-mismatch", fields: selected.map(f => f.fieldId) });
    if (new Set(selected.map(field => field.source.period?.instant)).size > 1) diagnostics.push({ reason: "instant-mismatch", fields: selected.map(f => f.fieldId) });
    const start = fields.fiscalYearStartDate, end = fields.fiscalYearEndDate;
    if (start.status === "selected" && end.status === "selected" && start.raw > end.raw) diagnostics.push({ reason: "fiscal-year-reversed", fields: [start.fieldId, end.fieldId] });
    return { docID, selectionVersion: COMPANY_PROFILE_SELECTION_VERSION, fields,
        consistency: { status: diagnostics.length ? "inconsistent" : selected.length === Object.keys(tags).length ? "consistent" : "incomplete", diagnostics } };
}

/** 明示した原本だけを構文検査して解析します。ファイル・通信・DBには触れません。 */
export function createCompanyProfile(xml: string, docID: string): CompanyProfile & { sourceXmlHash: string } {
    if (typeof docID !== "string" || !docID || /[\s\x00-\x1f\x7f]/.test(docID)) throw new Error("空白のない明示docIDが必要です");
    const profile = new EdinetXbrlParser().parse(xml, docID).getCompanyProfile();
    return { ...profile, sourceXmlHash: createHash("sha256").update(xml).digest("hex") };
}
