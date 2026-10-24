import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
const now = Date.UTC(2026, 9, 25, 0, 0, 0);
const empty = () => new Response(JSON.stringify({ metadata: { status: "200", resultset: { count: 0 } }, results: [] }));
const client = (options: ConstructorParameters<typeof EdinetXbrlDownloader>[0] = {}) => new EdinetXbrlDownloader({ apiKey: "SYNTHETIC-KEY", enableRateLimit: false, maxRetries: 1, ...options });
async function flush() { for (let i = 0; i < 30; i++) await Promise.resolve(); }
function sequence(header: string | null, status = 503) {
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const body = new ReadableStream<Uint8Array>({ cancel });
    const response = new Response(body, { status, headers: header === null ? undefined : { "retry-after": header } });
    const fetch = vi.fn().mockResolvedValueOnce(response).mockImplementation(async () => empty());
    vi.stubGlobal("fetch", fetch); return { fetch, cancel };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); vi.spyOn(Math, "random").mockReturnValue(0); vi.spyOn(console, "warn").mockImplementation(() => {}); });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("Retry-Afterと追加待ち（合成Response/fake timerのみ）", () => {
    it.each([0, -1, NaN, Infinity, 1.5, 2147483648])("不正なmaxRetryDelayMs %sを拒否する", maxRetryDelayMs => {
        expect(() => client({ maxRetryDelayMs })).toThrow("maxRetryDelayMs");
    });
    it.each([["0", 1000], ["0000", 1000], ["1", 1000], ["0002", 2000], ["60", 60000]])("整数秒%sは%dms以上待つ", async (header, delay) => {
        const { fetch, cancel } = sequence(header as string, 429); const result = client().search("2026-10-25"); await flush();
        expect(cancel).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync((delay as number) - 1); expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0);
    });
    it.each([
        ["Sun, 25 Oct 2026 00:00:05 GMT", 5000],
        ["Sat, 24 Oct 2026 23:59:59 GMT", 1000],
        ["Sun, 25 Oct 2026 00:00:00 GMT", 1000],
        ["Sun, 25 Oct 2026 00:01:00 GMT", 60000]
    ])("IMF-fixdate %sを検証し%dms待つ", async (header, delay) => {
        const { fetch } = sequence(header as string); const result = client().search("2026-10-25"); await flush();
        await vi.advanceTimersByTimeAsync((delay as number) - 1); expect(fetch).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    });
    it.each([null, "", " ", "-1", "+1", "0.5", "1e2", "Infinity", "NaN", "1, 2", "123abc", "Sun, 25 Oct 2026 00:00:02 UTC", "Mon, 25 Oct 2026 00:00:02 GMT", "Sun, 29 Feb 2026 00:00:02 GMT", "Sun, 25 Oct 2026 24:00:00 GMT", "Sun, 25 Oct 2026 00:60:00 GMT", "sun, 25 Oct 2026 00:00:02 GMT", "Sun, 25 oct 2026 00:00:02 GMT", "Sun, 25 Oct 2026 00:00:02 gmt", "Sun, 25 Oct 2026 00:00:02 GMT extra", "Sun, 25  Oct 2026 00:00:02 GMT", "Fri, 25 Oct 0026 00:00:02 GMT"])("不正/未対応header %sは既存backoffへ戻す", async header => {
        const { fetch } = sequence(header); const result = client().search("2026-10-25"); await flush();
        await vi.advanceTimersByTimeAsync(999); expect(fetch).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2);
    });
    it.each(["Sunday, 25-Oct-26 00:00:05 GMT", "Sun Oct 25 00:00:05 2026", "Sun, 25 Oct 2026 00:00:60 GMT", "Thursday, 31-Dec-26 23:59:60 GMT", "Thu Dec 31 23:59:60 2026"])("対応外だが認識可能なdate %sは早retryせず停止する", async header => {
        const { fetch } = sequence(header); await expect(client().search("2026-10-25")).rejects.toThrow("HTTP 503");
        expect(fetch).toHaveBeenCalledTimes(1); expect(Math.random).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it("うるう年の正しい2月29日を受理する", async () => {
        vi.setSystemTime(Date.UTC(2028, 1, 29, 0, 0, 0)); const { fetch } = sequence("Tue, 29 Feb 2028 00:00:05 GMT"); const result = client().search("2028-02-29"); await flush();
        await vi.advanceTimersByTimeAsync(4999); expect(fetch).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual([]);
    });
    it.each(["61", "9999999999999999999999999999999999999", "9".repeat(1000), "Sun, 25 Oct 2026 00:01:01 GMT"])("server指定%sが上限を超えたら早retryせずHTTPで終了", async header => {
        const { fetch, cancel } = sequence(header); await expect(client().search("2026-10-25")).rejects.toThrow("HTTP 503");
        expect(fetch).toHaveBeenCalledTimes(1); expect(cancel).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); expect(Math.random).not.toHaveBeenCalled(); expect(console.warn).not.toHaveBeenCalled();
    });
    it.each([["2", 1999, false], ["2", 2000, true], ["1", 999, false], ["1", 1000, true]])("秒ms換算 %s cap=%d retry=%s", async (header, cap, retry) => {
        const { fetch } = sequence(header as string); const promise = client({ maxRetryDelayMs: cap as number }).search("2026-10-25");
        if (!retry) { await expect(promise).rejects.toThrow("HTTP 503"); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); }
        else { await flush(); await vi.advanceTimersByTimeAsync(cap as number); expect(await promise).toEqual([]); expect(fetch).toHaveBeenCalledTimes(2); }
    });
    it("最大timer値を超える秒指定はoverflowせず終了する", async () => {
        const { fetch } = sequence("2147484"); await expect(client({ maxRetryDelayMs: 2147483647 }).search("2026-10-25")).rejects.toThrow("HTTP 503"); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it("serverWaitより自前jitterが長い場合は長い方を使う", async () => {
        vi.mocked(Math.random).mockReturnValue(1 - Number.EPSILON); const { fetch } = sequence("1"); const result = client().search("2026-10-25"); await flush();
        await vi.advanceTimersByTimeAsync(1249); expect(fetch).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual([]);
    });
    it("自前backoffは指数増加に0..25%を加え、capを越えない", async () => {
        vi.mocked(Math.random).mockReturnValue(1 - Number.EPSILON);
        const fetch = vi.fn().mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 503 })).mockResolvedValueOnce(new Response(null, { status: 503 })).mockImplementation(async () => empty()); vi.stubGlobal("fetch", fetch);
        const result = client({ maxRetries: 3, maxRetryDelayMs: 2300 }).search("2026-10-25"); await flush();
        for (const [index, delay] of [1250, 2300, 2300].entries()) {
            await vi.advanceTimersByTimeAsync(delay - 1); expect(fetch).toHaveBeenCalledTimes(index + 1); await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(index + 2);
        }
        expect(await result).toEqual([]); expect(Math.random).toHaveBeenCalledTimes(3); expect(vi.getTimerCount()).toBe(0);
    });
    it("小さいcapでは自前backoffも指定上限内に収まる", async () => {
        vi.mocked(Math.random).mockReturnValue(1 - Number.EPSILON); const { fetch } = sequence(null); const result = client({ maxRetryDelayMs: 1 }).search("2026-10-25"); await flush();
        expect(fetch).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual([]);
    });
    it("長いretry待ちもcaller abortで終了し、次のfetchを起こさない", async () => {
        const { fetch } = sequence("60"), controller = new AbortController();
        const checked = expect(client().search("2026-10-25", undefined, { signal: controller.signal })).rejects.toMatchObject({ code: "aborted" }); await flush();
        controller.abort("SYNTHETIC-SECRET"); await checked; await vi.runAllTimersAsync(); expect(fetch).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
    });
    it("timeoutの時計はserverWait中に進めない", async () => {
        const { fetch } = sequence("2"); const result = client({ requestTimeoutMs: 5 }).search("2026-10-25"); await flush();
        await vi.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledTimes(1); await vi.advanceTimersByTimeAsync(1); expect(await result).toEqual([]);
    });
    it.each([429, 503])("最後のHTTP%sはheaderがあってもrandom/待ち無し", async status => {
        const { fetch } = sequence("2", status); await expect(client({ maxRetries: 0 }).search("2026-10-25")).rejects.toThrow(`HTTP ${status}`);
        expect(fetch).toHaveBeenCalledTimes(1); expect(Math.random).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it.each(["http400", "json", "zip"])("%sをheaderにつられてretryしない", async kind => {
        const response = new Response("INVALID", { status: kind === "http400" ? 400 : 200, headers: { "retry-after": "2" } });
        const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal("fetch", fetch); const d = client();
        await expect(kind === "zip" ? d.fetchXbrl("SYNTHETIC1") : d.search("2026-10-25")).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1); expect(Math.random).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    });
    it("header原文/URL/キーをerror/cause/logに出さない", async () => {
        const secret = "SYNTHETIC-SECRET", { fetch } = sequence(`https://example.invalid?Subscription-Key=${secret}`);
        fetch.mockImplementation(async () => new Response(null, { status: 503, statusText: secret, headers: { "retry-after": secret } }));
        const checked = client().search("2026-10-25").catch(error => error); await flush(); await vi.advanceTimersByTimeAsync(1000); const error = await checked;
        expect(error.message).toContain("HTTP 503"); expect(error.message).not.toContain(secret); expect(error.cause).toBeUndefined(); expect(JSON.stringify(vi.mocked(console.warn).mock.calls)).not.toContain(secret);
    });
});
