/** Resolve only known module routes inside a caller-verified SDK. Never imports or authenticates it. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { normalFile } from "./operational-files.mjs";

const profiles = {
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
const present = (file: string) => {
  try {
    fs.lstatSync(file);
    return true;
  } catch (e: any) {
    if (e.code === "ENOENT") return false;
    throw e;
  }
};
type Layout = keyof typeof profiles;
type SdkModuleRoute = Exclude<keyof (typeof profiles)[Layout], "marker">;
export interface ResolvedSdkLayout {
  layout: Layout;
  extension: ".js" | ".ts";
  marker: string;
  modules: Partial<Record<SdkModuleRoute, string>>;
}
export function resolveSdkModules<const Routes extends readonly SdkModuleRoute[]>(
  verifiedSdkPath: string,
  requested: Routes,
): ResolvedSdkLayout & { modules: Record<Routes[number], string> } {
  const extension = path.extname(verifiedSdkPath);
  assert(
    (extension === ".js" || extension === ".ts") &&
      path.basename(verifiedSdkPath) === "index" + extension,
    "Unknown SDK entry",
  );
  assert(
    Array.isArray(requested) &&
      requested.length > 0 &&
      requested.length <= 8 &&
      new Set(requested).size === requested.length &&
      requested.every(
        (name: unknown) =>
          typeof name === "string" && name !== "marker" && Object.hasOwn(profiles.layered, name),
      ),
    "Unknown/duplicate SDK route",
  );
  assert(
    path.isAbsolute(verifiedSdkPath) &&
      path.resolve(verifiedSdkPath) === verifiedSdkPath &&
      normalFile(verifiedSdkPath) === verifiedSdkPath,
    "Canonical SDK entry required",
  );
  const base = path.dirname(verifiedSdkPath),
    layouts = Object.keys(profiles) as (keyof typeof profiles)[];
  const matching = layouts.filter((layout) =>
    present(path.join(base, profiles[layout].marker + extension)),
  );
  assert(matching.length === 1, "SDK must have one known layout marker");
  const layout = matching[0],
    profile = profiles[layout];
  const moduleFile = (name: keyof typeof profile) => {
    const file = path.join(base, profile[name] + extension);
    assert(
      layouts.every(
        (other) => other === layout || !present(path.join(base, profiles[other][name] + extension)),
      ),
      "Mixed SDK layouts",
    );
    assert(
      normalFile(file) === file && fs.realpathSync(file).startsWith(base + path.sep),
      "SDK module symlink/escape",
    );
    return file;
  };
  const marker = moduleFile("marker");
  return {
    layout,
    extension,
    marker,
    modules: Object.fromEntries(requested.map((name) => [name, moduleFile(name)])) as Record<
      Routes[number],
      string
    >,
  };
}
