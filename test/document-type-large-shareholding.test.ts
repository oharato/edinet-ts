import { afterEach, describe, expect, it, vi } from "vitest";
import { EdinetDocumentType, isFinancialReport, isLargeShareholding } from "../src/edinet-document-type";
import { resolveCliDocumentType } from "../src/cli-document-type";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";

// 公式仕様（EDINET API仕様書 Version 2、2026年6月）第4章と実APIサンプルに基づく:
// 350=大量保有報告書（変更報告書も同じ350、様式コード010002等で区別）、360=訂正大量保有報告書、
// 340=訂正別途買付け禁止の特例を受けるための申出書、330=同申出書、370=基準日の届出書、380=変更の届出書。
describe("大量保有関係の書類種別コード是正", () => {
    afterEach(() => vi.restoreAllMocks());
    it("大量保有は350、訂正は360、340は別途買付けの訂正申出書", () => {
        expect(EdinetDocumentType.LargeShareholdingReport).toBe("350");
        expect(EdinetDocumentType.CorrectionReport).toBe("360");
        expect(EdinetDocumentType.SeparatePurchaseProhibitionException).toBe("330");
        expect(EdinetDocumentType.AmendedSeparatePurchaseProhibitionException).toBe("340");
        expect(EdinetDocumentType.RecordDateNotification).toBe("370");
        expect(EdinetDocumentType.ChangeNotification).toBe("380");
    });
    it("変更報告書の旧名は互換のため350の別名として残る", () => {
        expect(EdinetDocumentType.ChangeReport).toBe("350");
        expect(EdinetDocumentType.ChangeReport).toBe(EdinetDocumentType.LargeShareholdingReport);
    });
    it("isLargeShareholdingは350と360だけを対象にする", () => {
        expect(isLargeShareholding("350")).toBe(true);
        expect(isLargeShareholding("360")).toBe(true);
        expect(isLargeShareholding("340")).toBe(false);
        expect(isLargeShareholding("330")).toBe(false);
        expect(isLargeShareholding("380")).toBe(false);
        expect(isLargeShareholding("120")).toBe(false);
        expect(isFinancialReport("350")).toBe(false);
    });
    it("CLIのlargeshareholdingは350と360で、340を含めない", () => {
        expect(resolveCliDocumentType("largeshareholding")).toEqual(["350", "360"]);
        expect(resolveCliDocumentType("350")).toBe("350");
        expect(resolveCliDocumentType("360")).toBe("360");
        expect(resolveCliDocumentType("correction")).toBe("360");
    });
    it("CLIの340は大量保有ではなく訂正別途買付け申出書になる", () => {
        expect(resolveCliDocumentType("340")).toBe("340");
        expect(resolveCliDocumentType("340")).toBe(EdinetDocumentType.AmendedSeparatePurchaseProhibitionException);
        expect(resolveCliDocumentType("330")).toBe("330");
        expect(resolveCliDocumentType("370")).toBe("370");
        expect(resolveCliDocumentType("380")).toBe("380");
    });
    it("旧changeは互換のため350のまま（初回報告書も含む）", () => {
        expect(resolveCliDocumentType("change")).toBe("350");
    });
    it("型ヘルプで大量保有350/360と340の違いを案内する", () => {
        const result = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), "get", "--help-types"], { cwd: "/tmp", encoding: "utf8", maxBuffer: 4 * 1024 * 1024 });
        expect(result.status).toBe(0);
        expect(result.stdout).toContain("LargeShareholding (大量保有報告書) [350/360]");
        expect(result.stdout).toContain("340は訂正別途買付け禁止の特例を受けるための申出書です");
        expect(result.stdout).not.toContain("[340/350/360]");
    });
    it("合成一覧から350と360だけを抽出し、340を混ぜない", async () => {
        const results = ["330", "340", "350", "360", "370"].map(code => ({ docID: `SYNTHETIC-${code}`, secCode: null,
            docDescription: null, docTypeCode: code, docInfoEditStatus: "0" }));
        const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({
            metadata: { status: "200", resultset: { count: results.length } }, results
        })));
        const client = new EdinetXbrlDownloader({ apiKey: "synthetic-key", enableRateLimit: false });
        const large = await client.search("2026-01-01", resolveCliDocumentType("largeshareholding"));
        expect(large.map(row => row.docID)).toEqual(["SYNTHETIC-350", "SYNTHETIC-360"]);
        expect(fetchMock).toHaveBeenCalledTimes(1);
    });
});
