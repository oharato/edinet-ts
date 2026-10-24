import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { assertDownloadDocId, findCachedXbrl, persistZipArchive, readCachedXbrl } from "../src/zip-cache";
import { ZIP_LIMITS, type LoadedZipArchive, type ZipArchiveEntry } from "../src/zip-archive";

vi.mock("node:fs", async () => {
    const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
    return { ...actual, writeFileSync: vi.fn(actual.writeFileSync), readSync: vi.fn(actual.readSync), readdirSync: vi.fn(actual.readdirSync) };
});
const temporary: string[] = [];
const temp = () => { const dir = fs.mkdtempSync(join(fs.realpathSync(tmpdir()), "zip-cache-test-")); temporary.push(dir); return dir; };
afterEach(() => { for (const dir of temporary.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); vi.clearAllMocks(); });
const bytes = (value = "<xbrl/>") => new TextEncoder().encode(value);
function archive(values: Record<string, string> = { "XBRL/PublicDoc/main.xbrl": "<xbrl/>" }): LoadedZipArchive {
    const entries = Object.entries(values).map(([name, value]) => ({ name, dir: name.endsWith("/"), compressedSize: bytes(value).length, uncompressedSize: bytes(value).length }));
    return { entries, async readEntry(name) { if (!(name in values)) throw new Error("missing"); return bytes(values[name]); } };
}
const fake = (entries: ZipArchiveEntry[]): LoadedZipArchive => ({ entries, readEntry: async () => bytes() });
const entry = (name: string, overrides: Partial<ZipArchiveEntry> = {}): ZipArchiveEntry => ({ name, dir: false, compressedSize: 7, uncompressedSize: 7, ...overrides });
const cache = (root: string, relative: string, value = "<xbrl/>") => { const file = join(root, "doc1", relative); fs.mkdirSync(join(file, ".."), { recursive: true }); fs.writeFileSync(file, value); return file; };

describe("書類IDとcache境界", () => {
    it.each(["doc1", "S100ABC", "A_1-b", "a".repeat(128)])("通常ID %sを受理", id => expect(() => assertDownloadDocId(id)).not.toThrow());
    it.each(["", "unknown", "UNKNOWN", ".", "..", "a/b", "a\\b", "/tmp", "a:b", "a b", "a\0b", "a".repeat(129), null, 1])("危険/不明ID %jを拒否", id => {
        expect(() => assertDownloadDocId(id)).toThrow();
        expect(() => findCachedXbrl(temp(), id as string)).toThrow();
    });
    it("cache無しならnull、探索はrootを作成しない", () => {
        const root = join(temp(), "missing"); expect(findCachedXbrl(root, "doc1")).toBeNull(); expect(fs.existsSync(root)).toBe(false);
    });
    it("全tree検査後にPublicDoc component内の通常XBRLを優先", () => {
        const root = temp(); cache(root, "root.xbrl"); cache(root, "Other/PublicDoc-text.xbrl"); const expected = cache(root, "XBRL/PublicDoc/main.xbrl");
        expect(findCachedXbrl(root, "doc1")).toBe(expected);
        expect(readCachedXbrl(expected)).toBe("<xbrl/>");
    });
    it.each(["empty", "other-only", "docfile", "xbrl-directory"])("既存不正tree %sをcache無しにしない", kind => {
        const root = temp(), dir = join(root, "doc1");
        if (kind === "docfile") fs.writeFileSync(dir, "existing");
        else { fs.mkdirSync(dir); if (kind === "other-only") fs.writeFileSync(join(dir, "other.txt"), "existing"); if (kind === "xbrl-directory") fs.mkdirSync(join(dir, "fake.xbrl")); }
        expect(() => findCachedXbrl(root, "doc1")).toThrow();
        expect(fs.existsSync(dir)).toBe(true);
    });
    it.each(["root", "ancestor", "doc", "file", "late-tree"])("symlink %sを通常cacheより優先して拒否", kind => {
        const base = temp(), real = join(base, "real"); fs.mkdirSync(real);
        let root = real;
        if (kind === "root" || kind === "ancestor") { fs.symlinkSync(real, join(base, "alias"), "dir"); root = kind === "root" ? join(base, "alias") : join(base, "alias", "child"); }
        else if (kind === "doc") { fs.mkdirSync(join(base, "elsewhere")); fs.symlinkSync(join(base, "elsewhere"), join(real, "doc1"), "dir"); }
        else { const good = cache(real, "PublicDoc/good.xbrl"); fs.symlinkSync(good, join(real, "doc1", kind === "file" ? "fake.xbrl" : "z-late")); }
        expect(() => findCachedXbrl(root, "doc1")).toThrow();
    });
    it("特殊ファイルを含むcachetreeを全件検査で拒否", () => {
        const root = temp(); cache(root, "PublicDoc/good.xbrl");
        const fifo = join(root, "doc1", "pipe"); expect(spawnSync("mkfifo", [fifo]).status).toBe(0);
        expect(() => findCachedXbrl(root, "doc1")).toThrow("特殊ファイル");
    });
    it("空または64MiB超のXBRLを拒否", () => {
        const root = temp(), file = cache(root, "main.xbrl", "");
        expect(() => findCachedXbrl(root, "doc1")).toThrow(); expect(() => readCachedXbrl(file)).toThrow();
        fs.truncateSync(file, ZIP_LIMITS.entryBytes + 1);
        expect(() => findCachedXbrl(root, "doc1")).toThrow(); expect(() => readCachedXbrl(file)).toThrow();
    });
    it("cachetree件数を10000以下に制限", () => {
        const root = temp(); cache(root, "main.xbrl");
        vi.mocked(fs.readdirSync).mockImplementationOnce(() => Array(10001).fill("main.xbrl") as any);
        expect(() => findCachedXbrl(root, "doc1")).toThrow("10000");
    });
});

