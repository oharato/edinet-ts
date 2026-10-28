import { createHash } from "node:crypto";
import { DedicatedSqliteDatabase } from "./dedicated-sqlite";
import { ObservedFinancialArchive, type FinancialSourceAcquisitionItem } from "./observed-financial-archive";
import { normalizeFinancialIndexPopulation, isFinancialIndexGenerationId, type FinancialIndexPopulation } from "./financial-search-index";
import { parseDocumentTimestamp as timestamp } from "../document-timestamp";
export const FINANCIAL_SOURCE_JOB_VERSION = "1";
export interface FinancialSourceJobInput {
    id: string;
    cutoff: string;
    population: FinancialIndexPopulation;
}
export interface FinancialSourceJobPlan extends FinancialSourceJobInput {
    jobVersion: typeof FINANCIAL_SOURCE_JOB_VERSION;
    archiveSha256: string;
    observationsSha256: string;
    documents: FinancialSourceAcquisitionItem[];
    selectionCounts: {
        selected: number;
        unavailable: number;
        unresolved: number;
    };
}
export interface FinancialSourceJobTask {
    docID: string;
    status: "pending" | "running" | "failed" | "complete";
    attempts: number;
    sourceSha256?: string;
    availableAt?: string;
}
export interface FinancialSourceJobAttempt {
    docID: string;
    number: number;
    status: "started" | "complete" | "failed" | "interrupted";
    startedAt: string;
    endedAt?: string;
    outcome?: "downloaded" | "reused";
    errorCode?: "source-acquisition-failed" | "source-acquisition-interrupted";
}
export interface FinancialSourceJobProgress {
    plan: FinancialSourceJobPlan;
    planSha256: string;
    tasks: FinancialSourceJobTask[];
    history: FinancialSourceJobAttempt[];
    pending: number;
    running: number;
    failed: number;
    completed: number;
    finished: boolean;
}
const schema = {
    source_job_format: "CREATE TABLE source_job_format(kind TEXT NOT NULL)",
    source_job_plans: "CREATE TABLE source_job_plans(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
    source_job_tasks: "CREATE TABLE source_job_tasks(job TEXT NOT NULL,doc_id TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(job,doc_id))",
    source_job_task_status: "CREATE INDEX source_job_task_status ON source_job_tasks(job,status,doc_id)",
    source_job_attempts: "CREATE TABLE source_job_attempts(job TEXT NOT NULL,doc_id TEXT NOT NULL,number INTEGER NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(job,doc_id,number))"
};
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
const sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
export function normalizeFinancialSourceJobInput(input: FinancialSourceJobInput): FinancialSourceJobInput {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(k => !["id", "cutoff", "population"].includes(k)) || !isFinancialIndexGenerationId(input.id) || timestamp(input.cutoff, true) === undefined)
        throw new Error("取得jobのID・cutoff・母集団が不正です");
    return { id: input.id, cutoff: input.cutoff, population: normalizeFinancialIndexPopulation(input.population, input.cutoff) };
}
/** 固定母集団/一覧の取得job。原本commitと状態commitの間の停止も再開します。 */
export class FinancialSourceJob extends DedicatedSqliteDatabase {
    private working = false;
    constructor(file: string, options: {
        readOnly?: boolean;
    } = {}) { super(file, options, { table: "source_job_format", kind: "edinet-ts-financial-source-job-v1", schema }); }
    override close() { if (this.working)
        throw new Error("取得jobの実行終了後にcloseしてください"); super.close(); }
    begin(input: FinancialSourceJobInput, archive: ObservedFinancialArchive): FinancialSourceJobProgress {
        if (this.working)
            throw new Error("取得jobは実行中です");
        const fixed = normalizeFinancialSourceJobInput(input), archiveSha256 = archive.snapshotSha256(), observationsSha256 = archive.observationsSha256();
        return this.transaction(() => {
            const old = this.rows("SELECT * FROM source_job_plans WHERE id=?", [fixed.id]);
            if (old.length) {
                const p = this.readProgress(fixed.id);
                if (canonical(normalizeFinancialSourceJobInput({ id: p.plan.id, cutoff: p.plan.cutoff, population: p.plan.population })) !== canonical(fixed) || p.plan.archiveSha256 !== archiveSha256 || p.plan.observationsSha256 !== observationsSha256)
                    throw new Error("同じ取得jobの計画は変更できません");
                return p;
            }
            const documents: FinancialSourceAcquisitionItem[] = [], decisions = new Map<string, string>(), selectionCounts = { selected: 0, unavailable: 0, unresolved: 0 };
            const seen = new Set<string>();
            for (let i = 0; i < fixed.population.edinetCodes.length; i++) {
                const codes = [fixed.population.edinetCodes[i]], batch = archive.planSourceAcquisition({ cutoff: fixed.cutoff, edinetCodes: codes });
                for (const item of batch.items) {
                    if (seen.has(item.docID))
                        throw new Error("取得書類が重複しています");
                    seen.add(item.docID);
                    documents.push(item);
                }
                for (const d of batch.selection.decisions) {
                    const body = canonical(d), previous = decisions.get(d.rootDocID);
                    if (previous !== undefined && previous !== body)
                        throw new Error("会社別の書類選択が一致しません");
                    if (previous === undefined) {
                        decisions.set(d.rootDocID, body);
                        selectionCounts[d.status]++;
                    }
                }
            }
            if (documents.length > 100000)
                throw new Error("一計画の書類上限は100,000です");
            documents.sort((a, b) => a.docID < b.docID ? -1 : a.docID > b.docID ? 1 : 0);
            const plan: FinancialSourceJobPlan = { ...fixed, jobVersion: FINANCIAL_SOURCE_JOB_VERSION, archiveSha256, observationsSha256, documents, selectionCounts }, body = canonical(plan);
            this.run("INSERT INTO source_job_plans VALUES(?,?,?)", [plan.id, body, hash(body)]);
            for (const d of documents)
                this.writeTask(plan.id, { docID: d.docID, status: d.status === "stored" ? "complete" : "pending", attempts: 0, ...(d.status === "stored" ? { sourceSha256: d.sourceSha256, availableAt: d.availableAt } : {}) }, true);
            return this.readProgress(plan.id);
        });
    }
    private writeTask(id: string, task: FinancialSourceJobTask, insert = false) {
        const body = canonical(task), digest = hash(canonical([id, task.docID, task.status, body]));
        if (insert)
            this.run("INSERT INTO source_job_tasks VALUES(?,?,?,?,?)", [id, task.docID, task.status, body, digest]);
        else
            this.run("UPDATE source_job_tasks SET status=?,body=?,sha256=? WHERE job=? AND doc_id=?", [task.status, body, digest, id, task.docID]);
    }
    private writeAttempt(id: string, a: FinancialSourceJobAttempt, insert = false) {
        const body = canonical(a), digest = hash(canonical([id, a.docID, a.number, a.status, body]));
        if (insert)
            this.run("INSERT INTO source_job_attempts VALUES(?,?,?,?,?,?)", [id, a.docID, a.number, a.status, body, digest]);
        else
            this.run("UPDATE source_job_attempts SET status=?,body=?,sha256=? WHERE job=? AND doc_id=? AND number=?", [a.status, body, digest, id, a.docID, a.number]);
    }
    private decode(row: Record<string, unknown>, id: string, attempt = false) {
        if (typeof row.body !== "string" || hash(canonical(attempt ? [id, row.doc_id, row.number, row.status, row.body] : [id, row.doc_id, row.status, row.body])) !== row.sha256)
            throw new Error("取得checkpointのhashが不一致です");
        const value = JSON.parse(row.body);
        if (value.docID !== row.doc_id || value.status !== row.status || attempt && value.number !== row.number)
            throw new Error("取得checkpointの索引が不整合です");
        return value;
    }
    private readProgress(id: string): FinancialSourceJobProgress {
        if (!isFinancialIndexGenerationId(id))
            throw new Error("取得job IDが不正です");
        const row = this.rows("SELECT * FROM source_job_plans WHERE id=?", [id])[0];
        if (!row || typeof row.body !== "string" || hash(row.body) !== row.sha256)
            throw new Error("取得計画が未保存またはhash不一致です");
        const plan = JSON.parse(row.body) as FinancialSourceJobPlan;
        normalizeFinancialSourceJobInput({ id: plan.id, cutoff: plan.cutoff, population: plan.population });
        if (plan.id !== id || plan.jobVersion !== FINANCIAL_SOURCE_JOB_VERSION || !sha(plan.archiveSha256) || !sha(plan.observationsSha256) || !Array.isArray(plan.documents) || plan.documents.length > 100000)
            throw new Error("取得計画が不整合です");
        const targets = new Map(plan.documents.map(d => [d.docID, d])), codes = new Set(plan.population.edinetCodes);
        if (targets.size !== plan.documents.length || plan.documents.some(d => typeof d.docID !== "string" || !d.docID || !codes.has(d.edinetCode) || !["missing", "declaration-only", "conflicting", "stored"].includes(d.status)))
            throw new Error("取得対象が不整合です");
        const tasks = this.rows("SELECT * FROM source_job_tasks WHERE job=? ORDER BY doc_id", [id]).map(r => this.decode(r, id) as FinancialSourceJobTask), history = this.rows("SELECT * FROM source_job_attempts WHERE job=? ORDER BY doc_id,number", [id]).map(r => this.decode(r, id, true) as FinancialSourceJobAttempt);
        if (tasks.length !== targets.size)
            throw new Error("取得対象のcheckpointが不足しています");
        const byDocument = new Map<string, FinancialSourceJobAttempt[]>();
        for (const attempt of history) {
            const list = byDocument.get(attempt.docID) ?? [];
            list.push(attempt);
            byDocument.set(attempt.docID, list);
        }
        const counts = { pending: 0, running: 0, failed: 0, completed: 0 };
        for (const task of tasks) {
            if (!targets.has(task.docID) || !Number.isSafeInteger(task.attempts) || task.attempts < 0 || !["pending", "running", "failed", "complete"].includes(task.status) || task.status === "complete" && (!sha(task.sourceSha256) || timestamp(task.availableAt, true) === undefined))
                throw new Error("取得taskが不整合です");
            const attempts = byDocument.get(task.docID) ?? [];
            if (attempts.length !== task.attempts || attempts.some((a, i) => a.number !== i + 1 || timestamp(a.startedAt, true) === undefined || !["started", "complete", "failed", "interrupted"].includes(a.status) || a.status !== "started" && (timestamp(a.endedAt, true) === undefined || timestamp(a.endedAt, true)! < timestamp(a.startedAt, true)!) || a.status === "started" && (i !== attempts.length - 1 || task.status !== "running")))
                throw new Error("取得試行履歴が不整合です");
            if (attempts.some(a => a.status === 'started' && (a.endedAt !== undefined || a.outcome !== undefined || a.errorCode !== undefined) || a.status === 'complete' && (!['downloaded', 'reused'].includes(a.outcome ?? '') || a.errorCode !== undefined) || a.status === 'failed' && (a.errorCode !== 'source-acquisition-failed' || a.outcome !== undefined) || a.status === 'interrupted' && (a.errorCode !== 'source-acquisition-interrupted' || a.outcome !== undefined)))
                throw new Error("試行結果が不整合です");
            const last = attempts.at(-1);
            if (task.status === "running" && last?.status !== "started" || task.status === "failed" && !['failed', 'interrupted'].includes(last?.status ?? '') || task.status === "pending" && task.attempts !== 0 || task.status === "complete" && task.attempts > 0 && last?.status !== "complete" || task.status === "complete" && task.attempts === 0 && targets.get(task.docID)!.status !== "stored")
                throw new Error("取得taskと履歴が一致しません");
            if (task.status === 'complete')
                counts.completed++;
            else
                counts[task.status]++;
        }
        if (history.some(a => !targets.has(a.docID)))
            throw new Error("対象外の試行履歴があります");
        return { plan, planSha256: String(row.sha256), tasks, history, ...counts, finished: counts.completed === tasks.length };
    }
    progress(id: string): FinancialSourceJobProgress {
        if (this.working)
            throw new Error("同じ接続の取得jobは実行中です");
        return this.transaction(() => this.readProgress(id), false);
    }
    private auditCompleted(progress: FinancialSourceJobProgress, archive: ObservedFinancialArchive) {
        if (archive.observationsSha256() !== progress.plan.observationsSha256)
            throw new Error("一覧観測の指紋が計画と異なります");
        const targets = new Map(progress.plan.documents.map(d => [d.docID, d])), groups = new Map<string, FinancialSourceJobTask[]>();
        for (const task of progress.tasks.filter(t => t.status === 'complete')) {
            const code = targets.get(task.docID)!.edinetCode, list = groups.get(code) ?? [];
            list.push(task);
            groups.set(code, list);
        }
        for (const [code, tasks] of groups) {
            const inventory = new Map(archive.planSourceAcquisition({ cutoff: progress.plan.cutoff, edinetCodes: [code] }).items.map(d => [d.docID, d]));
            for (const task of tasks) {
                const item = inventory.get(task.docID);
                if (item?.status !== 'stored' || item.sourceSha256 !== task.sourceSha256 || item.availableAt !== task.availableAt)
                    throw new Error("完了checkpointと保存原本が一致しません");
            }
        }
    }
    /** 停止したreadOnly原本を再検査し、後続の固定世代構築に使える指紋を返します。 */
    finish(id: string, archive: ObservedFinancialArchive): {
        planSha256: string;
        archiveSha256: string;
        selectionCutoff: string;
        population: FinancialIndexPopulation;
        documents: number;
    } {
        const progress = this.progress(id);
        if (!progress.finished)
            throw new Error("原本取得は全件完了していません");
        const archiveSha256 = archive.snapshotSha256();
        this.auditCompleted(progress, archive);
        return { planSha256: progress.planSha256, archiveSha256, selectionCutoff: progress.plan.cutoff, population: progress.plan.population, documents: progress.completed };
    }
    async runNext(id: string, archive: ObservedFinancialArchive, fetchXbrl: (docID: string, request: {
        signal?: AbortSignal;
    }) => Promise<string>, options: {
        limit?: number;
        signal?: AbortSignal;
    } = {}): Promise<FinancialSourceJobProgress & {
        aborted: boolean;
    }> {
        if (this.working || this.closed || this.readOnly)
            throw new Error("取得jobは実行中/close済み/readOnlyです");
        if (!(archive instanceof ObservedFinancialArchive) || typeof fetchXbrl !== "function" || !options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["limit", "signal"].includes(k)))
            throw new Error("取得関数とbatch条件が不正です");
        const { limit = 20, signal } = options;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || signal !== undefined && !(signal instanceof AbortSignal))
            throw new Error("取得件数は1〜100、signalはAbortSignalです");
        const before = this.progress(id), plan = before.plan;
        this.auditCompleted(before, archive);
        archive.append([], []);
        this.working = true;
        try {
            const chosen = before.tasks.filter(t => t.status !== 'complete').sort((a, b) => (a.status === 'pending' ? 0 : 1) - (b.status === 'pending' ? 0 : 1) || a.attempts - b.attempts || (a.docID < b.docID ? -1 : 1)).slice(0, limit);
            for (const candidate of chosen) {
                if (signal?.aborted)
                    break;
                const attempt = this.transaction(() => {
                    const task = this.decode(this.rows("SELECT * FROM source_job_tasks WHERE job=? AND doc_id=?", [id, candidate.docID])[0], id) as FinancialSourceJobTask;
                    if (task.status === 'complete')
                        return undefined;
                    const now = new Date().toISOString();
                    if (task.status === 'running') {
                        const old = this.decode(this.rows("SELECT * FROM source_job_attempts WHERE job=? AND doc_id=? AND number=?", [id, task.docID, task.attempts])[0], id, true) as FinancialSourceJobAttempt;
                        this.writeAttempt(id, { ...old, status: 'interrupted', endedAt: now, errorCode: 'source-acquisition-interrupted' });
                    }
                    const number = task.attempts + 1;
                    if (!Number.isSafeInteger(number))
                        throw new Error("試行数の上限です");
                    const a: FinancialSourceJobAttempt = { docID: task.docID, number, status: 'started', startedAt: now };
                    this.writeAttempt(id, a, true);
                    this.writeTask(id, { docID: task.docID, status: 'running', attempts: number });
                    return a;
                });
                if (!attempt)
                    continue;
                await this.transactionAsync(async () => {
                    const current = this.decode(this.rows("SELECT * FROM source_job_tasks WHERE job=? AND doc_id=?", [id, attempt.docID])[0], id) as FinancialSourceJobTask;
                    if (current.status !== 'running' || current.attempts !== attempt.number)
                        return;
                    const target = plan.documents.find(d => d.docID === attempt.docID)!;
                    if (archive.observationsSha256() !== plan.observationsSha256)
                        throw new Error("一覧観測の指紋が計画と異なります");
                    const status = archive.planSourceAcquisition({ cutoff: plan.cutoff, edinetCodes: [target.edinetCode] }).items.find(i => i.docID === target.docID && i.rootDocID === target.rootDocID);
                    if (!status)
                        throw new Error("取得対象の選択が変わっています");
                    let source: {
                        sourceSha256?: string;
                        availableAt?: string;
                    } = status, outcome: FinancialSourceJobAttempt['outcome'] = 'reused', failure: FinancialSourceJobAttempt['errorCode'];
                    try {
                        if (signal?.aborted)
                            throw new Error();
                        if (status.status !== 'stored') {
                            const xml = await fetchXbrl(target.docID, { signal });
                            if (signal?.aborted)
                                throw new Error();
                            if (archive.observationsSha256() !== plan.observationsSha256)
                                throw new Error();
                            source = archive.appendAcquiredSource(target.docID, xml);
                            outcome = 'downloaded';
                        }
                    }
                    catch {
                        failure = signal?.aborted ? 'source-acquisition-interrupted' : 'source-acquisition-failed';
                    }
                    if (failure) {
                        this.writeAttempt(id, { ...attempt, status: failure === 'source-acquisition-interrupted' ? 'interrupted' : 'failed', endedAt: new Date().toISOString(), errorCode: failure });
                        this.writeTask(id, { docID: target.docID, status: 'failed', attempts: attempt.number });
                    }
                    else {
                        this.writeAttempt(id, { ...attempt, status: 'complete', endedAt: new Date().toISOString(), outcome });
                        this.writeTask(id, { docID: target.docID, status: 'complete', attempts: attempt.number, sourceSha256: source.sourceSha256, availableAt: source.availableAt });
                    }
                });
            }
            return { ...this.transaction(() => this.readProgress(id), false), aborted: signal?.aborted ?? false };
        }
        finally {
            this.working = false;
        }
    }
}
