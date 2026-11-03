import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { evaluate, type PerformanceSummary } from "../scripts/evaluate-duck-financial-performance";
const summary = (): PerformanceSummary => ({
  allResultsEqual: true,
  cases: 12,
  warmups: 1,
  repeats: 5,
  fileBytes: { sqlite: 1000, duckdb: 500 },
  results: ["sqlite", "uncached", "cached"].map((mode) => ({
    mode,
    initialReadMs: 100,
    maxRssBytes: 1000,
    samples: Array.from({ length: 12 }, (_, c) =>
      Array.from({ length: 5 }, (_, repeat) => ({ name: String(c), repeat, elapsedMs: 100 })),
    ).flat(),
  })),
});
it("一つの遅いケースを中央値で隠さず、公開を承認しない", () => {
  const input = summary();
  expect(evaluate(input).numericCriteriaPassed).toBe(true);
  for (const sample of input.results[2].samples.slice(0, 5)) sample.elapsedMs = 126;
  expect(evaluate(input)).toMatchObject({
    numericCriteriaPassed: false,
    publicationApproved: false,
    checks: { medianCaseLatencyRatio: true, worstCaseLatencyRatio: false },
  });
});
it.each(["duplicate", "missing", "nan", "mismatched", "unequal"])(
  "不正な測定を拒否する: %s",
  (mutation) => {
    const input = summary(),
      samples = input.results[2].samples;
    if (mutation === "duplicate") samples[samples.length - 1] = samples[samples.length - 2];
    else if (mutation === "missing") samples.pop();
    else if (mutation === "nan") samples[0].elapsedMs = NaN;
    else if (mutation === "mismatched")
      for (const sample of samples.slice(0, 5)) sample.name = "other";
    else input.allResultsEqual = false;
    expect(() => evaluate(input)).toThrow();
  },
);
it("CLIは数値条件が未達なら判定JSONを出してexit 1になる", () => {
  const dir = mkdtempSync(join(tmpdir(), "duck-performance-"));
  try {
    const path = join(dir, "summary.json");
    for (const [size, status] of [
      [500, 0],
      [501, 1],
    ]) {
      const input = summary();
      input.fileBytes.duckdb = size;
      writeFileSync(path, JSON.stringify(input));
      const result = spawnSync(
        process.execPath,
        [resolve("scripts/evaluate-duck-financial-performance.mts"), path],
        { encoding: "utf8" },
      );
      expect(result.status, result.stderr).toBe(status);
      expect(JSON.parse(result.stdout).numericCriteriaPassed).toBe(status === 0);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
