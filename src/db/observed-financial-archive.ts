import { createHash } from "node:crypto";
import { DedicatedSqliteDatabase } from "./dedicated-sqlite";
import { captureDocumentVersionObservations, selectDocumentVersions, type DocumentVersionObservation } from "../document-version-selection";
import { captureObservedFinancialSources, createObservedFinancialSnapshotsUsing, ObservedFinancialResolutionFatalError, type ObservedFinancialSource, type ObservedFinancialSnapshotOptions, type ObservedFinancialSnapshotRecord, type ObservedFinancialSourceReason } from "../observed-financial-snapshots";
import { createAutomaticFinancialSnapshots, normalizeAutomaticFinancialDetailMetricIds, AutomaticFinancialProjectionError, type AutomaticFinancialSnapshotOptions } from "../automatic-financial-snapshots";
import { parseDocumentTimestamp as timestamp } from "../document-timestamp";
import { FINANCIAL_REPORTING_BASIS_VERSION } from "../financial-reporting-basis";
import { BALANCE_SHEET_REGISTRY_VERSION } from "../balance-sheet-registry";
import { FINANCIAL_DETAIL_REGISTRY_VERSION } from "../financial-detail-registry";
import { IFRS_BALANCE_SHEET_REGISTRY_VERSION } from "../ifrs-balance-sheet-registry";
import { IFRS_FINANCIAL_DETAIL_REGISTRY_VERSION } from "../ifrs-financial-detail-registry";
export const OBSERVED_FINANCIAL_ARCHIVE_VERSION = "1";
export interface ObservedFinancialArchiveOptions {
    readOnly?: boolean;
}
export interface ArchivedFinancialSnapshotOptions extends ObservedFinancialSnapshotOptions {
    extractorVersion: string;
    sourceCommit?: string;
    edinetCodes?: readonly string[];
}
const mappingVersions = { basis: FINANCIAL_REPORTING_BASIS_VERSION, balanceSheet: BALANCE_SHEET_REGISTRY_VERSION, details: FINANCIAL_DETAIL_REGISTRY_VERSION, ifrsBalanceSheet: IFRS_BALANCE_SHEET_REGISTRY_VERSION, ifrsDetails: IFRS_FINANCIAL_DETAIL_REGISTRY_VERSION };
export interface ArchivedFinancialSnapshots {
    selection: ReturnType<typeof selectDocumentVersions>;
    records: ObservedFinancialSnapshotRecord[];
    unavailableSources: {
        rootDocID: string;
        docID: string;
        reason: ObservedFinancialSourceReason | "conflicting-source-observations";
    }[];
    provenance: {
        archiveVersion: typeof OBSERVED_FINANCIAL_ARCHIVE_VERSION;
        extractorVersion: string;
        sourceCommit?: string;
        edinetCodes?: readonly string[];
        mappingVersions: typeof mappingVersions;
    };
    cache: {
        hits: number;
        extracted: number;
    };
}
const kind = "edinet-ts-observed-financial-archive-v1";
const schema = {
    archive_format: "CREATE TABLE archive_format(kind TEXT NOT NULL)",
    archive_observations: "CREATE TABLE archive_observations(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,parent_doc_id TEXT,edinet_code TEXT,observed_ms INTEGER NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
    archive_observation_company: "CREATE INDEX archive_observation_company ON archive_observations(edinet_code,doc_id)",
    archive_observation_parent: "CREATE INDEX archive_observation_parent ON archive_observations(parent_doc_id,doc_id)",
    archive_observation_document: "CREATE INDEX archive_observation_document ON archive_observations(doc_id)",
    archive_sources: "CREATE TABLE archive_sources(id TEXT PRIMARY KEY,doc_id TEXT NOT NULL,available_ms INTEGER NOT NULL,body TEXT NOT NULL,sha256 TEXT NOT NULL)",
    archive_source_lookup: "CREATE INDEX archive_source_lookup ON archive_sources(doc_id,available_ms)",
    archive_contents: "CREATE TABLE archive_contents(sha256 TEXT PRIMARY KEY,xml BLOB NOT NULL)",
    archive_extractions: "CREATE TABLE archive_extractions(id TEXT PRIMARY KEY,body TEXT NOT NULL,sha256 TEXT NOT NULL)"
};
const canonical = (v: unknown): string => JSON.stringify(v, (_k, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(k => [k, item[k]])) : item);
const hash = (s: string | Uint8Array) => createHash("sha256").update(s).digest("hex");
/** 内部共有: CLIもDB作成前に抽出条件を検証します。 */
export function normalizeArchivedFinancialSnapshotOptions(options: ArchivedFinancialSnapshotOptions) {
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["cutoff", "detailMetricIds", "extractorVersion", "sourceCommit", "edinetCodes"].includes(k)))
        throw new Error("cutoff・抽出版・項目を指定してください");
    const { cutoff, detailMetricIds, extractorVersion, sourceCommit, edinetCodes: requestedCodes } = options;
    let edinetCodes: string[] | undefined;
    if (requestedCodes !== undefined) {
        if (!Array.isArray(requestedCodes))
            throw new Error("会社指定は配列です");
        const length = requestedCodes.length;
        if (!Number.isSafeInteger(length) || length < 1 || length > 100)
            throw new Error("会社指定は1〜100件です");
        edinetCodes = Array.from({ length }, (_, i) => {
            if (!Object.hasOwn(requestedCodes, i))
                throw new Error("疎配列は使えません");
            return requestedCodes[i];
        });
        if (new Set(edinetCodes).size !== length || edinetCodes.some(c => typeof c !== "string" || !/^E\d{5}$/.test(c)))
            throw new Error("会社指定が不正/重複しています");
    }
    if (typeof extractorVersion !== "string" || !extractorVersion.trim() || extractorVersion.length > 256 || sourceCommit !== undefined && (typeof sourceCommit !== "string" || !/^[a-f0-9]{40}$/.test(sourceCommit)))
        throw new Error("抽出版/ソースcommitが不正です");
    // 空入力で条件を先に検証し、解析前に配列を固定します。
    const query = { cutoff, detailMetricIds: normalizeAutomaticFinancialDetailMetricIds(detailMetricIds) };
    createObservedFinancialSnapshotsUsing([], [], query, createAutomaticFinancialSnapshots);
    return { ...query, extractorVersion, sourceCommit, edinetCodes };
}
/** 内部共有: 再開計画が抽出版・対応表版を固定します。 */
export function financialArchiveExtractionProvenance(options: ArchivedFinancialSnapshotOptions): ArchivedFinancialSnapshots["provenance"] {
    const q = normalizeArchivedFinancialSnapshotOptions(options);
    return { archiveVersion: OBSERVED_FINANCIAL_ARCHIVE_VERSION, extractorVersion: q.extractorVersion, sourceCommit: q.sourceCommit, edinetCodes: q.edinetCodes, mappingVersions: { ...mappingVersions } };
}
/** 専用の追記アーカイブ。旧DBを移行せず、原観測・原本と版付き解析結果を保持します。 */
export class ObservedFinancialArchive extends DedicatedSqliteDatabase {
    constructor(file: string, options: ObservedFinancialArchiveOptions = {}) { super(file, options, { table: "archive_format", kind, schema }); }
    /** 停止した原本アーカイブのreadOnlyコピー全体を固定します。 */
    snapshotSha256(): string { return this.readOnlySnapshotSha256(); }
    private decode(row: Record<string, unknown>) {
        if (typeof row.id !== "string" || typeof row.body !== "string" || hash(canonical([row.id, row.body])) !== row.sha256)
            throw new Error("アーカイブrecordのhash不一致です");
        return JSON.parse(row.body);
    }
    private putRecord(table: "archive_extractions", id: string, value: unknown) {
        const body = canonical(value), existing = this.rows(`SELECT * FROM ${table} WHERE id=?`, [id]);
        if (existing.length) {
            this.decode(existing[0]);
            if (existing[0].body !== body)
                throw new Error("同じ保存IDの異なる内容は上書きできません");
            return false;
        }
        this.run(`INSERT INTO ${table} VALUES(?,?,?)`, [id, body, hash(canonical([id, body]))]);
        return true;
    }
    append(observations: readonly DocumentVersionObservation[], sources: readonly ObservedFinancialSource[] = []) {
        if (this.closed)
            throw new Error("アーカイブはclose済みです");
        if (this.readOnly)
            throw new Error("readOnlyのアーカイブです");
        const { captured, analyzed } = captureDocumentVersionObservations(observations), byID = new Map(captured.map(o => [o.relation.observationId, o]));
        const prepared = analyzed.observations.map(({ statuses: _statuses, ...o }) => { const c = byID.get(o.observationId)!; return { ...o, observedAt: new Date(c.observed).toISOString(), document: { ...o.document, ...(c.periodStart !== undefined ? { periodStart: c.periodStart } : {}), ...(c.periodEnd !== undefined ? { periodEnd: c.periodEnd } : {}) } }; });
        if (Buffer.byteLength(canonical(prepared)) > 16 * 1024 * 1024)
            throw new Error("観測JSONは16MiB以下です");
        const inputs = captureObservedFinancialSources(sources).map(s => {
            const bytes = s.xml === undefined ? undefined : Buffer.from(s.xml, "utf8");
            if (bytes !== undefined && (bytes.toString("utf8") !== s.xml || hash(bytes) !== s.sourceSha256))
                throw new Error("原本のUTF-8/hashが一致しません");
            const body = { docID: s.docID, availableAt: new Date(timestamp(s.availableAt, true)!).toISOString(), sourceSha256: s.sourceSha256 };
            return { body, id: hash(canonical(body)), bytes };
        });
        return this.transaction(() => {
            let insertedObservations = 0, insertedSources = 0, insertedContents = 0;
            for (const o of prepared) {
                const body = canonical(o), old = this.rows("SELECT * FROM archive_observations WHERE id=?", [o.observationId]);
                if (old.length) {
                    this.decodeObservation(old[0]);
                    if (old[0].body !== body)
                        throw new Error("同じ観測IDの異なる内容は上書きできません");
                }
                else {
                    this.run("INSERT INTO archive_observations VALUES(?,?,?,?,?,?,?)", [o.observationId, o.document.docID, o.document.parentDocID ?? null, o.document.edinetCode ?? null, timestamp(o.observedAt, true)!, body, hash(canonical([o.observationId, body]))]);
                    insertedObservations++;
                }
            }
            for (const s of inputs) {
                const body = canonical(s.body), existing = this.rows("SELECT * FROM archive_sources WHERE id=?", [s.id]);
                if (existing.length) {
                    this.decode(existing[0]);
                    if (existing[0].body !== body)
                        throw new Error("原本観測IDが不整合です");
                }
                else {
                    this.run("INSERT INTO archive_sources VALUES(?,?,?,?,?)", [s.id, s.body.docID, timestamp(s.body.availableAt, true)!, body, hash(canonical([s.id, body]))]);
                    insertedSources++;
                }
                if (s.bytes !== undefined) {
                    const old = this.rows("SELECT xml FROM archive_contents WHERE sha256=?", [s.body.sourceSha256]);
                    if (old.length) {
                        if (!(old[0].xml instanceof Uint8Array) || hash(old[0].xml) !== s.body.sourceSha256 || !Buffer.from(old[0].xml).equals(s.bytes))
                            throw new Error("保存原本が不整合です");
                    }
                    else {
                        this.run("INSERT INTO archive_contents VALUES(?,?)", [s.body.sourceSha256, s.bytes]);
                        insertedContents++;
                    }
                }
            }
            return { insertedObservations, insertedSources, insertedContents };
        });
    }
    private decodeObservation(row: Record<string, unknown>) {
        const o = this.decode(row);
        if (o.observationId !== row.id || o.document?.docID !== row.doc_id || (o.document.parentDocID ?? null) !== row.parent_doc_id || (o.document.edinetCode ?? null) !== row.edinet_code || timestamp(o.observedAt, true) !== row.observed_ms)
            throw new Error("観測の索引が不整合です");
        return o as DocumentVersionObservation;
    }
    createSnapshots(options: ArchivedFinancialSnapshotOptions): ArchivedFinancialSnapshots {
        const { extractorVersion, sourceCommit, edinetCodes, ...query } = normalizeArchivedFinancialSnapshotOptions(options);
        const { cutoff } = query;
        return this.transaction<ArchivedFinancialSnapshots>(() => {
            const obsRows = edinetCodes === undefined ? this.rows("SELECT * FROM archive_observations ORDER BY id LIMIT 10001") : this.rows(`WITH RECURSIVE linked(doc_id) AS (
    SELECT doc_id FROM archive_observations WHERE edinet_code IN (${edinetCodes.map(() => "?").join(",")})
    UNION SELECT a.doc_id FROM archive_observations a JOIN linked l ON a.parent_doc_id=l.doc_id
    UNION SELECT a.parent_doc_id FROM archive_observations a JOIN linked l ON a.doc_id=l.doc_id WHERE a.parent_doc_id IS NOT NULL
   ) SELECT * FROM archive_observations WHERE doc_id IN (SELECT doc_id FROM linked) ORDER BY id LIMIT 10001`, edinetCodes);
            if (obsRows.length > 10000)
                throw new Error("一回の選択は10,000観測までです。edinetCodesで会社の集合を分けてください");
            const observations = obsRows.map(r => this.decodeObservation(r));
            const preview = createObservedFinancialSnapshotsUsing(observations, [], query, createAutomaticFinancialSnapshots), selectedIDs = preview.selection.selected.filter(s => edinetCodes === undefined || edinetCodes.includes(s.observation.document.edinetCode ?? "")).map(s => s.observation.document.docID), declarations = new Map<string, {
                body: ObservedFinancialSource;
                ms: number;
            }[]>();
            for (let i = 0; i < selectedIDs.length; i += 500) {
                const ids = selectedIDs.slice(i, i + 500);
                for (const row of this.rows(`SELECT * FROM archive_sources WHERE doc_id IN (${ids.map(() => "?").join(",")}) ORDER BY doc_id,available_ms,id`, ids)) {
                    const body = this.decode(row) as ObservedFinancialSource, ms = timestamp(body.availableAt, true);
                    if (body.docID !== row.doc_id || ms !== row.available_ms || hash(canonical(body)) !== row.id)
                        throw new Error("原本観測の索引が不整合です");
                    const list = declarations.get(body.docID) ?? [];
                    list.push({ body, ms: ms! });
                    declarations.set(body.docID, list);
                }
            }
            const selectedSet = new Set(selectedIDs);
            let cacheHits = 0, extracted = 0;
            const records: ObservedFinancialSnapshotRecord[] = [], unavailable = new Map(preview.unavailableSources.filter(s => selectedSet.has(s.docID)).map(s => [s.docID, s])), conflicts = new Set<string>();
            let batch: ObservedFinancialSource[] = [], batchBytes = 0;
            const extract = (xml: string, input: AutomaticFinancialSnapshotOptions) => {
                const sourceSha256 = hash(xml), id = hash(canonical([input.docID, sourceSha256, input.detailMetricIds ?? null, extractorVersion, sourceCommit ?? null, mappingVersions]));
                let payload;
                try {
                    const old = this.rows("SELECT * FROM archive_extractions WHERE id=?", [id]);
                    if (old.length) {
                        payload = this.decode(old[0]);
                        cacheHits++;
                    }
                    else {
                        extracted++;
                        try {
                            payload = { kind: "result", result: createAutomaticFinancialSnapshots(xml, input) };
                        }
                        catch (error) {
                            payload = { kind: error instanceof AutomaticFinancialProjectionError ? "projection-failed" : "parse-failed" };
                        }
                        payload = JSON.parse(canonical(payload));
                        if (!this.readOnly)
                            this.putRecord("archive_extractions", id, payload);
                    }
                }
                catch {
                    throw new ObservedFinancialResolutionFatalError("解析キャッシュを読み書きできません");
                }
                if (!payload || typeof payload !== "object" || Array.isArray(payload))
                    throw new ObservedFinancialResolutionFatalError("保存解析結果が不整合です");
                if (payload.kind === "projection-failed")
                    throw new AutomaticFinancialProjectionError();
                if (payload.kind === "parse-failed")
                    throw new Error("保存した解析失敗です");
                if (payload.kind !== "result" || payload.result?.inputXmlSha256 !== sourceSha256 || payload.result?.basis?.docID !== input.docID)
                    throw new ObservedFinancialResolutionFatalError("保存解析結果が不整合です");
                return payload.result;
            };
            const flush = () => {
                if (!batch.length)
                    return;
                const ids = new Set(batch.map(s => s.docID)), result = createObservedFinancialSnapshotsUsing(observations, batch, query, extract);
                for (const r of result.records) {
                    records.push(r);
                    unavailable.delete(r.docID);
                }
                for (const u of result.unavailableSources)
                    if (ids.has(u.docID))
                        unavailable.set(u.docID, u);
                batch = [];
                batchBytes = 0;
            };
            for (const docID of selectedIDs) {
                const list = declarations.get(docID);
                if (!list?.length)
                    continue;
                const cut = timestamp(cutoff, true)!, past = list.filter(s => s.ms <= cut), latest = past.length ? past.at(-1)! : list[0], sameTime = list.filter(s => s.ms === latest.ms);
                if (past.length && new Set(sameTime.map(s => s.body.sourceSha256)).size > 1) {
                    conflicts.add(docID);
                    continue;
                }
                if (batch.length === 100)
                    flush();
                const source = { ...latest.body };
                if (latest.ms <= cut) {
                    const size = this.rows("SELECT length(xml) AS bytes FROM archive_contents WHERE sha256=?", [source.sourceSha256]);
                    if (size.length) {
                        const bytes = Number(size[0].bytes);
                        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > 256 * 1024 * 1024)
                            throw new Error("一原本の上限は256MiBです");
                        if (batchBytes + bytes > 256 * 1024 * 1024)
                            flush();
                        const content = this.rows("SELECT xml FROM archive_contents WHERE sha256=?", [source.sourceSha256])[0]?.xml;
                        if (!(content instanceof Uint8Array) || hash(content) !== source.sourceSha256)
                            throw new Error("保存原本のhashが一致しません");
                        source.xml = Buffer.from(content).toString("utf8");
                        batchBytes += bytes;
                    }
                }
                batch.push(source);
            }
            flush();
            return { selection: preview.selection, records, unavailableSources: [...unavailable.values()].map(s => conflicts.has(s.docID) ? { ...s, reason: "conflicting-source-observations" as const } : s), provenance: { archiveVersion: OBSERVED_FINANCIAL_ARCHIVE_VERSION, extractorVersion, sourceCommit, edinetCodes, mappingVersions: { ...mappingVersions } }, cache: { hits: cacheHits, extracted } };
        }, !this.readOnly);
    }
}
