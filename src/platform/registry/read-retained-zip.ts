/** 最大2GiBの保存ZIPを展開しきらずに読む。中央directory・各memberのCRC/サイズを検査する。 */
import { strict as assert } from "node:assert";
import { fromFdPromise, type Entry } from "yauzl";
import { RetainedFile } from "../files/retained-files";

export function centralDirectory(file: RetainedFile) {
  const tail = file.read(Math.max(0, file.bytes - 65557), Math.min(file.bytes, 65557));
  const offset = tail.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert(offset >= 0 && tail.length - offset >= 22, "Missing ZIP directory");
  const count = tail.readUInt16LE(offset + 10),
    length = tail.readUInt32LE(offset + 12),
    start = tail.readUInt32LE(offset + 16);
  assert(
    tail.readUInt16LE(offset + 4) === 0 &&
      tail.readUInt16LE(offset + 6) === 0 &&
      count === tail.readUInt16LE(offset + 8) &&
      count >= 2 &&
      count <= 200 &&
      length <= 4 * 1024 ** 2 &&
      start + length === file.bytes - tail.length + offset &&
      offset + 22 + tail.readUInt16LE(offset + 20) === tail.length,
    "Unsupported ZIP directory",
  );
  return { start, length, count };
}
export function validateMembers(members: Entry[], names: unknown): asserts names is string[] {
  assert(
    Array.isArray(names) &&
      names.length >= 1 &&
      names.length <= 100 &&
      names.every(
        (name) =>
          typeof name === "string" &&
          name.endsWith(".xml") &&
          !name.includes("\\") &&
          !name.includes("\0") &&
          !name.startsWith("/") &&
          name.split("/").every((part) => part && part !== "." && part !== ".."),
      ) &&
      new Set(names).size === names.length,
    "Invalid expected XML part names",
  );
  const expected = new Set(names.flatMap((name) => [name, name + ".asc"]));
  assert(
    members.length === expected.size &&
      new Set(members.map((member) => member.fileName)).size === expected.size &&
      members.every((member) => expected.has(member.fileName)),
    "ZIP has missing, duplicate or unexpected members",
  );
  for (const member of members) {
    const mode = member.externalFileAttributes >>> 16,
      limit = member.fileName.endsWith(".asc") ? 1024 ** 2 : 8 * 1024 ** 3;
    assert(
      !(member.generalPurposeBitFlag & 1) &&
        !member.fileName.endsWith("/") &&
        [0, 0o100000].includes(mode & 0o170000) &&
        member.uncompressedSize > 0 &&
        member.uncompressedSize <= limit &&
        [0, 8].includes(member.compressionMethod),
      "Unsupported ZIP member",
    );
  }
}
export async function openRetainedZip(file: RetainedFile) {
  const directory = centralDirectory(file);
  const zip = await fromFdPromise(file.fd, {
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  const members: Entry[] = [];
  for await (const entry of zip.eachEntry()) {
    members.push(entry);
    assert(members.length <= directory.count, "ZIP member count differs");
    // Python's ZIP reader checked local names; yauzl intentionally ignores them.
    const local = file.read(entry.relativeOffsetOfLocalHeader, 30);
    assert(
      local.readUInt32LE(0) === 0x04034b50 &&
        local.readUInt16LE(6) === entry.generalPurposeBitFlag &&
        local.readUInt16LE(8) === entry.compressionMethod,
      "ZIP local header differs",
    );
    const nameBytes = local.readUInt16LE(26),
      extraBytes = local.readUInt16LE(28);
    const rawName = file.read(entry.relativeOffsetOfLocalHeader + 30, nameBytes);
    assert(rawName.equals(entry.fileNameRaw), "ZIP local name differs");
    assert(
      entry.relativeOffsetOfLocalHeader + 30 + nameBytes + extraBytes + entry.compressedSize <=
        directory.start,
      "ZIP member overlaps directory",
    );
  }
  assert(members.length === directory.count, "ZIP member count differs");
  return { zip, members };
}