describe("私有stagingからのZIP保存", () => {
    it("未存在rootへ通常nested treeを保存し、余計なstaging/lockを残さない", async () => {
        const base = temp(), root = join(base, "new", "root"), source = archive({ "XBRL/": "", "XBRL/PublicDoc/main.xbrl": "<xbrl/>", "XBRL/AuditDoc/a.txt": "audit" });
        const result = await persistZipArchive(root, "doc1", source, "XBRL/PublicDoc/main.xbrl");
        expect(result).toBe(join(root, "doc1", "XBRL", "PublicDoc", "main.xbrl"));
        expect(findCachedXbrl(root, "doc1")).toBe(result); expect(readCachedXbrl(result)).toBe("<xbrl/>");
        expect(fs.readdirSync(root)).toEqual(["doc1"]);
        expect(fs.statSync(join(root, "doc1")).mode & 0o777).toBe(0o700); expect(fs.statSync(result).mode & 0o777).toBe(0o600);
    });
    it.each(["empty", "other", "valid", "targetfile"])("既存target %sは一切置換しない", async kind => {
        const root = temp(), target = join(root, "doc1");
        if (kind === "targetfile") fs.writeFileSync(target, "unchanged");
        else { fs.mkdirSync(target); if (kind !== "empty") fs.writeFileSync(join(target, kind === "valid" ? "old.xbrl" : "other"), "unchanged"); }
        await expect(persistZipArchive(root, "doc1", archive(), "XBRL/PublicDoc/main.xbrl")).rejects.toThrow("上書き");
        expect(fs.readdirSync(root)).toEqual(["doc1"]);
        if (kind === "targetfile") expect(fs.readFileSync(target, "utf8")).toBe("unchanged");
        else expect(fs.readdirSync(target)).toEqual(kind === "empty" ? [] : [kind === "valid" ? "old.xbrl" : "other"]);
    });
    it("協調lock競合で他者lockを削除しない", async () => {
        const root = temp(), lock = join(root, ".doc1.lock"); fs.writeFileSync(lock, "other");
        await expect(persistZipArchive(root, "doc1", archive(), "XBRL/PublicDoc/main.xbrl")).rejects.toThrow();
        expect(fs.readFileSync(lock, "utf8")).toBe("other"); expect(fs.readdirSync(root)).toEqual([".doc1.lock"]);
    });
    it("並行した同docID保存は一方だけ公開", async () => {
        const root = temp(), source = archive(); let release!: () => void;
        const gate = new Promise<void>(resolve => { release = resolve; });
        const waiting: LoadedZipArchive = { entries: source.entries, async readEntry(name) { await gate; return source.readEntry(name); } };
        const first = persistZipArchive(root, "doc1", waiting, "XBRL/PublicDoc/main.xbrl");
        await expect(persistZipArchive(root, "doc1", source, "XBRL/PublicDoc/main.xbrl")).rejects.toThrow();
        release(); await first; expect(fs.readdirSync(root)).toEqual(["doc1"]);
    });
    it("展開中に現れた空targetも置換せず、自分のstagingだけ片付ける", async () => {
        const root = temp(), source = archive();
        const changed: LoadedZipArchive = { entries: source.entries, async readEntry(name) { fs.mkdirSync(join(root, "doc1")); return source.readEntry(name); } };
        await expect(persistZipArchive(root, "doc1", changed, "XBRL/PublicDoc/main.xbrl")).rejects.toThrow("公開前");
        expect(fs.readdirSync(root)).toEqual(["doc1"]); expect(fs.readdirSync(join(root, "doc1"))).toEqual([]);
    });
    it("entry読取失敗後に部分treeを公開しない", async () => {
        const root = temp(), source = archive({ "first.txt": "saved-first", "main.xbrl": "<xbrl/>" });
        const failing: LoadedZipArchive = { entries: source.entries, async readEntry(name) { if (name === "main.xbrl") throw new Error("read failure"); return source.readEntry(name); } };
        await expect(persistZipArchive(root, "doc1", failing, "main.xbrl")).rejects.toThrow("read failure"); expect(fs.readdirSync(root)).toEqual([]);
    });
    it("部分writeの失敗後も既存treeを変えずstaging/lockを除去", async () => {
        const root = temp(); fs.mkdirSync(join(root, "unrelated")); fs.writeFileSync(join(root, "unrelated", "keep"), "unchanged");
        const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
        vi.mocked(fs.writeFileSync).mockImplementationOnce((fd: any, data: any) => { actual.writeFileSync(fd, data.subarray(0, 1)); throw new Error("disk write failure"); });
        await expect(persistZipArchive(root, "doc1", archive(), "XBRL/PublicDoc/main.xbrl")).rejects.toThrow("disk write failure");
        expect(fs.readdirSync(root)).toEqual(["unrelated"]); expect(fs.readFileSync(join(root, "unrelated", "keep"), "utf8")).toBe("unchanged");
    });
    it("rootがsymlinkまたは祖先がfileなら作成せず拒否", async () => {
        const base = temp(), original = join(base, "original"); fs.mkdirSync(original); fs.symlinkSync(original, join(base, "alias"), "dir");
        await expect(persistZipArchive(join(base, "alias", "new"), "doc1", archive(), "XBRL/PublicDoc/main.xbrl")).rejects.toThrow(); expect(fs.readdirSync(original)).toEqual([]);
        fs.writeFileSync(join(base, "file"), "unchanged");
        await expect(persistZipArchive(join(base, "file", "new"), "doc1", archive(), "XBRL/PublicDoc/main.xbrl")).rejects.toThrow();
    });
    it.each(["../escape.xbrl", "/absolute.xbrl", "a\\bad.xbrl", "C:bad.xbrl", "a//b.xbrl", "a/./b.xbrl", "a/../b.xbrl", "NUL.txt", "COM¹.xbrl", "a. /b.xbrl", "a\u0085.xbrl"])("偽装archiveの危険path %sを独立に拒否", async name => {
        const root = temp(); await expect(persistZipArchive(root, "doc1", fake([entry(name)]), name)).rejects.toThrow(); expect(fs.readdirSync(root)).toEqual([]);
    });
    it.each([
        [entry("main.xbrl"), entry("main.xbrl")], [entry("Main.xbrl"), entry("main.xbrl")],
        [entry("a"), entry("a/main.xbrl")], [entry("A/", { dir: true, uncompressedSize: 0 }), entry("a/main.xbrl")],
        [entry("é/", { dir: true, uncompressedSize: 0 }), entry("e\u0301/main.xbrl")]
    ].map(entries => [entries]))("重複・文字表記・file/dir衝突を拒否", async entries => {
        const root = temp(); await expect(persistZipArchive(root, "doc1", fake(entries), entries.at(-1)!.name)).rejects.toThrow(); expect(fs.readdirSync(root)).toEqual([]);
    });
    it.each([
        [entry("main.xbrl", { uncompressedSize: ZIP_LIMITS.entryBytes + 1 })], [entry("main.xbrl", { compressedSize: -1 })],
        [entry("main.xbrl", { uncompressedSize: NaN })], [entry("main.xbrl", { uncompressedSize: 0 })],
        [entry("main.xbrl/", { dir: true, uncompressedSize: 0 })], Array.from({ length: 10001 }, (_, i) => entry(`${i}.xbrl`)),
        Array.from({ length: 5 }, (_, i) => entry(`${i}.xbrl`, { compressedSize: 1, uncompressedSize: ZIP_LIMITS.entryBytes }))
    ].map(entries => [entries]))("偽装archiveの不正容量/件数を保存前に拒否", async entries => {
        const root = temp(); await expect(persistZipArchive(root, "doc1", fake(entries), entries[0].name)).rejects.toThrow(); expect(fs.readdirSync(root)).toEqual([]);
    });
    it("実展開サイズが申告と異なれば公開しない", async () => {
        const root = temp(); await expect(persistZipArchive(root, "doc1", { entries: [entry("main.xbrl")], readEntry: async () => bytes("longer-content") }, "main.xbrl")).rejects.toThrow("実展開サイズ"); expect(fs.readdirSync(root)).toEqual([]);
    });
});

