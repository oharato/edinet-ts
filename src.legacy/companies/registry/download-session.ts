/** 国税庁の同一HTTPS originだけに接続し、cookie・サイズ・時間・容量制限を保って原本を保存する。 */
import { CookieJar } from "tough-cookie";
import { closeSync, fsyncSync, openSync, writeSync } from "node:fs";
import { dirname } from "node:path";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";
import { reserveSpace } from "../../utils/retained-files";
export type RegistryRequest = (url: string, fields?: URLSearchParams) => Promise<Response>;
export function createRegistrySession(): RegistryRequest {
  const jar = new CookieJar();
  return async (url, fields) => {
    assert(
      new URL(url).origin === "https://www.houjin-bangou.nta.go.jp",
      "Unexpected registry origin",
    );
    const headers: Record<string, string> = {
      Cookie: await jar.getCookieString(url),
      "Accept-Encoding": "identity",
    };
    if (fields) {
      headers.Referer = new URL("./", url).href;
      headers["Content-Type"] = "application/x-www-form-urlencoded";
    }
    const response = await fetch(url, {
      method: fields ? "POST" : "GET",
      headers,
      body: fields?.toString(),
      redirect: "error",
      signal: AbortSignal.timeout(120000),
    });
    for (const cookie of response.headers.getSetCookie()) await jar.setCookie(cookie, url);
    return response;
  };
}
export async function downloadRegistryFile(
  request: RegistryRequest,
  url: string,
  target: string,
  limit: number,
  fields?: URLSearchParams,
) {
  const start = performance.now(),
    hash = createHash("sha256"),
    response = await request(url, fields);
  let fd: number | undefined,
    bytes = 0,
    finished = false;
  try {
    assert(
      response.url === url && response.status === 200 && response.body,
      "Unexpected HTTP response",
    );
    // fetch transparently decompresses HTTP bodies; retained bytes must match the response length/hash.
    const encoding = response.headers.get("Content-Encoding");
    assert(
      encoding === null || encoding.trim().toLowerCase() === "identity",
      "Unexpected encoded response",
    );
    const length = response.headers.get("Content-Length");
    assert(
      length === null || (/^\d+$/.test(length) && Number(length) <= limit),
      "Oversized response",
    );
    fd = openSync(target, "wx", 0o600);
    for await (const chunk of response.body as ReadableStream<Uint8Array> &
      AsyncIterable<Uint8Array>) {
      bytes += chunk.length;
      assert(bytes <= limit && performance.now() - start <= 120000, "Response budget exceeded");
      reserveSpace(dirname(target), chunk.length);
      let offset = 0;
      while (offset < chunk.length) offset += writeSync(fd, chunk, offset, chunk.length - offset);
      hash.update(chunk);
    }
    assert(bytes > 0 && (length === null || bytes === Number(length)), "Incomplete response");
    fsyncSync(fd);
    finished = true;
    return { url, bytes, sha256: hash.digest("hex"), observedAt: new Date().toISOString() };
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (!finished && response.body && !response.body.locked)
      await response.body.cancel().catch(() => {});
  }
}
