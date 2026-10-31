import {FINANCIAL_VERSION_POLICY,captureFinancialVersionEvidenceBundle,verifyFinancialVersionContext,type FinancialVersionOptions,type FinancialVersionRuntimeBinding} from '../financial-version-selection';
import { createHash } from "node:crypto";
import { DedicatedSqliteDatabase } from "./dedicated-sqlite";
import { ObservedFinancialArchive, normalizeArchivedFinancialSnapshotOptions, financialArchiveExtractionProvenance, type ArchivedFinancialSnapshotOptions, type ArchivedFinancialSnapshots } from "./observed-financial-archive";
import { FinancialSearchIndex, FINANCIAL_SEARCH_INDEX_VERSION, isFinancialIndexGenerationId, normalizeFinancialIndexPopulation, financialIndexBuildPartId, financialIndexGenerationSha256, type FinancialIndexPopulation, type FinancialIndexGeneration } from "./financial-search-index";
export const FINANCIAL_INDEX_BUILD_VERSION = "1";
export interface FinancialIndexBuildInput {
    id: string;
    generation: string;
    archiveSha256: string;
    population: FinancialIndexPopulation;
    options: Omit<ArchivedFinancialSnapshotOptions, "edinetCodes"> & {financialVersion?:FinancialVersionOptions & {proofSha256:string}};
}
export interface FinancialIndexBuildPlan extends FinancialIndexBuildInput {
    buildVersion: typeof FINANCIAL_INDEX_BUILD_VERSION;
    indexVersion: "1"|"2";
    provenance: Omit<ArchivedFinancialSnapshots["provenance"], "edinetCodes"> & {financialVersion?:FinancialVersionOptions & {proofSha256:string}};
}
export interface FinancialIndexBuildTask {
    edinetCode: string;
    partID: string;
    status: "pending" | "failed" | "complete";
    attempts: number;
    partSha256?: string;
    rowCount?: number;
    selectedDocuments?: number;
    unavailableSources?: number;
    unresolvedRecords?: number;
    unavailableGroups?: number;
    lastErrorCode?: "company-materialization-failed";
}
export interface FinancialIndexBuildProgress {
    plan: FinancialIndexBuildPlan;
    planSha256: string;
    tasks: FinancialIndexBuildTask[];
    pending: number;
    failed: number;
    completed: number;
    companiesWithRows: number;
    rowCount: number;
    finished: boolean;
    generationSha256?: string;
}
const schema = {
    financial_build_format: "CREATE TABLE financial_build_format(kind TEXT NOT NULL)",
    financial_build_plans: "CREATE TABLE financial_build_plans(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
    financial_build_tasks: "CREATE TABLE financial_build_tasks(build TEXT NOT NULL,edinet_code TEXT NOT NULL,status TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL,PRIMARY KEY(build,edinet_code))",
    financial_build_task_status: "CREATE INDEX financial_build_task_status ON financial_build_tasks(build,status,edinet_code)",
    financial_build_completions: "CREATE TABLE financial_build_completions(build TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)"
};
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = (v: string) => createHash("sha256").update(v).digest("hex"), sha = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
function flat(v: unknown, keys: readonly string[]): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
    throw new Error("未知または不正な世代構築入力です"); return Object.fromEntries(Object.keys(v).map(k => [k, (v as Record<string, unknown>)[k]])); }