describe("cacheの厳密UTF-8読取", () => {
    it("BOMとUnicodeを原文字列として保持し不正UTF-8を拒否", () => {
        const root = temp(), file = cache(root, "main.xbrl", "\uFEFF<会社/>"); expect(readCachedXbrl(file)).toBe("\uFEFF<会社/>");
        fs.writeFileSync(file, Buffer.from([0xc3, 0x28])); expect(() => readCachedXbrl(file)).toThrow();
    });
    it("読取中の伸長を検出する", async () => {
        const root = temp(), file = cache(root, "main.xbrl"), actual = await vi.importActual<typeof import("node:fs")>("node:fs");
        vi.mocked(fs.readSync).mockImplementationOnce(((...args: any[]) => { const n = (actual.readSync as any)(...args); fs.appendFileSync(file, "x"); return n; }) as any);
        expect(() => readCachedXbrl(file)).toThrow("変化");
    });
    it("linkや不明fileをread入口でも拒否", () => {
        const root = temp(), file = cache(root, "main.xbrl"), link = join(root, "fake.xbrl"); fs.symlinkSync(file, link);
        expect(() => readCachedXbrl(link)).toThrow(); expect(() => readCachedXbrl(join(root, "missing.xbrl"))).toThrow();
    });
    it("link/..を含む入力でも祖先検査と同じ正規化pathだけを読む", () => {
        const root = temp(), cacheDir = join(root, "cache"), outside = join(root, "outside");
        fs.mkdirSync(cacheDir); fs.mkdirSync(join(outside, "child"), { recursive: true });
        const sentinel = join(outside, "external.xbrl"); fs.writeFileSync(sentinel, "external-sentinel");
        fs.symlinkSync(join(outside, "child"), join(cacheDir, "link"), "dir");
        const ambiguous = `${cacheDir}/link/../external.xbrl`;
        expect(() => readCachedXbrl(ambiguous)).toThrow();
        fs.writeFileSync(join(cacheDir, "external.xbrl"), "normalized-local");
        expect(readCachedXbrl(ambiguous)).toBe("normalized-local");
        expect(fs.readFileSync(sentinel, "utf8")).toBe("external-sentinel");
    });
});
