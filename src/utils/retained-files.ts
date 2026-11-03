/** 保存原本をsymlinkなしで開き、サイズ・hash・inodeの不変性を検査する。 */
import {
  constants,
  closeSync,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  statfsSync,
} from "node:fs";
import type { BigIntStats } from "node:fs";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { strict as assert } from "node:assert";

export const RESERVE = 34 * 1024 ** 3;
export const identity = (s: BigIntStats) =>
  [s.dev, s.ino, s.size, s.mtimeNs, s.ctimeNs, s.nlink].join(":");
export class RetainedFile {
  readonly path: string;
  readonly fd: number;
  readonly before: BigIntStats;
  readonly bytes: number;
  constructor(path: string, maximum: number) {
    this.path = resolve(path);
    this.fd = openSync(this.path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      this.before = fstatSync(this.fd, { bigint: true });
      assert(
        this.before.isFile() &&
          this.before.nlink === 1n &&
          this.before.size > 0n &&
          this.before.size <= BigInt(maximum),
        "Expected a bounded, single-link regular file",
      );
      this.bytes = Number(this.before.size);
    } catch (error) {
      closeSync(this.fd);
      throw error;
    }
  }
  read(offset: number, bytes: number) {
    assert(
      Number.isSafeInteger(offset) &&
        Number.isSafeInteger(bytes) &&
        offset >= 0 &&
        bytes >= 0 &&
        offset + bytes <= this.bytes,
      "Read exceeds retained input",
    );
    const buffer = Buffer.alloc(bytes);
    let got = 0;
    while (got < bytes) {
      const n = readSync(this.fd, buffer, got, bytes - got, offset + got);
      assert(n > 0, "Incomplete retained input");
      got += n;
    }
    return buffer;
  }
  digest() {
    const hash = createHash("sha256");
    for (let offset = 0; offset < this.bytes; offset += 1024 * 1024)
      hash.update(this.read(offset, Math.min(1024 * 1024, this.bytes - offset)));
    this.unchanged();
    return hash.digest("hex");
  }
  unchanged() {
    assert(
      identity(fstatSync(this.fd, { bigint: true })) === identity(this.before) &&
        identity(lstatSync(this.path, { bigint: true })) === identity(this.before),
      "Retained input changed",
    );
  }
  close() {
    closeSync(this.fd);
  }
}
export function readRetainedJSON(path: string): any {
  const file = new RetainedFile(path, 2 * 1024 ** 2);
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
export function availableBytes(directory: string) {
  const stat = statfsSync(directory, { bigint: true });
  return stat.bavail * stat.bsize;
}
export function reserveSpace(directory: string, required = 0, reserve = RESERVE) {
  assert(
    availableBytes(directory) >= BigInt(reserve) + BigInt(required),
    "Insufficient free space with 34GiB reserve",
  );
}
export const exactKeys = (value: any, fields: string[]) => {
  assert(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...fields].sort()),
    "Invalid manifest fields",
  );
};
