import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join } from "node:path";
import { spawnSync } from "node:child_process";
import { it, expect } from "vitest";
function fixture(
  work: (dir: string, run: (args: string[]) => ReturnType<typeof spawnSync>) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "cli-help-input-"));
  try {
    work(dir, (args) =>
      spawnSync(
        process.execPath,
        ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), ...args],
        { cwd: dir, encoding: "utf8" },
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
it("lists acquisition, parsing, search before operations and preserves detailed help", () =>
  fixture((_dir, run) => {
    const r = run(["--help"]),
      out = String(r.stdout);
    expect(r.status).toBe(0);
    expect(out.indexOf("  download ")).toBeLessThan(out.indexOf("  parse "));
    expect(out.indexOf("  parse ")).toBeLessThan(out.indexOf("  screen "));
    expect(out.indexOf("  screen ")).toBeLessThan(out.indexOf("  import-bs "));
    for (const text of ["parse --file", "get --ticker", "screen --file", "<command> --help"])
      expect(out).toContain(text);
    for (const command of ["screen-bs", "screen-duck-financial-index"])
      expect(String(run([command, "--help"]).stdout)).toContain("CLI_INPUT_EXAMPLES.md");
  }));
it.each(["screen-bs", "screen-duck-financial-index"])(
  "%s distinguishes missing files and invalid JSON without disclosing values",
  (command) =>
    fixture((dir, run) => {
      const prefix =
        command === "screen-bs"
          ? ["screen-bs", "--manifest"]
          : [
              "screen-duck-financial-index",
              "--db",
              "missing.duckdb",
              "--metrics",
              "currentAssets",
              "--cohort",
            ];
      const label = command === "screen-bs" ? "manifest" : "cohort";
      const missing = run([...prefix, join(dir, "absent.json")]);
      expect(missing.status).toBe(1);
      expect(String(missing.stderr)).toContain(label + "：ファイルが見つかりません");
      const json = join(dir, "invalid.json");
      writeFileSync(json, '{"SECRET_TOKEN_123":');
      const invalid = run([...prefix, json]);
      expect(invalid.status).toBe(1);
      expect(String(invalid.stderr)).toContain("JSON構文");
      expect(String(invalid.stderr)).not.toContain("SECRET_TOKEN_123");
      expect(invalid.stdout).toBe("");
    }),
);
it("identifies manifest item/field and hides untrusted values before source I/O", () =>
  fixture((dir, run) => {
    const json = join(dir, "manifest.json");
    const entry = { file: "absent.xbrl", instant: "2026-03-31" };
    writeFileSync(json, JSON.stringify([entry, entry, { ...entry, instant: "SECRET_VALUE_123" }]));
    const r = run(["screen-bs", "--manifest", json]);
    expect(r.status).toBe(1);
    expect(String(r.stderr)).toContain("manifestの3件目：instant");
    expect(String(r.stderr)).not.toContain("SECRET_VALUE_123");
    expect(r.stdout).toBe("");
  }));

it("only passes exact known diagnostics, not messages with appended private input", async () => {
  const { cliInputMessage } = await import("../src/cli/input-diagnostics");
  expect(cliInputMessage(new Error("入力ファイルがbyte上限を超えています"), "safe")).toContain(
    "byte上限",
  );
  expect(
    cliInputMessage(new Error("入力ファイルがbyte上限を超えています SECRET_TOKEN"), "safe"),
  ).toBe("safe");
});
