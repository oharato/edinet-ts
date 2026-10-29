import {createHash} from 'node:crypto';
import {setImmediate as yieldTurn} from 'node:timers/promises';

const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const time = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const object = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).every(key => fields.includes(key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && value.trim() === value;
const notice = d => String(d.withdrawalStatus) === '1' || String(d.docInfoEditStatus) === '1' || ['1', '3'].includes(String(d.disclosureStatus));
const key = o => createHash('sha256').update(JSON.stringify([o.listDate, o.document.docID, o.document.parentDocID ?? null,
    ...['withdrawalStatus', 'docInfoEditStatus', 'disclosureStatus'].map(k => String(o.document[k])),
    o.document.opeDateTime ?? null, o.document.submitDateTime ?? null])).digest('hex');

export function assertDailyNoticeState(state, repository) {
    const now = Date.now(), today = new Date(now + 9 * 3600000).toISOString().slice(0, 10);
    if (!object(state, ['afterSequence', 'seen', 'pending', 'unresolved'])
        || !Number.isSafeInteger(state.afterSequence) || state.afterSequence < 0 || state.afterSequence > repository.getLastObservationSequence()
        || !Array.isArray(state.seen) || state.seen.length > 100000
        || !Array.isArray(state.pending) || state.pending.length > 10000
        || !Array.isArray(state.unresolved) || state.unresolved.length > 10000) throw Error('Invalid daily notice checkpoint');
    for (const hash of state.seen) if (typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash)) throw Error('Invalid daily notice identity');
    for (const pending of state.pending) if (!object(pending, ['date', 'notBefore']) || !date(pending.date) || pending.date >= today
        || !time(pending.notBefore) || Date.parse(pending.notBefore) > now) throw Error('Invalid daily notice target');
    for (const sequence of state.unresolved) if (!Number.isSafeInteger(sequence) || sequence < 1 || sequence > state.afterSequence) throw Error('Invalid unresolved daily notice');
    if (new Set(state.seen).size !== state.seen.length || new Set(state.pending.map(p => p.date)).size !== state.pending.length
        || new Set(state.unresolved).size !== state.unresolved.length) throw Error('Duplicate daily notice checkpoint entry');
}

/** 原観測は変更せず、通知cursorと対象日の最低観測時刻を同じcheckpointへ保存します。 */
export async function scanDailyMetadataNotices(repository, state, save, {signal} = {}) {
    assertDailyNoticeState(state, repository);
    if (typeof save !== 'function') throw Error('Daily notice checkpoint writer is required');
    const throughSequence = repository.getLastObservationSequence(), seen = new Set(state.seen), pending = new Map(state.pending.map(p => [p.date, p.notBefore]));
    let readObservations = 0, newNotices = 0;
    const validate = o => {
        const today = new Date(Date.now() + 9 * 3600000).toISOString().slice(0, 10);
        if (!o || !date(o.listDate) || o.listDate >= today || !time(o.observedAt) || Date.parse(o.observedAt) > Date.now()
            || !id(o.document?.docID) || o.document.parentDocID != null && !id(o.document.parentDocID)) throw Error('Invalid stored daily notice observation');
    };
    const enqueue = o => {
        validate(o);
        const d = o.document, references = String(d.withdrawalStatus) === '1'
            ? (d.parentDocID ? [d.parentDocID] : []) : [...new Set([d.docID, ...(d.parentDocID ? [d.parentDocID] : [])])];
        const targets = new Set();
        for (const docID of references) {
            let cursor = 0;
            for (;;) {
                const rows = repository.getDocumentObservations({docID, afterSequence: cursor, limit: 1000});
                for (const original of rows) {
                    validate(original);
                    if (original.listDate < o.listDate) targets.add(original.listDate);
                }
                if (rows.length < 1000) break;
                cursor = rows.at(-1).sequence;
            }
        }
        for (const target of targets) if (!repository.hasCompleteListForDate(target, o.observedAt))
            pending.set(target, [pending.get(target) ?? o.observedAt, o.observedAt].sort()[1]);
        if (pending.size > 10000) throw Error('Daily notice target limit exceeded');
        return targets.size > 0;
    };
    if (state.afterSequence < throughSequence) {
        const unresolved = [];
        for (const sequence of state.unresolved) {
            if (signal?.aborted) return {complete: false, aborted: true, readObservations, newNotices};
            const o = repository.getDocumentObservations({afterSequence: sequence - 1, limit: 1})[0];
            if (o?.sequence !== sequence || !notice(o.document)) throw Error('Stored unresolved daily notice is missing');
            if (!enqueue(o)) unresolved.push(sequence);
        }
        state.unresolved = unresolved;
    }
    while (state.afterSequence < throughSequence && !signal?.aborted) {
        const rows = repository.getDocumentObservations({afterSequence: state.afterSequence, limit: 1000}).filter(o => o.sequence <= throughSequence);
        if (!rows.length) throw Error('Daily notice observation cursor is missing');
        for (const o of rows) {
            validate(o);
            if (!notice(o.document)) continue;
            const identity = key(o); if (seen.has(identity)) continue;
            seen.add(identity); state.seen.push(identity); newNotices++;
            if (state.seen.length > 100000) throw Error('Daily notice identity limit exceeded');
            if (!enqueue(o)) state.unresolved.push(o.sequence);
            if (state.unresolved.length > 10000) throw Error('Unresolved daily notice limit exceeded');
        }
        readObservations += rows.length;
        state.afterSequence = rows.at(-1).sequence;
        state.pending = [...pending].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([date, notBefore]) => ({date, notBefore}));
        await save(structuredClone(state));
        await yieldTurn();
    }
    return {complete: state.afterSequence === throughSequence, aborted: signal?.aborted ?? false, readObservations, newNotices};
}
