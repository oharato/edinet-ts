/** Independent bundled TypeScript verification for a complete candidate, without publication approval. */
import { strict as assert } from "node:assert";
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, statfsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const canonical = (value) =>
    JSON.stringify(value, (_k, v) =>
      v && typeof v === "object" && !Array.isArray(v)
        ? Object.fromEntries(
            Object.keys(v)
              .sort()
              .map((k) => [k, v[k]]),
          )
        : v,
    ),
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  read = (file) => JSON.parse(readFileSync(file, "utf8"));
async function main() {
  const sdk = resolve(process.argv[2]),
    cycle = resolve(process.argv[3]),
    out = resolve(process.argv[4]),
    marker = read(join(cycle, "input.json")),
    saved = read(join(cycle, "build.json"));
  assert.equal(marker.inputSha256, sha(canonical(marker.input)));
  assert.equal(saved.inputSha256, marker.inputSha256);
  assert.equal(saved.sha256, sha(canonical([saved.inputSha256, saved.body])));
  assert.equal(saved.body?.status, "built");
  assert.equal(saved.body.indexPath, join(cycle, "index.duckdb"));
  assert(!existsSync(out));
  const { duckFinancialSdkSha256 } = await import(
    pathToFileURL(join(sdk, "dist/duck-financial-cycle.js")).href
  );
  assert.equal(duckFinancialSdkSha256(), marker.input.sdkSha256);
  const space = statfsSync(cycle, { bigint: true });
  assert(
    space.bavail * space.bsize >=
      34n * 1024n ** 3n +
        BigInt(statSync(marker.input.archivePath).size) +
        4n * BigInt(statSync(saved.body.indexPath).size),
    "Raw verification disk reserve",
  );
  mkdirSync(out, { mode: 0o700 });
  const { financialSourceVerifierSha256, runFinancialSourceVerifier } = await import(
    pathToFileURL(join(sdk, "dist/pipeline/verification/source-verifier-command.js")).href
  );
  const verifierSha256 = financialSourceVerifierSha256(),
    { DuckFinancialSearchIndex } = await import(pathToFileURL(join(sdk, "dist/index.js")).href),
    reader = await DuckFinancialSearchIndex.open(saved.body.indexPath),
    start = performance.now();
  try {
    const quality = await reader.quality(saved.body.generation),
      checks = await reader.withVerificationSnapshot((path) =>
        runFinancialSourceVerifier(
          "duckdb",
          path,
          marker.input.archivePath,
          saved.body.generation,
          marker.input.build.archiveSha256,
        ),
      );
    assert.equal(checks.version, 1);
    assert.equal(checks.generation, saved.body.generation);
    assert.equal(checks.selectedValues, quality.values.available);
    assert(checks.selectedValues > 0);
    assert.match(checks.valuesSha256, /^[a-f0-9]{64}$/);
    assert.equal(financialSourceVerifierSha256(), verifierSha256);
    assert.equal(duckFinancialSdkSha256(), marker.input.sdkSha256);
    writeFileSync(
      join(out, "summary.json"),
      JSON.stringify(
        {
          node: process.version,
          inputSha256: marker.inputSha256,
          sdkSha256: marker.input.sdkSha256,
          duckdbSha256: await reader.snapshotSha256(),
          verifierSha256,
          checks,
          elapsedMs: performance.now() - start,
          nodeMaxRssKiB: process.resourceUsage().maxRSS,
          scope:
            "all indexed available values; independent TypeScript XML facts; no catalog mutation or publication approval",
        },
        null,
        2,
      ) + "\n",
    );
    console.log(JSON.stringify(checks));
  } finally {
    await reader.close();
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
