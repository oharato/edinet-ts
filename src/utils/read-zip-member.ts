/** ZIPの一つのmemberを順に読み、展開サイズ・CRC・SHA-256を検査する。 */
import { strict as assert } from "node:assert";
import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";
import type { ZipFile, Entry } from "yauzl";
export async function readZipMember(
  zip: ZipFile,
  member: Entry,
  write: (bytes: Buffer) => void | Promise<void>,
) {
  const source = await zip.openReadStreamPromise(member),
    hash = createHash("sha256");
  let bytes = 0,
    crc = 0;
  try {
    for await (const chunk of source) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      bytes += buffer.length;
      assert(bytes <= member.uncompressedSize, "Expanded member exceeded size");
      crc = crc32(buffer, crc);
      hash.update(buffer);
      await write(buffer);
    }
    assert(
      bytes === member.uncompressedSize && crc === member.crc32,
      "Incomplete member or CRC mismatch",
    );
    return {
      entry: member.fileName,
      bytes,
      crc32: crc.toString(16).padStart(8, "0"),
      sha256: hash.digest("hex"),
    };
  } finally {
    source.destroy();
  }
}
