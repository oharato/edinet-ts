import { afterEach, describe, expect, it, vi } from "vitest";
import { EdinetDocumentType, isFinancialReport, isLargeShareholding } from "../src/edinet-document-type";
import { resolveCliDocumentType } from "../src/cli-document-type";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";

describe("通知書010と届出書030の区別", () => {
    afterEach(() => vi.restoreAllMocks());
    it("旧名の値を変更せず、正しい2種類を追加する", () => {
        expect(EdinetDocumentType.SecuritiesRegistrationStatement).toBe("010");
        expect(EdinetDocumentType.SecuritiesNotice).toBe("010");
        expect(EdinetDocumentType.RegistrationStatement).toBe("030");
        expect(EdinetDocumentType.AmendedSecuritiesRegistrationStatement).toBe("040");
        expect(isFinancialReport("030")).toBe(false); expect(isLargeShareholding("030")).toBe(false);
    });
    it.each(["registration-statement", "REGISTRATION-STATEMENT", "030"])("%s は届出書030", input => {
        expect(resolveCliDocumentType(input)).toBe("030");
    });
    it.each(["securities-notice", "SECURITIES-NOTICE", "010", "registration"])("%s は通知書010（旧名も維持）", input => {
        expect(resolveCliDocumentType(input)).toBe("010");
    });
    it.each(["annual", "120", "unknown", "constructor", "__proto__"])("%s の有報既定値は維持", input => {
        expect(resolveCliDocumentType(input)).toBe("120");
    });
    it("訂正040の既存指定は変更しない", () => {
        expect(resolveCliDocumentType("amended")).toBe("040");
    });
    it.each(["download", "get"])("%s の実CLI helpで030と010を案内する（取得なし）", command => {
        const result = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), command, "--help"], { cwd: "/tmp", encoding: "utf8" });
        expect(result.status).toBe(0); expect(result.stdout).toContain("registration-statement/030");
        expect(result.stdout).toContain("securities-notice/010"); expect(result.stderr).toBe("");
    });
    it("型ヘルプでも届出書030と旧registration010を区別する", () => {
        const result = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), "get", "--help-types"], { cwd: "/tmp", encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
        expect(result.status).toBe(0); expect(result.stdout).toContain("registration-statement (有価証券届出書) [030]");
        expect(result.stdout).toContain("旧 registration は互換用に010のまま");
        expect(result.stdout).not.toContain("有価証券届出書) [010]");
    });
    it("合成一覧から010と030を別々に抽出し、040を混ぜない", async () => {
        const results = ["010", "030", "040", "120"].map(code => ({ docID: `SYNTHETIC-${code}`, secCode: null,
            docDescription: null, docTypeCode: code, docInfoEditStatus: "0" }));
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
            metadata: { status: "200", resultset: { count: results.length } }, results
        })));
        const client = new EdinetXbrlDownloader({ apiKey: "synthetic-key", enableRateLimit: false });
        const notice = await client.search("2026-01-01", resolveCliDocumentType("securities-notice"));
        const statement = await client.search("2026-01-01", resolveCliDocumentType("030"));
        expect(notice.map(row => row.docID)).toEqual(["SYNTHETIC-010"]);
        expect(statement.map(row => row.docID)).toEqual(["SYNTHETIC-030"]);
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
});
