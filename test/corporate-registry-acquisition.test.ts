import { expect, it, vi } from "vitest";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { fetchRegistryDifference } from "../src/platform/registry/fetch-difference";
import { parseRegistryListing } from "../src/platform/registry/parse-download-listing";
import { withOperationalLocks } from "../src/platform/locks/with-operational-locks";
import * as retained from "../src/platform/files/retained-files";
import { signedRegistryFixture, sha256 } from "./fixtures/signed-corporate-registry";
import { createStoredZip } from "./fixtures/create-stored-zip";
import { differenceListing, mockRegistrySession } from "./fixtures/registry-download-response";
const linux = it.runIf(process.platform === "linux");
async function fixture(
  run: (f: ReturnType<typeof signedRegistryFixture>, out: string, bytes: Buffer) => Promise<void>,
) {
  const f = signedRegistryFixture(),
    space = vi.spyOn(retained, "reserveSpace").mockImplementation(() => {});
  const bytes = createStoredZip([
    ["diff_20261028.xml", readFileSync(f.xml)],
    ["diff_20261028.xml.asc", readFileSync(f.xml + ".asc")],
  ]);
  try {
    await run(f, join(f.root, "download"), bytes);
  } finally {
    space.mockRestore();
    f.close();
  }
}
linux("保存済み差分は署名を再検査して通信せず再開し、root marker欠落からも復旧する", () =>
  fixture(async (f, out, bytes) => {
    const first = mockRegistrySession(bytes),
      run = (session = first) =>
        fetchRegistryDifference("2026-10-28", f.key, f.fingerprint, out, session.request);
    const result = await run();
    expect(result.status).toBe("downloaded");
    expect(first.calls).toHaveLength(2);
    expect(first.calls[1].fields!.get("selDlFileNo")).toBe("33");
    expect(result.acquisition.download.sha256).toBe(sha256(bytes));
    const offline = mockRegistrySession(Buffer.from("bad"));
    expect((await run(offline)).status).toBe("retained");
    expect(offline.calls).toEqual([]);
    unlinkSync(join(out, "complete.json"));
    expect((await run(offline)).status).toBe("recovered");
    expect(offline.calls).toEqual([]);
  }),
);
linux("失敗試行の原本を残して別試行で再開する", () =>
  fixture(async (f, out, bytes) => {
    const session = mockRegistrySession(bytes);
    session.controls.fail = true;
    await expect(
      fetchRegistryDifference("2026-10-28", f.key, f.fingerprint, out, session.request),
    ).rejects.toThrow();
    const before = readFileSync(join(out, "attempt-0001/listing.html"));
    expect(existsSync(join(out, "attempt-0001/failure.json"))).toBe(true);
    expect(
      (
        await fetchRegistryDifference(
          "2026-10-28",
          f.key,
          f.fingerprint,
          out,
          mockRegistrySession(bytes).request,
        )
      ).attempt,
    ).toBe("attempt-0002");
    expect(readFileSync(join(out, "attempt-0001/listing.html"))).toEqual(before);
  }),
);
linux.each(["plan", "archive", "import"])("保存済みの%s改変を再取得で隠さない", (mutation) =>
  fixture(async (f, out, bytes) => {
    await fetchRegistryDifference(
      "2026-10-28",
      f.key,
      f.fingerprint,
      out,
      mockRegistrySession(bytes).request,
    );
    let fingerprint = f.fingerprint;
    if (mutation === "plan") fingerprint = "0".repeat(40);
    if (mutation === "archive") appendFileSync(join(out, "attempt-0001/delivery.zip"), "changed");
    if (mutation === "import")
      writeFileSync(join(out, "attempt-0001/verified/part-000-import.json"), "{}");
    const session = mockRegistrySession(bytes);
    await expect(
      fetchRegistryDifference("2026-10-28", f.key, fingerprint, out, session.request),
    ).rejects.toThrow();
    expect(session.calls).toEqual([]);
  }),
);
linux.each(["missing-date", "short", "redirect", "capacity", "future"])(
  "不正な取得を完了扱いにしない: %s",
  (mutation) =>
    fixture(async (f, out, bytes) => {
      const session = mockRegistrySession(
        bytes,
        differenceListing(mutation === "missing-date" ? "2026-10-27" : "2026-10-28"),
      );
      session.controls.short = mutation === "short";
      session.controls.redirect = mutation === "redirect";
      if (mutation === "capacity")
        vi.mocked(retained.reserveSpace).mockImplementation(() => {
          throw Error("capacity");
        });
      await expect(
        fetchRegistryDifference(
          mutation === "future" ? "2099-01-01" : "2026-10-28",
          f.key,
          f.fingerprint,
          out,
          session.request,
        ),
      ).rejects.toThrow();
      expect(existsSync(join(out, "complete.json"))).toBe(false);
      if (mutation === "future" || mutation === "capacity") expect(session.calls).toEqual([]);
    }),
);
linux("同時取得の排他を取得前に検査する", () =>
  fixture(async (f, out, bytes) => {
    mkdirSync(out, { mode: 0o700 });
    const session = mockRegistrySession(bytes);
    await withOperationalLocks([join(out, ".lock")], async () => {
      await expect(
        fetchRegistryDifference("2026-10-28", f.key, f.fingerprint, out, session.request),
      ).rejects.toThrow("lock unavailable");
    });
    expect(session.calls).toEqual([]);
  }),
);
it.each([
  differenceListing().replace("xml-unicode", "other"),
  differenceListing().replace(
    "</form>",
    '<tr class="type2_corpHistory2"><td>令和8年10月28日</td><td><a onclick="return doDownload(44);">XML</a></td></tr></form>',
  ),
])("CSVだけの一覧や曖昧な日付は拒否する", (html) => {
  expect(() => parseRegistryListing(html, "2026-10-28", "diff")).toThrow();
});
