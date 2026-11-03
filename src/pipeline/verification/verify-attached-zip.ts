/** 訂正報告のZIP構造・manifest・添付全文を、SDKのZIP/版選択処理と独立に照合する。 */
import { strict as assert } from "node:assert";
import { crc32 } from "node:zlib";
import { fromBufferPromise } from "yauzl";
import { readZipMember } from "../../utils/read-zip-member";
import { readVersionXml, MIB, type VersionXmlNode } from "./read-version-input";
import { direct } from "./read-version-identity";
import { sha, digest } from "./version-evidence-format";
const MANIFEST = "http://disclosure.edinet-fsa.go.jp/2013/manifest";
function visible(raw: Buffer) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  let result = "",
    from = 0;
  for (let i = 0; i < text.length; i++)
    if (text[i] === "<") {
      const end = text.indexOf(">", i + 1);
      if (end < 0) break;
      result += text.slice(from, i) + " ";
      i = end;
      from = end + 1;
    }
  return (result + text.slice(from)).replace(/\s+/g, " ").trim();
}
function descendants(node: VersionXmlNode, local: string): VersionXmlNode[] {
  return node.children.flatMap((child) => [
    ...(child.tag === `{${MANIFEST}}${local}` ? [child] : []),
    ...descendants(child, local),
  ]);
}
export async function attachedZipProof(
  raw: Buffer,
  source: Buffer,
  evidence: any,
  ordinal: number,
  identity: Record<string, string>,
  day: string,
) {
  assert(sha(raw) === evidence.sha256, "Raw ZIP hash");
  let end = -1;
  for (let at = raw.length - 22; at > Math.max(-1, raw.length - 22 - 65536); at--)
    if (raw.readUInt32LE(at) === 0x06054b50 && at + 22 + raw.readUInt16LE(at + 20) === raw.length) {
      end = at;
      break;
    }
  assert(end >= 0, "ZIP end record");
  const count = raw.readUInt16LE(end + 10),
    offset = raw.readUInt32LE(end + 16);
  assert(
    raw.readUInt16LE(end + 4) === 0 &&
      raw.readUInt16LE(end + 6) === 0 &&
      raw.readUInt16LE(end + 8) === count &&
      count < 65535 &&
      offset + raw.readUInt32LE(end + 12) === end,
    "ZIP classic layout",
  );
  const zip = await fromBufferPromise(raw, {
      strictFileNames: true,
      autoClose: false,
      validateEntrySizes: true,
    }),
    infos = [];
  for await (const info of zip.eachEntry()) {
    infos.push(info);
    assert(infos.length <= 10000, "ZIP entry count");
  }
  assert(
    infos.length === count && infos.reduce((n, info) => n + info.uncompressedSize, 0) <= 256 * MIB,
    "ZIP total limits",
  );
  const members: {
      name: string;
      dir: false;
      compressedSize: number;
      uncompressedSize: number;
      sha256: string;
    }[] = [],
    content = new Map<string, Buffer>(),
    seen = new Set<string>(),
    paths = new Map<string, boolean>(),
    ranges: [number, number][] = [];
  for (const info of infos) {
    const name = info.fileName,
      bare = name.replace(/\/+$/, ""),
      parts = bare.split("/"),
      normalized = bare.normalize("NFC").toLowerCase(),
      directory = name.endsWith("/");
    assert(
      !seen.has(normalized) &&
        !name.startsWith("/") &&
        !/[\\\u0000-\u001f\u007f-\u009f:<>"|?*]/.test(name) &&
        Buffer.byteLength(name) <= 4096 &&
        parts.every(
          (p) =>
            p &&
            p !== "." &&
            p !== ".." &&
            Buffer.byteLength(p) <= 255 &&
            !/[. ]$/.test(p) &&
            !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:[ .]*\.|[ .]*$)/i.test(p),
        ),
      "ZIP unsafe/duplicate path",
    );
    seen.add(normalized);
    paths.set(normalized, directory);
    assert(
      info.generalPurposeBitFlag & 0x800 || [...name].every((c) => c.codePointAt(0)! < 128),
      "Non-UTF8 ZIP name",
    );
    assert(
      info.uncompressedSize <= 64 * MIB &&
        [0, 8].includes(info.compressionMethod) &&
        !(info.generalPurposeBitFlag & ~0x080e) &&
        [0, 0o100000, 0o040000].includes((info.externalFileAttributes >>> 16) & 0o170000) &&
        info.versionNeededToExtract < 45,
      "ZIP entry type/limits",
    );
    const at = info.relativeOffsetOfLocalHeader;
    assert(at >= 0 && at + 30 <= offset && raw.readUInt32LE(at) === 0x04034b50, "ZIP local header");
    const flags = raw.readUInt16LE(at + 6),
      method = raw.readUInt16LE(at + 8),
      nameLength = raw.readUInt16LE(at + 26),
      extraLength = raw.readUInt16LE(at + 28),
      start = at + 30 + nameLength + extraLength;
    assert(
      flags === info.generalPurposeBitFlag &&
        method === info.compressionMethod &&
        start + info.compressedSize <= offset,
      "ZIP local/central mismatch",
    );
    const localName = raw.subarray(at + 30, at + 30 + nameLength);
    assert(
      new TextDecoder("utf-8", { fatal: true }).decode(localName) === name,
      "ZIP local UTF8 name",
    );
    for (const extra of [info.extraFieldRaw, raw.subarray(at + 30 + nameLength, start)]) {
      for (let position = 0; position < extra.length;) {
        assert(position + 4 <= extra.length, "ZIP extra field");
        const tag = extra.readUInt16LE(position),
          length = extra.readUInt16LE(position + 2);
        position += 4;
        assert(position + length <= extra.length && tag !== 1, "ZIP64/extra field");
        if (tag === 0x7075) {
          const value = extra.subarray(position, position + length);
          assert(
            value.length >= 5 &&
              value[0] === 1 &&
              value.readUInt32LE(1) === crc32(localName) &&
              new TextDecoder("utf-8", { fatal: true }).decode(value.subarray(5)) === name,
            "ZIP Unicode override",
          );
        }
        position += length;
      }
    }
    let stop = start + info.compressedSize;
    if (flags & 8) {
      const descriptor = stop + (raw.readUInt32LE(stop) === 0x08074b50 ? 4 : 0);
      assert(
        descriptor + 12 <= offset &&
          raw.readUInt32LE(descriptor) === info.crc32 &&
          raw.readUInt32LE(descriptor + 4) === info.compressedSize &&
          raw.readUInt32LE(descriptor + 8) === info.uncompressedSize,
        "ZIP data descriptor",
      );
      stop = descriptor + 12;
    } else
      assert(
        raw.readUInt32LE(at + 14) === info.crc32 &&
          raw.readUInt32LE(at + 18) === info.compressedSize &&
          raw.readUInt32LE(at + 22) === info.uncompressedSize,
        "ZIP local sizes/CRC",
      );
    ranges.push([at, stop]);
    if (directory) continue;
    const chunks: Buffer[] = [];
    await readZipMember(zip, info, (chunk) => {
      chunks.push(chunk);
    });
    const data = Buffer.concat(chunks);
    assert(data.length === info.uncompressedSize, "ZIP size");
    content.set(name, data);
    members.push({
      name,
      dir: false,
      compressedSize: info.compressedSize,
      uncompressedSize: info.uncompressedSize,
      sha256: sha(data),
    });
  }
  ranges.sort((a, b) => a[0] - b[0]);
  assert(
    ranges.length &&
      ranges[0][0] === 0 &&
      ranges.at(-1)![1] === offset &&
      ranges.slice(1).every((range, i) => ranges[i][1] === range[0]),
    "ZIP overlapping/gapped records",
  );
  assert(
    [...paths.keys()].every((name) =>
      name
        .split("/")
        .slice(1)
        .every(
          (_part, i) =>
            paths.get(
              name
                .split("/")
                .slice(0, i + 1)
                .join("/"),
            ) !== false,
        ),
    ),
    "ZIP file/directory collision",
  );
  const entry = (name: string) => {
    const value = content.get(name);
    assert(value, "ZIP entry absent");
    return value;
  };
  const manifestName = "XBRL/PublicDoc/manifest_PublicDoc.xml",
    manifest = readVersionXml(entry(manifestName));
  assert(manifest.tag === `{${MANIFEST}}manifest`, "Manifest namespace");
  const instances = descendants(manifest, "instance"),
    items = descendants(manifest, "item");
  assert(instances.length === 1 && items.length === 1, "Manifest cardinality");
  const instance = instances[0],
    item = items[0],
    preferred = instance.attributes.preferredFilename,
    role = item.attributes.extrole;
  assert(
    instance.attributes.type === "PublicDoc" &&
      item.attributes.ref === instance.attributes.id &&
      /rol_CabinetOfficeOrdinanceOnDisclosureOfCorporateInformationEtcFormNo(?:3Annual|43Quarterly)SecuritiesReport$/.test(
        role ?? "",
      ),
    "Whole report role",
  );
  const expectedRole =
    "http://disclosure.edinet-fsa.go.jp/role/jpcrp/rol_CabinetOfficeOrdinanceOnDisclosureOfCorporateInformationEtcFormNo" +
    (identity.periodCode === "FY" ? "3Annual" : "43Quarterly") +
    "SecuritiesReport";
  assert(role === expectedRole, "Official attachment form role");
  const names = direct(instance, MANIFEST, "ixbrl").map((n) => n.text);
  assert(
    names.length >= 2 &&
      new Set(names).size === names.length &&
      [...names, preferred].every(
        (n) => typeof n === "string" && !n.includes("/") && !n.includes("\\"),
      ),
    "Inline manifest names",
  );
  const listed = names.map((n) => "XBRL/PublicDoc/" + n);
  assert(
    entry("XBRL/PublicDoc/" + preferred).equals(source) &&
      listed.some((n) => n.includes("_honbun_")),
    "Attached source/full body",
  );
  const headers = listed.filter((n) => n.includes("_header_"));
  assert(
    headers.length === 1 &&
      /訂正報告書の添付\s*インライン\s*XBRL/i.test(visible(entry(headers[0]))),
    "Attached inline cover",
  );
  for (const name of content.keys())
    if (
      name.startsWith("XBRL/PublicDoc/") &&
      /\.(?:xbrl|xsd|xml|htm|html)$/.test(name) &&
      name !== manifestName
    ) {
      const match =
        /_(E\d{5}-\d{3})_(\d{4}-\d{2}-\d{2})_(\d{2})_(\d{4}-\d{2}-\d{2})(?:_|\.|$)/.exec(name);
      assert(
        match &&
          match[1] === identity.issuer + "-000" &&
          match[2] === identity.currentPeriod &&
          match[3] === String(ordinal).padStart(2, "0") &&
          match[4] === day,
        "Filename ordinal/basis",
      );
    }
  const bodies = [...content.keys()].filter(
    (n) =>
      n.startsWith("PublicDoc/") &&
      /\.html?$/.test(n) &&
      /訂正事項|訂正箇所/.test(visible(entry(n))),
  );
  assert(bodies.length, "Correction text missing");
  return {
    rawResponseSha256: evidence.sha256,
    receivedAt: evidence.receivedAt,
    manifestSha256: sha(entry(manifestName)),
    role,
    preferred,
    inlineDocuments: listed.map((name) => ({ name, sha256: sha(entry(name)) })),
    memberManifestSha256: digest(members),
    memberCount: members.length,
    cover: { path: headers[0], sha256: sha(entry(headers[0])) },
    correctionBody: { path: bodies[0], sha256: sha(entry(bodies[0])) },
  };
}
