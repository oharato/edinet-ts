import { compareBalanceSheetVersions } from "./balance-sheet-version-diff";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { BALANCE_SHEET_REGISTRY_VERSION } from "./balance-sheet-registry";
import { BalanceSheetSqliteStore } from "./db/balance-sheet-store";
import { importBalanceSheets, planBalanceSheetImport, type BalanceSheetImportSource } from "./balance-sheet-import";

/** 有限な手元作業用の上限。性能保証や全市場運用の設定値ではありません。 */
export const LOCAL_IMPORT_LIMITS = Object.freeze({ entries: 100, manifestBytes: 2 * 1024 * 1024,
    sourceBytes: 64 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, dbBytes: 256 * 1024 * 1024 });
export interface LocalBalanceSheetImportOptions {
    manifest: string; db: string; extractorVersion: string; mappingVersion?: string; sourceCommit?: string;
    dryRun?: boolean; create?: boolean;
}
interface LocalFile { path: string; identity: string; bytes: Uint8Array; }
const identity = (stat: fs.BigIntStats) => `${stat.dev}:${stat.ino}`;
/** ローカル検証runnerでも共用する内部用の上限付きread。package rootの公開APIではありません。 */
export function readRegularFile(file: string, maxBytes: number): LocalFile {
    const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    try {
        const stat = fs.fstatSync(fd, { bigint: true });
        if (!stat.isFile()) throw new Error("指定入力は通常のファイルである必要があります");
        if (stat.size > BigInt(maxBytes)) throw new Error("入力ファイルがbyte上限を超えています");
        // 成長するファイルでも上限以上を読みません。
        const buffer = Buffer.alloc(Number(stat.size) + 1);
        let length = 0;
        while (length < buffer.length) {
            const n = fs.readSync(fd, buffer, length, buffer.length - length, null);
            if (!n) break;
            length += n;
        }
        const after = fs.fstatSync(fd, { bigint: true });
        if (length > maxBytes || length !== Number(stat.size) || after.size !== stat.size || after.mtimeNs !== stat.mtimeNs || after.ctimeNs !== stat.ctimeNs) throw new Error("読取中に入力ファイルが変化しました");
        return { path: fs.realpathSync(file), identity: identity(stat), bytes: buffer.subarray(0, length) };
    } finally { fs.closeSync(fd); }
}
/** 内部用。本文の解析前に拒否するための事前検査。実読取りの検査は省略しません。 */
export function assertRegularFileByteBudget(files: readonly string[]): void {
    let total = 0n;
    for (const file of files) {
        const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
        try {
            const stat = fs.fstatSync(fd, { bigint: true });
            if (!stat.isFile()) throw new Error("指定入力は通常のファイルである必要があります");
            total += stat.size;
            if (stat.size > BigInt(LOCAL_IMPORT_LIMITS.sourceBytes) || total > BigInt(LOCAL_IMPORT_LIMITS.totalBytes)) throw new Error("入力ファイルがbyte上限を超えています");
        } finally { fs.closeSync(fd); }
    }
}
function lstat(file: string): fs.Stats | undefined {
    try { return fs.lstatSync(file); } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw error;
    }
}
function protectDb(dbPath: string, inputs: readonly Pick<LocalFile, "path" | "identity">[]): boolean {
    const stat = lstat(dbPath);
    if (stat) {
        if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("DBにはsymlinkでない通常ファイルを指定してください");
        const real = fs.realpathSync(dbPath), id = identity(fs.statSync(dbPath, { bigint: true }));
        if (inputs.some(input => input.path === real || input.identity === id)) throw new Error("DBとmanifest/原本が同じファイルです");
    }
    // 利用中/復旧待ちのDBと、原本に重なる副ファイルには触れません。
    for (const suffix of ["-journal", "-wal", "-shm"]) if (lstat(dbPath + suffix)) throw new Error("DB副ファイルが存在します。利用中DBを避け、停止済みの試験用コピーを指定してください");
    return !!stat;
}

