import {FacilityDetailStore} from "./facility-detail-store";
import {LargeHoldingStore} from './large-holding-store';
import * as fs from "node:fs";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { Database } from "./node-sqlite";
import { ObservedFinancialArchive } from "./observed-financial-archive";
import { FinancialSourceJob } from "./financial-source-job";
import { FinancialIndexBuild } from "./financial-index-build";
import { FinancialSearchIndex } from "./financial-search-index";
import { FinancialIndexPublication } from "./financial-index-publication";
import { CompanyMasterStore } from "./company-master-store";
import { CorporateRegistryStore } from "./corporate-registry-store";
import {CorporateRegistryBlockStore,CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES} from "./corporate-registry-block-store";

import {ParsedFinancialStore} from "./parsed-financial-store";
import {ParsedFinancialJob} from "./parsed-financial-job";

const formats = {
    "parsed-financial-store": ParsedFinancialStore,
    "parsed-financial-job": ParsedFinancialJob,
    "observed-financial-archive": ObservedFinancialArchive,
    "financial-source-job": FinancialSourceJob,
    "financial-index-build": FinancialIndexBuild,
    "financial-search-index": FinancialSearchIndex,
    "financial-index-publication": FinancialIndexPublication,
    "company-master-store": CompanyMasterStore,
    "corporate-registry-store": CorporateRegistryStore,
    "corporate-registry-block-store": CorporateRegistryBlockStore,
    "large-holding-store": LargeHoldingStore,
    "facility-detail-store": FacilityDetailStore,
} as const;
export type DedicatedSqliteRecoveryKind = keyof typeof formats;
export interface DedicatedSqliteRecoveryOptions {
    source: string;
    outputDirectory: string;
    kind: DedicatedSqliteRecoveryKind;
    databaseSha256: string;
    journalSha256: string;
}
export interface DedicatedSqliteRecoveryResult {
    recoveryVersion: "1";
    kind: DedicatedSqliteRecoveryKind;
    source: { database: { path: string; bytes: number; sha256: string }; journal: { path: string; bytes: number; sha256: string } };
    journal: { pageSize: number; sectorSize: number; originalPages: number; records: number; segments: number; ignoredUnsyncedTail: boolean };
    output: { path: string; bytes: number; sha256: string };
    sqliteVersion: string;
    integrityCheck: "ok";
    schemaCheck: "matched";
    applicationRecordsValidated: false;
}
export const SQLITE_RECOVERY_MAX_BYTES = 32 * 1024 ** 3;
const magic = Buffer.from("d9d505f920a163d7", "hex");
const identity = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(":");
function readAt(fd: number, offset: number, size: number) {
    const bytes = Buffer.alloc(size);
    let used = 0;
    while (used < size) {
        const n = fs.readSync(fd, bytes, used, size - used, offset + used);
        if (!n) throw new Error("復旧入力が途中で終わっています");
        used += n;
    }
    return bytes;
}
function inspectJournal(fd: number, size: number, databaseBytes: number): DedicatedSqliteRecoveryResult["journal"] {
    if (size <= 512 || readAt(fd, size - 8, 8).equals(magic)) throw new Error("単独DBの同期済みhot journalだけを復旧できます");
    let offset = 0, records = 0, segments = 0, ignoredUnsyncedTail = false;
    let pageSize = 0, sectorSize = 0, originalPages = 0;
    let pages: Uint8Array | undefined;
    while (offset < size) {
        const remaining = size - offset;
        if (remaining < 28) {
            if (segments && readAt(fd, offset, remaining).every(b => b === 0)) { ignoredUnsyncedTail = true; break; }
            throw new Error("journal headerが途中で終わっています");
        }
        const header = readAt(fd, offset, 28);
        if (header.subarray(0, 8).every(b => b === 0) && segments) { ignoredUnsyncedTail = true; break; }
        if (!header.subarray(0, 8).equals(magic)) throw new Error("journal headerが不正です");
        const count = header.readUInt32BE(8), nonce = header.readUInt32BE(12), original = header.readUInt32BE(16), sector = header.readUInt32BE(20), page = header.readUInt32BE(24);
        const power = (n: number) => n >= 512 && n <= 65536 && (n & (n - 1)) === 0;
        if (!power(page) || !power(sector) || !original || original * page > databaseBytes || segments && (page !== pageSize || sector !== sectorSize || original !== originalPages)) throw new Error("journalのページ/sector/元サイズが不正です");
        pageSize = page; sectorSize = sector; originalPages = original;
        pages ??= new Uint8Array(Math.ceil((original + 1) / 8));
        const start = offset + sector, length = count === 0xffffffff ? Math.floor((size - start) / (page + 8)) : count;
        if (!length || start > size || start + length * (page + 8) > size) throw new Error("journal recordが不足しています");
        for (let i = 0; i < length; i++) {
            const record = readAt(fd, start + i * (page + 8), page + 8), number = record.readUInt32BE(0);
            if (!number || number > original || pages[number >>> 3] & (1 << (number & 7))) throw new Error("journalの原ページ番号が不正です");
            let checksum = nonce;
            for (let j = page - 200; j >= 0; j -= 200) checksum = (checksum + record[4 + j]) >>> 0;
            if (checksum !== record.readUInt32BE(page + 4)) throw new Error("journal recordのchecksum不一致です");
            pages[number >>> 3] |= 1 << (number & 7); records++;
        }
        segments++;
        const end = start + length * (page + 8), next = Math.ceil(end / sector) * sector;
        const padding = Math.min(next, size) - end;
        if (padding && !readAt(fd, end, padding).every(b => b === 0)) throw new Error("journalの末尾/境界が不正です");
        if (end === size || next >= size) break;
        offset = next;
    }
    return { pageSize, sectorSize, originalPages, records, segments, ignoredUnsyncedTail };
}
/** 停止した単独DB+journalを新規の私有候補へ復旧。元ファイルと既存の出力先は変更しません。 */
export function recoverDedicatedSqliteSnapshot(options: DedicatedSqliteRecoveryOptions): DedicatedSqliteRecoveryResult {
    if (!options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => !["source", "outputDirectory", "kind", "databaseSha256", "journalSha256"].includes(k))) throw new Error("復旧元・新規出力先・専用形式・両指紋を指定してください");
    const { source, outputDirectory, kind, databaseSha256, journalSha256 } = options;
    if (typeof source !== "string" || !source.trim() || source === ":memory:" || typeof outputDirectory !== "string" || !outputDirectory.trim() || typeof kind !== "string" || !Object.hasOwn(formats, kind) || ![databaseSha256, journalSha256].every(v => typeof v === "string" && /^[a-f0-9]{64}$/.test(v))) throw new Error("復旧入力が不正です");
    const input = path.resolve(source), output = path.resolve(outputDirectory);
    const opened: { path: string; fd: number; stat: fs.BigIntStats }[] = [];
    let created = false, succeeded = false;
    const noWal = () => { for (const suffix of ["-wal", "-shm"]) { try { fs.lstatSync(input + suffix); } catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") continue; throw e; } throw new Error("WAL/SHMを伴うDBはこの復旧の対象外です"); } };
    const unchanged = () => {
        noWal();
        for (const f of opened) if (identity(fs.fstatSync(f.fd, { bigint: true })) !== identity(f.stat) || identity(fs.lstatSync(f.path, { bigint: true })) !== identity(f.stat)) throw new Error("復旧元が変化しました");
    };
    const stream = (f: typeof opened[number], destination?: string) => {
        const digest = createHash("sha256"), buffer = Buffer.alloc(1024 * 1024);
        const fd = destination === undefined ? undefined : fs.openSync(destination, "wx", 0o600);
        try {
            for (let offset = 0; offset < Number(f.stat.size);) {
                const n = fs.readSync(f.fd, buffer, 0, Math.min(buffer.length, Number(f.stat.size) - offset), offset);
                if (!n) throw new Error("復旧元が途中で終わっています");
                digest.update(buffer.subarray(0, n));
                if (fd !== undefined) for (let used = 0; used < n;) { const written = fs.writeSync(fd, buffer, used, n - used); if (!written) throw new Error("復旧候補を書き込めません"); used += written; }
                offset += n;
            }
            if (fd !== undefined) fs.fsyncSync(fd);
            return digest.digest("hex");
        } finally { if (fd !== undefined) fs.closeSync(fd); }
    };
    try {
        noWal();
        for (const file of [input, input + "-journal"]) {
            const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
            let stat: fs.BigIntStats;
            try { stat = fs.fstatSync(fd, { bigint: true }); } catch (error) { fs.closeSync(fd); throw error; }
            opened.push({ path: file, fd, stat });
            if (!stat.isFile() || stat.nlink !== 1n || stat.size <= 0n || stat.size > BigInt(SQLITE_RECOVERY_MAX_BYTES)) throw new Error("復旧元には上限内の単一リンク通常ファイルが必要です");
        }
        const [database, journalFile] = opened;
        if (kind === "corporate-registry-block-store" && database.stat.size > BigInt(CORPORATE_REGISTRY_BLOCK_MAX_DB_BYTES)) throw new Error("圧縮法人番号DBの容量上限を超えています");
        if (database.stat.size + journalFile.stat.size > BigInt(SQLITE_RECOVERY_MAX_BYTES)) throw new Error("復旧入力の合計は32GiB以下です");
        const header = readAt(database.fd, 0, 100);
        if (!header.subarray(0, 16).equals(Buffer.from("SQLite format 3\0")) || header[18] !== 1 || header[19] !== 1) throw new Error("rollback journal形式のSQLite DBが必要です");
        const journal = inspectJournal(journalFile.fd, Number(journalFile.stat.size), Number(database.stat.size));
        if ((header.readUInt16BE(16) === 1 ? 65536 : header.readUInt16BE(16)) !== journal.pageSize) throw new Error("DBとjournalのページサイズが異なります");
        unchanged();
        const parent = fs.realpathSync(path.dirname(output)), disk = fs.statfsSync(parent, { bigint: true });
        if (disk.bavail * disk.bsize <= 2n * database.stat.size + journalFile.stat.size + 64n * 1024n ** 2n) throw new Error("復旧候補と検査用コピーの空き容量が不足しています");
        fs.mkdirSync(output, { mode: 0o700 }); created = true;
        const working = path.join(output, "working.sqlite");
        if (stream(database, working) !== databaseSha256 || stream(journalFile, working + "-journal") !== journalSha256) throw new Error("復旧元の指紋が異なります");
        unchanged();
        const db = new Database(working);
        let sqliteVersion: string;
        try {
            db.exec("PRAGMA trusted_schema=OFF");
            const check = db.prepare("PRAGMA integrity_check(1)"), version = db.prepare("SELECT sqlite_version() AS version");
            try {
                const result = check.all();
                if (result.length !== 1 || result[0].integrity_check !== "ok") throw new Error("復旧候補のSQLite整合検査が失敗しました");
                sqliteVersion = String(version.get()!.version);
            } finally { check.close(); version.close(); }
        } finally { db.close(); }
        for (const suffix of ["-journal", "-wal", "-shm"]) if (fs.existsSync(working + suffix)) throw new Error("復旧候補に副ファイルが残っています");
        if (fs.statSync(working).size !== journal.originalPages * journal.pageSize) throw new Error("復旧後のDBサイズが元ページ数と異なります");
        const verified = new formats[kind](working, { readOnly: true }); verified.close();
        if (stream(database) !== databaseSha256 || stream(journalFile) !== journalSha256) throw new Error("検査中に復旧元が変化しました");
        unchanged();
        const outputPath = path.join(output, "recovered.sqlite");
        fs.renameSync(working, outputPath);
        const recovered = { path: outputPath, fd: fs.openSync(outputPath, "r"), stat: fs.statSync(outputPath, { bigint: true }) };
        let outputSha256: string;
        try { outputSha256 = stream(recovered); fs.fsyncSync(recovered.fd); } finally { fs.closeSync(recovered.fd); }
        unchanged();
        const result: DedicatedSqliteRecoveryResult = { recoveryVersion: "1", kind, source: { database: { path: input, bytes: Number(database.stat.size), sha256: databaseSha256 }, journal: { path: journalFile.path, bytes: Number(journalFile.stat.size), sha256: journalSha256 } }, journal, output: { path: outputPath, bytes: Number(recovered.stat.size), sha256: outputSha256 }, sqliteVersion, integrityCheck: "ok", schemaCheck: "matched", applicationRecordsValidated: false };
        const manifest = fs.openSync(path.join(output, "manifest.tmp"), "wx", 0o600);
        try { fs.writeFileSync(manifest, JSON.stringify(result, null, 2)); fs.fsyncSync(manifest); } finally { fs.closeSync(manifest); }
        fs.renameSync(path.join(output, "manifest.tmp"), path.join(output, "manifest.json"));
        for (const folder of [output, parent]) {
            const directory = fs.openSync(folder, "r"); try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
        }
        succeeded = true;
        return result;
    } finally {
        for (const f of opened) fs.closeSync(f.fd);
        if (created && !succeeded) fs.rmSync(output, { recursive: true, force: true });
    }
}
