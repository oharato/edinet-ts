import { createHash } from "node:crypto";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import type { EdinetData } from "./edinet-xbrl-object";
import type { EdinetContext } from "./edinet-context";
import { identicalMetricFacts, toSafeMetricNumber, type FactSelectionEvidence, type SelectionReason } from "./metric-selection";
import { selectSubsidiaryHumanCapitalLabels, type SubsidiaryHumanCapitalLabelMetadata, type SubsidiaryHumanCapitalLabelRow, type SubsidiaryHumanCapitalLabelTrace } from "./subsidiary-human-capital-labels";
import type { ContextDimensionsTraceResult } from "./context-dimension-traces";
import { ComparisonOperator, SortOrder } from "./financial-options";
const namespace = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor";
export const SubsidiaryHumanCapitalMetricId = Object.freeze({ FemaleManagerRatio: "femaleManagerRatio",
    MaleChildcareLeaveAllRatio: "maleChildcareLeaveReportedAllRatio", MaleChildcareLeaveRegularRatio: "maleChildcareLeaveReportedRegularRatio", MaleChildcareLeaveNonRegularRatio: "maleChildcareLeaveReportedNonRegularRatio",
    GenderWageAllRatio: "genderWageAllRatio", GenderWageRegularRatio: "genderWageRegularRatio", GenderWageNonRegularRatio: "genderWageNonRegularRatio" } as const);
export type SubsidiaryHumanCapitalMetricId = typeof SubsidiaryHumanCapitalMetricId[keyof typeof SubsidiaryHumanCapitalMetricId];
const tags: Readonly<Record<SubsidiaryHumanCapitalMetricId, string>> = Object.freeze({
    femaleManagerRatio: "RatioOfFemaleEmployeesInManagerialPositionsMetricsOfConsolidatedSubsidiaries",
    maleChildcareLeaveReportedAllRatio: "AllEmployeesRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfConsolidatedSubsidiaries",
    maleChildcareLeaveReportedRegularRatio: "RegularEmployeesRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfConsolidatedSubsidiaries",
    maleChildcareLeaveReportedNonRegularRatio: "NonRegularEmployeesRatioOfMaleEmployeesTakingChildcareLeaveMetricsOfConsolidatedSubsidiaries",
    genderWageAllRatio: "AllEmployeesDifferencesInWagesBetweenMaleAndFemaleEmployeesMetricsOfConsolidatedSubsidiaries",
    genderWageRegularRatio: "RegularEmployeesDifferencesInWagesBetweenMaleAndFemaleEmployeesMetricsOfConsolidatedSubsidiaries",
    genderWageNonRegularRatio: "NonRegularEmployeesDifferencesInWagesBetweenMaleAndFemaleEmployeesMetricsOfConsolidatedSubsidiaries"
});
const ids = Object.values(SubsidiaryHumanCapitalMetricId), childcare = (id: SubsidiaryHumanCapitalMetricId) => id.startsWith("maleChildcareLeave");
export const SUBSIDIARY_HUMAN_CAPITAL_METRICS_VERSION = "1";
export type ChildcareCalculationMethod = "ordinance-item1" | "ordinance-item2" | "womens-act";
export interface SubsidiaryHumanCapitalNoteProof { key: "jpcrp_cor:InformationAboutEmployeesTextBlock"; contextRef: string; rawSha256: string; }
export type SubsidiaryHumanCapitalAnnotation = { rowKey: string; metric: SubsidiaryHumanCapitalMetricId; proof: SubsidiaryHumanCapitalNoteProof } & (
    { kind: "childcare-method"; method: ChildcareCalculationMethod } | { kind: "unavailable"; state: "not-applicable" | "not-disclosed" }
);
export interface SubsidiaryHumanCapitalMetricEvidence extends FactSelectionEvidence { traceRef: number; }
interface SelectionBase { metricId: SubsidiaryHumanCapitalMetricId; evidence: readonly SubsidiaryHumanCapitalMetricEvidence[];
    declaration?: { kind: "childcare-method"; method: ChildcareCalculationMethod; proof: SubsidiaryHumanCapitalNoteProof; verification: "source-reference-matched" };
    disclosure?: { state: "unknown" } | { state: "not-applicable" | "not-disclosed"; proof: SubsidiaryHumanCapitalNoteProof; verification: "source-reference-matched" }; }
