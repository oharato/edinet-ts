import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { SQLInputValue } from "node:sqlite";
import { Database, type NativeDatabase } from "./node-sqlite";
interface DedicatedSqliteFormat {
    table: string;
    kind: string;
    schema: Readonly<Record<string, string>>;
}
const identity = (s: fs.BigIntStats) => [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs].join(":");
const normalized = (s: string) => s.replace(/\s+/g, " ").trim();
function inspect(file: string) {
    let s: fs.Stats | undefined;
    try {
        s = fs.lstatSync(file);
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
            throw e;
    }
    if (s && (!s.isFile() || s.isSymbolicLink() || s.nlink !== 1))
        throw new Error("専用DBには単一リンクの通常ファイルが必要です");
    for (const suffix of ["-wal", "-shm", "-journal"])
        try {
            fs.lstatSync(file + suffix);
            throw new Error("DB副ファイルがあります。停止した専用DBが必要です");
        }
        catch (e) {
            if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                throw e;
        }
    return s;
}
/** 内部共有: 専用DBだけを開き、未知の既存ファイルは私有コピーで検査します。 */
export class DedicatedSqliteDatabase {
    protected db!: NativeDatabase;
    private scratch?: string;
    private snapshotFile?: string;
    private snapshotFingerprint?: { identity: string; sha256: string };
    protected closed = false;
    protected readOnly: boolean;
    constructor(file: string, options: {
        readOnly?: boolean;
    }, private readonly format: DedicatedSqliteFormat) {
        if (typeof file !== "string" || !file.trim() || !options || typeof options !== "object" || Array.isArray(options) || Object.keys(options).some(k => k !== "readOnly"))
            throw new Error("専用DBパスとreadOnlyを指定してください");
        const readOnly = options.readOnly;
        if (readOnly !== undefined && typeof readOnly !== "boolean")
            throw new Error("readOnlyはbooleanです");
        this.readOnly = readOnly ?? false;
        try {
            if (file === ":memory:") {
                if (this.readOnly)
                    throw new Error("readOnlyのmemory DBは作成できません");
                this.db = new Database(file);
                this.initialize();
                return;
            }
            const target = resolve(file), exists = inspect(target);
            if (!exists) {
                if (this.readOnly)
                    throw new Error("readOnlyのDBがありません");
                const fd = fs.openSync(target, "wx", 0o600);
                fs.closeSync(fd);
                this.db = new Database(target);
                this.initialize();
                return;
            }
            // 未知の既存DBへSQLiteを接続せず、私有コピーで形式を検査します。
            const dir = fs.mkdtempSync(join(tmpdir(), "edinet-observed-archive-")), probe = join(dir, "probe.sqlite");
            this.scratch = dir;
            const input = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
            let output: number | undefined, originalIdentity: string;
            try {
                output = fs.openSync(probe, "wx", 0o600);
                const before = fs.fstatSync(input, { bigint: true });
                if (!before.isFile() || before.nlink !== 1n)
                    throw new Error("通常ファイルが必要です");
                originalIdentity = identity(before);
                const chunk = Buffer.alloc(1024 * 1024);
                let total = 0;
                while (BigInt(total) < before.size) {
                    const remaining = before.size - BigInt(total), n = fs.readSync(input, chunk, 0, remaining > BigInt(chunk.length) ? chunk.length : Number(remaining), null);
                    if (!n)
                        break;
                    let written = 0;
                    while (written < n) {
                        const count = fs.writeSync(output, chunk, written, n - written);
                        if (!count)
                            throw new Error("DBコピーを書き込めません");
                        written += count;
                    }
                    total += n;
                }
                if (BigInt(total) !== before.size || identity(fs.fstatSync(input, { bigint: true })) !== originalIdentity)
                    throw new Error("コピー中にDBが変化しました");
            }
            finally {
                fs.closeSync(input);
                if (output !== undefined)
                    fs.closeSync(output);
            }
            this.snapshotFile = probe;
            this.db = new Database(probe, { readOnly: true });
            this.assertFormat();
            if (!this.readOnly) {
                inspect(target);
                if (identity(fs.statSync(target, { bigint: true })) !== originalIdentity!)
                    throw new Error("形式検査中にDBが変化しました");
                this.db.close();
                this.db = new Database(target);
                this.assertFormat();
                fs.rmSync(dir, { recursive: true, force: true });
                this.scratch = undefined;
            }
        }
        catch (error) {
            try {
                this.db?.close();
            }
            finally {
                this.closed = true;
                if (this.scratch)
                    fs.rmSync(this.scratch, { recursive: true, force: true });
            }
            throw error;
        }
    }
    protected rows(sql: string, args: SQLInputValue[] = []): Record<string, unknown>[] {
        if (this.closed)
            throw new Error("専用DBはclose済みです");
        const s = this.db.prepare(sql);
        try {
            return s.all(...args) as Record<string, unknown>[];
        }
        finally {
            s.close();
        }
    }
    protected run(sql: string, args: SQLInputValue[] = []) {
        const s = this.db.prepare(sql);
        try {
            s.run(...args);
        }
        finally {
            s.close();
        }
    }
    private initialize() {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            for (const sql of Object.values(this.format.schema))
                this.db.exec(sql);
            this.run(`INSERT INTO ${this.format.table} VALUES(?)`, [this.format.kind]);
            this.db.exec("COMMIT");
        }
        catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
        }
        this.assertFormat();
    }
    private assertFormat() {
        const objects = this.rows("SELECT name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'");
        if (objects.length !== Object.keys(this.format.schema).length || objects.some(o => typeof o.name !== "string" || !Object.hasOwn(this.format.schema, o.name) || typeof o.sql !== "string" || normalized(o.sql) !== normalized(this.format.schema[o.name])))
            throw new Error("専用DBの固定schema以外は使えません");
        const meta = this.rows(`SELECT kind FROM ${this.format.table}`);
        if (meta.length !== 1 || meta[0].kind !== this.format.kind)
            throw new Error("非対応の専用DB形式です");
    }
    protected transaction<T>(fn: () => T, write = true): T {
        if (this.closed)
            throw new Error("専用DBはclose済みです");
        if (write && this.readOnly)
            throw new Error("readOnlyの専用DBです");
        this.db.exec(write ? "BEGIN IMMEDIATE" : "BEGIN");
        try {
            this.assertFormat();
            const r = fn();
            this.db.exec("COMMIT");
            return r;
        }
        catch (e) {
            this.db.exec("ROLLBACK");
            throw e;
        }
    }
    /** 非同期workerの状態DBを一件の処理中だけ排他します。原本DBは別commitです。 */
    protected async transactionAsync<T>(fn: () => Promise<T>): Promise<T> {
        if (this.closed || this.readOnly)
            throw new Error("close済み/readOnlyの専用DBです");
        this.db.exec("BEGIN IMMEDIATE");
        try {
            this.assertFormat();
            const result = await fn();
            this.db.exec("COMMIT");
            return result;
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    protected readOnlySnapshotSha256(): string {
        if (this.closed || !this.readOnly || !this.snapshotFile)
            throw new Error("固定したreadOnlyファイルが必要です");
        const fd = fs.openSync(this.snapshotFile, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | fs.constants.O_NOFOLLOW);
        try {
            const before = fs.fstatSync(fd, { bigint: true });
            if (!before.isFile() || before.nlink !== 1n)
                throw new Error("単一リンクの通常ファイルが必要です");
            // 読取専用の私有コピー。同じinode/size/mtime/ctimeの指紋だけ再利用します。
            const currentIdentity = identity(before);
            if (this.snapshotFingerprint) {
                if (currentIdentity !== this.snapshotFingerprint.identity)
                    throw new Error("固定したsnapshotが変化しました");
                return this.snapshotFingerprint.sha256;
            }
            const digest = createHash("sha256"), chunk = Buffer.alloc(1024 * 1024);
            let bytes = 0;
            while (BigInt(bytes) < before.size) {
                const remaining = before.size - BigInt(bytes), n = fs.readSync(fd, chunk, 0, remaining > BigInt(chunk.length) ? chunk.length : Number(remaining), null);
                if (!n)
                    break;
                digest.update(chunk.subarray(0, n));
                bytes += n;
            }
            if (BigInt(bytes) !== before.size || identity(before) !== identity(fs.fstatSync(fd, { bigint: true })))
                throw new Error("指紋計算中にDBが変化しました");
            const sha256 = digest.digest("hex");
            this.snapshotFingerprint = { identity: currentIdentity, sha256 };
            return sha256;
        }
        finally {
            fs.closeSync(fd);
        }
    }
    close() {
        if (this.closed)
            return;
        this.db.close();
        this.closed = true;
        if (this.scratch)
            fs.rmSync(this.scratch, { recursive: true, force: true });
    }
}
