import { expect, it } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activate, locked, publish } from "../scripts/local-artifact-store";
const fixture = (
  run: (root: string, generation: (name: string, value: string) => string) => void,
) => {
  const root = mkdtempSync(join(tmpdir(), "artifact-store-"));
  try {
    run(root, (name, value) => {
      const stage = join(root, ".staging-" + name);
      mkdirSync(stage);
      writeFileSync(join(stage, "result"), value);
      return publish(root, stage, { sourceCommit: "fixture" });
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
};
it("旧世代を残し、hashを確かめて切り戻せる", () =>
  fixture((root, generation) =>
    locked(root, () => {
      const one = generation("one", "old");
      generation("two", "new");
      expect(readFileSync(join(root, "current/result"), "utf8")).toBe("new");
      expect(readFileSync(join(one, "result"), "utf8")).toBe("old");
      activate(root, "one");
      expect(readFileSync(join(root, "current/result"), "utf8")).toBe("old");
    }),
  ));
it("改変した旧世代や失敗途中の世代にcurrentを切り替えない", () =>
  fixture((root, generation) => {
    const one = generation("one", "old");
    generation("two", "new");
    writeFileSync(join(one, "result"), "corrupt");
    expect(() => activate(root, "one")).toThrow("hash verification failed");
    mkdirSync(join(root, ".staging-failure"));
    expect(readFileSync(join(root, "current/result"), "utf8")).toBe("new");
  }));
it("並行する公開・パストラバーサル・symlinkを拒否する", () =>
  fixture((root) => {
    locked(root, () => expect(() => locked(root, () => {})).toThrow("holds the lock"));
    expect(() => activate(root, "../outside")).toThrow("basename");
    const stage = join(root, ".staging-bad");
    mkdirSync(stage);
    symlinkSync("/etc/passwd", join(stage, "link"));
    expect(() => publish(root, stage, {})).toThrow("Symlinks");
  }));
