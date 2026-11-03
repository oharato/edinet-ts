import {DOCUMENT_FORMAT_KEYS,normalizeDocumentFormatFlag,type DocumentFormatFlag} from "./document-formats";
/** API一覧の状態区分。財務値の正しさや採用する原本を決める値ではありません。 */
export const DocumentWithdrawalStatus = Object.freeze({ Other: "0", WithdrawalNotice: "1", Withdrawn: "2" } as const);
export type DocumentWithdrawalStatus = typeof DocumentWithdrawalStatus[keyof typeof DocumentWithdrawalStatus];
export const DocumentInfoEditStatus = Object.freeze({ Other: "0", EditNotice: "1", Edited: "2" } as const);
export type DocumentInfoEditStatus = typeof DocumentInfoEditStatus[keyof typeof DocumentInfoEditStatus];
export const DocumentDisclosureStatus = Object.freeze({ Other: "0", NonDisclosureNotice: "1", NonDisclosed: "2", DisclosureRestoredNotice: "3" } as const);
export type DocumentDisclosureStatus = typeof DocumentDisclosureStatus[keyof typeof DocumentDisclosureStatus];
export const DocumentParentResolution = Object.freeze({ NotInInput: "not-in-input", SingleObservation: "single-observation",
    MultipleObservations: "multiple-observations", SelfReference: "self-reference" } as const);
export type DocumentParentResolution = typeof DocumentParentResolution[keyof typeof DocumentParentResolution];
export const DOCUMENT_RELATIONS_MAX_OBSERVATIONS = 10000;
/** 参照先の観測ID配列の合計。多数の同一docID観測による出力膨張を防ぎます。 */
export const DOCUMENT_RELATIONS_MAX_PARENT_REFERENCES = 100000;

export interface DocumentRelationDocument {
    docID: string;
    xbrlFlag?: DocumentFormatFlag; pdfFlag?: DocumentFormatFlag; csvFlag?: DocumentFormatFlag; attachDocFlag?: DocumentFormatFlag; englishDocFlag?: DocumentFormatFlag;
    parentDocID?: string | null;
    withdrawalStatus?: string | number | null;
    docInfoEditStatus?: string | number | null;
    disclosureStatus?: string | number | null;
    docTypeCode?: string | null;
    edinetCode?: string | null;
    secCode?: string | null;
    submitDateTime?: string | null;
    opeDateTime?: string | null;
    /** 入力に他の一覧項目があっても、その値は読まず返しません。 */
    [key: string]: unknown;
}
export interface DocumentRelationObservation { observationId: string; listDate?: string; document: DocumentRelationDocument; }
export type ObservedDocumentStatus<Code extends string> =
    { presence: "known"; code: Code; label: string } | { presence: "missing" | "null"; code?: never; label: string };
export interface AnalyzedDocumentObservation extends DocumentRelationObservation {
    statuses: {
        withdrawalStatus: ObservedDocumentStatus<DocumentWithdrawalStatus>;
        docInfoEditStatus: ObservedDocumentStatus<DocumentInfoEditStatus>;
        disclosureStatus: ObservedDocumentStatus<DocumentDisclosureStatus>;
    };
}
export interface DocumentRelationGroup { docID: string; observationIds: string[]; }
export interface DeclaredDocumentRelation {
    observationId: string; docID: string; parentDocID: string;
    parentObservationIds: string[]; resolution: DocumentParentResolution;
}
export type DocumentRelationDiagnosticCode = "parent-unrecorded" | "parent-not-in-input" | "multiple-observations" |
    "observation-values-differ" | "self-reference" | "cycle-candidate";
