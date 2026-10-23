import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { XLSX } from "../scripts/utils/spreadsheet";

describe("最新依存とNode26の利用経路", () => {
    it("commanderのversion/help/不正引数とparseのJSON出力を維持", () => {
        const cli = resolve(__dirname, "../src/cli.ts");
        const args = ["--import", "tsx", cli];
        expect(execFileSync(process.execPath, [...args, "--version"], { encoding: "utf8" }).trim()).toBe("1.1.17");
        expect(execFileSync(process.execPath, [...args, "parse", "--help"], { encoding: "utf8" })).toContain("--file");
        const fixture = resolve(__dirname, "test_data/3031_raccoon.xbrl");
        const result = execFileSync(process.execPath, [...args, "parse", "--file", fixture], { encoding: "utf8" });
        expect(JSON.parse(result).netSales).toBeTypeOf("number");
        const invalid = spawnSync(process.execPath, [...args, "parse", "--file", fixture, "--unknown"], { encoding: "utf8" });
        expect(invalid.status).toBe(1);
        expect(invalid.stdout).toBe("");
        expect(invalid.stderr).toMatch(/unknown option/);
    });
    it("SheetJS公式更新でも生成スクリプトが使うsheet選択・列位置・文字列を保持", () => {
        const dir = mkdtempSync(join(tmpdir(), "edinet-xlsx-"));
        try {
            const file = join(dir, "AccountList.xlsx");
            const rows = [["header"], [], [null, "合成項目", null, null, null, null, null, "jppfs_cor", "SyntheticFact", "monetaryItemType", "00123"]];
            const book = XLSX.utils.book_new();
            XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(rows), "一般商工業");
            writeFileSync(file, XLSX.write(book, { type: "buffer", bookType: "xlsx" }));
            const restored = XLSX.readFile(file);
            const parsed = XLSX.utils.sheet_to_json<unknown[]>(restored.Sheets["一般商工業"], { header: 1 });
            expect(parsed[2][1]).toBe("合成項目");
            expect(parsed[2].slice(7, 11)).toEqual(["jppfs_cor", "SyntheticFact", "monetaryItemType", "00123"]);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
