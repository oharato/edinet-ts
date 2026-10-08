import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import { EdinetDocumentType } from "../src/edinet-document-type";

const document = (overrides: Record<string, unknown> = {}) => ({
    secCode: "72030",
    docID: "S100TEST",
    docDescription: "有価証券報告書",
    docTypeCode: EdinetDocumentType.AnnualCards,
    docInfoEditStatus: "0",
    ...overrides
});
const list = (results: unknown[]) => ({
    metadata: { status: "200", resultset: { count: results.length } },
    results
});

describe("書類一覧の応答検証", () => {
    const fetchMock = vi.fn();
    let downloader: EdinetXbrlDownloader;
    const respond = (body: unknown) => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => body });
    };

    beforeEach(() => {
        vi.stubGlobal("fetch", fetchMock);
        fetchMock.mockReset();
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        downloader = new EdinetXbrlDownloader({ apiKey: "test-key", enableRateLimit: false });
    });
    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    it.each(["0", "1", "2", 0, 1, 2])("区分 %s を従来の数値型に正規化する", async status => {
        const raw = document({ docInfoEditStatus: status, periodEnd: "2024-03-31", futureField: { value: 7 } });
        respond(list([raw]));
        const [result] = await downloader.search("2024-06-25");
        expect(result).toEqual({ ...raw, docInfoEditStatus: Number(status) });
        expect(raw.docInfoEditStatus).toBe(status);
    });

    it("取下げ済み等の nullable 項目を保持する", async () => {
        const raw = document({ secCode: null, docTypeCode: null, docDescription: null,
            filerName: null, edinetCode: null, submitDateTime: null, withdrawalStatus: "2" });
        respond(list([raw]));
        expect(await downloader.search("2024-06-25")).toEqual([{ ...raw, docInfoEditStatus: 0 }]);
        expect(await downloader.search("2024-06-25", EdinetDocumentType.AnnualCards)).toEqual([]);
    });

    it("正常な 0 件の応答だけを空配列として返す", async () => {
        respond(list([]));
        expect(await downloader.search("2024-06-25")).toEqual([]);
    });

    it("単一種別と複数種別のフィルタを維持する", async () => {
        const annual = document();
        const semiAnnual = document({ docID: "S100SEMI", docTypeCode: EdinetDocumentType.SemiAnnualReport });
        respond(list([annual, semiAnnual]));
        expect((await downloader.search("2024-06-25", EdinetDocumentType.AnnualCards)).map(d => d.docID)).toEqual(["S100TEST"]);
        expect((await downloader.search("2024-06-25", [EdinetDocumentType.AnnualCards, EdinetDocumentType.SemiAnnualReport])).map(d => d.docID)).toEqual(["S100TEST", "S100SEMI"]);
        expect(await downloader.search("2024-06-25", [])).toEqual([]);
    });

    it("HTTP エラーをそのまま失敗として扱う", async () => {
        fetchMock.mockResolvedValue({ ok: false, status: 400, statusText: "Bad Request" });
        await expect(downloader.search("2024-06-25")).rejects.toThrow("Failed to fetch documents list: Bad Request");
    });

    it("不正 JSON を空配列に変換しない", async () => {
        fetchMock.mockResolvedValue({ ok: true, json: async () => { throw new SyntaxError("Invalid JSON"); } });
        await expect(downloader.search("2024-06-25")).rejects.toThrow("Invalid JSON");
    });

    it("数値の metadata.status も互換的に受け入れる", async () => {
        respond({ metadata: { status: 200, resultset: { count: 0 } }, results: [] });
        expect(await downloader.search("2024-06-25")).toEqual([]);
    });

    it.each(["200", 200])("互換的な成功 statusCode %s を受け入れる", async statusCode => {
        respond({ ...list([]), statusCode });
        expect(await downloader.search("2024-06-25")).toEqual([]);
    });

    it.each([
        { statusCode: 401, message: "Access denied" },
        { statusCode: "401", message: "Access denied" },
        { metadata: { status: "400", message: "Bad Request" } },
        { metadata: { status: 404, message: "Not Found" } }
    ])("HTTP 200 のエラー JSON を 0 件と誤認しない: %j", async body => {
        respond(body);
        await expect(downloader.search("2024-06-25")).rejects.toThrow("API Error:");
    });

    it.each([
        null, [], "invalid", {}, { results: [] }, { metadata: null, results: [] },
        { metadata: { status: null }, results: [] },
        { metadata: { status: "200", resultset: { count: 0 } } },
        { ...list([]), results: null }, { ...list([]), results: {} },
        { ...list([]), results: "" },
        { metadata: { status: "200", resultset: { count: "0" } }, results: [] },
        { metadata: { status: "200", resultset: { count: 1 } }, results: [] },
        { metadata: { status: "200", resultset: { count: -1 } }, results: [] },
        { metadata: { status: "200" }, results: [] }
    ])("不正な応答を拒否する: %j", async body => {
        respond(body);
        await expect(downloader.search("2024-06-25")).rejects.toThrow("Invalid EDINET documents response");
    });

    it.each([null, [], {}, document({ docID: " " }), document({ docID: 1 }),
        document({ secCode: undefined }), document({ secCode: 72030 }),
        document({ docDescription: false }), document({ docTypeCode: 120 }),
        document({ filerName: {} }), document({ submitDateTime: 1 })
    ])("不正なレコードを無視せず全応答を拒否する: %j", async invalid => {
        respond(list([document(), invalid]));
        await expect(downloader.search("2024-06-25")).rejects.toThrow("results[1]");
    });

    it.each([undefined, null, "", " 0", "00", "3", 3, false, true, {}, [], 0.5])("区分 %j を 0 に誤変換しない", async status => {
        respond(list([document({ docInfoEditStatus: status })]));
        await expect(downloader.search("2024-06-25")).rejects.toThrow("docInfoEditStatus");
    });

    it.each(["0", 0])("findLatest が区分 %s の対象書類を検索できる", async status => {
        respond(list([
            document({ docID: "S100OTHER", secCode: "99990" }),
            document({ docID: "S100EDIT", docInfoEditStatus: "1" }),
            document({ docID: "S100WRONG", docTypeCode: EdinetDocumentType.SemiAnnualReport }),
            document({ docInfoEditStatus: status })
        ]));
        expect((await downloader.findLatest("7203", EdinetDocumentType.AnnualCards, 1))?.docID).toBe("S100TEST");
    });

    it.each(["0", 0])("downloadByTicker が区分 %s の書類だけをダウンロードする", async status => {
        respond(list([
            document({ docID: "S100OTHER", secCode: "99990" }),
            document({ docID: "S100EDIT", docInfoEditStatus: "2" }),
            document({ docID: "S100WRONG", docTypeCode: EdinetDocumentType.SemiAnnualReport }),
            document({ docInfoEditStatus: status })
        ]));
        const download = vi.spyOn(downloader, "download").mockResolvedValue("/fixture/report.xbrl");
        expect(await downloader.downloadByTicker("7203", "/fixture", "2024-06-25")).toBe("/fixture/report.xbrl");
        expect(download).toHaveBeenCalledExactlyOnceWith("S100TEST", "/fixture");
    });

    it("区分 1/2 を従来の条件どおり選択しない", async () => {
        respond(list([document({ docInfoEditStatus: "1" }), document({ docInfoEditStatus: "2" })]));
        const download = vi.spyOn(downloader, "download");
        expect(await downloader.findLatest("7203", EdinetDocumentType.AnnualCards, 1)).toBeNull();
        expect(await downloader.downloadByTicker("7203", "/fixture", "2024-06-25")).toBeNull();
        expect(download).not.toHaveBeenCalled();
    });
});
