import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import type { EdinetData } from "./edinet-xbrl-object";
import type { EdinetContext } from "./edinet-context";
import type { ContextDimensionsTraceResult } from "./context-dimension-traces";
import { SortOrder } from "./financial-options";

export const SubsidiaryHumanCapitalLabelOperator = Object.freeze({ Equal: "eq", Contains: "contains" } as const);
export type SubsidiaryHumanCapitalLabelOperator = typeof SubsidiaryHumanCapitalLabelOperator[keyof typeof SubsidiaryHumanCapitalLabelOperator];
export const SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS = Object.freeze({ documents: 100, conditions: 100, candidates: 10000 });
/** @internal Only reviewed taxonomy editions; do not infer compatible dates. */
export function isSubsidiaryHumanCapitalNamespace(value: string | undefined): value is string {
    return value === "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor" ||
        value === "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2024-11-01/jpcrp_cor";
}
const tag = "ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries";
export interface SubsidiaryHumanCapitalLabelMetadata { docID: string; instant: string; secCode?: string; }
export interface SubsidiaryHumanCapitalLabelDocument { xml: string; metadata: SubsidiaryHumanCapitalLabelMetadata; }
export interface SubsidiaryHumanCapitalLabelDimension { axisNamespaceURI: string; axis: string; memberNamespaceURI: string; member: string; }
export type SubsidiaryHumanCapitalLabelReason = "selected" | "tag-absent" | "unknown-namespace" | "context-unavailable" | "unsupported-context" |
    "period-mismatch" | "unsupported-entity" | "trace-unavailable" | "unsupported-dimensions" | "duplicate-context" |
    "unsupported-unit" | "nil" | "empty-parsed-label" | "reference-like-text" | "raw-unavailable" | "multiple-facts";
