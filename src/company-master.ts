import { createHash } from "node:crypto";
import { loadZipArchive } from "./zip-archive";

export interface CompanyMasterRecord {
    entityId: string; edinetCode: string; securityCode?: string; corporateNumber?: string;
    name: string; filerType: string; listingStatus: "listed" | "unlisted" | "unknown";
    industry?: string; fiscalYearEndRaw?: string; fiscalYearEndMonth?: number;
}
export interface CompanyMasterSnapshot {
    asOf: string; observedAt: string; sourceUrl: string; sourceSha256: string;
    archiveSha256?: string; originalCsvSha256?: string;
    records: readonly CompanyMasterRecord[];
}
const validDate = (value: unknown): value is string => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

const validObservationTime = (value: unknown): value is string => typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) && validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));

/** 公式固定URLを1回取得。認証不要、元ZIP/CSVのhashを保持し、DBやファイルは変更しません。 */
export async function fetchEdinetCompanyMaster(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<CompanyMasterSnapshot> {
    const timeout = options.timeoutMs ?? 30000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647) throw new Error("取得期限が不正です");
    const sourceUrl = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip";
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout);
    const response = await fetch(sourceUrl, { signal, redirect: "error" });
    if (!response.ok || !response.body) throw new Error("公式コードリストを取得できませんでした");
    const reader = response.body.getReader(), chunks: Uint8Array[] = []; let size = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            size += value.byteLength;
            if (size > 8 * 1024 * 1024) throw new Error("コードリストZIPの受信上限を超えました");
            chunks.push(value);
        }
    } catch (error) {
        try { void reader.cancel().catch(() => {}); } catch { /* 元エラーを保持 */ }
        throw error;
    } finally { reader.releaseLock(); }
    signal.throwIfAborted();
    const bytes = Buffer.concat(chunks), archive = await loadZipArchive(bytes, {
        compressedBytes: 8 * 1024 * 1024, entryBytes: 32 * 1024 * 1024, totalBytes: 32 * 1024 * 1024, entries: 10
    });
    const candidates = archive.entries.filter(entry => !entry.dir && entry.name.endsWith(".csv"));
    if (candidates.length !== 1 || candidates[0].uncompressedSize > 32 * 1024 * 1024) throw new Error("公式コードリストCSVが一意でないか大きすぎます");
    const csv = await archive.readEntry(candidates[0].name);
    signal.throwIfAborted();
    return { ...parseEdinetCodeList(new TextDecoder("shift_jis", { fatal: true }).decode(csv), { sourceUrl, observedAt: new Date().toISOString() }),
        archiveSha256: createHash("sha256").update(bytes).digest("hex"), originalCsvSha256: createHash("sha256").update(csv).digest("hex") };
}
/** 公式CSVの引用符・改行・二重引用符を解釈します。空列を消しません。 */
function csvRows(input: string): string[][] {
    const rows: string[][] = []; let row: string[] = [], field = "", quoted = false, closed = false;
    const endField = () => { row.push(field); field = ""; closed = false; };
    for (let i = 0; i < input.length; i++) {
        const c = input[i];
        if (quoted) {
            if (c === '"' && input[i + 1] === '"') { field += '"'; i++; }
            else if (c === '"') { quoted = false; closed = true; }
            else field += c;
        } else if (c === ',' || c === '\n' || c === '\r') {
            endField();
            if (c !== ',') { if (row.some(value => value !== "")) rows.push(row); row = []; if (c === '\r' && input[i + 1] === '\n') i++; }
        } else if (c === '"' && field === "" && !closed) quoted = true;
        else { if (closed || c === '"') throw new Error("CSVの引用符が不正です"); field += c; }
    }
    if (quoted) throw new Error("CSVの引用符が閉じていません");
    if (field || closed || row.length) { endField(); rows.push(row); }
    return rows;
}
/** CP932は呼出元で復号。公式日付をそのまま保存し、現在の属性を過去へ遡及しません。 */
export function parseEdinetCodeList(csv: string, provenance: { observedAt: string; sourceUrl: string }): CompanyMasterSnapshot {
    if (typeof csv !== "string" || Buffer.byteLength(csv) > 32 * 1024 * 1024 || !provenance ||
        !validObservationTime(provenance.observedAt)) throw new Error("CSVと取得日時が必要です");
    const url = new URL(provenance.sourceUrl);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) throw new Error("認証情報のないHTTPS出典URLが必要です");
    const rows = csvRows(csv.replace(/^\uFEFF/, "")), match = /^(\d{4})年(\d{1,2})月(\d{1,2})日現在$/.exec(rows[0]?.[1] ?? "");
    if (!match) throw new Error("公式CSVの基準日がありません");
    const asOf = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    if (!validDate(asOf) || Date.parse(asOf + "T00:00:00+09:00") > Date.parse(provenance.observedAt)) throw new Error("CSVの基準日/取得日時が不整合です");
    const header = rows[1], required = ["ＥＤＩＮＥＴコード", "提出者種別", "上場区分", "決算日", "提出者名", "提出者業種", "証券コード", "提出者法人番号"];
    if (!header || new Set(header).size !== header.length || required.some(key => !header.includes(key))) throw new Error("公式コードリストの列が不足/重複しています");
    const seen = new Set<string>();
    const records = rows.slice(2).map(values => {
        if (values.length !== header.length) throw new Error("CSVの列数が不整合です");
        const fields = Object.fromEntries(header.map((key, i) => [key, values[i]]));
        const edinetCode = fields["ＥＤＩＮＥＴコード"], code = fields["証券コード"], number = fields["提出者法人番号"], listing = fields["上場区分"];
        if (!/^E\d{5}$/.test(edinetCode) || seen.has(edinetCode) || !fields["提出者名"].trim() ||
            code && !/^[0-9A-Z]{4,5}$/.test(code) || number && !/^\d{13}$/.test(number) || !["", "上場", "非上場"].includes(listing)) throw new Error("コードリストに不正/重複する識別情報があります");
        seen.add(edinetCode);
        const fiscal = fields["決算日"], month = /^(\d{1,2})月(?:\d{1,2}日|末日)$/.exec(fiscal);
        const fiscalYearEndMonth = month && Number(month[1]) >= 1 && Number(month[1]) <= 12 ? Number(month[1]) : undefined;
        // 法人番号が後から補われても観測の安定IDを変えず、別コードの法人結合は推測しません。
        return { entityId: `edinet:${edinetCode}`, edinetCode,
            securityCode: code ? code.length === 4 ? code + "0" : code : undefined, corporateNumber: number || undefined,
            name: fields["提出者名"], filerType: fields["提出者種別"], listingStatus: listing === "上場" ? "listed" : listing === "非上場" ? "unlisted" : "unknown",
            industry: fields["提出者業種"] || undefined, fiscalYearEndRaw: fiscal || undefined, fiscalYearEndMonth } satisfies CompanyMasterRecord;
    });
    const count = /^(\d+)件$/.exec(rows[0]?.[3] ?? "");
    if (!count || Number(count[1]) !== records.length) throw new Error("公式CSVの宣言件数と行数が一致しません");
    return { asOf, observedAt: provenance.observedAt, sourceUrl: url.href, sourceSha256: createHash("sha256").update(csv).digest("hex"), records };
}
export interface CompanyMasterQuery { asOf: string; knownAt: string; industry?: string; listingStatus?: CompanyMasterRecord["listingStatus"]; fiscalYearEndMonth?: number; nameContains?: string; securityCode?: string; }
/** 保存済みスナップショットのas-of観測。正確な改称/合併/廃止日を推測しません。 */
export function queryCompanyMaster(snapshots: readonly CompanyMasterSnapshot[], query: CompanyMasterQuery) {
    if (!Array.isArray(snapshots) || !query || !validDate(query.asOf) || !validObservationTime(query.knownAt) ||
        query.fiscalYearEndMonth !== undefined && (!Number.isInteger(query.fiscalYearEndMonth) || query.fiscalYearEndMonth < 1 || query.fiscalYearEndMonth > 12) ||
        query.listingStatus !== undefined && !["listed", "unlisted", "unknown"].includes(query.listingStatus) || query.securityCode !== undefined && !/^[0-9A-Z]{4,5}$/.test(query.securityCode) ||
        [query.industry, query.nameContains].some(value => value !== undefined && typeof value !== "string") ||
        Object.keys(query).some(key => !["asOf", "knownAt", "industry", "listingStatus", "fiscalYearEndMonth", "nameContains", "securityCode"].includes(key))) throw new Error("不正な企業マスター検索条件です");
    const inputs: readonly CompanyMasterSnapshot[] = Array.from(snapshots);
    const eligible = inputs.filter(snapshot => {
        if (!validDate(snapshot.asOf) || !validObservationTime(snapshot.observedAt) ||
            Date.parse(snapshot.asOf + "T00:00:00+09:00") > Date.parse(snapshot.observedAt) || !/^[a-f0-9]{64}$/.test(snapshot.sourceSha256) || !Array.isArray(snapshot.records)) throw new Error("不正な保存マスターです");
        const source = new URL(snapshot.sourceUrl), seen = new Set<string>();
        if (source.protocol !== "https:" || source.username || source.password || source.search || source.hash) throw new Error("保存マスターの出典が不正です");
        for (const row of snapshot.records) {
            if (!row || !/^E\d{5}$/.test(row.edinetCode) || seen.has(row.edinetCode) || row.entityId !== `edinet:${row.edinetCode}` ||
                typeof row.name !== "string" || !row.name.trim() || typeof row.filerType !== "string" ||
                !["listed", "unlisted", "unknown"].includes(row.listingStatus) || row.securityCode !== undefined && !/^[0-9A-Z]{5}$/.test(row.securityCode) ||
                row.corporateNumber !== undefined && !/^\d{13}$/.test(row.corporateNumber) ||
                row.industry !== undefined && typeof row.industry !== "string" || row.fiscalYearEndRaw !== undefined && typeof row.fiscalYearEndRaw !== "string" ||
                row.fiscalYearEndMonth !== undefined && (!Number.isInteger(row.fiscalYearEndMonth) || row.fiscalYearEndMonth < 1 || row.fiscalYearEndMonth > 12)) throw new Error("保存マスターの企業情報が不正です");
            seen.add(row.edinetCode);
        }
        return snapshot.asOf <= query.asOf && Date.parse(snapshot.observedAt) <= Date.parse(query.knownAt);
    }).sort((a, b) => b.asOf.localeCompare(a.asOf) || Date.parse(b.observedAt) - Date.parse(a.observedAt));
    const snapshot = eligible[0];
    if (!snapshot) return { status: "unavailable" as const, reason: "no-observation" as const, rows: [], total: 0 };
    if (eligible.some(s => s.asOf === snapshot.asOf && Date.parse(s.observedAt) === Date.parse(snapshot.observedAt) && s.sourceSha256 !== snapshot.sourceSha256)) throw new Error("同時点のマスターが競合しています");
    const code = query.securityCode?.length === 4 ? query.securityCode + "0" : query.securityCode;
    const rows = snapshot.records.filter(row => (query.industry === undefined || row.industry === query.industry) &&
        (query.listingStatus === undefined || row.listingStatus === query.listingStatus) && (query.fiscalYearEndMonth === undefined || row.fiscalYearEndMonth === query.fiscalYearEndMonth) &&
        (query.nameContains === undefined || row.name.includes(query.nameContains)) && (code === undefined || row.securityCode === code))
        .map(row => structuredClone(row)).sort((a, b) => a.edinetCode.localeCompare(b.edinetCode));
    return { status: "available" as const, asOf: snapshot.asOf, observedAt: snapshot.observedAt, sourceUrl: snapshot.sourceUrl, sourceSha256: snapshot.sourceSha256, rows, total: rows.length };
}
