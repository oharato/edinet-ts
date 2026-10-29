import { analyzeDocumentRelations, type DocumentRelationDocument, type AnalyzedDocumentObservation } from "./document-relations";
import { parseDocumentTimestamp as timestamp } from "./document-timestamp";
export const LARGE_HOLDING_VERSIONS_VERSION = "1";
export interface LargeHoldingVersionDocument extends DocumentRelationDocument { issuerEdinetCode?: string | null; formCode?: string | null; }
export interface LargeHoldingVersionObservation { observationId: string; observedAt: string; listDate?: string; document: LargeHoldingVersionDocument; }
export type LargeHoldingVersionReason = "selected" | "conflicting-observations" | "unknown-status" | "withdrawn" | "non-disclosed" | "notice-only" | "edited-metadata-unverified" | "submit-time-unavailable" | "filer-unavailable" | "issuer-unavailable" | "form-unavailable" | "parent-missing" | "cycle" | "wrong-parent-type" | "filer-mismatch" | "issuer-mismatch" | "non-chronological-chain" | "unresolved-correction" | "inactive-parent" | "multiple-correction-leaves" | "document-type-unavailable";
export interface LargeHoldingVersionDecision { rootDocID: string; status: "selected" | "unresolved" | "unavailable"; reason: LargeHoldingVersionReason; selectedDocID?: string; chainDocIDs: string[]; observationIds: string[]; inactiveDocuments?: { docID: string; reason: LargeHoldingVersionReason }[]; }
export interface SelectedLargeHoldingObservation { rootDocID: string; observedAt: string; observationIds: string[]; observation: AnalyzedDocumentObservation & { document: LargeHoldingVersionDocument }; }
export interface LargeHoldingVersionSelection { version: typeof LARGE_HOLDING_VERSIONS_VERSION; cutoff: string; decisions: LargeHoldingVersionDecision[]; selected: SelectedLargeHoldingObservation[]; ignored: { observationId: string; reason: "after-cutoff" | "superseded-observation" | "unsupported-document-type" }[]; holdingValuesMerged: false; reconstructedUnobservedHistory: false; }
interface Variant { observation: SelectedLargeHoldingObservation["observation"]; observed: number; submitted?: number; signature: string; }
interface State { id: string; observed: number; variants: Variant[]; conflict: boolean; }
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
const knownType = (s: string | null | undefined) => s === "350" || s === "360";
const inactive = (r: LargeHoldingVersionReason | undefined) => r === "withdrawn" || r === "non-disclosed" || r === "notice-only";
function availability(s: State): LargeHoldingVersionReason | undefined {
    if (s.conflict) return "conflicting-observations";
    const v = s.variants[0], d = v.observation.document, { withdrawalStatus: w, disclosureStatus: x, docInfoEditStatus: e } = v.observation.statuses;
    if (w.presence !== "known" || x.presence !== "known" || e.presence !== "known") return "unknown-status";
    if (w.code === "2") return "withdrawn"; if (x.code === "2") return "non-disclosed";
    if (w.code !== "0" || x.code !== "0" || e.code === "1") return "notice-only";
    if (e.code !== "0") return "edited-metadata-unverified";
    if (v.submitted === undefined) return "submit-time-unavailable";
    if (!/^E\d{5}$/.test(d.edinetCode ?? "")) return "filer-unavailable";
    if (!/^E\d{5}$/.test(d.issuerEdinetCode ?? "")) return "issuer-unavailable";
    if (d.docTypeCode === "350" ? !["010000", "010002", "020000", "020002"].includes(d.formCode ?? "") : d.docTypeCode !== "360" || d.formCode !== "090001") return "form-unavailable";
}
/** 一覧の350/360の訂正版を選択します。350のparentDocIDは訂正辺として辿りません。 */
export function selectLargeHoldingReportVersions(observations: readonly LargeHoldingVersionObservation[], cutoff: string): LargeHoldingVersionSelection {
    const cut = timestamp(cutoff, true);
    if (cut === undefined || !Array.isArray(observations) || observations.length > 10000) throw new Error("timezone付きcutoffと10000件以下の大量保有観測が必要です");
    const fields = ["docID", "parentDocID", "withdrawalStatus", "disclosureStatus", "docInfoEditStatus", "docTypeCode", "edinetCode", "secCode", "submitDateTime", "opeDateTime", "formCode", "issuerEdinetCode"] as const;
    const captured = Array.from({ length: observations.length }, (_, i) => {
        const value = observations[i];
        if (!value || Object.keys(value).some(k => !["observationId", "observedAt", "listDate", "document"].includes(k)) || !value.document || typeof value.document !== "object" || Array.isArray(value.document)) throw new Error("大量保有の観測形式が不正です");
        const observedAt = value.observedAt, observed = timestamp(observedAt, true), d: LargeHoldingVersionDocument = { docID: "" };
        for (const key of fields) if (Object.hasOwn(value.document, key)) (d as Record<string, unknown>)[key] = value.document[key];
        for (const key of ["formCode", "issuerEdinetCode"] as const) if (d[key] !== undefined && d[key] !== null && (typeof d[key] !== "string" || d[key]!.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(d[key]!))) throw new Error("大量保有のフォーム/発行者は文字列/null/未記録です");
        if (d.parentDocID !== undefined && d.parentDocID !== null && (typeof d.parentDocID !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(d.parentDocID))) throw new Error("親書類IDが不正です");
        const submitted = timestamp(d.submitDateTime, false);
        if (observed === undefined || submitted !== undefined && submitted > observed) throw new Error("観測日時と提出日時の前後を確認してください");
        const { issuerEdinetCode, formCode, ...base } = d;
        // 関係説明の汎用グラフに350の参照辺を混ぜません。返却用には原値を保持します。
        return { observed, submitted, original: d, relation: { observationId: value.observationId, ...(value.listDate === undefined ? {} : { listDate: value.listDate }), document: { ...base, ...(d.docTypeCode === "350" ? { parentDocID: null } : {}) } } };
    });
    const analyzed = analyzeDocumentRelations(captured.map(c => c.relation)), source = new Map(captured.map(c => [c.relation.observationId, c]));
    const states = new Map<string, State>(), ignored: LargeHoldingVersionSelection["ignored"] = [];
    const history = new Map<string, {ids: string[]; parents: Set<string>}>();
    for (const entry of analyzed.observations) {
        const c = source.get(entry.observationId)!;
        if (c.observed > cut) { ignored.push({ observationId: entry.observationId, reason: "after-cutoff" }); continue; }
        if (knownType(c.original.docTypeCode)) {
            const prior = history.get(c.original.docID) ?? {ids: [], parents: new Set<string>()};
            prior.ids.push(entry.observationId);
            if (c.original.docTypeCode === "360" && c.original.parentDocID) prior.parents.add(c.original.parentDocID);
            history.set(c.original.docID, prior);
        }
        const observation = { ...entry, document: { ...entry.document, ...(Object.hasOwn(c.original, "parentDocID") ? { parentDocID: c.original.parentDocID } : { parentDocID: undefined }), ...(Object.hasOwn(c.original, "issuerEdinetCode") ? { issuerEdinetCode: c.original.issuerEdinetCode } : {}), ...(Object.hasOwn(c.original, "formCode") ? { formCode: c.original.formCode } : {}) } };
        const { withdrawalStatus: _w, disclosureStatus: _d, docInfoEditStatus: _e, ...identity } = observation.document;
        const variant: Variant = { observation, observed: c.observed, submitted: c.submitted, signature: JSON.stringify([identity, observation.statuses]) }, previous = states.get(observation.document.docID);
        if (!previous || c.observed > previous.observed) {
            if (previous) ignored.push(...previous.variants.map(v => ({ observationId: v.observation.observationId, reason: "superseded-observation" as const })));
            states.set(observation.document.docID, { id: observation.document.docID, observed: c.observed, variants: [variant], conflict: false });
        } else if (c.observed === previous.observed) { previous.conflict ||= previous.variants[0].signature !== variant.signature; previous.variants.push(variant); }
        else ignored.push({ observationId: entry.observationId, reason: "superseded-observation" });
    }
    const ids = (s: State) => s.variants.map(v => v.observation.observationId).sort(compare), doc = (s: State) => s.variants[0].observation.document;
    const relevant = [...states.values()].filter(s => {
        if (history.has(s.id)) return true;
        ignored.push(...ids(s).map(observationId => ({ observationId, reason: "unsupported-document-type" as const }))); return false;
    }).sort((a, b) => compare(a.id, b.id));
    const evidence = (s: State) => s.variants.every(v => !knownType(v.observation.document.docTypeCode))
        ? [...new Set([...ids(s), ...history.get(s.id)!.ids])].sort(compare) : ids(s);
    const parents = (s: State) => s.variants.every(v => !knownType(v.observation.document.docTypeCode))
        ? [...(history.get(s.id)?.parents ?? [])] : s.variants.filter(v => v.observation.document.docTypeCode === "360").map(v => v.observation.document.parentDocID).filter((v): v is string => !!v);
    const decisions: LargeHoldingVersionDecision[] = [], cache = new Map<string, { root?: string; reason?: LargeHoldingVersionReason }>(), groups = new Map<string, State[]>(), failures: State[] = [];
    let steps = 0;
    const step = () => { if (++steps > 100000) throw new Error("大量保有の系列参照は100000ステップ以下です"); };
    for (const start of relevant) {
        let current = start, root: string | undefined, reason: LargeHoldingVersionReason | undefined;
        const path: string[] = [], seen = new Set<string>();
        for (;;) {
            step();
            const saved = cache.get(current.id);
            if (saved) { root = saved.root; reason = saved.reason; if (!root) path.push(current.id); break; }
            if (seen.has(current.id)) { reason = "cycle"; break; } seen.add(current.id); path.push(current.id);
            if (current.conflict) { reason = "conflicting-observations"; break; }
            const d = doc(current);
            if (d.docTypeCode === "350") { root = current.id; break; }
            if (d.docTypeCode !== "360") { reason = "document-type-unavailable"; break; }
            const parent = d.parentDocID ? states.get(d.parentDocID) : undefined;
            if (!parent) { reason = "parent-missing"; break; }
            if (!parent.conflict) {
                const p = doc(parent);
                if (!knownType(p.docTypeCode)) { reason = "wrong-parent-type"; break; }
                if (!/^E\d{5}$/.test(d.edinetCode ?? "") || !/^E\d{5}$/.test(p.edinetCode ?? "")) { reason = "filer-unavailable"; break; }
                if (d.edinetCode !== p.edinetCode) { reason = "filer-mismatch"; break; }
                if (!/^E\d{5}$/.test(d.issuerEdinetCode ?? "") || !/^E\d{5}$/.test(p.issuerEdinetCode ?? "")) { reason = "issuer-unavailable"; break; }
                if (d.issuerEdinetCode !== p.issuerEdinetCode) { reason = "issuer-mismatch"; break; }
                if (current.variants[0].submitted === undefined || parent.variants[0].submitted === undefined) { reason = "submit-time-unavailable"; break; }
                if (current.variants[0].submitted! < parent.variants[0].submitted!) { reason = "non-chronological-chain"; break; }
            }
            current = parent;
        }
        for (const id of path) cache.set(id, root ? { root } : { reason });
        if (!root) {
            const available = availability(start), why = inactive(available) ? available! : reason!;
            decisions.push({ rootDocID: start.id, status: inactive(why) ? "unavailable" : "unresolved", reason: why, chainDocIDs: path, observationIds: evidence(start) });
            if (!inactive(available) || start.variants.every(v => !knownType(v.observation.document.docTypeCode))) failures.push(start);
        } else { const group = groups.get(root) ?? []; group.push(start); groups.set(root, group); }
    }
    const blocked = new Map<string, Set<string>>(), inactiveEvidence = new Map<string, Set<string>>();
    for (const failed of failures) {
        const destination = inactive(availability(failed)) ? inactiveEvidence : blocked;
        const queue = parents(failed), seen = new Set<string>(), refs = new Set(evidence(failed));
        for (let i = 0; i < queue.length; i++) {
            step(); const id = queue[i]; if (seen.has(id)) continue; seen.add(id);
            const s = states.get(id); if (!s) continue;
            const root = cache.get(id)?.root;
            if (root) { const saved = destination.get(root) ?? new Set<string>(); for (const obs of refs) { step(); saved.add(obs); } destination.set(root, saved); continue; }
            if (history.has(s.id)) for (const obs of evidence(s)) refs.add(obs);
            queue.push(...parents(s));
        }
    }
    const selected: SelectedLargeHoldingObservation[] = [];
    for (const [rootDocID, group] of [...groups].sort(([a], [b]) => compare(a, b))) {
        const root = states.get(rootDocID)!, rootReason = availability(root), observationIds = [...new Set([...group.flatMap(ids), ...(inactiveEvidence.get(rootDocID) ?? [])])].sort(compare), chain = group.map(s => s.id).sort(compare);
        const inactiveDocuments = group.flatMap(s => { const r = availability(s); return inactive(r) ? [{ docID: s.id, reason: r! }] : []; });
        const fail = (reason: LargeHoldingVersionReason, more: string[] = []) => decisions.push({ rootDocID, status: inactive(reason) ? "unavailable" : "unresolved", reason, chainDocIDs: chain, observationIds: [...new Set([...observationIds, ...more])].sort(compare), ...(inactiveDocuments.length ? { inactiveDocuments } : {}) });
        if (rootReason) { fail(rootReason); continue; }
        if (blocked.has(rootDocID)) { fail("unresolved-correction", [...blocked.get(rootDocID)!]); continue; }
        const uncertain = group.find(s => { const r = availability(s); return r !== undefined && !inactive(r); });
        if (uncertain) { fail(availability(uncertain)!); continue; }
        const active = group.filter(s => !availability(s)), activeIDs = new Set(active.map(s => s.id));
        if (active.some(s => doc(s).docTypeCode === "360" && !activeIDs.has(doc(s).parentDocID!))) { fail("inactive-parent"); continue; }
        const parents = new Set(active.filter(s => doc(s).docTypeCode === "360").map(s => doc(s).parentDocID)), leaves = active.filter(s => !parents.has(s.id));
        if (leaves.length !== 1) { fail("multiple-correction-leaves"); continue; }
        const leaf = leaves[0], chainDocIDs: string[] = []; let id = leaf.id;
        for (;;) { chainDocIDs.push(id); if (id === rootDocID) break; id = doc(states.get(id)!).parentDocID!; }
        decisions.push({ rootDocID, status: "selected", reason: "selected", selectedDocID: leaf.id, chainDocIDs: chainDocIDs.reverse(), observationIds, ...(inactiveDocuments.length ? { inactiveDocuments } : {}) });
        selected.push({ rootDocID, observedAt: new Date(Math.max(...group.map(s => s.observed), ...[...(inactiveEvidence.get(rootDocID) ?? [])].map(id => source.get(id)!.observed))).toISOString(), observationIds: ids(leaf), observation: leaf.variants[0].observation });
    }
    decisions.sort((a, b) => compare(a.rootDocID, b.rootDocID)); selected.sort((a, b) => compare(a.observation.document.docID, b.observation.document.docID)); ignored.sort((a, b) => compare(a.observationId, b.observationId) || compare(a.reason, b.reason));
    return { version: LARGE_HOLDING_VERSIONS_VERSION, cutoff, decisions, selected, ignored, holdingValuesMerged: false, reconstructedUnobservedHistory: false };
}
