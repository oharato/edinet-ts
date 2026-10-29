import { parseDocumentTimestamp as timestamp } from "./document-timestamp";
import { EdinetRepository } from "./db/edinet-repository";
import { ObservedFinancialArchive } from "./db/observed-financial-archive";
import type { EdinetDocument } from "./edinet-xbrl-downloader";
import type { DocumentVersionObservation } from "./document-version-selection";
export interface FinancialListBackfillOptions {
    startDate: string;
    endDate: string;
    maxDays?: number;
    afterDate?: string;
    /** 同じ値で再開可能。この時刻以降に再観測した閉じた日だけを再利用します。 */
    refreshAfter?: string;
    signal?: AbortSignal;
}
export interface FinancialListBackfillResult {
    refreshAfter?: string;
    days: {
        date: string;
        status: "cached" | "fetched" | "failed";
        documents?: number;
        closed: boolean;
        errorCode?: "document-list-fetch-failed";
    }[];
    nextAfterDate?: string;
    remainingDates: number;
    complete: boolean;
    aborted: boolean;
}
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
const signalValid = (s: unknown) => s === undefined || s instanceof AbortSignal;
/** 保存済みの閉じた日は再利用し、空の一覧も原子的に保存します。 */
export async function backfillFinancialDocumentLists(repository: EdinetRepository, fetchList: (date: string, request: {
    signal?: AbortSignal;
}) => Promise<EdinetDocument[]>, options: FinancialListBackfillOptions): Promise<FinancialListBackfillResult> {
    if (!(repository instanceof EdinetRepository) || typeof fetchList !== "function" || !options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["startDate", "endDate", "maxDays", "afterDate", "refreshAfter", "signal"].includes(k)))
        throw new Error("一覧補完の入力が不正です");
    const { startDate, endDate, maxDays = 20, afterDate, refreshAfter, signal } = options, today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
    const refreshTime = refreshAfter === undefined ? undefined : timestamp(refreshAfter, true);
    if (refreshAfter !== undefined && (refreshTime === undefined || refreshTime > Date.now())) throw new Error("再観測開始時刻は現在以前のtimezone付き日時です");
    if (!date(startDate) || !date(endDate) || startDate > endDate || endDate > today || (Date.parse(endDate) - Date.parse(startDate)) / 86400000 > 1830 || !Number.isSafeInteger(maxDays) || maxDays < 1 || maxDays > 100 || afterDate !== undefined && (!date(afterDate) || afterDate < startDate || afterDate > endDate) || !signalValid(signal))
        throw new Error("一覧補完は過去〜当日の日付範囲・1〜100取得日で指定してください");
    repository.assertWritable();
    const days: FinancialListBackfillResult['days'] = [];
    let fetched = 0, cursor = afterDate;
    for (let ms = Date.parse(startDate); ms <= Date.parse(endDate); ms += 86400000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        if (afterDate !== undefined && day <= afterDate)
            continue;
        if (signal?.aborted)
            break;
        if (repository.hasCompleteListForDate(day, refreshAfter)) {
            days.push({ date: day, status: 'cached', closed: true });
            cursor = day;
            continue;
        }
        if (fetched === maxDays)
            break;
        fetched++;
        try {
            const documents = await fetchList(day, { signal });
            if (signal?.aborted)
                break;
            repository.saveDocumentList(documents, day);
            days.push({ date: day, status: 'fetched', documents: documents.length, closed: repository.hasCompleteListForDate(day, refreshAfter) });
        }
        catch {
            if (signal?.aborted)
                break;
            days.push({ date: day, status: 'failed', closed: false, errorCode: 'document-list-fetch-failed' });
        }
        cursor = day;
    }
    let remainingDates = 0, complete = true;
    for (let ms = Date.parse(startDate); ms <= Date.parse(endDate); ms += 86400000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        if (!repository.hasCompleteListForDate(day, refreshAfter)) {
            complete = false;
            if (cursor === undefined || day > cursor)
                remainingDates++;
        }
    }
    return { ...(refreshTime === undefined ? {} : {refreshAfter: new Date(refreshTime).toISOString()}), days, ...(remainingDates && cursor !== undefined ? { nextAfterDate: cursor } : {}), remainingDates, complete, aborted: signal?.aborted ?? false };
}
export interface FinancialObservationTransferOptions {
    sourceId: string;
    afterSequence?: number;
    pageSize?: number;
    maxPages?: number;
    signal?: AbortSignal;
}
export interface FinancialObservationTransferResult {
    sourceId: string;
    afterSequence: number;
    throughSequence: number;
    nextAfterSequence: number;
    readObservations: number;
    insertedObservations: number;
    complete: boolean;
    aborted: boolean;
}
/** 原観測を安定namespaceで追記。cursorは原本commit後にだけ進めます。 */
export function archiveFinancialDocumentObservations(repository: EdinetRepository, archive: ObservedFinancialArchive, options: FinancialObservationTransferOptions): FinancialObservationTransferResult {
    if (!(repository instanceof EdinetRepository) || !(archive instanceof ObservedFinancialArchive) || !options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["sourceId", "afterSequence", "pageSize", "maxPages", "signal"].includes(k)))
        throw new Error("観測転送の入力が不正です");
    const { sourceId, afterSequence = 0, pageSize = 1000, maxPages = 20, signal } = options;
    if (typeof sourceId !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(sourceId) || !Number.isSafeInteger(afterSequence) || afterSequence < 0 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 1000 || !Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 1000 || !signalValid(signal))
        throw new Error("転送元ID・cursor・batch条件が不正です");
    const throughSequence = repository.getLastObservationSequence();
    if (afterSequence > throughSequence)
        throw new Error("転送cursorが転送元の末尾より先です");
    const convert = (o: ReturnType<EdinetRepository['getDocumentObservations']>[number]): DocumentVersionObservation => ({ ...o, observationId: `metadata:${sourceId}:${o.sequence}` });
    archive.append([], []);
    if (afterSequence) {
        const previous = repository.getDocumentObservations({ afterSequence: afterSequence - 1, limit: 1 })[0];
        if (previous?.sequence !== afterSequence || archive.observation(convert(previous).observationId) === undefined)
            throw new Error("転送cursorに対応する保存観測がありません");
        archive.append([convert(previous)]);
    }
    let cursor = afterSequence, readObservations = 0, insertedObservations = 0;
    for (let page = 0; page < maxPages && cursor < throughSequence; page++) {
        if (signal?.aborted)
            break;
        const rows = repository.getDocumentObservations({ afterSequence: cursor, limit: pageSize }).filter(o => o.sequence <= throughSequence);
        if (signal?.aborted)
            break;
        if (!rows.length)
            throw new Error("固定した末尾までの観測がありません");
        const result = archive.append(rows.map(convert));
        cursor = rows.at(-1)!.sequence;
        readObservations += rows.length;
        insertedObservations += result.insertedObservations;
    }
    return { sourceId, afterSequence, throughSequence, nextAfterSequence: cursor, readObservations, insertedObservations, complete: cursor === throughSequence, aborted: signal?.aborted ?? false };
}
