import type { RegistryRequest } from "../../src/platform/registry/download-session";
export const differenceListing = (date = "2026-10-28") =>
  `<form id="appForm" action="/download/sabun/index.html" method="post"><input type="hidden" name="token" value="private"><input type="hidden" name="event" value="download"><input type="hidden" name="selDlFileNo" value=""><h2 id="csv-sjis">CSV</h2><tr class="type0_corpHistory1"><td>令和${Number(date.slice(0, 4)) - 2018}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日</td><td><a onclick="return doDownload(11);">CSV</a></td></tr><h2 id="xml-unicode">XML</h2><tr class="type2_corpHistory1"><td>令和${Number(date.slice(0, 4)) - 2018}年${Number(date.slice(5, 7))}月${Number(date.slice(8, 10))}日</td><td><a onclick="return doDownload(33);">XML</a></td></tr></form>`;
export const fullListing =
  '<form id="appForm" action="/download/zenken/index.html" method="post"><input type="hidden" name="event" value="download"><input type="hidden" name="selDlFileNo"><h2 id="csv-unicode">CSV</h2><p>令和8年10月30日更新</p><dl><dt>全国</dt><dd><a onclick="return doDownload(11);">zip 100MB</a></dd></dl><h2 id="xml-unicode">XML</h2><p>令和8年10月30日更新</p><dl><dt>全国</dt><dd><a onclick="return doDownload(33);">zip 364MB</a></dd></dl><dl><dt>東京都</dt><dd><a onclick="return doDownload(44);">zip 11MB</a></dd></dl></form>';
export function mockRegistrySession(bytes: Uint8Array, html = differenceListing()) {
  const calls: { url: string; fields?: URLSearchParams }[] = [];
  const controls = { fail: false, short: false, redirect: false };
  const request: RegistryRequest = async (url, fields) => {
    calls.push({ url, fields: fields ? new URLSearchParams(fields) : undefined });
    if (fields && controls.fail) throw Error("Interrupted request");
    const body = fields ? Buffer.from(bytes) : Buffer.from(html);
    const response = new Response(body, {
      status: 200,
      headers: { "Content-Length": String(body.length + (fields && controls.short ? 1 : 0)) },
    });
    Object.defineProperty(response, "url", {
      value: controls.redirect ? "https://example.invalid/" : url,
    });
    return response;
  };
  return { request, calls, controls };
}
