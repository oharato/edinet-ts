import {createHash} from 'node:crypto';
import {backfillFinancialDocumentLists} from '../../dist/index.js';

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
        || !keys(state, ['version', 'throughDate', 'completedDay', 'budget', 'active']) || state.version !== 1
        || !validDate(state.throughDate) || state.throughDate > yesterday
        || state.completedDay !== undefined && (!validDate(state.completedDay) || state.completedDay > today)
        || !keys(state.budget, ['date', 'requests']) || !validDate(state.budget.date) || state.budget.date > today
        || !Number.isSafeInteger(state.budget.requests) || state.budget.requests < 0 || state.budget.requests > 32)
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
    const persist = () => save(structuredClone(state));
    if (state.budget.date !== today) state.budget = {date: today, requests: 0};
    if (!state.active) {
        if (state.completedDay === today) return {status: 'already-complete'};
        const startDate = [shift(today, -7), shift(state.throughDate, 1)].sort()[0];
        state.active = {startDate, endDate: [yesterday, shift(startDate, 1830)].sort()[0], refreshAfter: new Date().toISOString()};
        await persist();
    }
    const run = state.active;
    const reserve = async () => {
        if (signal?.aborted) return false;
        // 日付を跨いだ実行は次の起動で新しい当日probeを取得します。
        if (jstDate(Date.now()) !== today || state.budget.requests === 32) return false;
        state.budget.requests++;
        await persist();
        return true;
    };
    if (run.probe?.date !== today) {
        if (!await reserve()) return {status: signal?.aborted ? 'aborted' : 'budget-exhausted'};
        let documents;
        try { documents = await fetchList(today, {signal}); }
        catch { return {status: signal?.aborted ? 'aborted' : 'probe-failed'}; }
        if (signal?.aborted) return {status: 'aborted'};
        if (jstDate(Date.now()) !== today) return {status: 'day-changed'};
        if (!Array.isArray(documents)) throw Error('Invalid daily metadata probe');
        run.probe = {date: today, observedAt: new Date().toISOString(), documents: documents.length,
            sha256: createHash('sha256').update(JSON.stringify(documents)).digest('hex')};
        await persist();
    }
    while (!signal?.aborted && jstDate(Date.now()) === today) {
        // 予約残高なしでも、commit済み・checkpoint未保存の日は完了へ進められます。
        const pending = [];
        for (let day = run.startDate; day <= run.endDate; day = shift(day, 1))
            if (!repository.hasCompleteListForDate(day, run.refreshAfter)) pending.push(day);
        if (!pending.length) {
            state.throughDate = [state.throughDate, run.endDate].sort()[1];
            if (run.endDate === yesterday) state.completedDay = today;
            delete state.active;
            await persist();
            return {status: 'complete', throughDate: state.throughDate};
        }
        if (!await reserve()) return {status: signal?.aborted ? 'aborted' : 'budget-exhausted'};
        const result = await backfillFinancialDocumentLists(repository, fetchList,
            {startDate: pending[0], endDate: pending[0], refreshAfter: run.refreshAfter, maxDays: 1, signal});
        if (result.aborted) return {status: 'aborted'};
        if (!result.complete) return {status: 'fetch-failed', date: pending[0]};
    }
    return {status: signal?.aborted ? 'aborted' : 'day-changed'};
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
