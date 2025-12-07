import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";

// Mock fetch
const fetchMock = vi.fn();
global.fetch = fetchMock;

describe("EdinetXbrlDownloader", () => {
    const TEST_KEY = "test-api-key";

    beforeEach(() => {
        vi.resetAllMocks();
        delete process.env.EDINET_API_KEY;
        delete process.env.EDINET_DOWNLOAD_DIR;
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("Constructor", () => {
        /**
         * APIキーが指定されていない場合に警告ログが出ることを確認します。
         */
        it("logs warning if no API key provided", () => {
            const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => { });
            new EdinetXbrlDownloader();
            expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("EDINET_API_KEY is not provided"));
            consoleSpy.mockRestore();
        });

        /**
         * コンストラクタ引数でAPIキーを受け入れられることを確認します。
         */
        it("accepts API key from argument", () => {
            const instance = new EdinetXbrlDownloader({ apiKey: TEST_KEY });
            expect(instance["apiKey"]).toBe(TEST_KEY);
        });

        /**
         * 環境変数（EDINET_API_KEY）からAPIキーを受け入れることを確認します。
         */
        it("accepts API key from environment variable", () => {
            process.env.EDINET_API_KEY = "env-key";
            const instance = new EdinetXbrlDownloader();
            expect(instance["apiKey"]).toBe("env-key");
        });

        /**
         * 引数と環境変数の両方がある場合、引数が優先されることを確認します。
         */
        it("prioritizes argument over environment variable", () => {
            process.env.EDINET_API_KEY = "env-key";
            const instance = new EdinetXbrlDownloader({ apiKey: "arg-key" });
            expect(instance["apiKey"]).toBe("arg-key");
        });
    });

    describe("downloadByTicker", () => {
        /**
         * ディレクトリ指定引数がない場合、環境変数（EDINET_DOWNLOAD_DIR）がフォールバックとして使用されることを確認します。
         */
        it("uses EDINET_DOWNLOAD_DIR if targetDir not provided", async () => {
            process.env.EDINET_DOWNLOAD_DIR = "/tmp/downloads";
            const downloader = new EdinetXbrlDownloader({ apiKey: TEST_KEY });

            // "Target directory is missing" エラーにならないことを確認します（fetchエラー等別のエラーになるのは許容）
            // fetchMock needs to return a response structure that doesn't crash before the directory check logic (if any) or confirms logic proceeds
            fetchMock.mockResolvedValueOnce({
                ok: false,
                statusText: "Mock Fail"
            });

            await expect(downloader.download("doc1")).rejects.toThrow("Failed to download document doc1");
        });
    });
});