export type SubsidiaryHumanCapitalMetricSelection = SelectionBase & (
    { status: "selected"; reason: SelectionReason; raw: string; safeNumber?: number; source: SubsidiaryHumanCapitalMetricEvidence } |
    { status: "reported"; reason: "definition-unconfirmed"; raw: string; safeNumber?: number; source: SubsidiaryHumanCapitalMetricEvidence } |
    { status: "missing" | "unsupported" | "ambiguous"; reason: SelectionReason; raw?: never; safeNumber?: never; source?: never }
);
export interface SubsidiaryHumanCapitalMetricRow { label: SubsidiaryHumanCapitalLabelRow; selections: Partial<Record<SubsidiaryHumanCapitalMetricId, SubsidiaryHumanCapitalMetricSelection>>; }
export interface SubsidiaryHumanCapitalMetricDiagnostic { rowKey: string | null; metric: SubsidiaryHumanCapitalMetricId;
    reason: SelectionReason | "label-unavailable" | "period-mismatch" | "unsafe-number" | "definition-unconfirmed" | "different-childcare-method"; evidence: readonly SubsidiaryHumanCapitalMetricEvidence[]; }
export interface SubsidiaryHumanCapitalMetricsExtraction {
    metadata: SubsidiaryHumanCapitalLabelMetadata; submitterEntity?: EdinetContext["entity"]; inputXmlSha256?: string;
    dtsValidation: "not-performed"; originalLexicalValidation: "not-performed"; rows: SubsidiaryHumanCapitalMetricRow[]; traces: SubsidiaryHumanCapitalLabelTrace[];
    labelDiagnostics: ReturnType<typeof selectSubsidiaryHumanCapitalLabels>["diagnostics"]; diagnostics: SubsidiaryHumanCapitalMetricDiagnostic[];
    summary: { labels: number; selectedLabels: number; candidateFacts: number; comparableValues: number; reportedValues: number; unavailableValues: number; orphanFacts: number };
}
export interface SubsidiaryHumanCapitalMetricDocument { xml: string; metadata: SubsidiaryHumanCapitalLabelMetadata; annotations?: readonly SubsidiaryHumanCapitalAnnotation[]; }
const methods: readonly ChildcareCalculationMethod[] = ["ordinance-item1", "ordinance-item2", "womens-act"];
const compareText = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
function captureArray<T>(input: readonly T[], maximum: number): T[] {
    if (!Array.isArray(input)) throw new Error("明示配列が必要です");
    const length = input.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > maximum) throw new Error("配列の件数が不正です");
    return Array.from({ length }, (_, index) => {
        if (!Object.hasOwn(input, index)) throw new Error("疎配列は使えません");
        return input[index];
    });
}
function requested(input: readonly SubsidiaryHumanCapitalMetricId[]): SubsidiaryHumanCapitalMetricId[] {
    const captured = captureArray(input, Object.keys(tags).length);
    if (!captured.length || captured.some(id => !Object.hasOwn(tags, id)) || new Set(captured).size !== captured.length) throw new Error("子会社指標に空/未知/重複があります");
    return captured;
}
/** @internal 表の専用タグと検証済み行ラベルだけを結び付けます。 */
export function selectSubsidiaryHumanCapitalMetrics(metadata: SubsidiaryHumanCapitalLabelMetadata, metricIds: readonly SubsidiaryHumanCapitalMetricId[],
    annotations: readonly SubsidiaryHumanCapitalAnnotation[], facts: ReadonlyMap<string, readonly EdinetData[]>, contexts: ReadonlyMap<string, EdinetContext>,
    units: ReadonlyMap<string, string>, traceContext: (id: string) => ContextDimensionsTraceResult, knownDocID = ""): SubsidiaryHumanCapitalMetricsExtraction {
    const metrics = requested(metricIds), labels = selectSubsidiaryHumanCapitalLabels(metadata, facts, contexts, traceContext, knownDocID), m = labels.metadata;
    const traces = [...labels.traces], traceIndexes = new Map(traces.map((t, index) => [t.contextRef, index]));
    const traceRef = (id: string) => { let index = traceIndexes.get(id); if (index === undefined) { index = traces.length; traces.push({ contextRef: id, trace: traceContext(id) }); traceIndexes.set(id, index); } return index; };
    const selected = labels.rows.filter((r): r is Extract<SubsidiaryHumanCapitalLabelRow, { status: "selected" }> => r.status === "selected");
    const byContext = new Map(selected.map(row => [row.candidates[0].contextRef, row])), byRow = new Map(selected.map(row => [row.rowKey, row]));
    const rowForContext = (id: string, context: EdinetContext | undefined) => {
        const direct = byContext.get(id); if (direct) return direct;
        const trace = traces[traceRef(id)].trace, entries = trace.candidates[0]?.dimensions, entry = entries?.[0];
        if (!context?.namespaceVerified || !context.periodValid || context.period.instant !== m.instant || context.period.startDate !== undefined || context.period.endDate !== undefined || !context.entity ||
            trace.status !== "resolved" || trace.candidates.length !== 1 || entries?.length !== 1 || entry?.kind !== "explicit" || entry.location !== "scenario" ||
            entry.axis.status !== "resolved" || entry.member.status !== "resolved" || entry.axis.namespaceURI !== namespace || entry.axis.localName !== "SequentialNumbersAxis" || entry.member.namespaceURI !== namespace) return;
        const dimensions = [{ axisNamespaceURI: namespace, axis: "SequentialNumbersAxis", memberNamespaceURI: namespace, member: entry.member.localName }];
        return byRow.get(hash(JSON.stringify([m.docID, context.entity.scheme, context.entity.identifier, m.instant, dimensions])));
    };
    const capturedAnnotations = captureArray(annotations, 10000);
    const declared = new Map<string, SubsidiaryHumanCapitalAnnotation>(), proofChecks = new Map<string, { valid: boolean; hash: string }>();
    for (const input of capturedAnnotations) {
        if (!input || typeof input !== "object" || Object.keys(input).some(k => !["kind", "rowKey", "metric", "method", "state", "proof"].includes(k))) throw new Error("注記宣言が不正です");
        const { kind, rowKey, metric, proof: p } = input;
        if (!selected.some(row => row.rowKey === rowKey) || !metrics.includes(metric) || !p || typeof p !== "object" || Object.keys(p).some(k => !["key", "contextRef", "rawSha256"].includes(k))) throw new Error("注記宣言の行/項目/原文参照が不正です");
        const proof = { key: p.key, contextRef: p.contextRef, rawSha256: p.rawSha256 };
        if (proof.key !== "jpcrp_cor:InformationAboutEmployeesTextBlock" || typeof proof.contextRef !== "string" || typeof proof.rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(proof.rawSha256)) throw new Error("注記の参照とhashが必要です");
        const proofKey = JSON.stringify([proof.key, proof.contextRef]); let checked = proofChecks.get(proofKey);
        if (!checked) {
            const note = (facts.get(proof.key) ?? []).filter(f => f.contextRef === proof.contextRef), context = contexts.get(proof.contextRef);
            const valid = note.length === 1 && note[0].namespaceURI === namespace && !note[0].nil && !note[0].unitRef && typeof note[0].rawValue === "string" &&
                !!context?.namespaceVerified && !!context.periodValid && !!context.period.instant && context.period.instant >= m.instant &&
                !!context.entity && !!labels.submitterEntity && context.entity.scheme === labels.submitterEntity.scheme && context.entity.identifier === labels.submitterEntity.identifier && traceContext(context.id).status === "resolved";
            checked = { valid, hash: valid ? hash(note[0].rawValue!) : "" }; proofChecks.set(proofKey, checked);
        }
        if (!checked.valid || checked.hash !== proof.rawSha256) throw new Error("注記の原本内参照を確認できません");
        let captured: SubsidiaryHumanCapitalAnnotation;
        if (kind === "childcare-method") {
            const method = input.method;
            if (!childcare(metric) || !methods.includes(method) || Object.hasOwn(input, "state")) throw new Error("育休の算出方法が不正です");
            captured = { kind, rowKey, metric, method, proof };
        } else if (kind === "unavailable") {
            const state = input.state;
            if (!["not-applicable", "not-disclosed"].includes(state) || Object.hasOwn(input, "method")) throw new Error("未記載理由が不正です");
            captured = { kind, rowKey, metric, state, proof };
        } else throw new Error("注記の種別が不正です");
        const key = JSON.stringify([rowKey, metric, kind]); if (declared.has(key)) throw new Error("同じ注記宣言が重複しています"); declared.set(key, captured);
    }
    const groups = new Map<string, SubsidiaryHumanCapitalMetricEvidence[]>(), diagnostics: SubsidiaryHumanCapitalMetricDiagnostic[] = []; let candidates = 0, orphanFacts = 0;
    for (const metric of metrics) for (const [key, list] of facts) {
        if (key.split(":").at(-1) !== tags[metric]) continue;
        for (const fact of list) {
            if (++candidates > 10000) throw new Error("子会社表の数値候補は10000件以下です");
            const context = contexts.get(fact.contextRef), label = rowForContext(fact.contextRef, context);
            const evidence: SubsidiaryHumanCapitalMetricEvidence = { key, namespace: key.split(":")[0], namespaceURI: fact.namespaceURI, contextRef: fact.contextRef,
                period: context ? { ...context.period } : undefined, scope: context?.scope, entity: context?.entity ? { ...context.entity } : undefined,
                dimensions: context ? [...context.dimensions] : undefined, rawDimensions: context?.rawDimensions, unitRef: fact.unitRef, unit: units.get(fact.unitRef),
                raw: fact.rawValue, decimals: fact.rawDecimals, nil: fact.nil, traceRef: traceRef(fact.contextRef), reason: "selected" };
            if (!label) {
                const reason = !context ? "unknown-context" : context.period.instant !== m.instant ? "period-mismatch" : "label-unavailable";
                evidence.reason = !context ? "unknown-context" : context.period.instant !== m.instant ? "context-mismatch" : "unsupported-semantics"; orphanFacts++; diagnostics.push({ rowKey: null, metric, reason, evidence: [evidence] }); continue;
            }
            if (key.split(":").length !== 2 || fact.namespaceURI !== namespace) evidence.reason = "unknown-namespace";
            else if (fact.nil) evidence.reason = "nil";
            else if (evidence.unit !== "xbrli:pure") evidence.reason = "unsupported-unit";
            else if (fact.rawValue === undefined) evidence.reason = "raw-unavailable";
            else if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(fact.rawValue)) evidence.reason = "invalid-decimal";
            else if (fact.rawDecimals !== undefined && !/^(?:INF|[+-]?\d+)$/.test(fact.rawDecimals)) evidence.reason = "invalid-decimals";
            else if (/^-/.test(fact.rawValue) && /[1-9]/.test(fact.rawValue)) evidence.reason = "unsupported-semantics";
            else evidence.reason = toSafeMetricNumber(fact.rawValue) === undefined ? "selected-raw-only" : "selected";
            const groupKey = JSON.stringify([label.rowKey, metric]), group = groups.get(groupKey) ?? []; group.push(evidence); groups.set(groupKey, group);
        }
    }
    let comparableValues = 0, reportedValues = 0, unavailableValues = 0;
    const rows = labels.rows.map(label => {
        const selections: SubsidiaryHumanCapitalMetricRow["selections"] = {};
        if (label.status !== "selected") return { label, selections };
        for (const metric of metrics) {
            const evidence = groups.get(JSON.stringify([label.rowKey, metric])) ?? [], method = declared.get(JSON.stringify([label.rowKey, metric, "childcare-method"])), disclosure = declared.get(JSON.stringify([label.rowKey, metric, "unavailable"]));
            const base: SelectionBase = { metricId: metric, evidence, ...(method?.kind === "childcare-method" ? { declaration: { kind: "childcare-method", method: method.method, proof: method.proof, verification: "source-reference-matched" as const } } : {}) };
            const valid = evidence.length > 0 && evidence.every(e => e.reason === "selected" || e.reason === "selected-raw-only");
            let result: SubsidiaryHumanCapitalMetricSelection;
            if (!evidence.length) result = { ...base, status: "missing", reason: "tag-absent" };
            else if (evidence.length > 1 && (!valid || !evidence.every(e => identicalMetricFacts(e, evidence[0])))) result = { ...base, status: "ambiguous", reason: "multiple-facts" };
            else if (valid) {
                const numeric = { ...base, raw: evidence[0].raw!, safeNumber: toSafeMetricNumber(evidence[0].raw!), source: evidence[0] };
                result = childcare(metric) && !method ? { ...numeric, status: "reported", reason: "definition-unconfirmed" } :
                    { ...numeric, status: "selected", reason: evidence.length > 1 ? "selected-identical-duplicates" : evidence[0].reason };
            }
            else result = { ...base, status: evidence[0].reason === "nil" ? "missing" : "unsupported", reason: evidence[0].reason };
            if (disclosure?.kind === "unavailable") {
                if (result.status !== "missing" || result.reason !== "nil") throw new Error("nil以外へ未記載理由を宣言できません");
                result.disclosure = { state: disclosure.state, proof: disclosure.proof, verification: "source-reference-matched" };
            } else if (result.reason === "nil") result.disclosure = { state: "unknown" };
            selections[metric] = result;
            if (result.status === "selected" && result.safeNumber !== undefined) comparableValues++;
            else if (result.status === "reported") reportedValues++;
            else unavailableValues++;
            if (result.status !== "selected" || result.safeNumber === undefined) diagnostics.push({ rowKey: label.rowKey, metric,
                reason: result.status === "selected" ? "unsafe-number" : result.reason, evidence });
        }
        return { label, selections };
    });
    return structuredClone({ metadata: m, submitterEntity: labels.submitterEntity, dtsValidation: "not-performed", originalLexicalValidation: "not-performed", rows, traces, labelDiagnostics: labels.diagnostics, diagnostics,
        summary: { labels: labels.rows.length, selectedLabels: selected.length, candidateFacts: candidates, comparableValues, reportedValues, unavailableValues, orphanFacts } });
}
export function extractSubsidiaryHumanCapitalMetrics(xml: string, metadata: SubsidiaryHumanCapitalLabelMetadata,
    metricIds: readonly SubsidiaryHumanCapitalMetricId[] = ids, annotations: readonly SubsidiaryHumanCapitalAnnotation[] = []): SubsidiaryHumanCapitalMetricsExtraction {
    if (typeof xml !== "string") throw new Error("XML文字列が必要です");
    const object = new EdinetXbrlParser().parse(xml, metadata.docID), result = object.selectSubsidiaryHumanCapitalMetrics(metadata, metricIds, annotations);
    return { ...result, inputXmlSha256: hash(xml) };
}
export type SubsidiaryHumanCapitalMetricSearchRow = SubsidiaryHumanCapitalMetricRow & {
    label: Extract<SubsidiaryHumanCapitalLabelRow, { status: "selected" }>; inputXmlSha256: string;
};
export interface SubsidiaryHumanCapitalMetricsSearchOptions { conditions?: readonly { operator: ComparisonOperator; value: number }[];
    labelContains?: string; childcareMethod?: ChildcareCalculationMethod; order?: SortOrder; offset?: number; limit?: number; }
