/** ZIPのXMLを一つずつ取り出して署名を検証する。原本と既存の証跡は上書きしない。 */
import { readZipMember } from "../archive/read-zip-member";
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  writeSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import type { Entry, ZipFile } from "yauzl";
import { exactKeys, readRetainedJSON, reserveSpace, RetainedFile } from "../files/retained-files";
import { openRetainedZip, validateMembers } from "./read-retained-zip";
import { verifyDetachedSignature } from "./verify-detached-signature";

export const writeJSON = (path: string, value: unknown) =>
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { flag: "wx", mode: 0o600 });
async function extract(zip: ZipFile, member: Entry, path: string) {
  const fd = openSync(path, "wx", 0o600);
  try {
    const result = await readZipMember(zip, member, (chunk) => {
      reserveSpace(dirname(path), chunk.length);
      let offset = 0;
      while (offset < chunk.length) offset += writeSync(fd, chunk, offset, chunk.length - offset);
    });
    reserveSpace(dirname(path));
    return { ...result, path };
  } finally {
    closeSync(fd);
  }
}
function manifestInput(path: string) {
  const m = readRetainedJSON(path),
    base = dirname(resolve(path));
  exactKeys(m, ["archive", "sha256", "publicKey", "fingerprint", "source", "expectedXmlParts"]);
  assert(
    typeof m.archive === "string" &&
      m.archive.trim() &&
      typeof m.publicKey === "string" &&
      m.publicKey.trim() &&
      typeof m.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(m.sha256),
    "Invalid ZIP input",
  );
  return { m, base };
}
export async function inspectRegistryArchive(path: string, expectedSha256: string) {
  const file = new RetainedFile(path, 2 * 1024 ** 3);
  try {
    assert(file.digest() === expectedSha256, "ZIP differs from acquisition hash");
    const { members } = await openRetainedZip(file),
      names = members
        .filter((member) => member.fileName.endsWith(".xml"))
        .map((member) => member.fileName);
    validateMembers(members, names);
    assert(file.digest() === expectedSha256, "ZIP changed during inspection");
    return {
      sha256: expectedSha256,
      bytes: file.bytes,
      expectedXmlParts: names,
      expandedBytes: members.reduce((n, m) => n + m.uncompressedSize, 0),
      members: members.map((m) => ({
        entry: m.fileName,
        bytes: m.uncompressedSize,
        compressedBytes: m.compressedSize,
        crc32: m.crc32.toString(16).padStart(8, "0"),
      })),
      signaturesVerified: false,
    };
  } finally {
    file.close();
  }
}
export async function verifyRegistryZip(manifest: string, output: string) {
  const { m, base } = manifestInput(manifest),
    out = resolve(output),
    file = new RetainedFile(resolve(base, m.archive), 2 * 1024 ** 3);
  try {
    assert(file.digest() === m.sha256, "ZIP differs from acquisition hash");
    const { zip, members } = await openRetainedZip(file);
    validateMembers(members, m.expectedXmlParts);
    reserveSpace(
      dirname(out),
      members.reduce((n, m) => n + m.uncompressedSize, 0),
    );
    mkdirSync(out, { mode: 0o700 });
    try {
      const receipts: Awaited<ReturnType<typeof verifyDetachedSignature>>[] = [],
        inventory: Awaited<ReturnType<typeof extract>>[] = [],
        imports: { manifest: string; input: unknown }[] = [];
      for (const [i, name] of m.expectedXmlParts.entries()) {
        const stem = "part-" + String(i).padStart(3, "0"),
          xml = join(out, stem + ".xml");
        for (const [entry, target] of [
          [name, xml],
          [name + ".asc", xml + ".asc"],
        ])
          inventory.push(
            await extract(
              zip,
              members.find((member) => member.fileName === entry)!,
              target,
            ),
          );
        const input = join(out, stem + "-input.json");
        writeJSON(input, {
          file: xml,
          signature: xml + ".asc",
          sha256: inventory.at(-2)!.sha256,
          publicKey: resolve(base, m.publicKey),
          fingerprint: m.fingerprint,
          source: m.source,
          part: name,
        });
        const receipt = await verifyDetachedSignature(input);
        receipts.push(receipt);
        imports.push({ manifest: stem + "-import.json", input: receipt.importManifest });
      }
      assert(file.digest() === m.sha256, "ZIP changed during verification");
      const receipt = {
        format: "edinet-ts-corporate-registry-zip-v1",
        archive: { path: file.path, sha256: m.sha256, bytes: file.bytes },
        source: m.source,
        members: inventory,
        parts: receipts,
        imports,
        allExpectedMembersVerified: true,
        networkRequested: false,
      };
      receipts.forEach((part, i) =>
        writeJSON(join(out, "part-" + String(i).padStart(3, "0") + "-receipt.json"), part),
      );
      imports.forEach((item) => writeJSON(join(out, item.manifest), item.input));
      writeJSON(join(out, "receipt.json"), receipt);
      return receipt;
    } catch (error) {
      rmSync(out, { recursive: true, force: true });
      throw error;
    }
  } finally {
    file.close();
  }
}
export async function verifyRegistryArchiveParts(manifest: string) {
  const { m, base } = manifestInput(manifest),
    file = new RetainedFile(resolve(base, m.archive), 2 * 1024 ** 3);
  try {
    assert(file.digest() === m.sha256, "ZIP differs from acquisition hash");
    const { zip, members } = await openRetainedZip(file);
    validateMembers(members, m.expectedXmlParts);
    const receipts = [];
    for (const name of m.expectedXmlParts) {
      const member = members.find((member) => member.fileName === name)!,
        sig = members.find((member) => member.fileName === name + ".asc")!;
      reserveSpace(base, member.uncompressedSize + sig.uncompressedSize);
      const directory = mkdtempSync(join(base, "registry-xml-verification-"));
      try {
        const xml = await extract(zip, member, join(directory, "input.xml")),
          detached = await extract(zip, sig, join(directory, "input.xml.asc"));
        const input = join(directory, "input.json");
        writeJSON(input, {
          file: xml.path,
          signature: detached.path,
          sha256: xml.sha256,
          publicKey: resolve(base, m.publicKey),
          fingerprint: m.fingerprint,
          source: m.source,
          part: name,
        });
        const result = await verifyDetachedSignature(input);
        receipts.push({
          entry: name,
          xmlSha256: xml.sha256,
          xmlBytes: xml.bytes,
          signatureEntry: name + ".asc",
          signatureSha256: detached.sha256,
          trustedFingerprint: result.trustedFingerprint,
          signingFingerprint: result.signingFingerprint,
          signatureCreatedAt: result.signatureCreatedAt,
          verifiedAt: result.verifiedAt,
          gpgVersion: result.gpgVersion,
          verificationStatus: result.verificationStatus,
          publicKey: result.files.publicKey,
        });
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
    assert(file.digest() === m.sha256, "ZIP changed during verification");
    return {
      format: "edinet-ts-corporate-registry-verified-archive-v1",
      archive: { path: file.path, sha256: m.sha256, bytes: file.bytes },
      source: m.source,
      parts: receipts,
      signaturesVerified: true,
      materialized: false,
      networkRequested: false,
    };
  } finally {
    file.close();
  }
}