export interface SubsidiaryHumanCapitalLabelEvidence {
    factKey: string; namespaceURI?: string; contextRef: string;
    /** 既存parserのtrim等を経た表現。元XMLの字面ではありません。 */
    parsedText: string; parsedRawValue?: string; nil: boolean; unitRef: string;
    entity?: EdinetContext["entity"]; period?: EdinetContext["period"];
    /** 同じ書類のextraction.traces / search.sources[].tracesのindex。全文を候補ごとに複製しません。 */
    traceRef: number; reason: SubsidiaryHumanCapitalLabelReason;
}
export interface SubsidiaryHumanCapitalLabelTrace { contextRef: string; trace: ContextDimensionsTraceResult; }
interface LabelRowBase {
    rowKey: string | null; metadata: SubsidiaryHumanCapitalLabelMetadata;
    entity?: EdinetContext["entity"]; dimensions?: readonly SubsidiaryHumanCapitalLabelDimension[];
    /** 明示連結軸は今回未対応。DTSのdefaultを補わず、財務scopeにも変換しません。 */
    consolidationDeclaration: "not-declared" | "uninterpreted";
    candidates: readonly SubsidiaryHumanCapitalLabelEvidence[];
}
export type SubsidiaryHumanCapitalLabelRow = LabelRowBase & (
    { status: "selected"; reason: "selected"; rowKey: string; parsedLabel: string } |
    { status: "missing" | "unsupported" | "ambiguous"; reason: SubsidiaryHumanCapitalLabelReason; parsedLabel?: never }
);
export interface SubsidiaryHumanCapitalLabelDiagnostic {
    metadata: SubsidiaryHumanCapitalLabelMetadata; rowKey: string | null;
    reason: SubsidiaryHumanCapitalLabelReason; candidates: readonly SubsidiaryHumanCapitalLabelEvidence[];
}
export interface SubsidiaryHumanCapitalLabelExtraction {
    metadata: SubsidiaryHumanCapitalLabelMetadata;
    /** 既存context metadataの全entityが一つに揃った場合だけ記録します。 */
    submitterEntity?: EdinetContext["entity"];
    /** Object入口は元XMLを保持しないためundefined。XML入口では必ず付けます。 */
    inputXmlSha256?: string;
    dtsValidation: "not-performed"; originalLexicalValidation: "not-performed";
    rows: SubsidiaryHumanCapitalLabelRow[]; diagnostics: SubsidiaryHumanCapitalLabelDiagnostic[];
    traces: SubsidiaryHumanCapitalLabelTrace[];
    /** 非採用行の診断と、候補0件の書類診断を数えます。 */
    reasonCounts: Partial<Record<SubsidiaryHumanCapitalLabelReason, number>>;
    summary: { candidateFacts: number; selectedRows: number; excludedRows: number };
}
export interface SubsidiaryHumanCapitalLabelCondition { operator: SubsidiaryHumanCapitalLabelOperator; value: string; }
export interface SubsidiaryHumanCapitalLabelSearchOptions {
    conditions?: readonly SubsidiaryHumanCapitalLabelCondition[]; order?: SortOrder; offset?: number; limit?: number;
}
export interface SubsidiaryHumanCapitalLabelSearchResult {
    rows: (Extract<SubsidiaryHumanCapitalLabelRow, { status: "selected" }> & { inputXmlSha256: string })[];
    total: number; excludedRows: number; filteredRows: number;
    diagnostics: SubsidiaryHumanCapitalLabelDiagnostic[];
    reasonCounts: Partial<Record<SubsidiaryHumanCapitalLabelReason, number>>;
    dtsValidation: "not-performed"; originalLexicalValidation: "not-performed";
    sources: { metadata: SubsidiaryHumanCapitalLabelMetadata; inputXmlSha256: string; traces: SubsidiaryHumanCapitalLabelTrace[] }[];
    summary: { documents: number; candidateFacts: number; emptyDocuments: number };
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const text = (value: unknown): value is string => typeof value === "string" && !!value.trim() && value.length <= 256 && !/[\x00-\x1f\x7f-\x9f]/.test(value);
function flat(value: unknown, allowed: readonly string[]): Record<string, unknown> {
    if (!record(value)) throw new Error("正しいラベル抽出/検索入力が必要です");
    const keys = Object.keys(value);
    if (keys.some(key => !allowed.includes(key))) throw new Error("未知のラベル抽出/検索項目です");
    const out: Record<string, unknown> = {}; for (const key of keys) out[key] = value[key]; return out;
}
function array(value: unknown, maximum: number): unknown[] {
    if (!Array.isArray(value)) throw new Error("明示配列が必要です");
    const length = value.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw new Error(`明示集合/条件は${maximum}件以下です`);
    return Array.from({ length }, (_, index) => { if (!Object.hasOwn(value, index)) throw new Error("疎配列は使えません"); return value[index]; });
}
function metadata(value: unknown): SubsidiaryHumanCapitalLabelMetadata {
    const m = flat(value, ["docID", "instant", "secCode"]);
    if (!text(m.docID) || !validDate(m.instant) || m.secCode !== undefined && !text(m.secCode)) throw new Error("書類ID・正しい期末と任意の証券コードを明示してください");
    return { docID: m.docID, instant: m.instant, ...(m.secCode === undefined ? {} : { secCode: m.secCode as string }) };
}

/** @internal privateなfact/contextと公開traceだけを使う。package rootへ公開しません。 */
export function selectSubsidiaryHumanCapitalLabels(inputMetadata: SubsidiaryHumanCapitalLabelMetadata,
    facts: ReadonlyMap<string, readonly EdinetData[]>, contexts: ReadonlyMap<string, EdinetContext>,
    traceContext: (id: string) => ContextDimensionsTraceResult, knownDocID = ""): SubsidiaryHumanCapitalLabelExtraction {
    const m = metadata(inputMetadata), candidates: { key: string | null; dimensions?: SubsidiaryHumanCapitalLabelDimension[]; evidence: SubsidiaryHumanCapitalLabelEvidence }[] = [];
    const traces: SubsidiaryHumanCapitalLabelTrace[] = [], traceIndexes = new Map<string, number>();
    if (knownDocID && knownDocID !== m.docID) throw new Error("解析済みObjectと申告docIDが一致しません");
    const entities = new Set(Array.from(contexts.values(), context => context.entity ? JSON.stringify([context.entity.scheme, context.entity.identifier]) : ""));
    const singleEntity = entities.size === 1 && !entities.has("");
    const entity = singleEntity ? contexts.values().next().value?.entity : undefined;
    const submitterEntity = entity && text(entity.identifier) && text(entity.scheme) ? { ...entity } : undefined;
    for (const [factKey, list] of facts) {
        if (factKey.split(":").at(-1) !== tag) continue;
        for (const fact of list) {
            if (candidates.length >= SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS.candidates) throw new Error("ラベル候補は10000件以下です");
            const context = contexts.get(fact.contextRef), namespace = fact.namespaceURI;
            let traceRef = traceIndexes.get(fact.contextRef);
            if (traceRef === undefined) {
                const trace = fact.contextRef.trim() ? traceContext(fact.contextRef) : { contextId: fact.contextRef, status: "missing" as const,
                    dtsValidation: "not-performed" as const, originalLexicalValidation: "not-performed" as const, candidates: [], diagnostics: [] };
                traceRef = traces.length; traceIndexes.set(fact.contextRef, traceRef); traces.push({ contextRef: fact.contextRef, trace });
            }
            const trace = traces[traceRef].trace;
            const evidence: SubsidiaryHumanCapitalLabelEvidence = { factKey, namespaceURI: fact.namespaceURI, contextRef: fact.contextRef,
                parsedText: fact.value, parsedRawValue: fact.rawValue, nil: fact.nil, unitRef: fact.unitRef,
                entity: context?.entity ? { ...context.entity } : undefined, period: context ? { ...context.period } : undefined, traceRef, reason: "selected" };
            let key: string | null = null, dimensions: SubsidiaryHumanCapitalLabelDimension[] | undefined;
            if (trace.status === "ambiguous") evidence.reason = "duplicate-context";
            else if (!context) evidence.reason = "context-unavailable";
            else if (!context.namespaceVerified || !context.periodValid || !validDate(context.period.instant) || context.period.startDate !== undefined || context.period.endDate !== undefined) evidence.reason = "unsupported-context";
            else if (context.period.instant !== m.instant) evidence.reason = "period-mismatch";
            else if (!singleEntity || !context.entity || !text(context.entity.identifier) || !text(context.entity.scheme)) evidence.reason = "unsupported-entity";
            else if (trace.status !== "resolved" || trace.candidates.length !== 1) evidence.reason = "trace-unavailable";
            else {
                const entries = trace.candidates[0].dimensions;
                const entry = entries[0];
                if (entries.length !== 1 || !entry || entry.location !== "scenario" || entry.kind !== "explicit" || entry.axis.status !== "resolved" || entry.member.status !== "resolved" ||
                    !isSubsidiaryHumanCapitalNamespace(namespace) || entry.axis.namespaceURI !== namespace || entry.axis.localName !== "SequentialNumbersAxis" || entry.member.namespaceURI !== namespace ||
                    !/^Row(?:[1-9]|[1-9]\d|[12]\d{2}|300)Member$/.test(entry.member.localName ?? "")) evidence.reason = "unsupported-dimensions";
                else {
                    dimensions = [{ axisNamespaceURI: namespace, axis: "SequentialNumbersAxis", memberNamespaceURI: namespace, member: entry.member.localName! }];
                    key = createHash("sha256").update(JSON.stringify([m.docID, context.entity.scheme, context.entity.identifier, m.instant, dimensions])).digest("hex");
                }
            }
            if (evidence.reason === "selected") {
                if (fact.namespaceURI !== namespace) evidence.reason = "unknown-namespace";
                else if (fact.unitRef) evidence.reason = "unsupported-unit";
                else if (fact.nil) evidence.reason = "nil";
                else if (!fact.value.trim()) evidence.reason = "empty-parsed-label";
                else if (fact.rawValue === undefined) evidence.reason = "raw-unavailable";
                else if (/&#(?:x[0-9a-f]+|\d+);/i.test(fact.value)) evidence.reason = "reference-like-text";
            }
            candidates.push({ key, dimensions, evidence });
        }
    }
    const groups = new Map<string, typeof candidates>();
    candidates.forEach((candidate, index) => { const key = candidate.key ?? `unresolved:${index}`; const list = groups.get(key) ?? []; list.push(candidate); groups.set(key, list); });
    const rows: SubsidiaryHumanCapitalLabelRow[] = [], diagnostics: SubsidiaryHumanCapitalLabelDiagnostic[] = [], reasonCounts: SubsidiaryHumanCapitalLabelExtraction["reasonCounts"] = {};
    const diagnostic = (rowKey: string | null, reason: SubsidiaryHumanCapitalLabelReason, evidence: readonly SubsidiaryHumanCapitalLabelEvidence[]) => {
        diagnostics.push({ metadata: m, rowKey, reason, candidates: evidence }); reasonCounts[reason] = (reasonCounts[reason] ?? 0) + 1;
    };
    for (const group of groups.values()) {
        const first = group[0], evidence = group.map(candidate => candidate.evidence);
        const base: LabelRowBase = { rowKey: first.key, metadata: m, entity: first.evidence.entity, dimensions: first.dimensions, consolidationDeclaration: first.dimensions ? "not-declared" : "uninterpreted", candidates: evidence };
        if (group.length > 1 || evidence.some(item => item.reason === "duplicate-context")) {
            const reason = evidence.some(item => item.reason === "duplicate-context") ? "duplicate-context" : "multiple-facts";
            rows.push({ ...base, status: "ambiguous", reason }); diagnostic(base.rowKey, reason, evidence);
        } else if (first.evidence.reason === "selected" && first.key !== null) rows.push({ ...base, rowKey: first.key, status: "selected", reason: "selected", parsedLabel: first.evidence.parsedText });
        else {
            const reason = first.evidence.reason;
            rows.push({ ...base, status: reason === "nil" || reason === "empty-parsed-label" ? "missing" : "unsupported", reason }); diagnostic(base.rowKey, reason, evidence);
        }
    }
    if (!candidates.length) diagnostic(null, "tag-absent", []);
    rows.sort((left, right) => compare(left.rowKey ?? "", right.rowKey ?? "") || compare(left.candidates[0].contextRef, right.candidates[0].contextRef));
    return structuredClone({ metadata: m, submitterEntity, dtsValidation: "not-performed", originalLexicalValidation: "not-performed", rows, diagnostics, traces, reasonCounts,
        summary: { candidateFacts: candidates.length, selectedRows: rows.filter(row => row.status === "selected").length, excludedRows: rows.filter(row => row.status !== "selected").length } });
}
function createCaptured(xml: string, m: SubsidiaryHumanCapitalLabelMetadata): SubsidiaryHumanCapitalLabelExtraction & { inputXmlSha256: string } {
    if (typeof xml !== "string") throw new Error("XML文字列が必要です");
    const parsed = new EdinetXbrlParser().parse(xml, m.docID), result = parsed.selectSubsidiaryHumanCapitalLabels(m);
    return { ...result, inputXmlSha256: createHash("sha256").update(xml).digest("hex") };
}
/** 原本の解析済み会社ラベルだけを読む。一般子会社一覧や法人同一性は判定しません。 */
export function extractSubsidiaryHumanCapitalLabels(xml: string, inputMetadata: SubsidiaryHumanCapitalLabelMetadata): SubsidiaryHumanCapitalLabelExtraction & { inputXmlSha256: string } {
    return createCaptured(xml, metadata(inputMetadata));
}
export function searchSubsidiaryHumanCapitalLabels(documents: readonly SubsidiaryHumanCapitalLabelDocument[], inputOptions: SubsidiaryHumanCapitalLabelSearchOptions = {}): SubsidiaryHumanCapitalLabelSearchResult {
    const o = flat(inputOptions, ["conditions", "order", "offset", "limit"]);
    const conditions = array(o.conditions === undefined ? [] : o.conditions, SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS.conditions).map(value => {
        const c = flat(value, ["operator", "value"]);
        if (!Object.values(SubsidiaryHumanCapitalLabelOperator).includes(c.operator as SubsidiaryHumanCapitalLabelOperator) || typeof c.value !== "string" || !c.value) throw new Error("空でないliteral文字列のeq/contains条件が必要です");
        return c as unknown as SubsidiaryHumanCapitalLabelCondition;
    });
    if (o.order !== undefined && !Object.values(SortOrder).includes(o.order as SortOrder)) throw new Error("不正な並び順です");
    for (const v of [o.offset, o.limit]) if (v !== undefined && (typeof v !== "number" || !Number.isSafeInteger(v) || v < 0)) throw new Error("offset/limitは0以上の安全な整数です");
    const captured = array(documents, SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS.documents).map(value => {
        if (!record(value) || Object.keys(value).some(key => !["xml", "metadata"].includes(key)) || !Object.hasOwn(value, "xml") || !Object.hasOwn(value, "metadata")) throw new Error("xmlとmetadataが必要です");
        return { document: value, metadata: metadata(value.metadata) };
    });
    const docs = new Set<string>();
    for (const item of captured) {
        if (docs.has(item.metadata.docID)) throw new Error("同じ書類の複数候補は自動採用しません"); docs.add(item.metadata.docID);
        if (item.metadata.instant !== captured[0].metadata.instant) throw new Error("期末が異なる書類は同じ検索集合にできません");
    }
    const extracted: (SubsidiaryHumanCapitalLabelExtraction & { inputXmlSha256: string })[] = [];
    let candidateFacts = 0;
    for (const item of captured) {
        const xml = item.document.xml, result = createCaptured(xml as string, item.metadata);
        candidateFacts += result.summary.candidateFacts;
        if (candidateFacts > SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS.candidates) throw new Error("検索集合の全ラベル候補は10000件以下です");
        extracted.push(result);
    }
    const entities = new Map<string, string>();
    for (const item of extracted) {
        const knownEntities = [...(item.submitterEntity ? [item.submitterEntity] : []), ...item.rows.flatMap(row => row.candidates.flatMap(candidate => candidate.entity ? [candidate.entity] : []))];
        for (const entity of knownEntities) {
            const key = JSON.stringify([entity.scheme, entity.identifier]), previous = entities.get(key);
            if (previous !== undefined && previous !== item.metadata.docID) throw new Error("同じ提出者entityの複数書類は自動採用しません");
            entities.set(key, item.metadata.docID);
        }
    }
    const diagnostics = extracted.flatMap(item => item.diagnostics), reasonCounts: SubsidiaryHumanCapitalLabelSearchResult["reasonCounts"] = {};
    for (const item of diagnostics) reasonCounts[item.reason] = (reasonCounts[item.reason] ?? 0) + 1;
    const selected = extracted.flatMap(item => item.rows.flatMap(row => row.status === "selected" ? [{ ...row, inputXmlSha256: item.inputXmlSha256 }] : []));
    const rows = selected.filter(row => conditions.every(c => c.operator === "eq" ? row.parsedLabel === c.value : row.parsedLabel.includes(c.value)));
    rows.sort((left, right) => compare(left.parsedLabel, right.parsedLabel) * (o.order === "desc" ? -1 : 1) || compare(left.metadata.docID, right.metadata.docID) || compare(left.rowKey, right.rowKey));
    const offset = (o.offset ?? 0) as number, limit = o.limit as number | undefined;
    return structuredClone({ rows: rows.slice(offset, limit === undefined ? undefined : offset + limit), total: rows.length,
        excludedRows: extracted.reduce((sum, item) => sum + item.summary.excludedRows, 0), filteredRows: selected.length - rows.length, diagnostics, reasonCounts,
        dtsValidation: "not-performed", originalLexicalValidation: "not-performed", sources: extracted.map(item => ({ metadata: item.metadata, inputXmlSha256: item.inputXmlSha256, traces: item.traces })),
        summary: { documents: extracted.length, candidateFacts, emptyDocuments: extracted.filter(item => item.summary.candidateFacts === 0).length } });
}
