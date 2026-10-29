import {createHash} from 'node:crypto';
import {backfillFinancialDocumentLists} from '../../dist/index.js';
import {assertDailyNoticeState,scanDailyMetadataNotices} from './daily-metadata-notices.mjs';

export const DAILY_METADATA_MAX_REQUESTS = 256;

const DAY = 86400000;
const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const shift = (date, days) => new Date(Date.parse(date) + days * DAY).toISOString().slice(0, 10);
const jstDate = now => new Date(now + 9 * 3600000).toISOString().slice(0, 10);
const validTime = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T.*Z$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const keys = (value, allowed) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => allowed.includes(key));

/** 呼出し側が排他を取得し、saveをatomic rename/fsyncで永続化してから通信します。 */
export async function collectDailyMetadata(repository, fetchList, state, save, {signal} = {}) {
    const today = jstDate(Date.now()), yesterday = shift(today, -1);
    if (typeof fetchList !== 'function' || typeof save !== 'function'
        || !keys(state, ['version', 'throughDate', 'completedDay', 'budget', 'active', 'notices', 'lastCompletedRun']) || ![1, 2, 3].includes(state.version)
        || state.version < 3 && state.lastCompletedRun !== undefined
        || state.version === 1 && state.notices !== undefined
        || !validDate(state.throughDate) || state.throughDate > yesterday
        || state.completedDay !== undefined && (!validDate(state.completedDay) || state.completedDay > today)
        || !keys(state.budget, ['date', 'requests']) || !validDate(state.budget.date) || state.budget.date > today
        || !Number.isSafeInteger(state.budget.requests) || state.budget.requests < 0 || state.budget.requests > DAILY_METADATA_MAX_REQUESTS)
        throw Error('Invalid daily metadata checkpoint');
    if (state.active !== undefined) {
        const run = state.active;
        if (!keys(run, ['startDate', 'endDate', 'refreshAfter', 'probe']) || !validDate(run.startDate)
            || !validDate(run.endDate) || run.startDate > run.endDate || run.endDate > yesterday
            || Date.parse(run.endDate) - Date.parse(run.startDate) > 1830 * DAY
            || !validTime(run.refreshAfter) || Date.parse(run.refreshAfter) > Date.now()
            || run.probe !== undefined && (!keys(run.probe, ['date', 'observedAt', 'documents', 'sha256'])
                || !validDate(run.probe.date) || run.probe.date > today || !validTime(run.probe.observedAt)
                || Date.parse(run.probe.observedAt) > Date.now() || Date.parse(run.probe.observedAt) < Date.parse(run.refreshAfter)
                || jstDate(Date.parse(run.probe.observedAt)) !== run.probe.date || !Number.isSafeInteger(run.probe.documents)
                || run.probe.documents < 0 || !/^[a-f0-9]{64}$/.test(run.probe.sha256)))
            throw Error('Invalid daily metadata run');
    }
    repository.assertWritable();
    if (state.version === 1) state.notices = {afterSequence: 0, seen: [], pending: [], unresolved: []};
    state.version = 3;
    assertDailyNoticeState(state.notices, repository);
    if (state.lastCompletedRun !== undefined) assertCompletedMetadataRun(state.lastCompletedRun, repository.getLastObservationSequence(), state.throughDate);
    const persist = () => save(structuredClone(state));
    const result = (status, fields = {}) => ({status, ...fields,
        ...(state.notices.pending.length ? {pendingNoticeDates: state.notices.pending.length} : {}),
        ...(state.notices.unresolved.length ? {unresolvedNotices: state.notices.unresolved.length} : {})});
    if ((await scanDailyMetadataNotices(repository, state.notices, persist, {signal})).aborted) return result('aborted');
    if (state.budget.date !== today) state.budget = {date: today, requests: 0};
    if (!state.active) {
        if (state.completedDay === today && !state.notices.pending.length && state.lastCompletedRun?.probe.date === today
            && state.lastCompletedRun.throughSequence === state.notices.afterSequence) return result('already-complete');
        const startDate = [shift(today, -7), shift(state.throughDate, 1)].sort()[0];
        state.active = {startDate, endDate: [yesterday, shift(startDate, 1830)].sort()[0], refreshAfter: new Date().toISOString()};
        await persist();
    }
    const run = state.active;
    const reserve = async () => {
        if (signal?.aborted) return false;
        // 日付を跨いだ実行は次の起動で新しい当日probeを取得します。
        if (jstDate(Date.now()) !== today || state.budget.requests === DAILY_METADATA_MAX_REQUESTS) return false;
        state.budget.requests++;
        await persist();
        return true;
    };
    if (run.probe?.date !== today) {
        if (!await reserve()) return result(signal?.aborted ? 'aborted' : 'budget-exhausted');
        let documents;
        try { documents = await fetchList(today, {signal}); }
        catch { return result(signal?.aborted ? 'aborted' : 'probe-failed'); }
        if (signal?.aborted) return result('aborted');
        if (jstDate(Date.now()) !== today) return result('day-changed');
        if (!Array.isArray(documents)) throw Error('Invalid daily metadata probe');
        run.probe = {date: today, observedAt: new Date().toISOString(), documents: documents.length,
            sha256: createHash('sha256').update(JSON.stringify(documents)).digest('hex')};
        await persist();
    }
    while (!signal?.aborted && jstDate(Date.now()) === today) {
        if ((await scanDailyMetadataNotices(repository, state.notices, persist, {signal})).aborted) return result('aborted');
        // DB commit直後の停止も、保存済みmarkerで再開します。通知cursorは原観測から再生できます。
        const remainingNotices = state.notices.pending.filter(p => !repository.hasCompleteListForDate(p.date, p.notBefore));
        if (remainingNotices.length !== state.notices.pending.length) { state.notices.pending = remainingNotices; await persist(); }
        const pending = new Map();
        for (let day = run.startDate; day <= run.endDate; day = shift(day, 1))
            if (!repository.hasCompleteListForDate(day, run.refreshAfter)) pending.set(day, run.refreshAfter);
        for (const target of state.notices.pending)
            pending.set(target.date, [pending.get(target.date) ?? target.notBefore, target.notBefore].sort()[1]);
        if (!pending.size) {
            state.throughDate = [state.throughDate, run.endDate].sort()[1];
            if (run.endDate === yesterday) state.completedDay = today;
            state.lastCompletedRun = {startDate: run.startDate, endDate: run.endDate, refreshAfter: run.refreshAfter, probe: structuredClone(run.probe),
                throughSequence: state.notices.afterSequence, closedThrough: state.throughDate, completedAt: new Date().toISOString(), unresolvedNotices: state.notices.unresolved.length};
            delete state.active;
            await persist();
            return result('complete', {throughDate: state.throughDate});
        }
        if (!await reserve()) return result(signal?.aborted ? 'aborted' : 'budget-exhausted');
        const [day, notBefore] = pending.entries().next().value;
        const page = await backfillFinancialDocumentLists(repository, fetchList,
            {startDate: day, endDate: day, refreshAfter: notBefore, maxDays: 1, signal});
        if (page.aborted) return result('aborted');
        if (!page.complete) return result('fetch-failed', {date: day});
    }
    return result(signal?.aborted ? 'aborted' : 'day-changed');
}

