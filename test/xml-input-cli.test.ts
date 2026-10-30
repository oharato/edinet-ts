import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, openSync, ftruncateSync, closeSync, writeSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { LOCAL_IMPORT_LIMITS } from "../src/local-balance-sheet-import";
import { instance, fact } from "./fixtures/metric-boundaries";
const cli = resolve("src/cli.ts"), loader = resolve("node_modules/tsx/dist/loader.mjs");
const entry = { file: "source.xbrl", secCode: "1001", docID: "SYNTHETIC1", scope: "Consolidated", accountingStandard: "J-GAAP", instant: "2025-03-31" };
const xml = instance(fact("100", "", "jppfs_cor:CurrentAssets"));
function fixture(action: (dir: string, run: () => ReturnType<typeof spawnSync>) => void) {
    const dir = mkdtempSync(join(tmpdir(), "xml-input-cli-"));
    try {
        writeFileSync(join(dir, "source.xbrl"), xml); writeFileSync(join(dir, "manifest.json"), JSON.stringify([entry]));
        action(dir, () => spawnSync(process.execPath, ["--import", loader, cli, "screen-bs", "--manifest", join(dir, "manifest.json")], { cwd: "/tmp", encoding: "utf8", timeout: 30000 }));
    } finally { rmSync(dir, { recursive: true, force: true }); }
}
describe("screen-bsの有限読取り", () => {
    it("通常XML/BOMを処理し元ファイルを変えない", () => fixture((dir, run) => {
        const content = '\ufeff<?xml version="1.0" encoding="UTF-8"?>' + xml; writeFileSync(join(dir, "source.xbrl"), content);
        const result = run(); expect(result.status, String(result.stderr)).toBe(0); expect(JSON.parse(String(result.stdout)).excludedRows).toBe(1);
        expect(readFileSync(join(dir, "source.xbrl"), "utf8")).toBe(content);
    }));
    it.each(["manifest-bytes", "source-bytes", "entry-count", "manifest-utf8", "source-utf8", "directory", "doctype"])("%sをstderr/nonzeroで拒否し原本を変えない", kind => fixture((dir, run) => {
        const manifest = join(dir, "manifest.json"), source = join(dir, "source.xbrl");
        if (kind === "manifest-bytes" || kind === "source-bytes") {
            const file = kind === "manifest-bytes" ? manifest : source;
            const fd = openSync(file, "w"); try { ftruncateSync(fd, (kind === "manifest-bytes" ? LOCAL_IMPORT_LIMITS.manifestBytes : LOCAL_IMPORT_LIMITS.sourceBytes) + 1); } finally { closeSync(fd); }
        }
        if (kind === "entry-count") writeFileSync(manifest, JSON.stringify(Array.from({ length: 101 }, () => entry)));
        if (kind === "manifest-utf8" || kind === "source-utf8") writeFileSync(kind === "manifest-utf8" ? manifest : source, new Uint8Array([0xc0, 0xaf]));
        if (kind === "directory") writeFileSync(manifest, JSON.stringify([{ ...entry, file: "." }]));
        if (kind === "doctype") writeFileSync(source, '<!DOCTYPE xbrli:xbrl SYSTEM "https://example.invalid/never-fetch.dtd">' + xml);
        const result = run(); expect(result.error).toBeUndefined(); expect(result.status).toBe(1); expect(String(result.stdout)).toBe(""); expect(String(result.stderr)).not.toBe("");
        if (kind === "entry-count") expect(String(result.stderr)).toContain("100件");
        if (kind === "manifest-bytes" || kind === "source-bytes") expect(String(result.stderr)).toContain("byte上限");
        if (kind === "doctype") expect(String(result.stderr)).toContain("DOCTYPE");
    }));
    it("合計上限超過は先頭の不正XMLを解析する前に拒否する", () => fixture((dir, run) => {
        writeFileSync(join(dir, "source.xbrl"), "<broken PRIVATE_SOURCE");
        const large = join(dir, "large.xbrl"), fd = openSync(large, "w");
        try { ftruncateSync(fd, LOCAL_IMPORT_LIMITS.sourceBytes); } finally { closeSync(fd); }
        writeFileSync(join(dir, "manifest.json"), JSON.stringify([entry, ...Array.from({ length: 4 }, (_, i) => ({ ...entry, file: "large.xbrl", secCode: String(2000 + i), docID: `LARGE${i}` }))]));
        const result = run(); expect(result.error).toBeUndefined(); expect(result.status).toBe(1);
        expect(result.stdout).toBe(""); expect(String(result.stderr)).toContain("byte上限"); expect(String(result.stderr)).not.toContain("PRIVATE_SOURCE");
        expect(readFileSync(join(dir, "source.xbrl"), "utf8")).toBe("<broken PRIVATE_SOURCE");
    }));
    it("各原本が上限内でも合計256MiB超を拒否", () => fixture((dir, run) => {
        // 合成XML1件を5回指定。4件分はちょうど合計上限、5件目は読取り前に拒否します。
        const prefix = '<x><!--', suffix = '--></x>', length = LOCAL_IMPORT_LIMITS.sourceBytes;
        const fd = openSync(join(dir, "source.xbrl"), "w");
        try {
            writeSync(fd, prefix); let remaining = length - prefix.length - suffix.length;
            const chunk = Buffer.alloc(1024 * 1024, 0x20);
            while (remaining) { const size = Math.min(remaining, chunk.length); writeSync(fd, chunk, 0, size); remaining -= size; }
            writeSync(fd, suffix);
        } finally { closeSync(fd); }
        writeFileSync(join(dir, "manifest.json"), JSON.stringify(Array.from({ length: 5 }, (_, index) => ({ ...entry, secCode: String(1001 + index), docID: `SYNTHETIC${index}` }))));
        const result = run(); expect(result.error).toBeUndefined(); expect(result.status).toBe(1); expect(String(result.stdout)).toBe(""); expect(String(result.stderr)).toContain("byte上限");
    }), 30000);
});
