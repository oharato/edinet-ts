/** 保存済み測定値から計画の数値条件を判定する。公開の承認は行わない。 */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

interface Sample {
  name: string;
  repeat: number;
  elapsedMs: number;
}
interface Measurement {
  mode: string;
  initialReadMs: number;
  maxRssBytes: number;
  samples: Sample[];
}
export interface PerformanceSummary {
  allResultsEqual: boolean;
  cases: number;
  warmups: number;
  repeats: number;
  fileBytes: { sqlite: number; duckdb: number };
  results: Measurement[];
}
const positive = (value: number) => {
  assert(typeof value === "number" && Number.isFinite(value) && value > 0, "Invalid measurement");
  return value;
};
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b),
    n = sorted.length;
  assert(n > 0);
  return (sorted[Math.floor((n - 1) / 2)] + sorted[Math.floor(n / 2)]) / 2;
};
export function evaluate(summary: PerformanceSummary) {
  assert(
    summary.allResultsEqual === true &&
      summary.cases === 12 &&
      summary.warmups === 1 &&
      summary.repeats === 5,
    "Invalid benchmark scope or unequal results",
  );
  const results = new Map(summary.results.map((result) => [result.mode, result]));
  assert(
    results.size === 3 &&
      summary.results.length === 3 &&
      ["sqlite", "uncached", "cached"].every((mode) => results.has(mode)),
    "Invalid benchmark modes",
  );
  const timings = new Map<string, Map<string, number>>();
  for (const [mode, result] of results) {
    const cases = new Map<string, Map<number, number>>();
    for (const sample of result.samples) {
      assert(
        typeof sample.name === "string" &&
          Number.isInteger(sample.repeat) &&
          sample.repeat >= 0 &&
          sample.repeat < 5,
        "Invalid sample identity",
      );
      const repeats = cases.get(sample.name) ?? new Map<number, number>();
      assert(!repeats.has(sample.repeat), "Duplicate measurement");
      repeats.set(sample.repeat, positive(sample.elapsedMs));
      cases.set(sample.name, repeats);
    }
    assert(
      cases.size === 12 && [...cases.values()].every((repeats) => repeats.size === 5),
      "Missing measurements",
    );
    timings.set(
      mode,
      new Map([...cases].map(([name, repeats]) => [name, median([...repeats.values()])])),
    );
  }
  const baseline = timings.get("sqlite")!;
  assert(
    [...timings.values()].every((cases) => [...cases.keys()].every((name) => baseline.has(name))),
    "Case names differ",
  );
  const caseLatencyRatios = Object.fromEntries(
    [...baseline].map(([name, value]) => [name, timings.get("cached")!.get(name)! / value]),
  );
  const measured = {
    fileSizeRatio: positive(summary.fileBytes.duckdb) / positive(summary.fileBytes.sqlite),
    medianCaseLatencyRatio: median(Object.values(caseLatencyRatios)),
    worstCaseLatencyRatio: Math.max(...Object.values(caseLatencyRatios)),
    initialReadRatio:
      positive(results.get("cached")!.initialReadMs) /
      positive(results.get("sqlite")!.initialReadMs),
    maxRssRatio:
      positive(results.get("cached")!.maxRssBytes) / positive(results.get("sqlite")!.maxRssBytes),
  };
  const limits = {
    fileSizeRatio: 0.5,
    medianCaseLatencyRatio: 1.1,
    worstCaseLatencyRatio: 1.25,
    initialReadRatio: 1.25,
    maxRssRatio: 1.25,
  };
  const checks = Object.fromEntries(
    (Object.keys(measured) as (keyof typeof measured)[]).map((name) => [
      name,
      measured[name] <= limits[name],
    ]),
  );
  return {
    version: 1,
    measured,
    limits,
    checks,
    caseLatencyRatios,
    numericCriteriaPassed: Object.values(checks).every(Boolean),
    publicationApproved: false,
    scope:
      "Numeric reader benchmark only; full-company correctness, local storage, competing load, daily operation and capacity guards require separate evidence.",
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const result = evaluate(JSON.parse(readFileSync(process.argv[2], "utf8")));
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.numericCriteriaPassed ? 0 : 1;
}