export interface DocumentRelationDiagnostic {
    code: DocumentRelationDiagnosticCode; message: string; observationIds: string[]; docIDs: string[]; fields?: string[];
}
export interface DocumentRelationsResult {
    observations: AnalyzedDocumentObservation[]; groups: DocumentRelationGroup[]; relations: DeclaredDocumentRelation[];
    diagnostics: DocumentRelationDiagnostic[];
    summary: { observations: number; documents: number; relations: number; diagnostics: number };
}
const documentKeys = ["docID", "parentDocID", "withdrawalStatus", "docInfoEditStatus", "disclosureStatus", "docTypeCode", "edinetCode", "secCode", "submitDateTime", "opeDateTime", ...DOCUMENT_FORMAT_KEYS] as const;
const statusKeys = ["withdrawalStatus", "docInfoEditStatus", "disclosureStatus"] as const;
const labels = {
    withdrawalStatus: { "0": "取下区分はその他", "1": "取下書", "2": "取下げられた書類" },
    docInfoEditStatus: { "0": "書類情報修正区分はその他", "1": "書類情報の修正を知らせる情報", "2": "書類情報が修正された書類" },
    disclosureStatus: { "0": "開示不開示区分はその他", "1": "不開示開始を知らせる情報", "2": "不開示とされている書類", "3": "不開示解除を知らせる情報" }
} as const;
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const compare = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const validId = (value: unknown): value is string => typeof value === "string" && value.length <= 256 && !!value.trim() && value === value.trim() && !/[\x00-\x1f\x7f-\x9f]/.test(value);
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
function status(value: unknown, field: typeof statusKeys[number]): ObservedDocumentStatus<string> {
    if (value === undefined) return { presence: "missing", label: "入力に区分の記録がありません" };
    if (value === null) return { presence: "null", label: "区分がnullで、状態を解釈できません" };
    if (typeof value !== "string" && typeof value !== "number" || !Object.hasOwn(labels[field], String(value))) throw new Error("書類状態は既知の文字列/数値区分、null、または未記録だけを受け付けます");
    const code = String(value);
    return { presence: "known", code, label: (labels[field] as Record<string, string>)[code] };
}
/** 必要な属性だけを各一回取得。未知の追加項目は評価しません。 */
function snapshot(value: DocumentRelationObservation): AnalyzedDocumentObservation {
    if (!record(value) || !Object.hasOwn(value, "observationId") || !Object.hasOwn(value, "document") || Object.keys(value).some(key => !["observationId", "listDate", "document"].includes(key))) throw new Error("observationId/listDate/documentの観測を指定してください");
    const observationId = value.observationId, document = value.document, listDate = Object.hasOwn(value, "listDate") ? value.listDate : undefined;
    if (!validId(observationId) || listDate !== undefined && !validDate(listDate) || !record(document)) throw new Error("正しい観測ID・一覧日付・書類情報が必要です");
    const captured: Record<string, unknown> = {};
    for (const key of documentKeys) if (Object.hasOwn(document, key)) captured[key] = document[key];
    if (!validId(captured.docID) || captured.parentDocID !== undefined && captured.parentDocID !== null && !validId(captured.parentDocID)) throw new Error("書類ID/親書類IDが不正です");
    for (const key of ["docTypeCode", "edinetCode", "secCode", "submitDateTime", "opeDateTime"] as const) {
        const item = captured[key];
        if (item !== undefined && item !== null && (typeof item !== "string" || item.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(item))) throw new Error("任意の書類情報は256文字以下の文字列/null/未記録で指定してください");
    }
    for (const key of DOCUMENT_FORMAT_KEYS) if (Object.hasOwn(captured,key)) captured[key] = normalizeDocumentFormatFlag(captured[key]);
    const statuses = Object.fromEntries(statusKeys.map(key => [key, status(captured[key], key)])) as AnalyzedDocumentObservation["statuses"];
    return { observationId, ...(listDate === undefined ? {} : { listDate }), document: captured as DocumentRelationDocument, statuses };
}

/** 入力に明示された参照の合併グラフだけを調べます。履歴上の同時成立は判定しません。 */
function cycleGroups(groups: readonly DocumentRelationGroup[], relations: readonly DeclaredDocumentRelation[]): string[][] {
    const forward = new Map(groups.map(group => [group.docID, new Set<string>()])), backward = new Map(groups.map(group => [group.docID, new Set<string>()]));
    for (const relation of relations) if (forward.has(relation.parentDocID)) {
        forward.get(relation.docID)!.add(relation.parentDocID); backward.get(relation.parentDocID)!.add(relation.docID);
    }
    const seen = new Set<string>(), order: string[] = [];
    for (const start of forward.keys()) {
        if (seen.has(start)) continue;
        const stack: { id: string; finish: boolean }[] = [{ id: start, finish: false }];
        while (stack.length) {
            const point = stack.pop()!;
            if (point.finish) { order.push(point.id); continue; }
            if (seen.has(point.id)) continue;
            seen.add(point.id); stack.push({ id: point.id, finish: true });
            for (const next of forward.get(point.id)!) if (!seen.has(next)) stack.push({ id: next, finish: false });
        }
    }
    seen.clear(); const result: string[][] = [];
    for (const start of order.reverse()) {
        if (seen.has(start)) continue;
        const component: string[] = [], stack = [start]; seen.add(start);
        while (stack.length) {
            const current = stack.pop()!; component.push(current);
            for (const next of backward.get(current)!) if (!seen.has(next)) { seen.add(next); stack.push(next); }
        }
        if (component.length > 1) result.push(component.sort(compare));
    }
    return result;
}