export function screenSubsidiaryHumanCapitalMetrics(documents: readonly SubsidiaryHumanCapitalMetricDocument[], metric: SubsidiaryHumanCapitalMetricId, options: SubsidiaryHumanCapitalMetricsSearchOptions = {}) {
    requested([metric]);
    const capturedDocuments = captureArray(documents, 100);
    if (!options || typeof options !== "object" || Object.keys(options).some(k => !["conditions", "labelContains", "childcareMethod", "order", "offset", "limit"].includes(k))) throw new Error("子会社検索入力が不正です");
    const { conditions: raw = [], labelContains, childcareMethod, order = "desc", offset = 0, limit } = options;
    if (labelContains !== undefined && (typeof labelContains !== "string" || !labelContains) ||
        childcare(metric) && !methods.includes(childcareMethod!) || !childcare(metric) && childcareMethod !== undefined ||
        !Object.values(SortOrder).includes(order) || [offset, limit].some(n => n !== undefined && (!Number.isSafeInteger(n) || n < 0))) throw new Error("同じ育休定義・条件・順序・ページが必要です");
    const conditions = captureArray(raw, 100).map(c => { if (!c || Object.keys(c).some(k => !["operator", "value"].includes(k))) throw new Error("条件が不正です"); const { operator, value } = c; if (!Object.values(ComparisonOperator).includes(operator) || !Number.isFinite(value)) throw new Error("有限の比較条件が必要です"); return { operator, value }; });
    let totalBytes = 0, totalCandidates = 0;
    const extracted = capturedDocuments.map(d => {
        if (!d || typeof d !== "object" || Object.keys(d).some(k => !["xml", "metadata", "annotations"].includes(k))) throw new Error("xml/metadata/注記宣言が必要です");
        const { xml, metadata, annotations } = d;
        if (typeof xml !== "string" || (totalBytes += Buffer.byteLength(xml, "utf8")) > 256 * 1024 * 1024) throw new Error("検索集合のXMLは合計256MiB以下です");
        const result = extractSubsidiaryHumanCapitalMetrics(xml, metadata, ids, annotations);
        totalCandidates += result.summary.candidateFacts + result.rows.reduce((sum, row) => sum + row.label.candidates.length, 0);
        if (totalCandidates > 10000) throw new Error("検索集合の表候補は10000件以下です");
        return result;
    });
    const docs = new Set<string>(), entities = new Set<string>(); let instant: string | undefined;
    for (const e of extracted) { const identity = e.submitterEntity ? JSON.stringify([e.submitterEntity.scheme, e.submitterEntity.identifier]) : undefined;
        if (docs.has(e.metadata.docID) || identity && entities.has(identity) || instant !== undefined && instant !== e.metadata.instant) throw new Error("同じ提出者/書類の重複や期末混在は使えません");
        docs.add(e.metadata.docID); if (identity) entities.add(identity); instant = e.metadata.instant;
    }
    const diagnostics = extracted.flatMap(e => e.diagnostics.filter(d => d.metric === metric)), available: SubsidiaryHumanCapitalMetricSearchRow[] = []; let excludedRows = 0;
    for (const e of extracted) for (const row of e.rows) {
        const s = row.selections[metric];
        if (row.label.status !== "selected" || !s || s.status !== "selected" || s.safeNumber === undefined) { excludedRows++; continue; }
        if (childcare(metric) && s.declaration?.method !== childcareMethod) { excludedRows++; diagnostics.push({ rowKey: row.label.rowKey, metric, reason: "different-childcare-method", evidence: s.evidence }); continue; }
        available.push({ ...row, label: row.label, inputXmlSha256: e.inputXmlSha256! });
    }
    const matches = available.filter(r => (labelContains === undefined || r.label.status === "selected" && r.label.parsedLabel.includes(labelContains)) && conditions.every(c => { const v = r.selections[metric]!.safeNumber!; return c.operator === "gt" ? v > c.value : c.operator === "gte" ? v >= c.value : c.operator === "lt" ? v < c.value : c.operator === "lte" ? v <= c.value : v === c.value; }));
    matches.sort((a, b) => (a.selections[metric]!.safeNumber! - b.selections[metric]!.safeNumber!) * (order === "asc" ? 1 : -1) || compareText(a.label.metadata.docID, b.label.metadata.docID) || compareText(a.label.rowKey ?? "", b.label.rowKey ?? ""));
    return { rows: matches.slice(offset, limit === undefined ? undefined : offset + limit), total: matches.length, excludedRows, filteredRows: available.length - matches.length,
        diagnostics, labelDiagnostics: extracted.flatMap(e => e.labelDiagnostics), sources: extracted.map(e => ({ metadata: e.metadata, inputXmlSha256: e.inputXmlSha256!, traces: e.traces })), dtsValidation: "not-performed" as const, originalLexicalValidation: "not-performed" as const };
}
