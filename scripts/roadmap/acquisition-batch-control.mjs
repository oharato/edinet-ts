import {setImmediate as yieldTurn} from "node:timers/promises";

export const ACQUISITION_RESERVE_BYTES = 32n * 1024n ** 3n;
export const ACQUISITION_MARGIN_BYTES = 2n * 1024n ** 3n;

/** SDKと同じ順序のprefixに限り、3試行済みを追加取得しません。 */
export function selectSourceBatch(tasks, stalled) {
    if (!Number.isSafeInteger(stalled) || stalled < 0 || stalled >= 5) throw Error('Invalid stalled batch count');
    return tasks.filter(t => !['complete', 'unavailable'].includes(t.status) && t.attempts < 3)
        .sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || a.attempts - b.attempts || (a.docID < b.docID ? -1 : a.docID > b.docID ? 1 : 0))
        .slice(0, Math.min(100, (5 - stalled) * 20));
}

/** 取得をまとめても従来の20件単位の停止判定を保持します。 */
export function countStalledBatches(selected, afterTasks, stalled) {
    const byId = new Map(afterTasks.map(t => [t.docID, t]));
    for (let i = 0; i < selected.length; i += 20) {
        const group = selected.slice(i, i + 20).map(before => {
            const after = byId.get(before.docID);
            if (!after || after.attempts < before.attempts) throw Error('Acquisition checkpoint moved backwards');
            return {before, after};
        }).filter(({before, after}) => after.attempts > before.attempts || after.status === 'complete');
        if (!group.length) break;
        stalled = group.some(({after}) => after.status === 'complete') ? 0 : stalled + 1;
    }
    return stalled;
}

/** 大きなbatchでも、各本文の受信前後で32GiB+2GiBを確保します。 */
export function withSourceDiskReserve(fetchXbrl, free, controller, onLowSpace) {
    const check = () => {
        if (controller.signal.aborted) throw Error('Acquisition interrupted');
        if (free() < ACQUISITION_RESERVE_BYTES + ACQUISITION_MARGIN_BYTES) {
            controller.abort(); onLowSpace(); throw Error('Acquisition disk reserve');
        }
    };
    return async (docID, request) => {
        check();
        await yieldTurn(); check();
        const xml = await fetchXbrl(docID, request);
        await yieldTurn(); check();
        return xml;
    };
}

/** 起動順だけでなく、現在のunit PIDと新しいscriptの初期保存を確認します。 */
export function isSourceReady(summary, pid, expected, argv) {
    return Number.isSafeInteger(pid) && pid > 0 && summary?.pid === pid
        && summary.planSha256 === expected.planSha256
        && summary.executionScriptSha256 === expected.workerSha256
        && Array.isArray(argv) && argv.includes(expected.scriptPath);
}
