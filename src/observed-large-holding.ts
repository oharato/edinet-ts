import { createHash } from "node:crypto";
import { selectLargeHoldingReportVersions, type LargeHoldingVersionObservation } from "./large-holding-versions";
import { extractLargeHoldingReport, searchLargeHoldingReports, searchParsedLargeHoldingReports, type LargeHoldingReport, type LargeHoldingDocument, type LargeHoldingSearchOptions } from "./large-holding-report";
import { parseDocumentTimestamp as timestamp } from "./document-timestamp";
export interface ObservedLargeHoldingSource { docID: string; availableAt: string; sourceSha256: string; coverContextRef: string; xml?: string; }
/** 選ばれた訂正版の原本がなければ理由を返し、旧版の値で埋めません。 */
export function searchObservedLargeHoldingReports(observations: readonly LargeHoldingVersionObservation[], sources: readonly ObservedLargeHoldingSource[], options: LargeHoldingSearchOptions) {
    if (!options) throw new Error("観測付き大量保有検索の条件が必要です");
    const selection = selectLargeHoldingReportVersions(observations, options.cutoff), cut = timestamp(options.cutoff, true)!;
    // 原本がない場合も条件の誤りを検証します。
    searchLargeHoldingReports([], options);
    if (!Array.isArray(sources) || sources.length > 100) throw new Error("大量保有の原本は100件以下です");
    const inputs = Array.from({ length: sources.length }, (_, i) => {
        const s = sources[i]; if (!s || Object.keys(s).some(k => !["docID", "availableAt", "sourceSha256", "coverContextRef", "xml"].includes(k))) throw new Error("大量保有の原本宣言が不正です");
        const { docID, availableAt, sourceSha256, coverContextRef, xml } = s;
        if (typeof docID !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(docID) || timestamp(availableAt, true) === undefined || typeof sourceSha256 !== "string" || !/^[a-f0-9]{64}$/.test(sourceSha256) || typeof coverContextRef !== "string" || !coverContextRef.trim() || coverContextRef.length > 1000 || xml !== undefined && typeof xml !== "string") throw new Error("大量保有の原本ID/観測時刻/hash/contextを確認してください");
        return { docID, availableAt, sourceSha256, coverContextRef, xml };
    });
    if (new Set(inputs.map(s => s.docID)).size !== inputs.length || inputs.reduce((n, s) => n + Buffer.byteLength(s.xml ?? ""), 0) > 256 * 1024 * 1024) throw new Error("大量保有の原本重複/合計上限を確認してください");
    const byID = new Map(inputs.map(s => [s.docID, s])), reports: LargeHoldingReport[] = [], unavailableSources: { rootDocID: string; docID: string; reason: "source-missing" | "not-available-at-cutoff" | "source-not-loaded" | "source-hash-mismatch" | "source-parse-failed" }[] = [];
    for (const selected of selection.selected) {
        const d = selected.observation.document, docID = d.docID, s = byID.get(docID);
        const failed = (reason: typeof unavailableSources[number]["reason"]) => unavailableSources.push({ rootDocID: selected.rootDocID, docID, reason });
        if (!s) { failed("source-missing"); continue; }
        const available = timestamp(s.availableAt, true)!;
        if (available > cut) { failed("not-available-at-cutoff"); continue; }
        if (s.xml === undefined) { failed("source-not-loaded"); continue; }
        if (createHash("sha256").update(s.xml).digest("hex") !== s.sourceSha256) { failed("source-hash-mismatch"); continue; }
        const status = selected.observation.statuses;
        if (Object.values(status).some(v => v.presence !== "known" || v.code !== "0")) throw new Error("選択済み観測の利用状態が整合しません");
        const document: LargeHoldingDocument = { xml: s.xml, metadata: { docID, docTypeCode: d.docTypeCode as "350" | "360", formCode: d.formCode!, edinetCode: d.edinetCode!, issuerEdinetCode: d.issuerEdinetCode!, parentDocID: d.parentDocID ?? undefined, submitDateTime: d.submitDateTime!, knownAt: new Date(Math.max(available, timestamp(selected.observedAt, true)!)).toISOString(), coverContextRef: s.coverContextRef, withdrawalStatus: "0", disclosureStatus: "0", docInfoEditStatus: "0" } };
        try { reports.push(extractLargeHoldingReport(document)); } catch { failed("source-parse-failed"); continue; }
    }
    return { selection, ...searchParsedLargeHoldingReports(reports, options), unavailableSources };
}