function buildExtractionOptions(input:FinancialIndexBuildInput['options']){
    const o=flat(input,['cutoff','extractorVersion','sourceCommit','detailMetricIds','financialVersion']);
    const {financialVersion,...ordinary}=o,q=normalizeArchivedFinancialSnapshotOptions(ordinary as unknown as ArchivedFinancialSnapshotOptions),{edinetCodes:_codes,...base}=q;
    if(financialVersion===undefined)return base;
    const fv=flat(financialVersion,['policy','evidenceManifestSha256','proofSha256']);
    if(fv.policy!==FINANCIAL_VERSION_POLICY||!sha(fv.evidenceManifestSha256)||!sha(fv.proofSha256))throw Error('金融版のpolicy・証拠・proof指紋が必要です');
    return {...base,financialVersion:{policy:FINANCIAL_VERSION_POLICY,evidenceManifestSha256:fv.evidenceManifestSha256,proofSha256:fv.proofSha256}};
}
function buildExtractionProvenance(input:FinancialIndexBuildInput['options']):FinancialIndexBuildPlan['provenance']{
    const {financialVersion,...ordinary}=input,{edinetCodes:_scope,...base}=financialArchiveExtractionProvenance(ordinary);
    return {...base,...financialVersion?{financialVersion}:{}};
}
export function normalizeFinancialIndexBuildInput(input: FinancialIndexBuildInput): FinancialIndexBuildPlan {
    const p = flat(input, ["id", "generation", "archiveSha256", "population", "options"]), options=buildExtractionOptions(p.options as FinancialIndexBuildInput['options']);
    if (!isFinancialIndexGenerationId(p.id) || !isFinancialIndexGenerationId(p.generation) || !sha(p.archiveSha256))
        throw new Error("構築ID・集約世代ID・原本指紋が不正です");
    const provenance=buildExtractionProvenance(options);
    return { id: p.id, generation: p.generation, archiveSha256: p.archiveSha256, population: normalizeFinancialIndexPopulation(p.population as FinancialIndexPopulation, options.cutoff), options, buildVersion: FINANCIAL_INDEX_BUILD_VERSION, indexVersion: 'financialVersion' in options?'2':FINANCIAL_SEARCH_INDEX_VERSION, provenance };
}
/** 全母集団の会社別世代をcheckpointし、揃った場合だけ一つのSQL検索世代へ集約します。 */
export class FinancialIndexBuild extends DedicatedSqliteDatabase {
    constructor(file: string, options: {
        readOnly?: boolean;
    } = {}) { super(file, options, { table: "financial_build_format", kind: "edinet-ts-financial-index-build-v1", schema }); }
    begin(input: FinancialIndexBuildInput): FinancialIndexBuildProgress {
        const plan = normalizeFinancialIndexBuildInput(input), body = canonical(plan), planSha256 = hash(body);
        this.transaction(() => {
            const old = this.rows("SELECT * FROM financial_build_plans WHERE id=?", [plan.id]);
            if (old.length) {
                this.readProgress(plan.id);
                if (old[0].body !== body)
                    throw new Error("同じ構築IDの計画は変更できません");
                return;
            }
            this.run("INSERT INTO financial_build_plans VALUES(?,?,?)", [plan.id, body, planSha256]);
            for (const code of plan.population.edinetCodes)
                this.writeTask(plan.id, { edinetCode: code, partID: financialIndexBuildPartId(planSha256, code), status: "pending", attempts: 0 }, true);
        });
        return this.progress(plan.id);
    }
    private writeTask(build: string, task: FinancialIndexBuildTask, insert = false) { const body = canonical(task), digest = hash(canonical([build, task.edinetCode, task.status, body])); if (insert)
        this.run("INSERT INTO financial_build_tasks VALUES(?,?,?,?,?)", [build, task.edinetCode, task.status, body, digest]);
    else
        this.run("UPDATE financial_build_tasks SET status=?,body=?,sha256=? WHERE build=? AND edinet_code=?", [task.status, body, digest, build, task.edinetCode]); }
    private decodeTask(row: Record<string, unknown>, id: string, planSha256: string, codes: ReadonlySet<string>): FinancialIndexBuildTask {
        if (typeof row.body !== "string" || hash(canonical([id, row.edinet_code, row.status, row.body])) !== row.sha256)
            throw new Error("会社checkpointのhashが不一致です");
        const task = JSON.parse(row.body) as FinancialIndexBuildTask;
        if (task.edinetCode !== row.edinet_code || task.status !== row.status || !codes.has(task.edinetCode) || task.partID !== financialIndexBuildPartId(planSha256, task.edinetCode) || !Number.isSafeInteger(task.attempts) || task.attempts < 0 || !["pending", "failed", "complete"].includes(task.status) || task.status === "complete" && (!sha(task.partSha256) || ![task.rowCount, task.selectedDocuments, task.unavailableSources, task.unresolvedRecords, task.unavailableGroups].every(n => Number.isSafeInteger(n) && n! >= 0)))
            throw new Error("会社checkpointが不整合です");
        return task;
    }
    private readProgress(id: string): FinancialIndexBuildProgress {
        if (!isFinancialIndexGenerationId(id))
            throw new Error("構築IDが不正です");
        const stored = this.rows("SELECT * FROM financial_build_plans WHERE id=?", [id])[0];
        if (!stored || typeof stored.body !== "string" || hash(stored.body) !== stored.sha256)
            throw new Error("構築計画が未収録またはhash不一致です");
        const plan = JSON.parse(stored.body) as FinancialIndexBuildPlan;
        if (plan.id !== id || plan.buildVersion !== FINANCIAL_INDEX_BUILD_VERSION || !['1','2'].includes(plan.indexVersion))
            throw new Error("構築計画の版が非対応です");
        if((plan.indexVersion==='2')!==(plan.options.financialVersion!==undefined))throw Error('構築計画の金融版modeが不一致です');
        if(plan.options.financialVersion){const normalized=buildExtractionOptions(plan.options);if(canonical(normalized)!==canonical(plan.options)||canonical(plan.options.financialVersion)!==canonical(plan.provenance.financialVersion))throw Error('構築計画の金融版指紋が不一致です')}
        const codes = new Set(plan.population.edinetCodes), rows = this.rows("SELECT * FROM financial_build_tasks WHERE build=? ORDER BY edinet_code", [id]);
        if (rows.length !== codes.size)
            throw new Error("構築計画の会社件数が不整合です");
        const tasks = rows.map(row => this.decodeTask(row, id, String(stored.sha256), codes));
        const done = tasks.filter(t => t.status === "complete"), completion = this.rows("SELECT * FROM financial_build_completions WHERE build=?", [id])[0];
        let generationSha256: string | undefined;
        if (completion) {
            if (typeof completion.body !== "string" || hash(canonical([id, completion.body])) !== completion.sha256)
                throw new Error("構築完了証跡のhashが不一致です");
            const c = JSON.parse(completion.body);
            if (c.id !== id || c.generation !== plan.generation || c.planSha256 !== stored.sha256 || !sha(c.generationSha256) || done.length !== tasks.length)
                throw new Error("構築完了証跡が不整合です");
            generationSha256 = c.generationSha256;
        }
        return { plan, planSha256: String(stored.sha256), tasks, pending: tasks.filter(t => t.status === "pending").length, failed: tasks.filter(t => t.status === "failed").length, completed: done.length, companiesWithRows: done.filter(t => t.rowCount! > 0).length, rowCount: done.reduce((n, t) => n + t.rowCount!, 0), finished: !!completion, ...(generationSha256 ? { generationSha256 } : {}) };
    }
    progress(id: string): FinancialIndexBuildProgress { return this.transaction(() => this.readProgress(id), false); }
    runNext(id: string, archive: ObservedFinancialArchive, index: FinancialSearchIndex, options: {
        limit?: number;
        financialVersion?:FinancialVersionRuntimeBinding;
    } = {}): FinancialIndexBuildProgress {
        if (this.closed || this.readOnly)
            throw new Error("close済み/readOnlyの構築状態です");
        if (!(archive instanceof ObservedFinancialArchive) || !(index instanceof FinancialSearchIndex))
            throw new Error("原本アーカイブと財務索引が必要です");
        const o = flat(options, ["limit","financialVersion"]), limit = o.limit ?? 20;
        if (typeof limit !== "number" || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new Error("一回の会社処理は1〜100件です");
        const before = this.progress(id), plan = before.plan,current=buildExtractionProvenance(plan.options);
        const financialVersion=plan.options.financialVersion;
        let binding=o.financialVersion as FinancialVersionRuntimeBinding|undefined;
        if(financialVersion){
            if(!binding||typeof binding!=='object'||Array.isArray(binding)||Object.keys(binding).some(k=>!['context','bundle'].includes(k)))throw Error('金融版の原本再認証contextが必要です');
            binding={context:binding.context,bundle:captureFinancialVersionEvidenceBundle(binding.bundle)};
            const proof=verifyFinancialVersionContext(binding.context,binding.bundle);
            if(proof.policy!==financialVersion.policy||proof.evidenceManifestSha256!==financialVersion.evidenceManifestSha256||proof.sha256!==financialVersion.proofSha256||proof.cutoff!==plan.options.cutoff)throw Error('金融版のruntime証拠が構築計画と不一致です');
        }else if(binding!==undefined)throw Error('通常の構築計画へ金融版contextは渡せません');
        if (canonical(current) !== canonical(plan.provenance))
            throw new Error("抽出/対応表版が計画時と異なります。新しい計画が必要です");
        if (archive.snapshotSha256() !== plan.archiveSha256)
            throw new Error("原本アーカイブの指紋が計画と異なります");
        if (before.finished)
            return before;
        const plannedCodes = new Set(plan.population.edinetCodes);
        const pending = this.rows("SELECT edinet_code FROM financial_build_tasks WHERE build=? AND status='pending' ORDER BY edinet_code LIMIT ?", [id, limit]), failed = this.rows("SELECT edinet_code FROM financial_build_tasks WHERE build=? AND status='failed' ORDER BY edinet_code LIMIT ?", [id, limit - pending.length]), chosen = [...new Set([...pending, ...failed].map(r => String(r.edinet_code)))];
        for (const candidate of chosen)
            this.transaction(() => {
                const row = this.rows("SELECT * FROM financial_build_tasks WHERE build=? AND edinet_code=?", [id, candidate])[0];
                if (!row)
                    throw new Error("会社checkpointがありません");
                const task = this.decodeTask(row, id, before.planSha256, plannedCodes);
                if (task.status === "complete")
                    return;
                const attempt = task.attempts + 1;
                if (!Number.isSafeInteger(attempt))
                    throw new Error("試行回数の上限です");
                try {
                    const {financialVersion:_fv,...ordinaryOptions}=plan.options;
                    const report = financialVersion?index.materializeSourceBacked(task.partID,archive,{...ordinaryOptions,edinetCodes:[task.edinetCode],financialVersion:{policy:financialVersion.policy,evidenceManifestSha256:financialVersion.evidenceManifestSha256}},binding!):index.materialize(task.partID, archive, { ...ordinaryOptions, edinetCodes: [task.edinetCode] });
                    const {edinetCodes:scope,...provenance}=report.provenance;
                    if(report.indexVersion!==plan.indexVersion||canonical(provenance)!==canonical(plan.provenance)||canonical(scope)!==canonical([task.edinetCode]))throw Error('会社別世代の金融版契約が構築計画と不一致です');
                    this.writeTask(id, { edinetCode: task.edinetCode, partID: task.partID, status: "complete", attempts: attempt, partSha256: financialIndexGenerationSha256(report), rowCount: report.rows.length, selectedDocuments: report.selection.selected.filter(s => s.observation.document.edinetCode === task.edinetCode).length, unavailableSources: report.unavailableSources.length, unresolvedRecords: report.unresolvedRecords.length, unavailableGroups: report.unavailableGroups.length });
                }
                catch {
                    this.writeTask(id, { edinetCode: task.edinetCode, partID: task.partID, status: "failed", attempts: attempt, lastErrorCode: "company-materialization-failed" });
                }
            });
        return this.progress(id);
    }
    finish(id: string, index: FinancialSearchIndex): FinancialIndexGeneration {
        if (!(index instanceof FinancialSearchIndex))
            throw new Error("財務索引が必要です");
        return this.transaction(() => {
            const state = this.readProgress(id), plan = state.plan;
            if (state.pending || state.failed)
                throw new Error("会社別世代が全件完了していません");
            for (const task of state.tasks) {
                const report = index.generation(task.partID), { edinetCodes, ...p } = report.provenance;
                if (report.indexVersion!==plan.indexVersion || financialIndexGenerationSha256(report) !== task.partSha256 || canonical(p) !== canonical(plan.provenance) || report.selection.cutoff !== plan.options.cutoff || canonical(edinetCodes) !== canonical([task.edinetCode]))
                    throw new Error("完了checkpointと会社別世代が一致しません");
            }
            const report = index.combine(plan.generation, state.tasks.map(t => t.partID), { planSha256: state.planSha256, archiveSha256: plan.archiveSha256, population: plan.population }), generationSha256 = financialIndexGenerationSha256(report);
            if (state.generationSha256 && state.generationSha256 !== generationSha256)
                throw new Error("完了世代の内容が変わっています");
            const body = canonical({ id, generation: plan.generation, planSha256: state.planSha256, generationSha256 });
            if (!state.finished)
                this.run("INSERT INTO financial_build_completions VALUES(?,?,?)", [id, body, hash(canonical([id, body]))]);
            return report;
        });
    }
}
