import { createHash } from 'node:crypto';
import { DedicatedSqliteDatabase } from './dedicated-sqlite';
import { FinancialSearchIndex, isFinancialIndexGenerationId, type FinancialIndexQuality } from './financial-search-index';
export const FINANCIAL_INDEX_PUBLICATION_VERSION = '1';
export interface FinancialIndexPublicationPolicy {
    minimumCompaniesWithUsableValues: number;
    maxUnavailableSources: number;
    maxUnresolvedSelections: number;
    maxUnavailableSelections: number;
    maxUnresolvedRecords: number;
    maxUnavailableGroups: number;
    maxDuplicateCohortIdentifiers: number;
    maxUnavailableValues: number;
}
export interface FinancialIndexPublicationCandidate {
    id: string;
    publicationVersion: typeof FINANCIAL_INDEX_PUBLICATION_VERSION;
    generation: string;
    generationSha256: string;
    archiveSha256: string;
    buildPlanSha256: string;
    quality: FinancialIndexQuality;
    qualitySha256: string;
    policy: FinancialIndexPublicationPolicy;
    eligible: boolean;
    violations: {
        condition: keyof FinancialIndexPublicationPolicy;
        actual: number;
        limit: number;
    }[];
}
export interface FinancialIndexPublicationTransition {
    sequence: number;
    previous: string | null;
    publication: string;
}
const schema = {
    publication_format: 'CREATE TABLE publication_format(kind TEXT NOT NULL)',
    publication_candidates: 'CREATE TABLE publication_candidates(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
    publication_history: 'CREATE TABLE publication_history(sequence INTEGER PRIMARY KEY,previous_id TEXT,publication_id TEXT NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)',
    publication_active: 'CREATE TABLE publication_active(singleton INTEGER PRIMARY KEY CHECK(singleton=1),publication_id TEXT NOT NULL,sequence INTEGER NOT NULL,sha256 TEXT NOT NULL)'
};
const canonical = (v: unknown): string => JSON.stringify(v, (_k, x) => x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
const hash = (v: string) => createHash('sha256').update(v).digest('hex');
const fields = ['minimumCompaniesWithUsableValues', 'maxUnavailableSources', 'maxUnresolvedSelections', 'maxUnavailableSelections', 'maxUnresolvedRecords', 'maxUnavailableGroups', 'maxDuplicateCohortIdentifiers', 'maxUnavailableValues'] as const;
function normalizePolicy(input: FinancialIndexPublicationPolicy): FinancialIndexPublicationPolicy {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).length !== fields.length || Object.keys(input).some(k => !fields.includes(k as never)))
        throw new Error('公開条件を全項目で指定してください');
    const policy = Object.fromEntries(fields.map(k => [k, input[k]])) as unknown as FinancialIndexPublicationPolicy;
    if (fields.some(k => !Number.isSafeInteger(policy[k]) || policy[k] < 0))
        throw new Error('公開条件は0以上の安全な整数です');
    return policy;
}
function violations(quality: FinancialIndexQuality, policy: FinancialIndexPublicationPolicy): FinancialIndexPublicationCandidate['violations'] {
    const actual: FinancialIndexPublicationPolicy = { minimumCompaniesWithUsableValues: quality.companiesWithUsableValues, maxUnavailableSources: quality.unavailableSources.reduce((n, r) => n + r.documents, 0), maxUnresolvedSelections: quality.selectionDecisions.unresolved, maxUnavailableSelections: quality.selectionDecisions.unavailable, maxUnresolvedRecords: quality.unresolvedRecords.reduce((n, r) => n + r.documents, 0), maxUnavailableGroups: quality.unavailableGroups.reduce((n, r) => n + r.documents, 0), maxDuplicateCohortIdentifiers: quality.cohorts.reduce((n, r) => n + r.duplicateCompanies + r.duplicateSecurityCodes, 0), maxUnavailableValues: quality.values.missing + quality.values.unsupported + quality.values.ambiguous + quality.values['unsafe-number'] };
    return fields.filter(k => k === 'minimumCompaniesWithUsableValues' ? actual[k] < policy[k] : actual[k] > policy[k]).map(condition => ({ condition, actual: actual[condition], limit: policy[condition] }));
}
/** 品質を固定した候補だけを明示切替。原本/索引の既存DB形式やサービスは変更しません。 */
export class FinancialIndexPublication extends DedicatedSqliteDatabase {
    constructor(file: string, options: {
        readOnly?: boolean;
    } = {}) { super(file, options, { table: 'publication_format', kind: 'edinet-ts-financial-index-publication-v1', schema }); }
    prepare(id: string, index: FinancialSearchIndex, generation: string, inputPolicy?: FinancialIndexPublicationPolicy): FinancialIndexPublicationCandidate {
        if (!isFinancialIndexGenerationId(id) || !(index instanceof FinancialSearchIndex))
            throw new Error('公開候補IDと財務索引が必要です');
        const quality = index.quality(generation), report = index.generation(generation);
        if (!report.assembly || quality.populationCompanies === undefined)
            throw new Error('全母集団を集約した固定世代が必要です');
        const policy = normalizePolicy(inputPolicy ?? { minimumCompaniesWithUsableValues: quality.populationCompanies, maxUnavailableSources: 0, maxUnresolvedSelections: 0, maxUnavailableSelections: 0, maxUnresolvedRecords: 0, maxUnavailableGroups: 0, maxDuplicateCohortIdentifiers: 0, maxUnavailableValues: 0 }), failed = violations(quality, policy);
        const candidate: FinancialIndexPublicationCandidate = { id, publicationVersion: FINANCIAL_INDEX_PUBLICATION_VERSION, generation, generationSha256: quality.generationSha256, archiveSha256: report.assembly.archiveSha256, buildPlanSha256: report.assembly.planSha256, quality, qualitySha256: hash(canonical(quality)), policy, eligible: failed.length === 0, violations: failed };
        return this.transaction(() => {
            const body = canonical(candidate), old = this.rows('SELECT * FROM publication_candidates WHERE id=?', [id]);
            if (old.length) {
                const previous = this.readCandidate(id);
                if (canonical(previous) !== body)
                    throw new Error('同じ候補IDの内容・公開条件は変更できません');
                return previous;
            }
            this.run('INSERT INTO publication_candidates VALUES(?,?,?)', [id, body, hash(canonical([id, body]))]);
            return candidate;
        });
    }
    private readCandidate(id: string): FinancialIndexPublicationCandidate {
        if (!isFinancialIndexGenerationId(id))
            throw new Error('公開候補IDが不正です');
        const row = this.rows('SELECT * FROM publication_candidates WHERE id=?', [id])[0];
        if (!row || typeof row.body !== 'string' || hash(canonical([id, row.body])) !== row.sha256)
            throw new Error('公開候補が未保存またはhash不一致です');
        const c = JSON.parse(row.body) as FinancialIndexPublicationCandidate;
        normalizePolicy(c.policy);
        if (c.id !== id || c.publicationVersion !== FINANCIAL_INDEX_PUBLICATION_VERSION || [c.generationSha256, c.archiveSha256, c.buildPlanSha256, c.qualitySha256].some(s => typeof s !== 'string' || !/^([a-f0-9]{64})$/.test(s)) || !isFinancialIndexGenerationId(c.generation) || c.quality.generation !== c.generation || c.quality.generationSha256 !== c.generationSha256 || hash(canonical(c.quality)) !== c.qualitySha256 || canonical(violations(c.quality, c.policy)) !== canonical(c.violations) || c.eligible !== (c.violations.length === 0))
            throw new Error('公開候補の品質/条件が不整合です');
        return c;
    }
    candidate(id: string): FinancialIndexPublicationCandidate { return this.transaction(() => this.readCandidate(id), false); }
    private readHistory(): FinancialIndexPublicationTransition[] {
        const history: FinancialIndexPublicationTransition[] = [], seen = new Set<string>();
        for (const row of this.rows('SELECT * FROM publication_history ORDER BY sequence')) {
            if (typeof row.body !== 'string' || hash(canonical([row.sequence, row.body])) !== row.sha256)
                throw new Error('公開履歴のhash不一致です');
            const item = JSON.parse(row.body) as FinancialIndexPublicationTransition, previous = history.at(-1)?.publication ?? null;
            if (item.sequence !== history.length + 1 || item.sequence !== row.sequence || item.previous !== previous || item.previous !== row.previous_id || item.publication !== row.publication_id)
                throw new Error('公開履歴が不整合です');
            if (!seen.has(item.publication)) {
                if (!this.readCandidate(item.publication).eligible)
                    throw new Error('公開履歴に条件未達の候補があります');
                seen.add(item.publication);
            }
            history.push(item);
        }
        const active = this.rows('SELECT * FROM publication_active'), last = history.at(-1);
        if (!last) {
            if (active.length)
                throw new Error('公開pointerに履歴がありません');
        }
        else if (active.length !== 1 || active[0].singleton !== 1 || active[0].publication_id !== last.publication || active[0].sequence !== last.sequence || active[0].sha256 !== hash(canonical([last.publication, last.sequence])))
            throw new Error('公開pointerと履歴が不整合です');
        return history;
    }
    history(): FinancialIndexPublicationTransition[] { return this.transaction(() => this.readHistory(), false); }
    current(): FinancialIndexPublicationCandidate | undefined { return this.transaction(() => { const last = this.readHistory().at(-1); return last ? this.readCandidate(last.publication) : undefined; }, false); }
    private verify(c: FinancialIndexPublicationCandidate, index: FinancialSearchIndex) {
        if (!(index instanceof FinancialSearchIndex) || canonical(index.quality(c.generation)) !== canonical(c.quality))
            throw new Error('候補の固定世代と財務索引が一致しません');
    }
    resolve(index: FinancialSearchIndex): FinancialIndexPublicationCandidate | undefined {
        const c = this.current();
        if (c)
            this.verify(c, index);
        return c;
    }
    activate(id: string, index: FinancialSearchIndex, options: {
        expectedActive: string | null;
    }): FinancialIndexPublicationCandidate {
        if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).length !== 1 || !Object.hasOwn(options, 'expectedActive') || options.expectedActive !== null && !isFinancialIndexGenerationId(options.expectedActive))
            throw new Error('直前の公開候補IDまたはnullを指定してください');
        const expected = options.expectedActive, c = this.candidate(id);
        if (!c.eligible)
            throw new Error('公開条件を満たしていません');
        this.verify(c, index);
        return this.transaction(() => {
            const history = this.readHistory(), previous = history.at(-1)?.publication ?? null;
            if (previous !== expected)
                throw new Error('公開候補が他の処理で切り替わりました');
            if (previous === id)
                return c;
            const item: FinancialIndexPublicationTransition = { sequence: history.length + 1, previous, publication: id }, body = canonical(item);
            this.run('INSERT INTO publication_history VALUES(?,?,?,?,?)', [item.sequence, previous, id, body, hash(canonical([item.sequence, body]))]);
            this.run('INSERT INTO publication_active VALUES(1,?,?,?) ON CONFLICT(singleton) DO UPDATE SET publication_id=excluded.publication_id,sequence=excluded.sequence,sha256=excluded.sha256', [id, item.sequence, hash(canonical([id, item.sequence]))]);
            return c;
        });
    }
}
