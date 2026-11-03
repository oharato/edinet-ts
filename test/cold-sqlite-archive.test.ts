import { expect, it, vi } from "vitest";
vi.mock("node:fs", async (original) => {
  const fs = await original<typeof import("node:fs")>();
  return { ...fs, readdirSync: vi.fn(fs.readdirSync) };
});
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import { Database } from "../src/db/node-sqlite";
import {
  packColdSqlite,
  restoreColdSqlite,
  retireColdSqlite,
  auditColdSqliteUsage,
} from "../src/pipeline/storage/cold-sqlite-archive";
import * as retained from "../src/utils/retained-files";
import { sha256 } from "./fixtures/signed-corporate-registry";
async function fixture(
  run: (f: {
    root: string;
    source: string;
    out: string;
    raw: Buffer;
    hash: string;
  }) => Promise<void>,
) {
  const root = fs.mkdtempSync(join(tmpdir(), "cold-sqlite-")),
    source = join(root, "source.sqlite"),
    out = join(root, "cold");
  const db = new Database(source);
  db.exec("CREATE TABLE example(value TEXT)");
  const insert = db.prepare("INSERT INTO example VALUES (?)");
  for (let i = 0; i < 30; i++) insert.run("保存する原文" + i);
  insert.close();
  db.close();
  const raw = fs.readFileSync(source),
    space = vi.spyOn(retained, "reserveSpace").mockImplementation(() => {});
  try {
    await run({ root, source, out, raw, hash: sha256(raw) });
  } finally {
    space.mockRestore();
    fs.rmSync(root, { recursive: true, force: true });
  }
}
it("退避も復元もSQLiteの全byteと内容を保ち、既存出力を上書きしない", () =>
  fixture(async (f) => {
    await packColdSqlite(f.source, f.out, f.hash);
    expect(fs.readFileSync(f.source)).toEqual(f.raw);
    expect(gunzipSync(fs.readFileSync(join(f.out, "payload.gz")))).toEqual(f.raw);
    await expect(packColdSqlite(f.source, f.out, f.hash)).rejects.toThrow();
    await expect(restoreColdSqlite(f.out, f.source)).rejects.toThrow("never overwrites");
    const target = join(f.root, "restored.sqlite");
    expect(await restoreColdSqlite(f.out, target)).toMatchObject({ sha256: f.hash });
    expect(fs.readFileSync(target)).toEqual(f.raw);
    const db = new Database(target, { readOnly: true });
    try {
      expect(db.prepare("SELECT count(*) AS n FROM example").get()).toEqual({ n: 30 });
    } finally {
      db.close();
    }
  }));
