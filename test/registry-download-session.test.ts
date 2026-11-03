import { expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createRegistrySession,
  downloadRegistryFile,
} from "../src/platform/registry/download-session";
it("同じoriginでcookieのpathを守り、HTTP自動展開とredirectを要求しない", async () => {
  const fetcher = vi.fn(async (url: string) => {
    const response = new Response("fixture", {
      headers:
        fetcher.mock.calls.length === 1
          ? { "Set-Cookie": "session=fixture; Secure; Path=/download/sabun/" }
          : {},
    });
    Object.defineProperty(response, "url", { value: url });
    return response;
  });
  vi.stubGlobal("fetch", fetcher);
  try {
    const request = createRegistrySession(),
      base = "https://www.houjin-bangou.nta.go.jp/download/sabun/";
    await request(base);
    await request(base + "index.html", new URLSearchParams({ event: "download" }));
    await request("https://www.houjin-bangou.nta.go.jp/download/zenken/");
    const calls = fetcher.mock.calls as unknown as [string, RequestInit][];
    expect(calls[1][1]).toMatchObject({
      method: "POST",
      redirect: "error",
      headers: { Cookie: "session=fixture", "Accept-Encoding": "identity" },
    });
    expect(calls[2][1]).toMatchObject({ headers: { Cookie: "" } });
    await expect(request("https://example.invalid/")).rejects.toThrow("origin");
    expect(fetcher).toHaveBeenCalledTimes(3);
  } finally {
    vi.unstubAllGlobals();
  }
});
it("HTTP圧縮で原本のbyte列が変わる応答は保存前に拒否する", async () => {
  const root = mkdtempSync(join(tmpdir(), "registry-response-")),
    target = join(root, "listing.html"),
    url = "https://www.houjin-bangou.nta.go.jp/download/sabun/";
  try {
    const response = new Response("decoded", { headers: { "Content-Encoding": "gzip" } });
    Object.defineProperty(response, "url", { value: url });
    await expect(downloadRegistryFile(async () => response, url, target, 1024)).rejects.toThrow(
      "encoded response",
    );
    expect(existsSync(target)).toBe(false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
