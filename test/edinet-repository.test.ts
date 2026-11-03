import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EdinetRepository } from "../src/db/edinet-repository";
import { Database } from "../src/db/node-sqlite";
import type { EdinetDocument } from "../src/edinet-xbrl-downloader";

const repositories: EdinetRepository[] = [];
const directories: string[] = [];
const repository = (file = ":memory:", options = {}) => {
    const repo = new EdinetRepository(file, options);
    repositories.push(repo);
    return repo;
};
const temporaryPath = () => {
    const dir = mkdtempSync(join(tmpdir(), "edinet-sqlite-"));
    directories.push(dir);
    return join(dir, "metadata.db");
};
const doc = (docID: string, extra: Partial<EdinetDocument> = {}): EdinetDocument => ({
    docID, secCode: "01230", filerName: "合成テスト会社", docTypeCode: "120",
    docDescription: "合成報告書", docInfoEditStatus: 0, periodEnd: "2024-03-31", ...extra
});
afterEach(() => {
    for (const repo of repositories.splice(0)) {
        try { repo.close(); } catch { /* 明示的close済みのテストもあるため */ }
    }
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Node標準SQLiteへの書類DB移行", () => {
    it("旧スキーマを維持し、文字列コード/全field/通常prototypeの行を返す", () => {
        const repo = repository();
        repo.insertDocument(doc("EXAMPLE"), "2024-06-25");
        const rows = repo.findDocuments({ secCode: "01230" });
        expect(rows).toEqual([{
            docID: "EXAMPLE", secCode: "01230", filerName: "合成テスト会社", docTypeCode: "120",
            submitDate: "2024-06-25", periodEnd: "2024-03-31", docDescription: "合成報告書"
        }]);
        expect(Object.getPrototypeOf(rows[0])).toBe(Object.prototype);
        expect(repo.hasMetadataForDate("2024-06-25")).toBe(true);
        expect(repo.hasMetadataForDate("2024-06-26")).toBe(false);
    });
    it("旧SQLite schemaの既存ファイルを開き、同じDBで追加と検索ができる", () => {
        const file = temporaryPath();
        const legacy = new Database(file);
        legacy.exec(`CREATE TABLE documents (doc_id TEXT PRIMARY KEY, sec_code TEXT, filer_name TEXT,
            doc_type_code TEXT, submit_date TEXT, period_end TEXT, doc_description TEXT);
            INSERT INTO documents VALUES ('OLD', '01230', '既存合成会社', '120', '2023-06-25', '2023-03-31', '既存合成書類');`);
        legacy.close();
        const repo = repository(file);
        repo.insertDocument(doc("NEW"), "2024-06-25");
        expect(repo.findDocuments({ secCode: "01230" }).map(row => row.docID)).toEqual(["NEW", "OLD"]);
    });
    it("0件の過去一覧を再open後も完了と区別し、単独挿入は完了としない", () => {
        const file = temporaryPath(), writer = repository(file);
        writer.saveDocumentList([], "2024-06-25");
        writer.insertDocument(doc("PARTIAL"), "2024-06-26");
        expect(writer.hasCompleteListForDate("2024-06-25")).toBe(true);
        expect(writer.hasMetadataForDate("2024-06-25")).toBe(false);
        expect(writer.hasCompleteListForDate("2024-06-26")).toBe(false);
        writer.close();
        expect(repository(file, { readOnly: true }).hasCompleteListForDate("2024-06-25")).toBe(true);
    });
    it("一覧保存に失敗した日は完了証跡を残さない", () => {
        const file = temporaryPath(), repo = repository(file), admin = new Database(file);
        admin.exec(`CREATE TRIGGER fail_list BEFORE INSERT ON documents WHEN NEW.doc_id='BAD' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;`);
        admin.close();
        expect(() => repo.saveDocumentList([doc("GOOD"), doc("BAD")], "2024-06-25")).toThrow();
        expect(repo.findDocuments({})).toEqual([]);
        expect(repo.hasCompleteListForDate("2024-06-25")).toBe(false);
        repo.saveDocumentList([], "2024-06-25");
        expect(repo.hasCompleteListForDate("2024-06-25")).toBe(true);
    });
    it("再取得した同書類の原観測を上書きせず、knownAtと再開位置で読む", () => {
        const repo = repository();
        repo.saveDocumentList([doc("A", { filerName: "旧名" })], "2024-06-25");
        repo.saveDocumentList([doc("A", { filerName: "新名" })], "2024-06-25");
        const rows = repo.getDocumentObservations({ docID: "A" });
        expect(rows.map(row => row.document.filerName)).toEqual(["旧名", "新名"]);
        expect(repo.getDocumentObservations({ afterSequence: rows[0].sequence })).toEqual([rows[1]]);
        expect(repo.getDocumentObservations({ knownAt: "2000-01-01T00:00:00Z" })).toEqual([]);
        expect(repo.findDocuments({})[0].filerName).toBe("旧名");
        expect(() => repo.getDocumentObservations({ limit: 10001 })).toThrow();
    });
    it("batchは同一transaction、重複IDは従来どおりIGNORE", () => {
        const repo = repository();
        repo.insertBatch([doc("A"), doc("B"), doc("A", { filerName: "上書きしない" })], "2024-06-25");
        expect(repo.findDocuments({})).toHaveLength(2);
        expect(repo.findDocuments({ filerName: "上書き" })).toEqual([]);
    });
    it("途中でSQLiteエラーが発生したbatch全体をrollbackし、接続を再利用できる", () => {
        const file = temporaryPath();
        const repo = repository(file);
        repo.insertDocument(doc("EXISTING"), "2024-06-25");
        const admin = new Database(file);
        admin.exec(`CREATE TRIGGER fail_bad BEFORE INSERT ON documents
            WHEN NEW.doc_id = 'BAD' BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
        admin.close();
        expect(() => repo.insertBatch([doc("GOOD"), doc("BAD")], "2024-06-25")).toThrow("synthetic failure");
        expect(repo.findDocuments({}).map(row => row.docID)).toEqual(["EXISTING"]);
        repo.insertDocument(doc("AFTER"), "2024-06-26");
        expect(repo.findDocuments({})).toHaveLength(2);
    });
    it("bindはNULL/省略値を保持し、SQL文字列を実行コードにしない", () => {
        const repo = repository();
        const literal = "合成会社' OR 1=1 --";
        repo.insertDocument(doc("A", { filerName: literal }), "2024-06-25");
        repo.insertDocument(doc("B", { secCode: null, filerName: undefined, docDescription: null }), "2024-06-25");
        expect(repo.findDocuments({ filerName: literal }).map(row => row.docID)).toEqual(["A"]);
        expect(repo.findDocuments({ secCode: "' OR 1=1 --" })).toEqual([]);
        expect(repo.findDocuments({}).find(row => row.docID === "B")).toMatchObject({ secCode: null, filerName: null, docDescription: null });
    });
    it("提出日・書類種別・期間末順・limitの従来検索を維持", () => {
        const repo = repository();
        repo.insertDocument(doc("OLD", { periodEnd: "2023-03-31" }), "2023-06-25");
        repo.insertDocument(doc("CURRENT"), "2024-06-25");
        repo.insertDocument(doc("OTHER", { docTypeCode: "160" }), "2024-09-25");
        expect(repo.findDocuments({ startDate: "2024-01-01", endDate: "2024-08-01", docTypeCode: "120", limit: 1 }).map(row => row.docID)).toEqual(["CURRENT"]);
    });
    it("read-onlyではschema/ファイル内容を変更せず、書込みは拒否", () => {
        const file = temporaryPath();
        const writer = repository(file);
        writer.insertDocument(doc("A"), "2024-06-25");
        writer.close();
        const hash = () => createHash("sha256").update(readFileSync(file)).digest("hex");
        const before = hash();
        const reader = repository(file, { readOnly: true });
        expect(reader.findDocuments({})).toHaveLength(1);
        expect(() => reader.insertDocument(doc("B"), "2024-06-25")).toThrow(/readonly|read.only/i);
        reader.close();
        expect(hash()).toBe(before);
    });
    it("read-onlyで存在しない親directoryやDBを作らない", () => {
        const file = join(temporaryPath(), "missing", "file.db");
        expect(() => repository(file, { readOnly: true })).toThrow();
        expect(existsSync(file)).toBe(false);
        expect(existsSync(join(file, ".."))).toBe(false);
    });
    it("busy/lockingはtimeoutで失敗し、lock解除後は書込みできる", () => {
        const file = temporaryPath();
        const repo = repository(file, { timeout: 0 });
        const locker = new Database(file);
        try {
            locker.exec("BEGIN IMMEDIATE");
            expect(() => repo.insertDocument(doc("LOCKED"), "2024-06-25")).toThrow(/locked|busy/i);
            locker.exec("ROLLBACK");
            repo.insertDocument(doc("AFTER"), "2024-06-25");
            expect(repo.findDocuments({})).toHaveLength(1);
        } finally {
            if (locker.isTransaction) locker.exec("ROLLBACK");
            locker.close();
        }
    });
    it("標準APIは同期、safe整数を超える値はBigInt読取を明示する", () => {
        const db = new Database(":memory:");
        try {
            db.exec("CREATE TABLE integers (value INTEGER)");
            const insert = db.prepare("INSERT INTO integers VALUES (?)");
            const result = insert.run(9007199254740993n);
            expect(result).not.toHaveProperty("then");
            insert.close();
            const read = db.prepare("SELECT value FROM integers");
            expect(() => read.get()).toThrow();
            read.setReadBigInts(true);
            expect(read.get()?.value).toBe(9007199254740993n);
            read.close();
        } finally { db.close(); }
    });
});
