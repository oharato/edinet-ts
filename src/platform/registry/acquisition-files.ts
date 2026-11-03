/** 取得の再開に使う計画・試行・保存ファイルを、私有directoryと排他で保護する。 */
import { existsSync, lstatSync, mkdirSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { strict as assert } from "node:assert";
import { RetainedFile, readRetainedJSON } from "../files/retained-files";
import { withOperationalLocks } from "../locks/with-operational-locks";
import { atomicJSON, canonical } from "../files/verification-files";
import { registryDate } from "./parse-download-listing";
export { readRetainedJSON as load };
export const same = (a: unknown, b: unknown, message: string) =>
  assert(canonical(a) === canonical(b), message);
export const atomic = (path: string, value: unknown) =>
  atomicJSON(path, value, { createOnly: !existsSync(path) });
export function retainedText(path: string) {
  const file = new RetainedFile(path, 2 * 1024 ** 2);
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(file.read(0, file.bytes));
    file.unchanged();
    return text;
  } finally {
    file.close();
  }
}
export function presentDate(date: string) {
  registryDate(date);
  assert(
    date <= new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10),
    "Future registry date",
  );
}
export const budget = (value: number) =>
  assert(Number.isInteger(value) && value >= 0 && value <= 100, "Invalid download budget");
export function nextAttempt(parent: string) {
  mkdirSync(parent, { recursive: true, mode: 0o700 });
  assert(!lstatSync(parent).isSymbolicLink(), "Attempt parent is a symlink");
  const numbers = readdirSync(parent)
    .filter((name) => /^attempt-\d{4}$/.test(name))
    .map((name) => Number(name.slice(-4)));
  const number = 1 + Math.max(0, ...numbers);
  assert(number <= 9999, "Attempt limit exceeded");
  const path = join(parent, "attempt-" + String(number).padStart(4, "0"));
  mkdirSync(path, { mode: 0o700 });
  return path;
}
export function checkRetained(
  path: string,
  expected: { bytes: number; sha256: string },
  maximum: number,
) {
  const file = new RetainedFile(path, maximum);
  try {
    assert(
      file.bytes === expected.bytes && file.digest() === expected.sha256,
      "Retained acquisition changed",
    );
  } finally {
    file.close();
  }
}
export async function withRegistryOutput<T>(
  output: string,
  key: string,
  fingerprint: string,
  work: (
    root: string,
    query: { fingerprint: string; publicKeySha256: string },
    key: string,
  ) => Promise<T>,
) {
  assert(
    typeof fingerprint === "string" && /^(?:[a-fA-F0-9]{40}|[a-fA-F0-9]{64})$/.test(fingerprint),
    "Full trusted fingerprint required",
  );
  const root = resolve(output),
    file = new RetainedFile(key, 1024 ** 2);
  try {
    const query = { fingerprint: fingerprint.toUpperCase(), publicKeySha256: file.digest() };
    mkdirSync(root, { recursive: true, mode: 0o700 });
    const stat = lstatSync(root);
    assert(
      stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o077),
      "Output must be a private directory",
    );
    return await withOperationalLocks([join(root, ".lock")], async () => {
      const result = await work(root, query, file.path);
      assert(file.digest() === query.publicKeySha256, "Public key changed during acquisition");
      return result;
    });
  } finally {
    file.close();
  }
}
