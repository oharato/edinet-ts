import {encodeArchiveContent,decodeArchiveContent,type ArchiveContentEncoding} from './archive-content';
import { assertXmlInput } from "../xml-input";
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { DedicatedSqliteDatabase } from "./dedicated-sqlite";
import { captureDocumentVersionObservations, selectDocumentVersions, type DocumentVersionObservation, type SelectedDocumentVersion } from "../document-version-selection";
import { OBSERVED_FINANCIAL_SNAPSHOT_VERSION, captureObservedFinancialSources, createObservedFinancialSnapshotsUsing, ObservedFinancialResolutionFatalError, type ObservedFinancialSource, type ObservedFinancialSnapshotOptions, type ObservedFinancialSnapshotRecord, type ObservedFinancialSourceReason } from "../observed-financial-snapshots";
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
    /** 新規DBの原本保存方式。既存DBは保存済みの方式を自動検出します。 */
    compression?: "gzip";
}
export interface FinancialArchiveSourceTransferOptions {
    sourceArchiveSha256: string;
    afterId?: string;
    /** 指定時刻以前に取得できていた原本宣言/内容だけを転送します。 */
    availableBy?: string;
    limit?: number;
}
export interface FinancialArchiveSourceTransferResult {
    sourceArchiveSha256: string;
    availableBy?: string;
    transferredIds: string[];
    insertedSources: number;
    insertedContents: number;
    nextAfterId?: string;
    complete: boolean;
}
export interface FinancialSourceAcquisitionOptions {
    cutoff: string;
    edinetCodes?: readonly string[];
}
export interface FinancialSourceAcquisitionItem {
    rootDocID: string;
    docID: string;
    edinetCode: string;
    status: "missing" | "declaration-only" | "stored" | "conflicting" | "unavailable";
    reason?: "xbrl-not-provided";
    formatAvailability?: SelectedDocumentVersion["formatAvailability"];
    availableAt?: string;
    sourceSha256?: string;
    availableByCutoff: boolean;
}
export interface FinancialSourceAcquisitionPlan {
    cutoff: string;
    edinetCodes?: readonly string[];
    selection: ReturnType<typeof selectDocumentVersions>;
    items: FinancialSourceAcquisitionItem[];
}
export interface FinancialSourceAcquisitionResult {
    plan: FinancialSourceAcquisitionPlan;
    results: {
        docID: string;
        status: "stored" | "failed";
        sourceSha256?: string;
        availableAt?: string;
        errorCode?: "source-acquisition-failed";
    }[];
    /** このcursorより後を処理。失敗の再試行はcursorなしの新しい巡回で行います。 */
    nextAfterDocID?: string;
    remaining: number;
    aborted: boolean;
}
export interface ArchivedFinancialSnapshotOptions extends ObservedFinancialSnapshotOptions {
    extractorVersion: string;
    sourceCommit?: string;
    edinetCodes?: readonly string[];
}
const mappingVersions = { observed: OBSERVED_FINANCIAL_SNAPSHOT_VERSION, basis: FINANCIAL_REPORTING_BASIS_VERSION, balanceSheet: BALANCE_SHEET_REGISTRY_VERSION, details: FINANCIAL_DETAIL_REGISTRY_VERSION, ifrsBalanceSheet: IFRS_BALANCE_SHEET_REGISTRY_VERSION, ifrsDetails: IFRS_FINANCIAL_DETAIL_REGISTRY_VERSION };
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
const kind = "edinet-ts-observed-financial-archive-v1", gzipKind = "edinet-ts-observed-financial-archive-gzip-v1";
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
    private readonly archiveFile?: string;
    private readonly contentEncoding: ArchiveContentEncoding;
    private readonly validatedObservationRows = new Map<string, Record<string, unknown>>();
    private validatedObservationBytes = 0;
    /** 全列が不変な行だけ再解析を省略。本文/索引は毎回SQLiteから読み直します。 */
    private validateFingerprintObservation(row: Record<string, unknown>) {
        const previous = typeof row.id === "string" ? this.validatedObservationRows.get(row.id) : undefined;
        if (previous && Object.keys(previous).length === Object.keys(row).length && Object.keys(previous).every(k => Object.hasOwn(row,k) && previous[k] === row[k])) return;
        this.decodeObservation(row);
        if (previous) {
            this.validatedObservationBytes -= this.observationRowBytes(previous);
            this.validatedObservationRows.delete(row.id as string);
        }
        const bytes = this.observationRowBytes(row);
        if (this.validatedObservationRows.size < 200000 && this.validatedObservationBytes + bytes <= 256 * 1024 * 1024) {
            this.validatedObservationRows.set(row.id as string, {...row});
            this.validatedObservationBytes += bytes;
        }
    }
    private observationRowBytes(row: Record<string, unknown>) {
        return 256 + Object.values(row).reduce<number>((n,v) => n + (typeof v === "string" ? 2*v.length : 16),0);
    }
    close() {
        this.validatedObservationRows.clear();
        this.validatedObservationBytes = 0;
        super.close();
    }

    constructor(file: string, options: ObservedFinancialArchiveOptions = {}) {
        if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["readOnly", "compression"].includes(k)))
            throw new Error("不正なアーカイブ設定です");
        const {readOnly, compression} = options;
        if (compression !== undefined && compression !== "gzip")
            throw new Error("不正なアーカイブ設定です");
        super(file, {readOnly}, {table: "archive_format", kind: compression === "gzip" ? gzipKind : kind, compatibleKinds: [kind, gzipKind], schema});
        this.contentEncoding = this.rows("SELECT kind FROM archive_format")[0].kind === gzipKind ? "gzip" : "plain";
        this.archiveFile = file === ":memory:" ? undefined : realpathSync(file);
    }
    private content(sourceSha256: string): Buffer | undefined {
        const size = this.rows("SELECT length(xml) AS bytes FROM archive_contents WHERE sha256=?", [sourceSha256]);
        if (!size.length) return undefined;
        if (typeof size[0].bytes !== "number" || !Number.isSafeInteger(size[0].bytes) || size[0].bytes < 0 || size[0].bytes > 256 * 1024 * 1024)
            throw new Error("一原本の上限は256MiBです");
        const bytes = this.rows("SELECT xml FROM archive_contents WHERE sha256=?", [sourceSha256])[0]?.xml;
        if (!(bytes instanceof Uint8Array) || bytes.byteLength !== size[0].bytes)
            throw new Error("保存原本のhashまたは圧縮内容が不整合です");
        try {
            return decodeArchiveContent(bytes, this.contentEncoding, sourceSha256);
        } catch {
            throw new Error("保存原本のhashまたは圧縮内容が不整合です");
        }
    }
    /** 停止した原本アーカイブのreadOnlyコピー全体を固定します。 */
    snapshotSha256(): string { return this.readOnlySnapshotSha256(); }
    /** 固定readOnly入力の一覧観測を原時刻・IDのまま転送します。 */
    transferObservationsTo(target: ObservedFinancialArchive, options: {sourceArchiveSha256: string; afterId?: string; limit?: number}) {
        if (!(target instanceof ObservedFinancialArchive) || target === this || this.archiveFile !== undefined && this.archiveFile === target.archiveFile || !options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["sourceArchiveSha256", "afterId", "limit"].includes(k)))
            throw new Error("異なる転送先と固定原本指紋を指定してください");
        const {sourceArchiveSha256, afterId, limit = 1000} = options;
        if (typeof sourceArchiveSha256 !== "string" || !/^[a-f0-9]{64}$/.test(sourceArchiveSha256) || afterId !== undefined && (typeof afterId !== "string" || !afterId.trim() || afterId.length > 256) || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000)
            throw new Error("観測転送の指紋・cursor・上限が不正です");
        if (this.snapshotSha256() !== sourceArchiveSha256) throw new Error("固定入力の指紋が異なります");
        target.append([], []);
        return this.transaction(() => {
            if (afterId !== undefined) {
                const previous = this.rows("SELECT * FROM archive_observations WHERE id=?", [afterId])[0];
                if (!previous) throw new Error("転送cursorが固定観測にありません");
                this.decodeObservation(previous);
            }
            const rows = this.rows("SELECT * FROM archive_observations WHERE id>? ORDER BY id LIMIT ?", [afterId ?? "", limit + 1]);
            const observations = rows.slice(0, limit).map(row => this.decodeObservation(row));
            const {insertedObservations} = target.append(observations);
            return {sourceArchiveSha256, transferredObservations: observations.length, insertedObservations,
                ...(observations.length ? {nextAfterId: observations.at(-1)!.observationId} : {}), complete: rows.length <= limit};
        }, false);
    }
    /** 固定readOnly原本から全版の宣言/内容を追記。各原本をcommitし、再投入は冪等です。 */
    transferSourcesTo(target: ObservedFinancialArchive, options: FinancialArchiveSourceTransferOptions): FinancialArchiveSourceTransferResult {
        if (!(target instanceof ObservedFinancialArchive) || target === this || this.archiveFile !== undefined && this.archiveFile === target.archiveFile || !options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["sourceArchiveSha256", "afterId", "availableBy", "limit"].includes(k)))
            throw new Error("異なる転送先と固定原本指紋を指定してください");
        const { sourceArchiveSha256, afterId, availableBy, limit = 20 } = options;
        const availableTime = availableBy === undefined ? undefined : timestamp(availableBy, true);
        if (availableBy !== undefined && availableTime === undefined) throw new Error("原本の取得時点にはtimezone付き日時が必要です");
        if (typeof sourceArchiveSha256 !== "string" || !/^[a-f0-9]{64}$/.test(sourceArchiveSha256) || afterId !== undefined && (typeof afterId !== "string" || !/^[a-f0-9]{64}$/.test(afterId)) || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
            throw new Error("原本転送は固定指紋・原本ID・1〜100件で指定してください");
        if (this.snapshotSha256() !== sourceArchiveSha256)
            throw new Error("転送元snapshot指紋が異なります");
        target.append([], []);
        return this.transaction(() => {
            const headers = "SELECT substr(id,1,65) AS id,substr(doc_id,1,257) AS doc_id,CASE WHEN typeof(available_ms) IN ('integer','real') THEN available_ms END AS available_ms,length(body) AS body_length,substr(body,1,2049) AS body,substr(sha256,1,65) AS sha256 FROM archive_sources";
            const decodeSource = (row: Record<string, unknown>) => {
                if (typeof row.body_length !== "number" || row.body_length > 2048) throw new Error("原本の宣言は2048文字以下です");
                const body = this.decode(row) as ObservedFinancialSource;
                const [source] = captureObservedFinancialSources([body]);
                const normalized = { docID: source.docID, availableAt: new Date(timestamp(source.availableAt, true)!).toISOString(), sourceSha256: source.sourceSha256 };
                if (canonical(body) !== canonical(normalized) || body.docID !== row.doc_id || timestamp(body.availableAt, true) !== row.available_ms || hash(canonical(body)) !== row.id)
                    throw new Error("転送原本の宣言/索引が不整合です");
                return normalized;
            };
            if (afterId !== undefined) {
                const previous = this.rows(headers + " WHERE id=?", [afterId])[0];
                if (!previous) throw new Error("転送cursorが固定原本にありません");
                const source = decodeSource(previous);
                if (availableTime !== undefined && timestamp(source.availableAt, true)! > availableTime) throw new Error("転送cursorが指定した取得時点の範囲外です");
            }
            const archive = this;
            function* candidates() {
                let cursor = afterId ?? "";
                for (;;) {
                    const rows = archive.rows(headers + " WHERE id>? ORDER BY id LIMIT 1000", [cursor]);
                    for (const row of rows) {
                        const source = decodeSource(row);
                        cursor = String(row.id);
                        // 索引が壊れた未来行で過去の原本を隠せないよう、宣言/索引を検査してから絞ります。
                        if (availableTime === undefined || timestamp(source.availableAt, true)! <= availableTime) yield {row, source};
                    }
                    if (rows.length < 1000) return;
                }
            }
            const iterator = candidates();
            let candidate = iterator.next();
            const transferredIds: string[] = [];
            let insertedSources = 0, insertedContents = 0, bytes = 0;
            for (; !candidate.done && transferredIds.length < limit; candidate = iterator.next()) {
                const {row, source: normalized} = candidate.value, body = normalized;
                const raw=this.content(body.sourceSha256);
                if(raw&&bytes+raw.byteLength>256*1024*1024&&transferredIds.length)break;
                let xml:string|undefined;
                if(raw){xml=raw.toString("utf8");if(!Buffer.from(xml,"utf8").equals(raw))throw Error("転送原本はUTF-8です");bytes+=raw.byteLength}
                const added = target.append([], [{ ...normalized, ...(xml === undefined ? {} : { xml }) }]);
                insertedSources += added.insertedSources;
                insertedContents += added.insertedContents;
                transferredIds.push(String(row.id));
            }
            if (this.snapshotSha256() !== sourceArchiveSha256) throw new Error("転送元snapshotが変化しました");
            const complete = candidate.done === true;
            return { sourceArchiveSha256, ...(availableTime === undefined ? {} : {availableBy: new Date(availableTime).toISOString()}), transferredIds, insertedSources, insertedContents, ...(complete ? {} : { nextAfterId: transferredIds.at(-1) }), complete };
        }, false);
    }
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
                    const old = this.content(s.body.sourceSha256);
                    if (old !== undefined) {
                        if (!old.equals(s.bytes))
                            throw new Error("保存原本が不整合です");
                    }
                    else {
                        this.run("INSERT INTO archive_contents VALUES(?,?)", [s.body.sourceSha256, encodeArchiveContent(s.bytes,this.contentEncoding,s.body.sourceSha256)]);
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
    observation(id: string): DocumentVersionObservation | undefined {
        if (typeof id !== "string" || !id.trim() || id.length > 256)
            throw new Error("観測IDが不正です");
        return this.transaction(() => { const row = this.rows("SELECT * FROM archive_observations WHERE id=?", [id])[0]; return row ? this.decodeObservation(row) : undefined; }, false);
    }
    private selectedObservations(edinetCodes?: readonly string[]): DocumentVersionObservation[] {
        const obsRows = edinetCodes === undefined ? this.rows("SELECT * FROM archive_observations ORDER BY id LIMIT 10001") : this.rows(`WITH RECURSIVE linked(doc_id) AS (
    SELECT doc_id FROM archive_observations WHERE edinet_code IN (${edinetCodes.map(() => "?").join(",")})
    UNION SELECT a.doc_id FROM archive_observations a JOIN linked l ON a.parent_doc_id=l.doc_id
    UNION SELECT a.parent_doc_id FROM archive_observations a JOIN linked l ON a.doc_id=l.doc_id WHERE a.parent_doc_id IS NOT NULL
   ) SELECT * FROM archive_observations WHERE doc_id IN (SELECT doc_id FROM linked) ORDER BY id LIMIT 10001`, [...edinetCodes]);
        if (obsRows.length > 10000)
            throw new Error("一回の選択は10,000観測までです。edinetCodesで会社の集合を分けてください");
        return obsRows.map(r => this.decodeObservation(r));
    }
    /** 取得による追記で変わらない、全一覧観測の指紋。会社の分割上限を超えて走査します。 */
    observationsSha256(): string {
        return this.transaction(() => {
            const digest = createHash("sha256").update("edinet-observations-v1\n");
            let after = "";
            for (;;) {
                const rows = this.rows("SELECT * FROM archive_observations WHERE id>? ORDER BY id LIMIT 1000", [after]);
                for (const row of rows) {
                    this.validateFingerprintObservation(row);
                    digest.update(canonical([row.id, row.body]) + "\n");
                }
                if (rows.length < 1000)
                    return digest.digest("hex");
                after = String(rows.at(-1)!.id);
            }
        }, false);
    }
    /** 取得worker共有: 実時計と検査済み本文を一件commitし、観測metadataだけを返します。 */
    appendAcquiredSource(docID: string, xml: string): Omit<ObservedFinancialSource, "xml"> {
        if (this.closed || this.readOnly)
            throw new Error("書込可能なアーカイブが必要です");
        assertXmlInput(xml);
        const availableAt = new Date().toISOString(), latest = this.rows("SELECT * FROM archive_sources WHERE doc_id=? ORDER BY available_ms DESC LIMIT 1", [docID])[0];
        if (latest) {
            const old = this.decode(latest) as ObservedFinancialSource;
            if (old.docID !== docID || timestamp(old.availableAt, true) !== latest.available_ms || hash(canonical(old)) !== latest.id)
                throw new Error("原本観測の索引が不整合です");
            if (timestamp(availableAt, true)! <= timestamp(old.availableAt, true)!)
                throw new Error("取得時計が原本観測以前です");
        }
        const source = { docID, availableAt, sourceSha256: hash(xml) };
        this.append([], [{ ...source, xml }]);
        return source;
    }
    /** 原本取得の差分。解析せず、最新の原本観測と実byteを検査します。 */
    planSourceAcquisition(options: FinancialSourceAcquisitionOptions): FinancialSourceAcquisitionPlan {
        if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["cutoff", "edinetCodes"].includes(k)))
            throw new Error("取得対象はcutoffと会社集合で指定してください");
        const { cutoff, edinetCodes } = normalizeArchivedFinancialSnapshotOptions({ ...options, extractorVersion: "source-acquisition" });
        return this.transaction(() => {
            const selection = selectDocumentVersions(this.selectedObservations(edinetCodes), cutoff);
            const items: FinancialSourceAcquisitionItem[] = selection.selected
                .filter(s => edinetCodes === undefined || edinetCodes.includes(s.observation.document.edinetCode!))
                .map((s): FinancialSourceAcquisitionItem => {
                const docID = s.observation.document.docID;
                const rows = this.rows("SELECT * FROM archive_sources WHERE doc_id=? ORDER BY available_ms DESC,id", [docID]);
                const declarations = rows.map(row => {
                    const body = this.decode(row) as ObservedFinancialSource;
                    if (body.docID !== row.doc_id || timestamp(body.availableAt, true) !== row.available_ms || hash(canonical(body)) !== row.id)
                        throw new Error("原本観測の索引が不整合です");
                    return body;
                });
                const latest = declarations[0];
                const item: FinancialSourceAcquisitionItem = { rootDocID: s.rootDocID, docID, edinetCode: s.observation.document.edinetCode!, status: "missing", availableByCutoff: false, ...(s.formatAvailability?{formatAvailability:s.formatAvailability}:{}) };
                const absent = ():FinancialSourceAcquisitionItem => s.formatAvailability?.formats.xbrl.state === "not-provided" ? {...item,status:"unavailable",reason:"xbrl-not-provided"} : item;
                if (!latest)
                    return absent();
                const latestMs = timestamp(latest.availableAt, true)!;
                if (new Set(declarations.filter(d => timestamp(d.availableAt, true) === latestMs).map(d => d.sourceSha256)).size > 1)
                    return { ...item, status: "conflicting", availableAt: latest.availableAt };
                const content = this.content(latest.sourceSha256);
                if (content === undefined && s.formatAvailability?.formats.xbrl.state === "not-provided") return absent();
                return { ...item, status: content !== undefined ? "stored" : "declaration-only", sourceSha256: latest.sourceSha256, availableAt: latest.availableAt, availableByCutoff: content !== undefined && latestMs <= timestamp(cutoff, true)! };
            }).sort((a, b) => a.docID < b.docID ? -1 : a.docID > b.docID ? 1 : 0);
            return { cutoff, edinetCodes, selection, items };
        }, false);
    }
    /** 成功した原本を一件ずつcommit。再open後の巡回は保存済みを再取得しません。 */
    async acquireSources(options: FinancialSourceAcquisitionOptions, fetchXbrl: (docID: string, request: {
        signal?: AbortSignal;
    }) => Promise<string>, batch: {
        limit?: number;
        afterDocID?: string;
        signal?: AbortSignal;
    } = {}): Promise<FinancialSourceAcquisitionResult> {
        if (this.closed || this.readOnly)
            throw new Error("取得には書込可能なアーカイブが必要です");
        if (typeof fetchXbrl !== "function" || !batch || typeof batch !== "object" || Array.isArray(batch) || Object.keys(batch).some(k => !["limit", "afterDocID", "signal"].includes(k)))
            throw new Error("取得関数とbatch条件が不正です");
        const { limit = 20, afterDocID, signal } = batch;
        if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || afterDocID !== undefined && (typeof afterDocID !== "string" || (!afterDocID.trim() || afterDocID.length > 256 || /[\x00-\x1f\x7f-\x9f]/.test(afterDocID))) || signal !== undefined && !(signal instanceof AbortSignal))
            throw new Error("取得は1〜100件・書類cursor・AbortSignalで指定してください");
        const plan = this.planSourceAcquisition(options), pending = plan.items.filter(i => i.status !== "stored" && i.status !== "unavailable" && (afterDocID === undefined || i.docID > afterDocID));
        const results: FinancialSourceAcquisitionResult["results"] = [];
        let cursor = afterDocID;
        for (const item of pending.slice(0, limit)) {
            if (signal?.aborted)
                break;
            if (this.closed)
                throw new Error("取得中にアーカイブがcloseされました");
            try {
                const xml = await fetchXbrl(item.docID, { signal });
                if (signal?.aborted)
                    break;
                const { sourceSha256, availableAt } = this.appendAcquiredSource(item.docID, xml);
                results.push({ docID: item.docID, status: "stored", sourceSha256, availableAt });
            }
            catch {
                if (this.closed)
                    throw new Error("取得中にアーカイブがcloseされました");
                if (signal?.aborted)
                    break;
                results.push({ docID: item.docID, status: "failed", errorCode: "source-acquisition-failed" });
            }
            cursor = item.docID;
        }
        const remaining = pending.filter(i => cursor === undefined || i.docID > cursor).length;
        return { plan, results, ...(remaining && cursor !== undefined ? { nextAfterDocID: cursor } : {}), remaining, aborted: signal?.aborted ?? false };
    }
    createSnapshots(options: ArchivedFinancialSnapshotOptions): ArchivedFinancialSnapshots {
        const { extractorVersion, sourceCommit, edinetCodes, ...query } = normalizeArchivedFinancialSnapshotOptions(options);
        const { cutoff } = query;
        return this.transaction<ArchivedFinancialSnapshots>(() => {
            const observations = this.selectedObservations(edinetCodes);
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
                    const content=this.content(source.sourceSha256);
                    if(content){
                        if(batchBytes+content.byteLength>256*1024*1024)flush();
                        source.xml=content.toString("utf8");batchBytes+=content.byteLength;
                    }
                }
                batch.push(source);
            }
            flush();
            return { selection: preview.selection, records, unavailableSources: [...unavailable.values()].map(s => conflicts.has(s.docID) ? { ...s, reason: "conflicting-source-observations" as const } : s), provenance: { archiveVersion: OBSERVED_FINANCIAL_ARCHIVE_VERSION, extractorVersion, sourceCommit, edinetCodes, mappingVersions: { ...mappingVersions } }, cache: { hits: cacheHits, extracted } };
        }, !this.readOnly);
    }
}
