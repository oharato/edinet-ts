import { constants, openSync, fstatSync, readSync, closeSync } from "node:fs";

/** ZIP証拠のファイルI/O。読取中の置換・増減を拒否し、呼出元へ元byteだけを渡す。 */
export function readFinancialZipFile(path: string, maximumBytes: number): Uint8Array {
  let fd: number | undefined;
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    const before = fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.size > BigInt(maximumBytes)) throw Error("zip-invalid");
    const data = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < data.length) {
      const n = readSync(fd, data, length, data.length - length, null);
      if (!n) break;
      length += n;
    }
    const after = fstatSync(fd, { bigint: true });
    if (
      length !== Number(before.size) ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs ||
      before.ctimeNs !== after.ctimeNs
    )
      throw Error("zip-invalid");
    return data.subarray(0, length);
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
