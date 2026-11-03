import { it, expect, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { resolveSdkModules } from "../scripts/roadmap/resolve-sdk-module.mts";
const dirs: string[] = [];
afterEach(() => {
  for (const p of dirs.splice(0)) fs.rmSync(p, { recursive: true, force: true });
});
const layouts = {
  "legacy-flat": {
    marker: "xbrl/parse-xbrl",
    withOperationalLocks: "utils/with-operational-locks",
    collectRegistryDifferences: "companies/registry/collect-differences",
    createRegistrySession: "companies/registry/download-session",
    financialSearchIndex: "db/financial-search-index",
    duckFinancialIndexBuild: "db/duck-financial-index-build",
    duckFinancialSnapshot: "db/duck-financial-snapshot",
    buildDuckFinancialCycle: "pipeline/build-duck-financial-cycle",
    sourceVerifierCommand: "pipeline/verification/source-verifier-command",
  },
  layered: {
    marker: "core/parser/parse-xbrl",
    withOperationalLocks: "platform/locks/with-operational-locks",
    collectRegistryDifferences: "platform/registry/collect-differences",
    createRegistrySession: "platform/registry/download-session",
    financialSearchIndex: "platform/db/stores/financial/financial-search-index",
    duckFinancialIndexBuild: "platform/pipeline/financial/jobs/duck-financial-index-build",
    duckFinancialSnapshot: "platform/db/engines/duckdb/duck-financial-snapshot",
    buildDuckFinancialCycle: "platform/pipeline/build-duck-financial-cycle",
    sourceVerifierCommand: "platform/pipeline/verification/source-verifier-command",
  },
} as const;
function fixture(layout: keyof typeof layouts, extension: ".js" | ".ts" = ".js") {
  const root = fs.mkdtempSync(path.join(tmpdir(), "sdk-routes-"));
  dirs.push(root);
  const put = (name: string) => {
    const p = path.join(root, name + extension);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "throw Error('Do not execute SDK modules during path resolution');\n");
    return p;
  };
  const entry = put("index");
  for (const p of Object.values(layouts[layout])) put(p);
  return { root, entry, put, extension };
}
it.each(["legacy-flat", "layered"] as const)(
  "%sの8既知routeをjs/tsの各entryから解決し実行しない",
  (layout) => {
    for (const extension of [".js", ".ts"] as const) {
      const f = fixture(layout, extension),
        names = Object.keys(layouts[layout]).filter((k) => k !== "marker"),
        result = resolveSdkModules(f.entry, names as any);
      expect(result.layout).toBe(layout);
      expect(result.marker).toBe(path.join(f.root, layouts[layout].marker + extension));
      for (const name of names)
        expect(result.modules[name as keyof typeof result.modules]).toBe(
          path.join(
            f.root,
            layouts[layout][name as keyof (typeof layouts)[typeof layout]] + extension,
          ),
        );
    }
  },
);
it.each(["legacy-flat", "layered"] as const)(
  "%sの財務routeだけならNTA moduleを要求しない",
  (layout) => {
    const f = fixture(layout);
    for (const name of [
      "withOperationalLocks",
      "collectRegistryDifferences",
      "createRegistrySession",
    ] as const)
      fs.rmSync(path.join(f.root, layouts[layout][name] + f.extension));
    expect(Object.keys(resolveSdkModules(f.entry, ["financialSearchIndex"]).modules)).toEqual([
      "financialSearchIndex",
    ]);
  },
);
it.each([
  "missing-marker",
  "both-markers",
  "mixed-route",
  "duplicate-route",
  "missing-route",
  "file-symlink",
  "parent-symlink",
  "entry-symlink",
])("%sをfallbackせず拒否する", (mode) => {
  const f = fixture("legacy-flat"),
    route = path.join(f.root, layouts["legacy-flat"].withOperationalLocks + f.extension);
  if (mode === "missing-marker")
    fs.rmSync(path.join(f.root, layouts["legacy-flat"].marker + f.extension));
  if (mode === "both-markers") f.put(layouts.layered.marker);
  if (mode === "mixed-route" || mode === "duplicate-route") {
    if (mode === "mixed-route") fs.rmSync(route);
    f.put(layouts.layered.withOperationalLocks);
  }
  if (mode === "missing-route") fs.rmSync(route);
  if (mode === "file-symlink") {
    fs.rmSync(route);
    fs.symlinkSync(f.entry, route);
  }
  if (mode === "parent-symlink") {
    fs.rmSync(path.dirname(route), { recursive: true });
    const outside = fs.mkdtempSync(path.join(tmpdir(), "sdk-outside-"));
    dirs.push(outside);
    fs.writeFileSync(path.join(outside, "with-operational-locks.js"), "");
    fs.symlinkSync(outside, path.dirname(route));
  }
  if (mode === "entry-symlink") {
    const original = f.put("actual-index");
    fs.rmSync(f.entry);
    fs.symlinkSync(original, f.entry);
  }
  expect(() => resolveSdkModules(f.entry, ["withOperationalLocks"])).toThrow();
});
it.each([
  { routes: [] },
  { routes: ["../escape"] },
  { routes: ["marker"] },
  { routes: ["financialSearchIndex", "financialSearchIndex"] },
])("unknown/empty/duplicate route入力を拒否する: $routes", ({ routes }) => {
  const f = fixture("layered");
  expect(() => resolveSdkModules(f.entry, routes as any)).toThrow();
});
it("未知entry拡張子を拒否する", () => {
  const f = fixture("legacy-flat");
  fs.writeFileSync(path.join(f.root, "index.mjs"), "");
  expect(() =>
    resolveSdkModules(path.join(f.root, "index.mjs"), ["withOperationalLocks"]),
  ).toThrow();
});
