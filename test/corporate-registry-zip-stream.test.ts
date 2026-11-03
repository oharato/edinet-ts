import { expect, it } from "vitest";
import {
  appendFileSync,
  linkSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import { createStoredZip } from "./fixtures/create-stored-zip";
import { sha256 } from "./fixtures/signed-corporate-registry";
import { streamVerifiedXml } from "../src/companies/registry/stream-verified-xml";
it.each([
  "valid",
  "archive-hash",
  "xml-hash",
  "missing-signature",
  "crc",
  "hardlink",
  "archive-change",
  "receipt-change",
])("ZIP送出の完全性を検査する: %s", async (mutation) => {
  const dir = mkdtempSync(join(tmpdir(), "registry-zip-stream-")),
    archive = join(dir, "source.zip"),
    receipt = join(dir, "receipt.json"),
    xml = Buffer.from("<corporations/>");
  try {
    const entries: [string, string | Uint8Array][] = [
      ["part.xml", xml],
      ["part.xml.asc", "synthetic signature fixture only"],
    ];
    if (mutation === "missing-signature") entries.pop();
    let bytes = createStoredZip(entries);
    if (mutation === "crc") {
      bytes = Buffer.from(bytes);
      bytes[30 + Buffer.byteLength("part.xml") + 1] ^= 1;
    }
    writeFileSync(archive, bytes);
    const data = {
      format: "edinet-ts-corporate-registry-verified-archive-v1",
      signaturesVerified: true,
      archive: {
        path: archive,
        sha256: mutation === "archive-hash" ? "0".repeat(64) : sha256(bytes),
        bytes: bytes.length,
      },
      parts: [
        {
          entry: "part.xml",
          xmlSha256: mutation === "xml-hash" ? "0".repeat(64) : sha256(xml),
          xmlBytes: xml.length,
        },
      ],
    };
    writeFileSync(receipt, JSON.stringify(data));
    if (mutation === "hardlink") linkSync(archive, join(dir, "alias.zip"));
    const chunks: Buffer[] = [];
    const out = new Writable({
      write(chunk, _encoding, done) {
        chunks.push(Buffer.from(chunk));
        if (mutation === "archive-change") appendFileSync(archive, "changed");
        if (mutation === "receipt-change") appendFileSync(receipt, " ");
        done();
      },
    });
    if (mutation === "valid") {
      await streamVerifiedXml(receipt, "part.xml", out);
      expect(Buffer.concat(chunks)).toEqual(xml);
      expect(readFileSync(archive)).toEqual(bytes);
    } else {
      await expect(streamVerifiedXml(receipt, "part.xml", out)).rejects.toThrow();
      if (mutation === "archive-hash") expect(chunks).toEqual([]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
