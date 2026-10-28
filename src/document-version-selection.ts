import { parseDocumentTimestamp as timestamp } from "./document-timestamp";
import { analyzeDocumentRelations, type DocumentRelationObservation, type AnalyzedDocumentObservation } from "./document-relations";

export interface DocumentVersionObservation extends DocumentRelationObservation { observedAt: string; }
export type DocumentVersionReason = "selected" | "unknown-status" | "withdrawn" | "non-disclosed" | "notice-only" |
    "conflicting-observations" | "parent-missing" | "cycle" | "unexpected-parent" | "wrong-parent-type" |
    "company-mismatch" | "company-unavailable" | "period-mismatch" | "period-unavailable" | "submit-time-unavailable" |
    "non-chronological-chain" | "multiple-correction-leaves" | "inactive-parent" | "unresolved-correction";
export interface DocumentVersionDecision {
    rootDocID: string; status: "selected" | "unavailable" | "unresolved"; reason: DocumentVersionReason;
    /** 選択時はroot→leaf、未解決時は失敗までの既知の経路です。 */
    selectedDocID?: string; chainDocIDs: string[]; observationIds: string[];
    /** 訂正側の一覧で期間未記載の場合も、宣言された元書類から辿った根拠を明示します。 */
    targetPeriod?: { startDate: string; endDate: string; sourceDocID: string };
}
export interface SelectedDocumentVersion {
    rootDocID: string; chainDocIDs: string[]; observationIds: string[];
    observation: AnalyzedDocumentObservation;
    /** 選択判断に使った系列内の最新観測時刻。提出時刻とは別です。 */
    observedAt: string;
    targetPeriod: { startDate: string; endDate: string; sourceDocID: string };
}
const families: Readonly<Record<string, string>> = { "120": "130", "140": "150", "160": "170" };
const roots = Object.keys(families), corrections = Object.values(families);
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
interface Candidate {
    observation: AnalyzedDocumentObservation; observedAt: number; submittedAt?: number;
    periodStart?: unknown; periodEnd?: unknown; observationIds: string[]; conflict: boolean;
    targetPeriod?: { startDate: string; endDate: string; sourceDocID: string };
}
function availability(candidate: Candidate): DocumentVersionReason | undefined {
    if (candidate.conflict) return "conflicting-observations";
    const { withdrawalStatus: w, disclosureStatus: d, docInfoEditStatus: e } = candidate.observation.statuses;
    if (w.presence !== "known" || d.presence !== "known" || e.presence !== "known") return "unknown-status";
    if (w.code === "2") return "withdrawn";
    if (d.code === "2") return "non-disclosed";
    if (w.code !== "0" || d.code !== "0" || e.code === "1") return "notice-only";
    if (candidate.submittedAt === undefined) return "submit-time-unavailable";
    if (!/^E\d{5}$/.test(candidate.observation.document.edinetCode ?? "")) return "company-unavailable";
    const start = candidate.targetPeriod?.startDate ?? candidate.periodStart, end = candidate.targetPeriod?.endDate ?? candidate.periodEnd;
    if (!validDate(start) || !validDate(end) || start > end) return "period-unavailable";
}
/** 観測済みの有報/半期/四半期の訂正系列をcutoffで選択。訂正差分の財務値を合成しません。 */
export function selectDocumentVersions(observations: readonly DocumentVersionObservation[], cutoff: string) {
    const cutoffTime = timestamp(cutoff, true);
    if (cutoffTime === undefined || !Array.isArray(observations)) throw new Error("timezone付きcutoffと10,000件以下の明示観測が必要です");
    const length = observations.length;
    if (!Number.isSafeInteger(length) || length < 0 || length > 10000) throw new Error("観測は10,000件以下の配列です");
    const captured = Array.from({length}, (_, index) => {
        if (!Object.hasOwn(observations, index)) throw new Error("観測に疎配列は使えません");
        const value = observations[index];
        if (!value || typeof value !== "object" || Object.keys(value).some(key => !["observationId", "listDate", "document", "observedAt", "sequence"].includes(key))) throw new Error("観測の形式が不正です");
        const { observationId, listDate, document, observedAt } = value;
        const observed = timestamp(observedAt, true);
        if (observed === undefined || !document || typeof document !== "object") throw new Error("観測日時または書類が不正です");
        const periodStart = document.periodStart, periodEnd = document.periodEnd;
        if ([periodStart, periodEnd].some(value => value !== undefined && value !== null && typeof value !== "string")) throw new Error("対象期間は文字列/null/未記録で指定してください");
        return { observed, relation: { observationId, ...(listDate === undefined ? {} : { listDate }), document }, periodStart, periodEnd };
    });
    const analyzed = analyzeDocumentRelations(captured.map(item => item.relation));
    const byObservationId = new Map(captured.map(item => [item.relation.observationId, item]));
    const latest = new Map<string, Candidate>(), ignored: { observationId: string; reason: "after-cutoff" | "unsupported-document-type" }[] = [];
    const identity = (item: Candidate) => {
        const { withdrawalStatus: _w, disclosureStatus: _d, docInfoEditStatus: _e, ...document } = item.observation.document;
        return JSON.stringify([document, item.observation.statuses, item.periodStart, item.periodEnd]);
    };
    for (const observation of analyzed.observations) {
        // 関係分析はID順に並べ替えるため、配列の位置ではなく観測IDで対応させます。
        const input = byObservationId.get(observation.observationId)!, doc = observation.document;
        const submittedAt = timestamp(doc.submitDateTime, false);
        if (input.observed > cutoffTime || submittedAt !== undefined && submittedAt > cutoffTime) { ignored.push({ observationId: observation.observationId, reason: "after-cutoff" }); continue; }
        if (!roots.includes(doc.docTypeCode ?? "") && !corrections.includes(doc.docTypeCode ?? "")) { ignored.push({ observationId: observation.observationId, reason: "unsupported-document-type" }); continue; }
        const candidate: Candidate = { observation, observedAt: input.observed, submittedAt, periodStart: input.periodStart, periodEnd: input.periodEnd, observationIds: [observation.observationId], conflict: false };
        const previous = latest.get(doc.docID);
        if (!previous || candidate.observedAt > previous.observedAt) latest.set(doc.docID, candidate);
        else if (candidate.observedAt === previous.observedAt) {
            previous.conflict ||= identity(previous) !== identity(candidate);
            previous.observationIds.push(observation.observationId);
        }
    }
    const decisions: DocumentVersionDecision[] = [], groups = new Map<string, Candidate[]>(), resolvedRoots = new Map<string, Candidate>(), failedRoots = new Map<string, DocumentVersionReason>();
    const failed = (candidate: Candidate, reason: DocumentVersionReason, path: string[]) => decisions.push({ rootDocID: candidate.observation.document.docID,
        status: "unresolved", reason, chainDocIDs: path, observationIds: candidate.observationIds });
    for (const candidate of latest.values()) {
        const path: string[] = [], seen = new Set<string>(); let current = candidate, reason: DocumentVersionReason | undefined;
        while (true) {
            const doc = current.observation.document;
            const failure = failedRoots.get(doc.docID);
            if (failure) { path.push(doc.docID); reason = failure; break; }
            const resolved = resolvedRoots.get(doc.docID);
            if (resolved) { current = resolved; break; }
            if (seen.has(doc.docID)) { reason = "cycle"; break; }
            seen.add(doc.docID); path.push(doc.docID);
            if (roots.includes(doc.docTypeCode!)) { if (doc.parentDocID) reason = "unexpected-parent"; break; }
            const parent = doc.parentDocID ? latest.get(doc.parentDocID) : undefined;
            if (!parent) { reason = "parent-missing"; break; }
            const p = parent.observation.document;
            const family = roots.find(root => families[root] === doc.docTypeCode)!;
            if (p.docTypeCode !== family && p.docTypeCode !== doc.docTypeCode) { reason = "wrong-parent-type"; break; }
            if (!doc.edinetCode || doc.edinetCode !== p.edinetCode || doc.secCode && p.secCode && doc.secCode !== p.secCode) { reason = "company-mismatch"; break; }
            if ([current.periodStart, current.periodEnd, parent.periodStart, parent.periodEnd].some(value => value !== null && value !== undefined && !validDate(value))) { reason = "period-unavailable"; break; }
            if (current.periodStart && parent.periodStart && current.periodStart !== parent.periodStart ||
                current.periodEnd && parent.periodEnd && current.periodEnd !== parent.periodEnd) { reason = "period-mismatch"; break; }
            if (current.submittedAt === undefined || parent.submittedAt === undefined) { reason = "submit-time-unavailable"; break; }
            if (current.submittedAt < parent.submittedAt) { reason = "non-chronological-chain"; break; }
            current = parent;
        }
        if (reason) { for (const docID of path) failedRoots.set(docID, reason); failed(candidate, reason, path); continue; }
        if (validDate(current.periodStart) && validDate(current.periodEnd)) {
            if (path.some(id => { const item = latest.get(id)!; return item.periodStart && item.periodStart !== current.periodStart || item.periodEnd && item.periodEnd !== current.periodEnd; })) {
                failed(candidate, "period-mismatch", path); continue;
            }
            candidate.targetPeriod = { startDate: current.periodStart, endDate: current.periodEnd, sourceDocID: current.observation.document.docID };
        }
        for (const docID of path) resolvedRoots.set(docID, current);
        const root = current.observation.document.docID, group = groups.get(root) ?? [];
        group.push(candidate); groups.set(root, group);
    }
    // 解決不能の訂正を落として古い元書類を「最新」と返さないよう、参照先系列も止めます。
    const blocked = new Map<string, string[]>();
    for (const decision of decisions) {
        const candidate = latest.get(decision.rootDocID)!;
        if (["withdrawn", "non-disclosed", "notice-only"].includes(availability(candidate) ?? "")) continue;
        let parentID = candidate.observation.document.parentDocID; const seen = new Set<string>();
        while (parentID && !seen.has(parentID)) {
            seen.add(parentID);
            const parent = latest.get(parentID); if (!parent) break;
            const root = resolvedRoots.get(parentID);
            if (root) { const id = root.observation.document.docID, refs = blocked.get(id) ?? []; refs.push(...candidate.observationIds); blocked.set(id, refs); break; }
            parentID = parent.observation.document.parentDocID;
        }
    }
    for (const [rootDocID, group] of groups) {
        const root = latest.get(rootDocID)!, rootReason = availability(root), observationIds = group.flatMap(item => item.observationIds);
        if (rootReason) {
            decisions.push({ rootDocID, status: ["withdrawn", "non-disclosed", "notice-only"].includes(rootReason) ? "unavailable" : "unresolved", reason: rootReason, chainDocIDs: [rootDocID], observationIds }); continue;
        }
        if (blocked.has(rootDocID)) { decisions.push({ rootDocID, status: "unresolved", reason: "unresolved-correction", chainDocIDs: group.map(item => item.observation.document.docID), observationIds: [...observationIds, ...blocked.get(rootDocID)!] }); continue; }
        const active = group.filter(item => !availability(item)), activeIds = new Set(active.map(item => item.observation.document.docID));
        const uncertain = group.find(item => { const reason = availability(item); return reason !== undefined && !["withdrawn", "non-disclosed", "notice-only"].includes(reason); });
        const inactiveParent = active.some(item => item.observation.document.parentDocID && !activeIds.has(item.observation.document.parentDocID));
        if (uncertain || inactiveParent) { decisions.push({ rootDocID, status: "unresolved", reason: uncertain ? availability(uncertain)! : "inactive-parent", chainDocIDs: group.map(item => item.observation.document.docID), observationIds }); continue; }
        const parents = new Set(active.map(item => item.observation.document.parentDocID).filter(Boolean));
        const leaves = active.filter(item => !parents.has(item.observation.document.docID));
        if (leaves.length !== 1) { decisions.push({ rootDocID, status: "unresolved", reason: "multiple-correction-leaves", chainDocIDs: active.map(item => item.observation.document.docID), observationIds }); continue; }
        const selectedDocID = leaves[0].observation.document.docID, chain: string[] = [];
        let docID: string | null | undefined = selectedDocID;
        while (docID) { chain.push(docID); docID = latest.get(docID)!.observation.document.parentDocID; }
        decisions.push({ rootDocID, status: "selected", reason: "selected", selectedDocID, chainDocIDs: chain.reverse(), observationIds, targetPeriod: leaves[0].targetPeriod });
    }
    decisions.sort((a, b) => a.rootDocID < b.rootDocID ? -1 : a.rootDocID > b.rootDocID ? 1 : 0);
    const selected: SelectedDocumentVersion[] = decisions.filter(d => d.status === "selected").map(d => ({
        rootDocID: d.rootDocID, chainDocIDs: [...d.chainDocIDs], observationIds: [...d.observationIds],
        observation: structuredClone(latest.get(d.selectedDocID!)!.observation),
        observedAt: new Date(Math.max(...d.observationIds.map(id => byObservationId.get(id)!.observed))).toISOString(),
        targetPeriod: {...d.targetPeriod!}
    }));
    return { cutoff, decisions, selected, ignored, financialValuesMerged: false as const, reconstructedUnobservedHistory: false as const };
}
