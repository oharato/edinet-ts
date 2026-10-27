import { normalizeFinancialDetailMetadata, type FinancialDetailMetadata } from "./financial-detail-metadata";
import { normalizeFinancialDetailSnapshot } from "./financial-detail-snapshots";
import { FINANCIAL_DETAIL_REGISTRY, type FinancialDetailMetricId } from "./financial-detail-registry";
import type { FinancialDetailSnapshot } from "./financial-detail-screening";

export type FinancialCoverageState = "available" | "metadata-incomplete" | "no-document-in-window" | "multiple-documents" |
    "not-downloaded" | "download-failed" | "xbrl-unavailable" | "withdrawn" | "non-disclosed" | "unresolved-document" |
    "parse-failed" | "incomparable" | "not-extracted" | "missing" | "unsupported" | "ambiguous" | "unsafe-number";
export interface CoverageDocument {
    edinetCode: string; docID: string;
    state: "not-downloaded" | "download-failed" | "xbrl-unavailable" | "withdrawn" | "non-disclosed" | "unresolved-document" | "parse-failed" | "parsed";
    snapshot?: FinancialDetailSnapshot;
}
export interface FinancialDetailCoverageInput {
    population: { asOf: string; source: string; edinetCodes: readonly string[] };
    metadataWindow: { startDate: string; endDate: string; completedDates: readonly string[] };
    cohort: Omit<FinancialDetailMetadata, "secCode" | "docID">;
    metricIds: readonly FinancialDetailMetricId[];
    /** 対象期間・書類種別を確認して明示した候補。最新版を推測しません。 */
    documents: readonly CoverageDocument[];
}
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const cohortKey = (m: FinancialDetailMetadata) => JSON.stringify([m.scope, m.accountingStandard, m.currency, m.periodType,
    m.period.instant, m.period.startDate, m.period.endDate]);
/** 明示母集団の取込工程と値の欠損を分離。過去の母集団・原本真正性は推測しません。 */
export function measureFinancialDetailCoverage(input: FinancialDetailCoverageInput) {
    if (!input || !input.population || !input.metadataWindow || !Array.isArray(input.documents) || !Array.isArray(input.metricIds)) throw new Error("母集団・一覧範囲・抽出対象を明示してください");
    const { population, metadataWindow: window } = input;
    if (!validDate(population.asOf) || typeof population.source !== "string" || !population.source.trim() || !Array.isArray(population.edinetCodes)) throw new Error("正しい母集団が必要です");
    const codes: string[] = Array.from(population.edinetCodes);
    if (new Set(codes).size !== codes.length || codes.some(code => typeof code !== "string" || !/^E\d{5}$/.test(code))) throw new Error("母集団の識別子が不正/重複しています");
    if (!validDate(window.startDate) || !validDate(window.endDate) || window.startDate > window.endDate || !Array.isArray(window.completedDates)) throw new Error("一覧の対象期間が不正です");
    const expectedDays = (Date.parse(window.endDate) - Date.parse(window.startDate)) / 86400000 + 1;
    if (expectedDays > 36600) throw new Error("一覧期間は100年以内です");
    const dates: string[] = Array.from(window.completedDates);
    if (new Set(dates).size !== dates.length || dates.some(date => !validDate(date) || date < window.startDate || date > window.endDate)) throw new Error("取得完了日が不正/重複しています");
    if (!input.cohort || Object.keys(input.cohort).some(key => !["period", "periodType", "scope", "accountingStandard", "currency"].includes(key))) throw new Error("共通の比較条件だけを指定してください");
    const cohort = normalizeFinancialDetailMetadata({ ...input.cohort, secCode: "1001", docID: "COHORT" } as FinancialDetailMetadata);
    const ids: FinancialDetailMetricId[] = Array.from(input.metricIds);
    if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !Object.hasOwn(FINANCIAL_DETAIL_REGISTRY, id) ||
        FINANCIAL_DETAIL_REGISTRY[id].periodType !== (cohort.period.instant === undefined ? "duration" : "instant"))) throw new Error("対象期と同じ期間型の明示項目が必要です");
    const documents = new Map<string, CoverageDocument[]>(), seen = new Set<string>(), owners = new Set(codes);
    for (const value of Array.from(input.documents)) {
        if (!value || typeof value !== "object") throw new Error("候補書類が不正です");
        const document = { edinetCode: value.edinetCode, docID: value.docID, state: value.state, snapshot: value.snapshot };
        if (!owners.has(document.edinetCode) || typeof document.docID !== "string" || !document.docID.trim() || seen.has(document.docID) ||
            !["not-downloaded", "download-failed", "xbrl-unavailable", "withdrawn", "non-disclosed", "unresolved-document", "parse-failed", "parsed"].includes(document.state)) throw new Error("候補書類の識別/工程が不正です");
        seen.add(document.docID);
        const captured = { ...document };
        if (captured.state === "parsed") {
            captured.snapshot = normalizeFinancialDetailSnapshot(captured.snapshot);
            if (captured.snapshot.metadata.docID !== captured.docID) throw new Error("候補とsnapshotの書類IDが不一致です");
        } else if (captured.snapshot !== undefined) throw new Error("未解析の候補へ抽出結果を混ぜられません");
        const group = documents.get(document.edinetCode) ?? []; group.push(captured); documents.set(document.edinetCode, group);
    }
    const rows: { edinetCode: string; metric: FinancialDetailMetricId; state: FinancialCoverageState; reason?: string; docIDs: string[] }[] = [];
    for (const code of codes) {
        const candidates = documents.get(code) ?? [];
        for (const metric of ids) {
            let state: FinancialCoverageState, reason: string | undefined;
            if (!candidates.length) state = dates.length === expectedDays ? "no-document-in-window" : "metadata-incomplete";
            else if (candidates.length > 1) state = "multiple-documents";
            else {
                const candidate = candidates[0];
                if (candidate.state !== "parsed") state = candidate.state;
                else if (cohortKey(candidate.snapshot!.metadata) !== cohortKey(cohort)) state = "incomparable";
                else {
                    const selection = candidate.snapshot!.selections[metric];
                    if (!selection) state = "not-extracted";
                    else if (selection.status !== "selected") { state = selection.status; reason = selection.reason; }
                    else if (selection.safeNumber === undefined) state = "unsafe-number";
                    else state = "available";
                }
            }
            rows.push({ edinetCode: code, metric, state, ...(reason ? { reason } : {}), docIDs: candidates.map(c => c.docID) });
        }
    }
    const counts: Partial<Record<FinancialCoverageState, number>> = {};
    const byMetric: Partial<Record<FinancialDetailMetricId, Partial<Record<FinancialCoverageState, number>>>> = {};
    for (const row of rows) { counts[row.state] = (counts[row.state] ?? 0) + 1; const group = byMetric[row.metric] ??= {}; group[row.state] = (group[row.state] ?? 0) + 1; }
    const { secCode: _code, docID: _doc, ...resultCohort } = cohort;
    return { population: { asOf: population.asOf, source: population.source, companies: codes.length },
        metadataWindow: { startDate: window.startDate, endDate: window.endDate, expectedDays, completedDays: dates.length, complete: dates.length === expectedDays },
        cohort: resultCohort, metricIds: ids, cells: rows.length, counts, byMetric, rows };
}
