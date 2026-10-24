import { describe, it, expect, vi, afterEach } from "vitest";
import * as fs from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import JSZip from "jszip";
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
const roots: string[] = [];
function root() { const dir = fs.mkdtempSync(join(tmpdir(), "edinet-zip-public-")); roots.push(dir); return dir; }
function client(dir: string) { return new EdinetXbrlDownloader({ apiKey: "SYNTHETIC-KEY", rootDir: dir, enableRateLimit: false, maxRetries: 0 }); }
async function zip(entries: Record<string, string>) {
    const value = new JSZip(); for (const [name, text] of Object.entries(entries)) value.file(name, text);
    return value.generateAsync({ type: "uint8array", compression: "DEFLATE", platform: "UNIX" });
}
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const dir of roots.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
describe("ZIP取得の公開API境界（すべて合成応答）", () => {
    it("通常nested ZIPを保存し、次回はPublicDocキャッシュだけを読む", async () => {
        const dir = root(), text = '\ufeff<x>合成&amp;例</x>';
        const bytes = await zip({ "root.xbrl": "<x>other</x>", "XBRL/PublicDoc/合成.xbrl": text, "XBRL/PublicDoc/info.txt": "synthetic" });
        const fetch = vi.fn().mockResolvedValue(new Response(bytes)); vi.stubGlobal("fetch", fetch);
        const d = client(dir), file = await d.download("SYNTHETIC1");
        expect(file).toBe(join(dir, "SYNTHETIC1", "XBRL", "PublicDoc", "合成.xbrl"));
        expect(fs.readFileSync(file, "utf8")).toBe(text);
        expect(await d.download("SYNTHETIC1")).toBe(file);
        expect(await d.fetchXbrl("SYNTHETIC1")).toBe(text);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(fs.readdirSync(dir)).toEqual(["SYNTHETIC1"]);
    });
    it("同じ優先順位の複数XBRLも初回とcacheで同じ名前順を使う", async () => {
        const dir=root(),bytes=await zip({"PublicDoc/b.xbrl":"<x>b</x>","PublicDoc/a.xbrl":"<x>a</x>","root.xbrl":"<x>root</x>"});
        const fetch=vi.fn().mockResolvedValue(new Response(bytes));vi.stubGlobal("fetch",fetch);const d=client(dir);
        const initial=await d.download("SYNTHETIC1");expect(initial).toBe(join(dir,"SYNTHETIC1","PublicDoc","a.xbrl"));expect(await d.download("SYNTHETIC1")).toBe(initial);
        expect(await d.fetchXbrl("SYNTHETIC1")).toBe("<x>a</x>");expect(fetch).toHaveBeenCalledTimes(1);
    });
    it("メモリ取得もPublicDocを選び、キャッシュやstagingを作らない", async () => {
        const dir = root(), bytes = await zip({ "root.xbrl": "other", "XBRL/PublicDoc/main.xbrl": "<x>合成</x>" });
        vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(bytes)));
        expect(await client(dir).fetchXbrl("SYNTHETIC1")).toBe("<x>合成</x>");
        expect(fs.readdirSync(dir)).toEqual([]);
    });
    it.each(["../outside", "/absolute", "C:drive", "a\\b", "a/b", ".", "..", "a?b", "", "a\0b"])("不正docID %jでは通信も保存もしない", async docID => {
        const dir = root(), fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        const d = client(dir); await expect(d.download(docID)).rejects.toThrow(); await expect(d.fetchXbrl(docID)).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled(); expect(fs.readdirSync(dir)).toEqual([]);
    });
    it("既存の未完成docDirを上書きせず通信もしない", async () => {
        const dir = root(), target = join(dir, "SYNTHETIC1"); fs.mkdirSync(target); fs.writeFileSync(join(target, "keep.txt"), "unchanged");
        const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
        await expect(client(dir).download("SYNTHETIC1")).rejects.toThrow();
        await expect(client(dir).fetchXbrl("SYNTHETIC1")).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled(); expect(fs.readFileSync(join(target, "keep.txt"), "utf8")).toBe("unchanged");
        expect(fs.readdirSync(target)).toEqual(["keep.txt"]);
    });
    it("通常cacheの後ろにあるsymlinkも拒否し、外部fileを変更しない", async () => {
        const dir = root(), outside = root(), target = join(dir, "SYNTHETIC1");fs.mkdirSync(target);fs.writeFileSync(join(target, "ok.xbrl"), "safe");
        fs.writeFileSync(join(outside, "keep"), "unchanged");fs.symlinkSync(outside, join(target, "zzz-link"), "dir");
        const fetch = vi.fn();vi.stubGlobal("fetch", fetch);
        await expect(client(dir).download("SYNTHETIC1")).rejects.toThrow();await expect(client(dir).fetchXbrl("SYNTHETIC1")).rejects.toThrow();
        expect(fetch).not.toHaveBeenCalled();expect(fs.readFileSync(join(outside, "keep"), "utf8")).toBe("unchanged");
    });
    it("危険ZIPを拒否し、docDirや部分ファイルを残さない", async () => {
        const dir = root(), bytes = await zip({ "PublicDoc/good.xbrl": "<x/>", "../outside.xbrl": "bad" });
        vi.stubGlobal("fetch", vi.fn().mockImplementation(() => Promise.resolve(new Response(bytes))));
        const d=client(dir);await expect(d.download("SYNTHETIC1")).rejects.toThrow();await expect(d.fetchXbrl("SYNTHETIC1")).rejects.toThrow();
        expect(fs.readdirSync(dir)).toEqual([]);
    });
    it("JSON/HTML応答の本文と鍵をエラーへ出さない", async () => {
        const dir = root(), secret = "SYNTHETIC-DO-NOT-PRINT";
        const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({message:secret}),{headers:{"content-type":"application/json"}}))
            .mockResolvedValueOnce(new Response(`<html>${secret}</html>`,{headers:{"content-type":"text/html"}}));vi.stubGlobal("fetch",fetch);
        for(const action of [()=>client(dir).download("SYNTHETIC1"),()=>client(dir).fetchXbrl("SYNTHETIC1")]){
            const error=await action().then(()=>undefined,e=>e as Error);expect(error).toBeInstanceOf(Error);expect(error!.message).not.toContain(secret);
        }
        expect(fs.readdirSync(dir)).toEqual([]);
    });
    it("bodyの通信例外に含まれるURLや鍵を再送出しない", async () => {
        const secret="SYNTHETIC-BODY-SECRET";const body=new ReadableStream<Uint8Array>({start(c){c.error(new Error(`https://example.invalid?Subscription-Key=${secret}`));}});
        vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(body)));
        const error=await client(root()).fetchXbrl("SYNTHETIC1").then(()=>undefined,e=>e as Error);
        expect(error).toBeInstanceOf(Error);expect(error!.message).toMatch(/受信/);expect(error!.message).not.toContain(secret);expect(error!.cause).toBeUndefined();
    });
    it("空のXBRLを成功した本文としない", async () => {
        const dir=root(),bytes=await zip({"PublicDoc/main.xbrl":""});vi.stubGlobal("fetch",vi.fn().mockImplementation(()=>Promise.resolve(new Response(bytes))));
        await expect(client(dir).fetchXbrl("SYNTHETIC1")).rejects.toThrow(/空/);await expect(client(dir).download("SYNTHETIC1")).rejects.toThrow();expect(fs.readdirSync(dir)).toEqual([]);
    });
    it("不正UTF-8のXBRLを黙って文字置換しない", async () => {
        const value=new JSZip();value.file("PublicDoc/main.xbrl",new Uint8Array([0xc3,0x28]));const bytes=await value.generateAsync({type:"uint8array"});
        vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response(bytes)));await expect(client(root()).fetchXbrl("SYNTHETIC1")).rejects.toThrow();
    });
});
describe("圧縮応答の有限read（小さい試験上限）",()=>{
    it("上限ちょうどを受け付け、chunk再利用でもbytesを保持する",async()=>{
        const reused=new Uint8Array([1,2]);let turn=0;const body=new ReadableStream<Uint8Array>({pull(c){if(turn===0){turn++;c.enqueue(reused);}else if(turn===1){turn++;reused.set([3,4]);c.enqueue(reused);}else c.close();}},{highWaterMark:0});
        const d=client(root()), bytes=await(d as any).readZipResponse(new Response(body),4);
        expect([...bytes]).toEqual([1,2,3,4]);
    });
    it("Content-Lengthが過大ならbodyを取消し、読取らない",async()=>{
        let cancelled=false;const body=new ReadableStream<Uint8Array>({cancel(){cancelled=true;}});
        await expect((client(root()) as any).readZipResponse(new Response(body,{headers:{"content-length":"5"}}),4)).rejects.toThrow(/上限/);expect(cancelled).toBe(true);
    });
    it("小さなContent-Lengthを信用せず実chunk量で止める",async()=>{
        let pulls=0,cancelled=false;const body=new ReadableStream<Uint8Array>({pull(c){pulls++;c.enqueue(new Uint8Array([1,2,3]));},cancel(){cancelled=true;}});
        await expect((client(root()) as any).readZipResponse(new Response(body,{headers:{"content-length":"1"}}),4)).rejects.toThrow(/上限/);expect(cancelled).toBe(true);expect(pulls).toBeLessThanOrEqual(4);
    });
    it("通信例外のURL/鍵をログと最終エラーに混ぜない",async()=>{
        vi.useFakeTimers();const secret="SYNTHETIC-DO-NOT-LOG",warn=vi.spyOn(console,"warn").mockImplementation(()=>{});
        vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new Error(`URL https://example.invalid?Subscription-Key=${secret}`)));
        const promise=(client(root()) as any).fetchWithRetry(`https://example.invalid?Subscription-Key=${secret}`);
        const checked=expect(promise).rejects.not.toThrow(secret);await vi.runAllTimersAsync();await checked;
        expect(JSON.stringify(warn.mock.calls)).not.toContain(secret);
    });
});