/** SQLiteのreadOnlyでもWAL用副ファイルを作り得るため、検査は一時コピーで行います。 */
function withPreviewStore<T>(dbPath: string | undefined, action: (store: BalanceSheetSqliteStore) => T): T {
    if (dbPath === undefined) {
        const store = new BalanceSheetSqliteStore(":memory:");
        try { return action(store); } finally { store.close(); }
    }
    const copy = readRegularFile(dbPath, LOCAL_IMPORT_LIMITS.dbBytes);
    const dir = fs.mkdtempSync(path.join(tmpdir(), "edinet-import-preview-"));
    try {
        const target = path.join(dir, "preview.sqlite");
        fs.writeFileSync(target, copy.bytes, { flag: "wx", mode: 0o600 });
        const reader = new BalanceSheetSqliteStore(target, { readOnly: true });
        try { return action(reader); } finally { reader.close(); }
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

/** CLIのローカル処理。ネット取得・ディレクトリ探索・暗黙のDB作成は行いません。 */
export function runLocalBalanceSheetImport(options: LocalBalanceSheetImportOptions) {
    for (const value of [options.manifest, options.db]) if (typeof value !== "string" || !value.trim()) throw new Error("manifestとdbのパスが必要です");
    const manifestPath = path.resolve(options.manifest), dbPath = path.resolve(options.db);
    const manifest = readRegularFile(manifestPath, LOCAL_IMPORT_LIMITS.manifestBytes);
    const entries = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifest.bytes));
    if (!Array.isArray(entries) || entries.length > LOCAL_IMPORT_LIMITS.entries) throw new Error("manifestは100件以下の配列です");
    const files: string[] = [];
    const sources: BalanceSheetImportSource[] = entries.map(entry => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.file !== "string" || !entry.file.trim() ||
            Object.keys(entry).some(key => !["file", "secCode", "docID", "instant", "scope", "accountingStandard", "currency"].includes(key))) throw new Error("不正なローカルmanifest項目です");
        files.push(path.resolve(path.dirname(manifestPath), entry.file));
        return { metadata: { secCode: entry.secCode, docID: entry.docID, instant: entry.instant, scope: entry.scope,
            accountingStandard: entry.accountingStandard, currency: entry.currency === undefined ? "JPY" : entry.currency },
            provenance: { extractorVersion: options.extractorVersion, mappingVersion: options.mappingVersion ?? BALANCE_SHEET_REGISTRY_VERSION,
                sourceSha256: "0".repeat(64), ...(options.sourceCommit === undefined ? {} : { sourceCommit: options.sourceCommit }) } };
    });
    const inputs: Pick<LocalFile, "path" | "identity">[] = [manifest];
    // Metadata/版/重複を原本読取前に既存APIで検査。実ファイルには書き込みません。
    const validation = new BalanceSheetSqliteStore(":memory:");
    try { planBalanceSheetImport(validation, sources); } finally { validation.close(); }
    assertRegularFileByteBudget(files);
    let bytesRead = 0;
    for (let i = 0; i < files.length; i++) {
        const file = readRegularFile(files[i], Math.min(LOCAL_IMPORT_LIMITS.sourceBytes, LOCAL_IMPORT_LIMITS.totalBytes - bytesRead));
        bytesRead += file.bytes.byteLength;
        sources[i].provenance.sourceSha256 = createHash("sha256").update(file.bytes).digest("hex");
        files[i] = file.path; inputs.push({ path: file.path, identity: file.identity });
    }
    const exists = protectDb(dbPath, inputs);
    if (options.create && exists) throw new Error("--createは未作成のDB専用です。既存ファイルを上書きしません");
    if (!options.dryRun && !exists && !options.create) throw new Error("DBがありません。新しい試験DBには--createを明示してください");
    // 構造検査も衝突計画もコピー上で済ませ、既存の空ファイルを初期化しません。
    const preview = withPreviewStore(exists ? dbPath : undefined, store => planBalanceSheetImport(store, sources));
    if (options.dryRun) return { mode: "dry-run" as const, bytesRead, plan: preview };
    if (preview.counts.conflict) return { mode: "import" as const, bytesRead, plan: preview, processed: 0, inserted: 0, unchanged: 0, snapshotIds: [] as string[] };
    if (protectDb(dbPath, inputs) !== exists) throw new Error("計画中にDBパスが変化しました。再実行してください");
    if (!exists) { const fd = fs.openSync(dbPath, "wx", 0o600); fs.closeSync(fd); }
    const store = new BalanceSheetSqliteStore(dbPath);
    try {
        const preview = planBalanceSheetImport(store, sources);
        if (preview.counts.conflict) return { mode: "import" as const, bytesRead, plan: preview, processed: 0, inserted: 0, unchanged: 0, snapshotIds: [] as string[] };
        // 同じdoc/原本を複数範囲で使えるため、識別したdescriptorからpathを選ぶ。
        const key = (source: BalanceSheetImportSource) => JSON.stringify([source.metadata.docID, source.metadata.secCode.length === 4 ? source.metadata.secCode + "0" : source.metadata.secCode,
            source.metadata.instant, source.metadata.scope]);
        const paths = new Map(sources.map((source, i) => [key(source), files[i]]));
        const result = importBalanceSheets(store, sources, source => readRegularFile(paths.get(key(source))!, LOCAL_IMPORT_LIMITS.sourceBytes).bytes);
        return { mode: "import" as const, bytesRead, ...result };
    } finally { store.close(); }
}

/** 停止済み試験DBのコピー上で2つの保存版を比較。元DBをSQLiteで開きません。 */
export function runLocalBalanceSheetDiff(options: { db: string; before: string; after: string }) {
    if (typeof options.db !== "string" || !options.db.trim()) throw new Error("dbのパスが必要です");
    const dbPath = path.resolve(options.db);
    if (!protectDb(dbPath, [])) throw new Error("比較するDBがありません。作成はしません");
    return withPreviewStore(dbPath, store => compareBalanceSheetVersions(store, options.before, options.after));
}
