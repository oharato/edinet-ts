/** 停止済みSQLiteをbyte単位でgzip退避・復元する。退役は照合と利用中FDの再検査後だけ行う。 */
import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createGunzip, createGzip } from "node:zlib";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { strict as assert } from "node:assert";
import { RetainedFile, reserveSpace } from "../../utils/retained-files";
import { atomicJSON, canonical } from "../../verification-files";
const fingerprint = (s: BigIntStats) =>
  [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink].map(String);
const now = () => new Date().toISOString();
const atomic = (path: string, value: unknown) => atomicJSON(path, value, { createOnly: true });
function stopped(path: string) {
  for (const suffix of ["-wal", "-shm", "-journal"]) {
    try {
      lstatSync(path + suffix);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    throw Error("SQLite sidecar present");
  }
}
function load(path: string) {
  const file = new RetainedFile(path, 1024 ** 2);
  try {
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(file.read(0, file.bytes)),
    );
    file.unchanged();
    return value;
  } finally {
    file.close();
  }
}
function flushDirectory(path: string) {
  const fd = openSync(path, "r");
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
async function decoded(file: RetainedFile, expectedBytes: number, write?: (chunk: Buffer) => void) {
  const hash = createHash("sha256");
  let bytes = 0;
  await pipeline(
    createReadStream(file.path, { fd: file.fd, autoClose: false, start: 0, end: file.bytes - 1 }),
    createGunzip(),
    async (chunks) => {
      for await (const chunk of chunks) {
        bytes += chunk.length;
        assert(bytes <= expectedBytes, "Decoded data exceeds original size");
        hash.update(chunk);
        write?.(chunk);
      }
    },
  );
  return { bytes, sha256: hash.digest("hex") };
}
export async function verifyColdPayload(
  path: string,
  sourceBytes: number,
  sourceSha256: string,
  expectedArchive?: { bytes: number; sha256: string },
) {
  const file = new RetainedFile(path, 1024 ** 4);
  try {
    const sha256 = file.digest();
    if (expectedArchive)
      assert(
        file.bytes === expectedArchive.bytes && sha256 === expectedArchive.sha256,
        "Compressed archive changed",
      );
    const result = await decoded(file, sourceBytes);
    assert(
      result.bytes === sourceBytes && result.sha256 === sourceSha256,
      "Cold archive differs from original",
    );
    file.unchanged();
    return { path: file.path, bytes: file.bytes, sha256 };
  } finally {
    file.close();
  }
}
export async function packColdSqlite(source: string, output: string, expectedSha256: string) {
  assert(
    typeof expectedSha256 === "string" && /^[a-f0-9]{64}$/.test(expectedSha256),
    "Pinned SHA-256 required",
  );
  source = resolve(source);
  const out = resolve(output);
  stopped(source);
  const file = new RetainedFile(source, 1024 ** 4);
  try {
    assert(
      file.bytes >= 16 && file.read(0, 16).equals(Buffer.from("SQLite format 3\0")),
      "SQLite header required",
    );
    mkdirSync(out, { mode: 0o700 });
    try {
      const partial = join(out, "payload.partial.gz"),
        fd = openSync(partial, "wx", 0o600),
        hash = createHash("sha256");
      let bytes = 0;
      try {
        await pipeline(
          createReadStream(source, {
            fd: file.fd,
            autoClose: false,
            start: 0,
            end: file.bytes - 1,
          }),
          new Transform({
            transform(chunk, _encoding, done) {
              bytes += chunk.length;
              hash.update(chunk);
              done(null, chunk);
            },
          }),
          createGzip({ level: 6 }),
          new Transform({
            transform(chunk, _encoding, done) {
              try {
                reserveSpace(out, chunk.length);
                done(null, chunk);
              } catch (error) {
                done(error as Error);
              }
            },
          }),
          createWriteStream(partial, { fd, autoClose: false }),
        );
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      assert(
        bytes === file.bytes && hash.digest("hex") === expectedSha256,
        "Original SHA-256 differs",
      );
      file.unchanged();
      stopped(source);
      const archive = await verifyColdPayload(partial, file.bytes, expectedSha256);
      file.unchanged();
      stopped(source);
      renameSync(partial, join(out, "payload.gz"));
      archive.path = join(out, "payload.gz");
      const receipt = {
        format: "edinet-ts-cold-sqlite-v1",
        source: {
          path: source,
          bytes: file.bytes,
          sha256: expectedSha256,
          identity: fingerprint(file.before),
        },
        archive,
        verifiedAt: now(),
        method: "full-gzip-roundtrip-sha256",
        sourceRetainedAtPack: true,
      };
      atomic(join(out, "receipt.json"), receipt);
      return receipt;
    } catch (error) {
      rmSync(out, { recursive: true, force: true });
      throw error;
    }
  } finally {
    file.close();
  }
}
function captureReceipt(output: string) {
  const out = resolve(output),
    receipt = load(join(out, "receipt.json")),
    s = receipt.source,
    a = receipt.archive;
  assert(
    receipt.format === "edinet-ts-cold-sqlite-v1" && a.path === join(out, "payload.gz"),
    "Invalid cold archive receipt",
  );
  assert(
    Number.isSafeInteger(s.bytes) &&
      s.bytes >= 16 &&
      s.bytes <= 1024 ** 4 &&
      Number.isSafeInteger(a.bytes) &&
      a.bytes > 0 &&
      typeof s.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(s.sha256) &&
      typeof a.sha256 === "string" &&
      /^[a-f0-9]{64}$/.test(a.sha256),
    "Invalid source or compressed fingerprint",
  );
  assert(
    Array.isArray(s.identity) && s.identity.length === 6 && s.identity[2] === String(s.bytes),
    "Invalid original identity",
  );
  return { out, receipt };
}
export function openDescriptors(source: string, allowedFd: number) {
  const original = statSync(source, { bigint: true }),
    matches: { pid: string; fd: string }[] = [],
    opaque = new Set<string>();
  const permission = (error: NodeJS.ErrnoException) =>
    ["EACCES", "EPERM"].includes(error.code ?? "");
  const vanished = (error: NodeJS.ErrnoException) => ["ENOENT", "ESRCH"].includes(error.code ?? "");
  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    let descriptors: string[];
    try {
      if (statSync(join("/proc", pid)).uid !== process.getuid!()) continue;
      descriptors = readdirSync(join("/proc", pid, "fd"));
    } catch (error) {
      if (vanished(error as NodeJS.ErrnoException)) continue;
      if (permission(error as NodeJS.ErrnoException)) {
        opaque.add(pid);
        continue;
      }
      throw error;
    }
    for (const fd of descriptors) {
      if (pid === String(process.pid) && fd === String(allowedFd)) continue;
      try {
        const s = statSync(join("/proc", pid, "fd", fd), { bigint: true });
        if (s.dev === original.dev && s.ino === original.ino) matches.push({ pid, fd });
      } catch (error) {
        if (permission(error as NodeJS.ErrnoException)) opaque.add(pid);
        else if (!vanished(error as NodeJS.ErrnoException)) throw error;
      }
    }
  }
  return { openDescriptors: matches, opaqueOwnedProcesses: [...opaque].sort() };
}
function usageAudit(out: string, source: string, fd: number, phase: string) {
  const audit = openDescriptors(source, fd),
    numbers = readdirSync(out)
      .filter((name) => /^retire-check-\d{4}\.json$/.test(name))
      .map((name) => Number(name.slice(13, 17)));
  const number = 1 + Math.max(0, ...numbers);
  assert(number <= 9999, "Audit count exceeded");
  const path = join(out, "retire-check-" + String(number).padStart(4, "0") + ".json"),
    value = { checkedAt: now(), phase, ...audit };
  atomic(path, value);
  return { auditPath: path, ...value };
}
export function auditColdSqliteUsage(output: string) {
  const { out, receipt } = captureReceipt(output),
    source = receipt.source.path;
  stopped(source);
  const file = new RetainedFile(source, 1024 ** 4);
  try {
    assert(
      file.before.uid === BigInt(process.getuid!()) &&
        canonical(fingerprint(file.before)) === canonical(receipt.source.identity),
      "Original owner or identity changed",
    );
    const audit = usageAudit(out, source, file.fd, "audit-only");
    file.unchanged();
    stopped(source);
    return {
      status:
        audit.openDescriptors.length || audit.opaqueOwnedProcesses.length
          ? "blocked"
          : "no-open-readers-observed",
      sourceRetained: true,
      ...audit,
    };
  } finally {
    file.close();
  }
}
export async function retireColdSqlite(output: string) {
  const { out, receipt } = captureReceipt(output),
    source = receipt.source.path;
  stopped(source);
  const file = new RetainedFile(source, 1024 ** 4);
  try {
    assert(
      file.before.uid === BigInt(process.getuid!()) &&
        canonical(fingerprint(file.before)) === canonical(receipt.source.identity),
      "Original owner or identity changed",
    );
    const check = (phase: string) => {
      const audit = usageAudit(out, source, file.fd, phase);
      assert(
        !audit.openDescriptors.length && !audit.opaqueOwnedProcesses.length,
        "Source use cannot be ruled out; original retained",
      );
    };
    check("before-verification");
    const current = captureReceipt(out);
    assert(canonical(current.receipt) === canonical(receipt), "Receipt changed");
    const archive = await verifyColdPayload(
      join(out, "payload.gz"),
      receipt.source.bytes,
      receipt.source.sha256,
      receipt.archive,
    );
    assert(
      canonical(archive) === canonical(receipt.archive) && file.digest() === receipt.source.sha256,
      "Original or archive changed",
    );
    check("before-retirement");
    file.unchanged();
    stopped(source);
    // Callers must stop future consumers before this explicit retirement operation.
    unlinkSync(source);
    flushDirectory(dirname(source));
    atomic(join(out, "retired.json"), {
      retiredAt: now(),
      source: receipt.source,
      archive: receipt.archive,
    });
    return { status: "retired", receipt: join(out, "receipt.json") };
  } finally {
    file.close();
  }
}
export async function restoreColdSqlite(output: string, target?: string) {
  const { out, receipt } = captureReceipt(output),
    source = receipt.source;
  target = resolve(target ?? source.path);
  stopped(target);
  try {
    lstatSync(target);
    throw Error("Restore never overwrites an existing path");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  reserveSpace(dirname(target), source.bytes);
  const archive = new RetainedFile(join(out, "payload.gz"), 1024 ** 4);
  try {
    assert(
      archive.bytes === receipt.archive.bytes && archive.digest() === receipt.archive.sha256,
      "Compressed archive changed",
    );
    const pending = join(dirname(target), ".sqlite-restore-" + randomUUID()),
      fd = openSync(pending, "wx", 0o600);
    try {
      let result;
      try {
        result = await decoded(archive, source.bytes, (chunk) => {
          reserveSpace(dirname(target!), chunk.length);
          let offset = 0;
          while (offset < chunk.length)
            offset += writeSync(fd, chunk, offset, chunk.length - offset);
        });
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      assert(
        result.bytes === source.bytes && result.sha256 === source.sha256,
        "Restored bytes differ",
      );
      archive.unchanged();
      stopped(target);
      linkSync(pending, target);
      unlinkSync(pending);
      flushDirectory(dirname(target));
      return { status: "restored", path: target, ...result };
    } finally {
      if (existsSync(pending)) unlinkSync(pending);
    }
  } finally {
    archive.close();
  }
}
