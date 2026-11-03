import { it, expect } from "vitest";
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  linkSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFinancialZipFile } from "../src/platform/files/read-financial-zip-file";

it("ZIP証拠は原byteを変えず読み、既存のhardlink入力も保持する", () => {
  const dir = mkdtempSync(join(tmpdir(), "financial-zip-file-"));
  try {
    const file = join(dir, "evidence.zip"),
      linked = join(dir, "linked.zip"),
      bytes = Buffer.from([0, 255, 3, 4]);
    writeFileSync(file, bytes);
    linkSync(file, linked);
    expect(Buffer.from(readFinancialZipFile(file, bytes.length))).toEqual(bytes);
    expect(Buffer.from(readFinancialZipFile(linked, bytes.length))).toEqual(bytes);
    expect(readFileSync(file)).toEqual(bytes);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
it("ZIP証拠の不足/上限超過/symlink/非regular入力は失敗のまま返す", () => {
  const dir = mkdtempSync(join(tmpdir(), "financial-zip-guard-"));
  try {
    const file = join(dir, "evidence.zip"),
      link = join(dir, "symbolic.zip"),
      directory = join(dir, "directory");
    writeFileSync(file, "12345");
    symlinkSync(file, link);
    mkdirSync(directory);
    expect(() => readFinancialZipFile(file, 4)).toThrow("zip-invalid");
    expect(() => readFinancialZipFile(link, 5)).toThrow();
    expect(() => readFinancialZipFile(directory, 5)).toThrow("zip-invalid");
    expect(() => readFinancialZipFile(join(dir, "absent"), 5)).toThrow();
    expect(readFileSync(file, "utf8")).toBe("12345");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