/** 明示観測だけの関係説明。原本取得・企業結合・訂正解決・最新採用・財務判断は行いません。 */
export function analyzeDocumentRelations(input: readonly DocumentRelationObservation[]): DocumentRelationsResult {
    if (!Array.isArray(input)) throw new Error("観測は10000件以下の配列で指定してください");
    const length = input.length;
    if (length > DOCUMENT_RELATIONS_MAX_OBSERVATIONS) throw new Error("観測は10000件以下の配列で指定してください");
    // 宣言した長さだけを各index一度読み、独自iteratorによる上限回避を防ぎます。
    const observations = Array.from({ length }, (_, index) => snapshot(input[index])), seen = new Set<string>();
    let parentReferences = 0;
    for (const observation of observations) {
        if (seen.has(observation.observationId)) throw new Error("同一observationIdの観測は区別できません");
        seen.add(observation.observationId);
    }
    observations.sort((left, right) => compare(left.observationId, right.observationId));
    const documents = new Map<string, AnalyzedDocumentObservation[]>();
    for (const observation of observations) {
        const group = documents.get(observation.document.docID) ?? [];
        group.push(observation); documents.set(observation.document.docID, group);
    }
    const groups = Array.from(documents, ([docID, records]) => ({ docID, observationIds: records.map(record => record.observationId) })).sort((left, right) => compare(left.docID, right.docID));
    const diagnostics: DocumentRelationDiagnostic[] = [], relations: DeclaredDocumentRelation[] = [];
    for (const group of groups) {
        if (group.observationIds.length < 2) continue;
        diagnostics.push({ code: "multiple-observations", message: "同じ書類IDに複数の観測があります。最新・訂正後の観測は自動で選びません。", docIDs: [group.docID], observationIds: [...group.observationIds] });
        const records = documents.get(group.docID)!;
        const differing = documentKeys.filter(key => new Set(records.map(record => Object.hasOwn(record.document, key) && record.document[key] !== undefined
            ? JSON.stringify(["value", record.document[key]]) : "missing")).size > 1);
        if (differing.length) diagnostics.push({ code: "observation-values-differ", message: "同じ書類IDの観測で原記載が異なります。情報修正等の可能性があるため、どちらかを誤りと断定しません。",
            docIDs: [group.docID], observationIds: [...group.observationIds], fields: [...differing] });
    }
    for (const observation of observations) {
        const { docID, parentDocID } = observation.document;
        if (parentDocID === undefined) {
            diagnostics.push({ code: "parent-unrecorded", message: "入力に親書類番号の項目がありません。親がないとは断定できません。", observationIds: [observation.observationId], docIDs: [docID] });
            continue;
        }
        if (parentDocID === null) continue;
        const targets = documents.get(parentDocID) ?? [];
        parentReferences += targets.length;
        if (parentReferences > DOCUMENT_RELATIONS_MAX_PARENT_REFERENCES) throw new Error("参照先の観測ID合計は100000件までです。入力集合を小さくしてください");
        const resolution = parentDocID === docID ? DocumentParentResolution.SelfReference : targets.length === 0 ? DocumentParentResolution.NotInInput :
            targets.length === 1 ? DocumentParentResolution.SingleObservation : DocumentParentResolution.MultipleObservations;
        relations.push({ observationId: observation.observationId, docID, parentDocID, parentObservationIds: targets.map(target => target.observationId), resolution });
        if (resolution === DocumentParentResolution.NotInInput) diagnostics.push({ code: "parent-not-in-input", message: "指定された親書類IDは入力集合に未収録です。書類の不存在を意味しません。", observationIds: [observation.observationId], docIDs: [docID, parentDocID] });
        if (resolution === DocumentParentResolution.SelfReference) diagnostics.push({ code: "self-reference", message: "この観測の親書類番号が同じ書類IDを参照しています。原記載を確認してください。", observationIds: [observation.observationId], docIDs: [docID] });
    }
    const components = cycleGroups(groups, relations), componentByDoc = new Map<string, number>(), involvedByComponent = components.map(() => [] as string[]);
    components.forEach((component, index) => component.forEach(docID => componentByDoc.set(docID, index)));
    for (const relation of relations) {
        const index = componentByDoc.get(relation.docID);
        if (index !== undefined && componentByDoc.get(relation.parentDocID) === index) involvedByComponent[index].push(relation.observationId);
    }
    for (const [index, component] of components.entries()) {
        diagnostics.push({ code: "cycle-candidate", message: "入力の親参照をまとめると循環候補があります。異なる観測時点の情報も含むため、確定した訂正循環とは断定しません。",
            observationIds: involvedByComponent[index].sort(compare), docIDs: component });
    }
    diagnostics.sort((left, right) => compare(left.code, right.code) || compare(JSON.stringify(left.docIDs), JSON.stringify(right.docIDs)) || compare(JSON.stringify(left.observationIds), JSON.stringify(right.observationIds)));
    return { observations, groups, relations, diagnostics, summary: { observations: observations.length, documents: groups.length, relations: relations.length, diagnostics: diagnostics.length } };
}
