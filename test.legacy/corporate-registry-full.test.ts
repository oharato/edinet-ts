import { expect, it, vi } from "vitest";
import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fetchNationalRegistry } from "../src/companies/registry/fetch-national-baseline";
import { parseRegistryListing } from "../src/companies/registry/parse-download-listing";
import * as retained from "../src/utils/retained-files";
import * as audit from "../src/companies/registry/verify-archive-parts";
import { signedRegistryFixture } from "./fixtures/signed-corporate-registry";
import { createStoredZip } from "./fixtures/create-stored-zip";
import { fullListing, mockRegistrySession } from "./fixtures/registry-download-response";
const linux = it.runIf(process.platform === "linux");
async function fixture(
  run: (f: ReturnType<typeof signedRegistryFixture>, out: string, bytes: Buffer) => Promise<void>,
) {
  const f = signedRegistryFixture(),
    space = vi.spyOn(retained, "reserveSpace").mockImplementation(() => {}),
    free = vi.spyOn(retained, "availableBytes").mockReturnValue(10n ** 12n);
  const bytes = createStoredZip([
    ["00_zenkoku_all_20261030.xml", readFileSync(f.xml)],
    ["00_zenkoku_all_20261030.xml.asc", readFileSync(f.xml + ".asc")],
  ]);
  try {
    await run(f, join(f.root, "full"), bytes);
  } finally {
    space.mockRestore();
    free.mockRestore();
    f.close();
  }
}
linux("全国XMLだけを取得し、保存済み分は通信せず再検証する", () =>
  fixture(async (f, out, bytes) => {
    const sessions: ReturnType<typeof mockRegistrySession>[] = [],
      factory = () => {
        const s = mockRegistrySession(bytes, fullListing);
        sessions.push(s);
        return s.request;
      };
    const result = await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 1, factory);
    expect(result).toMatchObject({
      status: "complete",
      signaturesVerified: true,
      materialized: true,
      expectedParts: 1,
      requestsThisRun: 2,
    });
    expect(sessions[0].calls[1].fields!.get("selDlFileNo")).toBe("33");
    const original = JSON.parse(readFileSync(result.importManifests[0], "utf8"));
    expect(original).toMatchObject({
      source: { kind: "full" },
      part: "00_zenkoku_all_20261030.xml",
    });
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 0, factory),
    ).toMatchObject({ status: "complete", requestsThisRun: 0 });
    expect(sessions).toHaveLength(1);
  }),
);
it.each([
  fullListing.replaceAll("令和8年10月30日更新", "令和8年10月29日更新"),
  fullListing.replaceAll("<dt>全国</dt>", "<dt>北海道</dt>"),
  fullListing.replace(
    "</form>",
    '<dl><dt>全国</dt><dd><a onclick="return doDownload(77);">zip 1MB</a></dd></dl></form>',
  ),
  fullListing.replace(
    "zip 364MB</a>",
    '分割1 zip 11MB</a><a onclick="return doDownload(34);">分割3 zip 5MB</a>',
  ),
])("日付・全国版・分割順が曖昧な一覧を拒否する", (html) => {
  expect(() => parseRegistryListing(html, "2026-10-30", "full")).toThrow();
});
linux("予算0では一覧だけ保存し、後から差分なしで再開できる", () =>
  fixture(async (f, out, bytes) => {
    const sessions: ReturnType<typeof mockRegistrySession>[] = [],
      factory = () => {
        const s = mockRegistrySession(bytes, fullListing);
        sessions.push(s);
        return s.request;
      };
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 0, factory),
    ).toMatchObject({ status: "pending", pendingFileIds: ["33"], requestsThisRun: 1 });
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 0, factory),
    ).toMatchObject({ status: "pending", requestsThisRun: 0 });
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 1, factory),
    ).toMatchObject({ status: "complete", requestsThisRun: 2 });
  }),
);
linux("容量不足では原本を保留し、容量回復後に再取得せず検証する", () =>
  fixture(async (f, out, bytes) => {
    const original = audit.inspectRegistryArchive,
      spy = vi.spyOn(audit, "inspectRegistryArchive").mockImplementation(async (...args) => {
        const v = await original(...args);
        v.expandedBytes = 10 ** 15;
        v.members[0].bytes = 10 ** 15;
        return v;
      });
    try {
      const result = await fetchNationalRegistry(
        "2026-10-30",
        f.key,
        f.fingerprint,
        out,
        1,
        () => mockRegistrySession(bytes, fullListing).request,
      );
      expect(result).toMatchObject({ status: "pending-capacity", signaturesVerified: false });
      expect(existsSync(result.parts[0].archive)).toBe(true);
      expect(existsSync(join(out, "part-000/verified"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 0, () => {
        throw Error("No network");
      }),
    ).toMatchObject({ status: "complete", requestsThisRun: 0 });
  }),
);
linux("保管原本の改変を再取得で置き換えない", () =>
  fixture(async (f, out, bytes) => {
    const result = await fetchNationalRegistry(
      "2026-10-30",
      f.key,
      f.fingerprint,
      out,
      1,
      () => mockRegistrySession(bytes, fullListing).request,
    );
    appendFileSync(result.parts[0].archive, "changed");
    await expect(
      fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 0, () => {
        throw Error("No network");
      }),
    ).rejects.toThrow("changed");
  }),
);
linux("分割ZIPの予算を守り、次回は残りだけを取得する", () =>
  fixture(async (f, out, bytes) => {
    const html = fullListing.replace(
        "zip 364MB</a>",
        '分割1 zip 11MB</a><a onclick="return doDownload(34);">分割2 zip 5MB</a>',
      ),
      sessions: ReturnType<typeof mockRegistrySession>[] = [];
    const factory = () => {
      const s = mockRegistrySession(bytes, html);
      sessions.push(s);
      return s.request;
    };
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 1, factory),
    ).toMatchObject({ status: "pending", pendingFileIds: ["34"], downloadsThisRun: 1 });
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 1, factory),
    ).toMatchObject({
      status: "complete",
      expectedParts: 2,
      downloadsThisRun: 1,
      requestsThisRun: 2,
    });
    expect(
      await fetchNationalRegistry("2026-10-30", f.key, f.fingerprint, out, 0, factory),
    ).toMatchObject({ status: "complete", requestsThisRun: 0 });
    expect(sessions.flatMap((s) => s.calls)).toHaveLength(4);
  }),
);
linux("全展開が収まらなくても一つずつ署名検証し、展開XMLを残さない", () =>
  fixture(async (f, out, bytes) => {
    const original = audit.inspectRegistryArchive,
      spy = vi.spyOn(audit, "inspectRegistryArchive").mockImplementation(async (...args) => ({
        ...(await original(...args)),
        expandedBytes: 10 ** 15,
      }));
    try {
      const result = await fetchNationalRegistry(
        "2026-10-30",
        f.key,
        f.fingerprint,
        out,
        1,
        () => mockRegistrySession(bytes, fullListing).request,
      );
      expect(result).toMatchObject({
        status: "verified-archive",
        signaturesVerified: true,
        materialized: false,
        expectedParts: 1,
      });
      expect(result).not.toHaveProperty("importManifests");
      expect(existsSync(join(out, "part-000/verified"))).toBe(false);
      expect(
        JSON.parse(readFileSync(result.archiveVerifications[0], "utf8")).parts[0].xmlSha256,
      ).toBe(f.manifest.sha256);
    } finally {
      spy.mockRestore();
    }
  }),
);
linux("後続署名の失敗では完了せず、一時展開をすべて除去する", () =>
  fixture(async (f, out) => {
    const bytes = createStoredZip([
      ["first.xml", readFileSync(f.xml)],
      ["first.xml.asc", readFileSync(f.xml + ".asc")],
      ["second.xml", readFileSync(f.xml)],
      ["second.xml.asc", "bad signature"],
    ]);
    const original = audit.inspectRegistryArchive,
      spy = vi.spyOn(audit, "inspectRegistryArchive").mockImplementation(async (...args) => ({
        ...(await original(...args)),
        expandedBytes: 10 ** 15,
      }));
    try {
      await expect(
        fetchNationalRegistry(
          "2026-10-30",
          f.key,
          f.fingerprint,
          out,
          1,
          () => mockRegistrySession(bytes, fullListing).request,
        ),
      ).rejects.toThrow();
      expect(
        readdirSync(join(out, "part-000")).some((name) =>
          name.startsWith("registry-xml-verification-"),
        ),
      ).toBe(false);
      expect(JSON.parse(readFileSync(join(out, "status.json"), "utf8")).signaturesVerified).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
  }),
);
linux("全XML数の上限を署名検証前に検査する", () =>
  fixture(async (f, out, bytes) => {
    const original = audit.inspectRegistryArchive,
      spy = vi.spyOn(audit, "inspectRegistryArchive").mockImplementation(async (...args) => ({
        ...(await original(...args)),
        expectedXmlParts: Array.from({ length: 101 }, (_, i) => i + ".xml"),
      }));
    try {
      await expect(
        fetchNationalRegistry(
          "2026-10-30",
          f.key,
          f.fingerprint,
          out,
          1,
          () => mockRegistrySession(bytes, fullListing).request,
        ),
      ).rejects.toThrow("part count");
      expect(existsSync(join(out, "part-000/verified"))).toBe(false);
    } finally {
      spy.mockRestore();
    }
  }),
);
