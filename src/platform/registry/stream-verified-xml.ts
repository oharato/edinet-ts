/** 事前署名検証の記録と保存ZIPを照合して、指定XMLだけをstdoutへ流す。署名の再認証は行わない。 */
import { readZipMember } from "../archive/read-zip-member";
import { strict as assert } from "node:assert";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { once } from "node:events";
import type { Writable } from "node:stream";
import { RetainedFile } from "../files/retained-files";
import { openRetainedZip, validateMembers } from "./read-retained-zip";

export async function streamVerifiedXml(receiptPath: string, entry: string, output: Writable) {
  const receiptFile = new RetainedFile(receiptPath, 2 * 1024 ** 2);
  let file: RetainedFile | undefined;
  try {
    const receipt = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(receiptFile.read(0, receiptFile.bytes)),
    );
    assert(
      receipt.format === "edinet-ts-corporate-registry-verified-archive-v1" &&
        receipt.signaturesVerified === true &&
        Array.isArray(receipt.parts),
      "A prior verified archive receipt is required",
    );
    const parts = receipt.parts,
      matching = parts.filter((part: any) => part.entry === entry);
    assert(matching.length === 1, "Entry missing or duplicated in receipt");
    const part = matching[0],
      info = receipt.archive;
    assert(
      typeof part.xmlSha256 === "string" && /^[a-f0-9]{64}$/.test(part.xmlSha256),
      "Invalid XML hash",
    );
    file = new RetainedFile(info.path, 2 * 1024 ** 3);
    assert(
      file.bytes === info.bytes && file.digest() === info.sha256,
      "Archive differs from receipt",
    );
    const { zip, members } = await openRetainedZip(file);
    validateMembers(
      members,
      parts.map((part: any) => part.entry),
    );
    const member = members.find((member) => member.fileName === entry)!;
    assert(member.uncompressedSize === part.xmlBytes, "Entry size differs from receipt");
    const result = await readZipMember(zip, member, async (chunk) => {
      if (!output.write(chunk)) await once(output, "drain");
    });
    assert(result.sha256 === part.xmlSha256, "XML differs from receipt");
    assert(file.digest() === info.sha256, "Archive changed during stream");
    receiptFile.unchanged();
  } finally {
    file?.close();
    receiptFile.close();
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({
      options: { receipt: { type: "string" }, entry: { type: "string" } },
    });
    assert(values.receipt && values.entry, "--receipt and --entry are required");
    await streamVerifiedXml(resolve(values.receipt), values.entry, process.stdout);
  } catch {
    console.error("Verified XML stream failed");
    process.exitCode = 1;
  }
}
