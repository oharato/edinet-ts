import { expect, it, vi } from "vitest";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  verifyRegistryZip,
  verifyRegistryArchiveParts,
} from "../src/companies/registry/verify-archive-parts";
import * as retained from "../src/utils/retained-files";
import { signedRegistryFixture, sha256 } from "./fixtures/signed-corporate-registry";
import { createStoredZip } from "./fixtures/create-stored-zip";
const linux = it.runIf(process.platform === "linux");
linux("全partの署名を検証し、既存結果を上書きしない", async () => {
  const f = signedRegistryFixture(),
    space = vi.spyOn(retained, "reserveSpace").mockImplementation(() => {});
  try {
    const { input } = await f.zip(),
      out = join(f.root, "out"),
      receipt = await verifyRegistryZip(input, out);
    expect(receipt).toMatchObject({ allExpectedMembersVerified: true, networkRequested: false });
    expect(receipt.members).toHaveLength(2);
    expect(receipt.parts[0].files.file.sha256).toBe(f.manifest.sha256);
    const before = readFileSync(join(out, "receipt.json"));
    await expect(verifyRegistryZip(input, out)).rejects.toThrow();
    expect(readFileSync(join(out, "receipt.json"))).toEqual(before);
    expect(await verifyRegistryArchiveParts(input)).toMatchObject({
      signaturesVerified: true,
      materialized: false,
      parts: [{ xmlSha256: f.manifest.sha256 }],
    });
  } finally {
    space.mockRestore();
    f.close();
  }
});
linux.each([
  "missing",
  "duplicate",
  "traversal",
  "wrong-hash",
  "bad-signature",
  "capacity",
  "capacity-loss",
  "later-part",
  "oversized-directory",
  "declared-traversal",
  "crc",
])("不正ZIPを拒否して途中の出力を除去する: %s", async (mutation) => {
  const f = signedRegistryFixture(),
    space = vi.spyOn(retained, "reserveSpace").mockImplementation(() => {});
  try {
    const { input, value } = await f.zip();
    const entries: [string, string | Uint8Array][] = [
      ["data.xml", readFileSync(f.xml)],
      ["data.xml.asc", readFileSync(f.xml + ".asc")],
    ];
    if (mutation === "missing") entries.pop();
    if (mutation === "duplicate") entries.push(["data.xml", "other"]);
    if (mutation === "traversal") entries.push(["../escape", "no"]);
    if (mutation === "bad-signature") entries[1][1] = "bad";
    if (mutation === "later-part") {
      entries.push(["second.xml", readFileSync(f.xml)], ["second.xml.asc", "bad"]);
      value.expectedXmlParts.push("second.xml");
    }
    const bytes = createStoredZip(entries);
    if (mutation === "oversized-directory") bytes.writeUInt32LE(5 * 1024 ** 2, bytes.length - 10);
    if (mutation === "crc") {
      const offset = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
      bytes.writeUInt32LE(0, offset + 16);
    }
    writeFileSync(value.archive, bytes);
    value.sha256 = mutation === "wrong-hash" ? "0".repeat(64) : sha256(bytes);
    if (mutation === "declared-traversal") value.expectedXmlParts = ["../data.xml"];
    writeFileSync(input, JSON.stringify(value));
    if (mutation === "capacity")
      space.mockImplementation(() => {
        throw Error("capacity");
      });
    if (mutation === "capacity-loss")
      space
        .mockImplementationOnce(() => {})
        .mockImplementation(() => {
          throw Error("capacity");
        });
    await expect(verifyRegistryZip(input, join(f.root, "out"))).rejects.toThrow();
    expect(existsSync(join(f.root, "out"))).toBe(false);
    expect(existsSync(join(f.root, "escape"))).toBe(false);
  } finally {
    space.mockRestore();
    f.close();
  }
});