it.each(["wrong-hash", "sidecar", "symlink", "capacity"])(
  "退避失敗は原本を保ち、生成途中の出力だけ除去する: %s",
  (mutation) =>
    fixture(async (f) => {
      let source = f.source,
        hash = f.hash;
      if (mutation === "wrong-hash") hash = "0".repeat(64);
      if (mutation === "sidecar") fs.writeFileSync(source + "-wal", "");
      if (mutation === "symlink") {
        source = join(f.root, "alias.sqlite");
        fs.symlinkSync(f.source, source);
      }
      if (mutation === "capacity")
        vi.mocked(retained.reserveSpace).mockImplementation(() => {
          throw Error("capacity");
        });
      await expect(packColdSqlite(source, f.out, hash)).rejects.toThrow();
      expect(fs.readFileSync(f.source)).toEqual(f.raw);
      expect(fs.existsSync(f.out)).toBe(false);
    }),
);
it.each(["corrupt-archive", "changed-source", "open-reader"])(
  "不確かな原本を退役させない: %s",
  (mutation) =>
    fixture(async (f) => {
      await packColdSqlite(f.source, f.out, f.hash);
      let reader: number | undefined;
      try {
        if (mutation === "corrupt-archive") fs.appendFileSync(join(f.out, "payload.gz"), "corrupt");
        if (mutation === "changed-source") fs.appendFileSync(f.source, "changed");
        if (mutation === "open-reader") reader = fs.openSync(f.source, "r");
        await expect(retireColdSqlite(f.out)).rejects.toThrow();
        expect(fs.existsSync(f.source)).toBe(true);
      } finally {
        if (reader !== undefined) fs.closeSync(reader);
      }
    }),
);
it.runIf(process.platform === "linux")(
  "追加FDを利用検査で検出し、閉じた後だけ退役・復元できる",
  () =>
    fixture(async (f) => {
      await packColdSqlite(f.source, f.out, f.hash);
      const fd = fs.openSync(f.source, "r");
      try {
        expect(auditColdSqliteUsage(f.out)).toMatchObject({
          status: "blocked",
          sourceRetained: true,
          openDescriptors: [{ pid: String(process.pid), fd: String(fd) }],
        });
      } finally {
        fs.closeSync(fd);
      }
      // Restrict this acceptance fixture to our process; other owned processes may be opaque on the host.
      const original = fs.readdirSync;
      const scan = vi.mocked(fs.readdirSync);
      const actual = scan.getMockImplementation()!;
      scan.mockImplementation(((path: string, options: unknown) =>
        path === "/proc"
          ? [String(process.pid)]
          : actual(path as any, options as any)) as typeof original);
      try {
        expect(auditColdSqliteUsage(f.out).status).toBe("no-open-readers-observed");
        expect(await retireColdSqlite(f.out)).toMatchObject({ status: "retired" });
        expect(fs.existsSync(f.source)).toBe(false);
        await restoreColdSqlite(f.out);
        expect(fs.readFileSync(f.source)).toEqual(f.raw);
      } finally {
        scan.mockImplementation(actual);
      }
    }),
);
it.each(["hardlink", "symlink", "changed-hash", "capacity"])(
  "危険な復元入力を拒否し、出力を作らない: %s",
  (mutation) =>
    fixture(async (f) => {
      await packColdSqlite(f.source, f.out, f.hash);
      const archive = join(f.out, "payload.gz"),
        target = join(f.root, "restored.sqlite");
      if (mutation === "hardlink") fs.linkSync(archive, join(f.root, "alias.gz"));
      if (mutation === "symlink") {
        fs.renameSync(archive, archive + ".real");
        fs.symlinkSync(archive + ".real", archive);
      }
      if (mutation === "changed-hash") fs.appendFileSync(archive, "corrupt");
      if (mutation === "capacity")
        vi.mocked(retained.reserveSpace).mockImplementation(() => {
          throw Error("capacity");
        });
      await expect(restoreColdSqlite(f.out, target)).rejects.toThrow();
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readFileSync(f.source)).toEqual(f.raw);
    }),
);
it.runIf(process.platform === "linux")("参照できない自分のprocessがある場合は退役を拒否する", () =>
  fixture(async (f) => {
    await packColdSqlite(f.source, f.out, f.hash);
    const scan = vi.mocked(fs.readdirSync),
      actual = scan.getMockImplementation()!;
    scan.mockImplementation(((path: string, options: unknown) => {
      if (path === "/proc") return [String(process.pid)];
      if (path === `/proc/${process.pid}/fd`)
        throw Object.assign(Error("opaque"), { code: "EACCES" });
      return actual(path as any, options as any);
    }) as typeof fs.readdirSync);
    try {
      expect(auditColdSqliteUsage(f.out)).toMatchObject({
        status: "blocked",
        sourceRetained: true,
        opaqueOwnedProcesses: [String(process.pid)],
      });
      await expect(retireColdSqlite(f.out)).rejects.toThrow("cannot be ruled out");
      expect(fs.readFileSync(f.source)).toEqual(f.raw);
    } finally {
      scan.mockImplementation(actual);
    }
  }),
);
it.runIf(process.platform === "linux")("最初の照合後に現れたreaderも削除直前に検出する", () =>
  fixture(async (f) => {
    await packColdSqlite(f.source, f.out, f.hash);
    const extra = fs.openSync(f.source, "r");
    const scan = vi.mocked(fs.readdirSync),
      actual = scan.getMockImplementation()!;
    let audit = 0;
    scan.mockImplementation(((path: string, options: unknown) => {
      if (path === "/proc") {
        audit++;
        return [String(process.pid)];
      }
      const result = actual(path as any, options as any);
      if (path === `/proc/${process.pid}/fd` && audit === 1)
        return (result as string[]).filter((fd) => fd !== String(extra));
      return result;
    }) as typeof fs.readdirSync);
    try {
      await expect(retireColdSqlite(f.out)).rejects.toThrow("cannot be ruled out");
      expect(audit).toBe(2);
      expect(fs.readFileSync(f.source)).toEqual(f.raw);
    } finally {
      scan.mockImplementation(actual);
      fs.closeSync(extra);
    }
  }),
);
it("圧縮原本の読込後の差し替えも復元確定前に拒否する", () =>
  fixture(async (f) => {
    await packColdSqlite(f.source, f.out, f.hash);
    const target = join(f.root, "restored.sqlite");
    const original = retained.RetainedFile.prototype.unchanged;
    let checks = 0;
    const spy = vi.spyOn(retained.RetainedFile.prototype, "unchanged").mockImplementation(function (
      this: retained.RetainedFile,
    ) {
      if (this.path === join(f.out, "payload.gz") && ++checks === 2) {
        fs.renameSync(this.path, this.path + ".old");
        fs.copyFileSync(this.path + ".old", this.path);
      }
      original.call(this);
    });
    try {
      await expect(restoreColdSqlite(f.out, target)).rejects.toThrow("changed");
      expect(fs.existsSync(target)).toBe(false);
      expect(fs.readdirSync(f.root).some((name) => name.startsWith(".sqlite-restore-"))).toBe(
        false,
      );
    } finally {
      spy.mockRestore();
    }
  }));
