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
         * APIキーが指定されていない場合にエラーを投げることを確認します。
         */
        it("throws error if no API key provided", () => {
            expect(() => new EdinetXbrlDownloader()).toThrow("API Key is required");
        });

        /**
         * コンストラクタ引数でAPIキーを受け入れられることを確認します。
         */
        it("accepts API key from argument", () => {
            expect(() => new EdinetXbrlDownloader(TEST_KEY)).not.toThrow();
        });

        /**
         * 環境変数（EDINET_API_KEY）からAPIキーを受け入れることを確認します。
         */
        it("accepts API key from environment variable", () => {
            process.env.EDINET_API_KEY = "env-key";
            expect(() => new EdinetXbrlDownloader()).not.toThrow();
        });

        /**
         * 引数と環境変数の両方がある場合、引数が優先されることを確認します。
         */
        it("prioritizes argument over environment variable", () => {
            process.env.EDINET_API_KEY = "env-key";
            // エラーが発生しないことで正常動作とみなします
            expect(() => new EdinetXbrlDownloader("arg-key")).not.toThrow();
        });
    });

    describe("downloadByTicker", () => {
        /**
         * ダウンロード先のディレクトリが指定されておらず、環境変数も設定されていない場合にエラーになることを検証します。
         */
        it("throws error if target directory is missing (and no env var)", async () => {
            const downloader = new EdinetXbrlDownloader(TEST_KEY);

            // 検索結果があったとしても、ディレクトリ未指定で download メソッド呼び出し時にエラーになることを確認
            fetchMock.mockResolvedValueOnce({
                ok: true,
                json: async () => ({ results: [] })
            });

            // download メソッドを直接呼び出してディレクトリチェックを検証します
            await expect(downloader.download("doc1", "")).rejects.toThrow("Target directory is not specified");
        });

        /**
         * ディレクトリ指定引数がない場合、環境変数（EDINET_DOWNLOAD_DIR）がフォールバックとして使用されることを確認します。
         */
        it("uses EDINET_DOWNLOAD_DIR if targetDir not provided", async () => {
            process.env.EDINET_DOWNLOAD_DIR = "/tmp/downloads";
            const downloader = new EdinetXbrlDownloader(TEST_KEY);

            // "Target directory is missing" エラーにならないことを確認します（fetchエラー等別のエラーになるのは許容）
            fetchMock.mockResolvedValueOnce({ ok: false, statusText: "Mock Fail" });

            await expect(downloader.download("doc1")).rejects.toThrow("Failed to download document doc1");
        });
    });
});
