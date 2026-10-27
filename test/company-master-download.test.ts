import { afterEach, describe, expect, it, vi } from "vitest";
import JSZip from "jszip";
import { fetchEdinetCompanyMaster } from "../src/index";
// 合成CSVをCP932へ変換したもの。実企業や認証情報は含みません。
const csv = Buffer.from("g1+DRYOTg42BW4NojsCNc5P6LDIwMjaUTjEwjI4yN5P6jLuN3SyMj5CULDGMjw0KgmSCY4Jogm2CZIJzg1KBW4NoLJLxj2+O0o7tlcosj+OP6ovmlaosjIiOWpP6LJLxj2+O0pa8LJLxj2+O0ovGju0sj9iMlINSgVuDaCyS8Y9vjtKWQJBslNSNhg0KRTAwMDAxLJPgjZGWQJBsgUWRZ42HLI/jj+osM4yOlpaT+iyNh5CsipSOronvjtAsj+6V8YFFksqQTYvGLDEyM0EwLDEyMzQ1Njc4OTAxMjMNCg==", "base64");
afterEach(() => vi.restoreAllMocks());
describe("無償公式マスターの限定取得", () => {
    it("固定URLを1回取得し、CP932を復号してhashと出典を保持", async () => {
        const bytes = await new JSZip().file("codes.csv", csv).generateAsync({ type: "uint8array" });
        const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes));
        const result = await fetchEdinetCompanyMaster();
        expect(fetch).toHaveBeenCalledTimes(1); expect(String(fetch.mock.calls[0][0])).toBe("https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip");
        expect(result).toMatchObject({ asOf: "2026-10-27", records: [{ name: "合成株式会社", securityCode: "123A0" }] });
        expect(result.archiveSha256).toMatch(/^[a-f0-9]{64}$/); expect(result.originalCsvSha256).toMatch(/^[a-f0-9]{64}$/);
    });
    it.each(["http", "not-zip", "multiple-csv"])("%sを成功扱いしない", async kind => {
        const bytes = kind === "multiple-csv" ? await new JSZip().file("a.csv", csv).file("b.csv", csv).generateAsync({ type: "uint8array" }) : new Uint8Array([1, 2, 3]);
        vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(bytes, { status: kind === "http" ? 500 : 200 }));
        await expect(fetchEdinetCompanyMaster()).rejects.toThrow();
    });
    it("本文の中断を伝播し、無効な期限で通信しない", async () => {
        const mock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_url, init) => {
            const signal = init!.signal!;
            return new Response(new ReadableStream({ start(controller) { signal.addEventListener("abort", () => controller.error(signal.reason), { once: true }); } }));
        });
        const controller = new AbortController(), promise = fetchEdinetCompanyMaster({ signal: controller.signal });
        await Promise.resolve(); controller.abort(); await expect(promise).rejects.toThrow();
        mock.mockClear(); await expect(fetchEdinetCompanyMaster({ timeoutMs: 0 })).rejects.toThrow(); expect(mock).not.toHaveBeenCalled();
    });
});