/** 固定計画の全task完了と取得unit停止の両方が必要です。 */
export function canStartDailyMetadata(summary, unit, expected) {
    return unit === 'inactive' && summary?.planSha256 === expected.planSha256
        && summary?.executionScriptSha256 === expected.workerSha256 && summary?.finished === true
        && summary.pending === 0 && summary.failed === 0 && summary.running === 0
        && Number.isSafeInteger(summary.completed) && summary.completed >= 0
        && Number.isSafeInteger(summary.unavailable) && summary.unavailable >= 0
        && Number.isSafeInteger(summary.documents) && summary.documents > 0
        && summary.completed + summary.unavailable === summary.documents;
}

/** 完了時の提供元probeと対象範囲を、次の実行や財務計画からも照合します。 */
export function assertCompletedMetadataRun(run, maxSequence, closedThrough) {
    if (!keys(run, ['startDate','endDate','refreshAfter','probe','throughSequence','closedThrough','completedAt','unresolvedNotices'])
        || !validDate(run.startDate) || !validDate(run.endDate) || run.startDate > run.endDate || !validDate(run.closedThrough)
        || run.endDate > run.closedThrough || run.closedThrough !== closedThrough || run.closedThrough >= jstDate(Date.now())
        || !validTime(run.refreshAfter) || !validTime(run.completedAt) || Date.parse(run.completedAt) > Date.now()
        || Date.parse(run.refreshAfter) > Date.parse(run.completedAt) || !Number.isSafeInteger(run.throughSequence) || run.throughSequence < 0 || run.throughSequence > maxSequence
        || !Number.isSafeInteger(run.unresolvedNotices) || run.unresolvedNotices < 0 || run.unresolvedNotices > 10000
        || !keys(run.probe, ['date','observedAt','documents','sha256']) || !validDate(run.probe.date) || !validTime(run.probe.observedAt)
        || jstDate(Date.parse(run.probe.observedAt)) !== run.probe.date || Date.parse(run.probe.observedAt) < Date.parse(run.refreshAfter)
        || Date.parse(run.probe.observedAt) > Date.parse(run.completedAt) || !Number.isSafeInteger(run.probe.documents) || run.probe.documents < 0
        || !/^[a-f0-9]{64}$/.test(run.probe.sha256)) throw Error('Invalid completed metadata run receipt');
}
