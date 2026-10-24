import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EdinetXbrlDownloader, EdinetRequestError, EdinetRequestErrorCode } from "../src/edinet-xbrl-downloader";
import { EdinetDocumentType } from "../src/edinet-document-type";
import { RateLimiter } from "../src/utils/rate-limiter";
import { Edinet } from "../src/edinet";

const empty = () => new Response(JSON.stringify({ metadata: { status: "200", resultset: { count: 0 } }, results: [] }));
const client = (extra: ConstructorParameters<typeof EdinetXbrlDownloader>[0] = {}) => new EdinetXbrlDownloader({ apiKey: "SYNTHETIC-KEY", enableRateLimit: false, maxRetries: 0, ...extra });
const never = () => new Promise<never>(() => {});
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function stoppedBody(cancel: () => unknown = () => {}) {
    return new ReadableStream<Uint8Array>({ pull: () => never(), cancel });
}
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("通信の本文完了までの時間制限と中断（合成応答のみ）", () => {
    it.each([0, -1, NaN, Infinity, 1.2, 2147483648])("不正な時間制限 %s を拒否する", timeout => {
        expect(() => client({ requestTimeoutMs: timeout })).toThrow("requestTimeoutMs");
    });
    it.each([-1, NaN, Infinity, 1.1, Number.MAX_SAFE_INTEGER + 1])("不正retry %s を拒否する", maxRetries => {
        expect(() => client({ maxRetries })).toThrow("maxRetries");
    });
    it("ヘッダー後の本文停止をtimeoutにし、cancel永久待ちでも終了する", async () => {
        const cancel = vi.fn(never); const fetch = vi.fn().mockResolvedValue(new Response(stoppedBody(cancel))); vi.stubGlobal("fetch", fetch);
        const checked = expect(client({ requestTimeoutMs: 50 }).search("2026-01-01")).rejects.toMatchObject({ code: "timeout" });
        await flush(); await vi.advanceTimersByTimeAsync(50); await checked;
        expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it("期限省略時でも本文受信中のcaller abortはretryしない", async () => {
        const cancel = vi.fn(never), controller = new AbortController();
        const fetch = vi.fn().mockResolvedValue(new Response(stoppedBody(cancel))); vi.stubGlobal("fetch", fetch);
        const checked = expect(client({ maxRetries: 3 }).search("2026-01-01", undefined, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
        await flush(); controller.abort("SYNTHETIC-SECRET"); await checked; await flush();
        expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it("fetchがsignalを無視しても終了し、遅いResponseを取消す", async () => {
        let finish!: (response: Response) => void; const cancel = vi.fn();
        vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(resolve => { finish = resolve; })));
        const checked = expect(client({ requestTimeoutMs: 20 }).search("2026-01-01")).rejects.toMatchObject({ code: "timeout" });
        await flush(); await vi.advanceTimersByTimeAsync(20); await checked;
        finish(new Response(stoppedBody(cancel))); await flush(); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it("待ち行列内のcaller abortは即終了し、そのfetchを開始しない", async () => {
        let release!: () => void; const first = new ReadableStream<Uint8Array>({ start(c) { release = () => { c.enqueue(new TextEncoder().encode(JSON.stringify({ metadata: { status: "200", resultset: { count: 0 } }, results: [] }))); c.close(); }; } });
        const fetch = vi.fn().mockResolvedValueOnce(new Response(first)).mockImplementation(async () => empty()); vi.stubGlobal("fetch", fetch);
        const d = client(), running = d.search("2026-01-01"), controller = new AbortController(); await flush();
        const queued = expect(d.search("2026-01-02", undefined, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
        controller.abort(); await queued; expect(fetch).toHaveBeenCalledTimes(1);
        release(); await running; expect(await d.search("2026-01-03")).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    });
    it("interval待ちも中断でき、後続ジョブは進む", async () => {
        const limiter = new RateLimiter(1, 1000), task = vi.fn(async () => "ok"); await limiter.schedule(task);
        const controller = new AbortController(), checked = expect(limiter.schedule(task, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
        controller.abort(); await checked; await flush();
        const next = limiter.schedule(task); await vi.advanceTimersByTimeAsync(1000); expect(await next).toBe("ok"); expect(task).toHaveBeenCalledTimes(2);
    });
    it.each([429, 503])("HTTP %sはbodyを取消し、最後の試行では待たない", async status => {
        const cancel = vi.fn(never), fetch = vi.fn().mockImplementation(async () => new Response(stoppedBody(cancel), { status })); vi.stubGlobal("fetch", fetch);
        await expect(client().search("2026-01-01")).rejects.toThrow(`HTTP ${status}`);
        expect(cancel).toHaveBeenCalledTimes(1); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); expect(console.warn).not.toHaveBeenCalled();
    });
    it("retryは最大回数+1通信だけで最後の不要sleepを作らない", async () => {
        const cancel = vi.fn(), fetch = vi.fn().mockImplementation(async () => new Response(stoppedBody(cancel), { status: 503 })); vi.stubGlobal("fetch", fetch);
        const checked = expect(client({ maxRetries: 2 }).search("2026-01-01")).rejects.toThrow("HTTP 503");
        await flush(); expect(fetch).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1000); expect(fetch).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(2000); await checked; expect(fetch).toHaveBeenCalledTimes(3); expect(cancel).toHaveBeenCalledTimes(3);
        expect(console.warn).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    });
    it("retry待ち中の中断は次のfetchを起こさない", async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 503 })), controller = new AbortController(); vi.stubGlobal("fetch", fetch);
        const checked = expect(client({ maxRetries: 3 }).search("2026-01-01", undefined, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
        await flush(); controller.abort(); await checked; await vi.runAllTimersAsync(); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it("成功後にtimer/listenerが残らず、late abortは次回へ影響しない", async () => {
        const fetch = vi.fn().mockImplementation(async () => empty()), controller = new AbortController(); vi.stubGlobal("fetch", fetch);
        const d = client({ requestTimeoutMs: 50 }); expect(await d.search("2026-01-01", undefined, { signal: controller.signal })).toEqual([]);
        expect(vi.getTimerCount()).toBe(0); controller.abort("SECRET"); expect(await d.search("2026-01-02")).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    });
    it("body完了までslotを保持し、timeout後は後続が進む", async () => {
        const fetch = vi.fn().mockResolvedValueOnce(new Response(stoppedBody())).mockImplementation(async () => empty()); vi.stubGlobal("fetch", fetch);
        const d = client({ requestTimeoutMs: 20 }), first = expect(d.search("2026-01-01")).rejects.toMatchObject({ code: "timeout" });
        const second = d.search("2026-01-02"); await flush(); expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(20); await first; expect(await second).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    });
    it.each(["invalid-json", "business", "invalid-zip", "zip-json"])("%sを通信障害として再試行しない", async kind => {
        const response = kind === "business" ? new Response(JSON.stringify({ statusCode: 401, message: "SYNTHETIC-SECRET" })) : kind === "zip-json" ? new Response("SECRET", { headers: { "content-type": "application/json" } }) : new Response("INVALID");
        const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch);
        const d = client({ maxRetries: 3 }), result = kind.includes("zip") ? d.fetchXbrl("SYNTHETIC1") : d.search("2026-01-01");
        await expect(result).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it("本文通信失敗は安全なnetwork分類で再試行できる", async () => {
        const fetch = vi.fn().mockResolvedValueOnce(new Response(new ReadableStream({ start(c) { c.error(new Error("SYNTHETIC-SECRET")); } }))).mockImplementation(async () => empty()); vi.stubGlobal("fetch", fetch);
        const result = client({ maxRetries: 1 }).search("2026-01-01"); await flush(); await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    });
    it.each(["fetch", "body", "http", "business", "reason"])("%s由来の秘密を例外/cause/logへ出さない", async source => {
        const secret = "SYNTHETIC-SECRET-NEVER-PRINT", controller = new AbortController();
        const fetch = vi.fn();
        if (source === "fetch") fetch.mockRejectedValue(new Error(`https://invalid/?Subscription-Key=${secret}`));
        else if (source === "body") fetch.mockResolvedValue(new Response(new ReadableStream({ start(c) { c.error(new Error(secret)); } })));
        else if (source === "http") fetch.mockResolvedValue(new Response(null, { status: 400, statusText: secret }));
        else if (source === "business") fetch.mockResolvedValue(new Response(JSON.stringify({ statusCode: secret, message: secret })));
        else controller.abort(new Error(secret));
        vi.stubGlobal("fetch", fetch);
        const error = await client().search("2026-01-01", undefined, { signal: controller.signal }).catch(e => e);
        expect(error).toBeInstanceOf(Error); expect(error.message).not.toContain(secret); expect(error.cause).toBeUndefined(); expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(secret);
    });
    it.each(["searchPeriod", "findLatest", "downloadByTicker"])("複合%sは中断/timeoutを握り潰さない", async method => {
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stoppedBody()))); const d = client({ requestTimeoutMs: 20 });
        const promise = method === "searchPeriod" ? d.searchPeriod("2026-01-01", "2026-01-02") : method === "findLatest" ? d.findLatest("0000", EdinetDocumentType.AnnualCards, 2) : d.downloadByTicker("0000");
        const checked = expect(promise).rejects.toMatchObject({ code: "timeout" }); await flush(); await vi.advanceTimersByTimeAsync(20); await checked;
    });
    it("キュー待ちの時間をrequestTimeoutへ含めない", async () => {
        const fetch = vi.fn().mockImplementation(async () => new Response(stoppedBody())); vi.stubGlobal("fetch", fetch);
        const d = client({ requestTimeoutMs: 50 });
        const first = expect(d.search("2026-01-01")).rejects.toMatchObject({ code: "timeout" });
        const second = expect(d.search("2026-01-02")).rejects.toMatchObject({ code: "timeout" });
        await flush(); await vi.advanceTimersByTimeAsync(50); await first; expect(fetch).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(1); await vi.advanceTimersByTimeAsync(49); expect(vi.getTimerCount()).toBe(1);
        await vi.advanceTimersByTimeAsync(1); await second; expect(vi.getTimerCount()).toBe(0);
    });
    it("timeoutも残り試行があれば再試行し成功できる", async () => {
        const fetch = vi.fn().mockResolvedValueOnce(new Response(stoppedBody())).mockImplementation(async () => empty()); vi.stubGlobal("fetch", fetch);
        const result = client({ requestTimeoutMs: 20, maxRetries: 1 }).search("2026-01-01");
        await flush(); await vi.advanceTimersByTimeAsync(20); expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1000); expect(await result).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    });
    it("既に中断したsignalはdownload/fetchXbrlのcache処理にも進まない", async () => {
        const fetch = vi.fn(), controller = new AbortController(); controller.abort("SECRET"); vi.stubGlobal("fetch", fetch);
        const d = client({ rootDir: "/synthetic-never-accessed" });
        await expect(d.download("SYNTHETIC1", undefined, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
        await expect(d.fetchXbrl("SYNTHETIC1", { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
        expect(fetch).not.toHaveBeenCalled();
    });
    it.each(["search", "searchPeriod", "findLatest", "downloadByTicker", "download", "fetchXbrl"])("%sはrequest.signalを一度だけ取得する", async method => {
        const first = new AbortController(), second = new AbortController(); first.abort("SECRET"); let gets = 0;
        const request = { get signal() { gets++; return gets === 1 ? first.signal : second.signal; } };
        const d = client();
        const result = method === "search" ? d.search("2026-01-01", undefined, request) : method === "searchPeriod" ? d.searchPeriod("2026-01-01", "2026-01-02", undefined, request) : method === "findLatest" ? d.findLatest("0000", EdinetDocumentType.AnnualCards, 1, request) : method === "downloadByTicker" ? d.downloadByTicker("0000", undefined, "2026-01-01", EdinetDocumentType.AnnualCards, request) : method === "download" ? d.download("SYNTHETIC1", undefined, request) : d.fetchXbrl("SYNTHETIC1", request);
        await expect(result).rejects.toMatchObject({ code: "aborted" }); expect(gets).toBe(1);
    });
    it("呼出後のsignal差替えでも元signalのlistenerを除去する", async () => {
        const first = new AbortController(), second = new AbortController(), remove = vi.spyOn(first.signal, "removeEventListener");
        const request = { signal: first.signal }; const cancel = vi.fn();
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stoppedBody(cancel))));
        const checked = expect(client().search("2026-01-01", undefined, request)).rejects.toMatchObject({ code: "aborted" });
        await flush(); request.signal = second.signal; first.abort("SECRET"); await checked; await flush();
        expect(cancel).toHaveBeenCalledTimes(1); expect(remove).toHaveBeenCalledWith("abort", expect.any(Function)); expect(vi.getTimerCount()).toBe(0);
    });
    it.each([{}, null, true, "signal"])("AbortSignal以外の%sを安全に拒否する", async signal => {
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        await expect(client().search("2026-01-01", undefined, { signal: signal as AbortSignal })).rejects.toThrow("signalはAbortSignal"); expect(fetch).not.toHaveBeenCalled();
    });
    it("signal getterの秘密入り例外を公開しない", async () => {
        const request = { get signal(): AbortSignal { throw new Error("SYNTHETIC-SECRET"); } };
        const error = await client().search("2026-01-01", undefined, request).catch(e => e);
        expect(error.message).toContain("signalはAbortSignal"); expect(error.message).not.toContain("SYNTHETIC-SECRET");
    });
    it.each(["headers", "reader"])("%s取得の例外をnetworkとして安全に包む", async source => {
        const response = new Response(stoppedBody()), secret = "SYNTHETIC-SECRET";
        if (source === "headers") Object.defineProperty(response, "headers", { get() { throw new Error(secret); } });
        else vi.spyOn(response.body!, "getReader").mockImplementation(() => { throw new Error(secret); });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response));
        const error = await client().search("2026-01-01").catch(e => e);
        expect(error.code).toBe("network"); expect(error.message).not.toContain(secret); expect(error.cause).toBeUndefined();
    });
    it("Facadeもsignal getterを一度だけ取得する", async () => {
        const controller = new AbortController(); let gets = 0;
        const request = { get signal() { gets++; return controller.signal; } };
        const download = vi.fn().mockRejectedValue(new EdinetRequestError(EdinetRequestErrorCode.Timeout));
        const facade = Object.create(Edinet.prototype) as Edinet;
        Object.assign(facade, { repo: { findDocuments: () => [{ docID: "SYNTHETIC1" }] }, downloader: { download } });
        await expect(facade.getFinancialHistory("0000", 5, EdinetDocumentType.AnnualCards, request)).rejects.toMatchObject({ code: "timeout" }); expect(gets).toBe(1);
    });
    it("通信エラー定数は変更できない", () => { expect(Object.isFrozen(EdinetRequestErrorCode)).toBe(true); });
    it.each(["download", "fetchXbrl"])("%sはcache import待ち中の中断も確認する", async method => {
        const fetch = vi.fn(), controller = new AbortController(); vi.stubGlobal("fetch", fetch);
        const d = client({ rootDir: "/synthetic-never-accessed" });
        const result = method === "download" ? d.download("SYNTHETIC1", undefined, { signal: controller.signal }) : d.fetchXbrl("SYNTHETIC1", { signal: controller.signal });
        const checked = expect(result).rejects.toMatchObject({ code: "aborted" }); controller.abort(); await checked; expect(fetch).not.toHaveBeenCalled();
    });
    it("archive読取後に中断したfetchXbrlは本文を返さない", async () => {
        const controller = new AbortController(), d = client({ rootDir: "/synthetic-never-accessed" });
        vi.spyOn(d as any, "loadDocumentArchive").mockResolvedValue({ entries: [{ name: "PublicDoc/a.xbrl", dir: false }], readEntry: async () => { controller.abort(); return new TextEncoder().encode("<x/>"); } });
        await expect(d.fetchXbrl("SYNTHETIC1", { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" });
    });
    it("downloadByTickerは応答の説明や書類IDをログへ出さない", async () => {
        const secret = "SYNTHETIC-SECRET", log = vi.spyOn(console, "log").mockImplementation(() => {}), d = client();
        vi.spyOn(d, "search").mockResolvedValue([{ secCode: "00000", docID: secret, docDescription: secret, docTypeCode: EdinetDocumentType.AnnualCards, docInfoEditStatus: 0 }]);
        vi.spyOn(d, "download").mockResolvedValue("/synthetic/result");
        expect(await d.downloadByTicker("0000")).toBe("/synthetic/result"); expect(JSON.stringify(log.mock.calls)).not.toContain(secret);
    });
    it("Facadeはdownloadのtimeoutを返し、既定呼出し引数を維持する", async () => {
        // 実DBを作らず、公開メソッドを合成repository/downloaderで検証します。
        const download = vi.fn().mockRejectedValue(new EdinetRequestError(EdinetRequestErrorCode.Timeout));
        const facade = Object.create(Edinet.prototype) as Edinet;
        Object.assign(facade, { repo: { findDocuments: () => [{ docID: "SYNTHETIC1" }] }, downloader: { download } });
        await expect(facade.getFinancialHistory("0000")).rejects.toMatchObject({ code: "timeout" }); expect(download).toHaveBeenCalledExactlyOnceWith("SYNTHETIC1");
        const controller = new AbortController(); await expect(facade.getFinancialHistory("0000", 5, EdinetDocumentType.AnnualCards, { signal: controller.signal })).rejects.toMatchObject({ code: "timeout" });
        expect(download).toHaveBeenLastCalledWith("SYNTHETIC1", undefined, { signal: controller.signal });
    });
});
