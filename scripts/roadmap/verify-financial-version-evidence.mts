/** 固定manifest pinに対し、保存した版の証拠と任意の構築済み索引を独立に検査する。 */
import { parseArgs } from "node:util";
import { strict as assert, AssertionError } from "node:assert";
import { loadVersionJSON } from "../../dist/platform/pipeline/verification/read-version-input.js";
import { canonical } from "../../dist/platform/pipeline/verification/version-evidence-format.js";
import { verifyVersionBundle } from "../../dist/platform/pipeline/verification/verify-version-bundle.js";
import { verifyVersionIndex } from "../../dist/platform/pipeline/verification/verify-version-index.js";
try {
  const { values } = parseArgs({
    options: {
      bundle: { type: "string" },
      proof: { type: "string" },
      "expected-manifest-sha256": { type: "string" },
      index: { type: "string" },
      generation: { type: "string" },
      "expected-plan-sha256": { type: "string" },
      "expected-archive-sha256": { type: "string" },
      "build-state": { type: "string" },
    },
  });
  assert(
    values.bundle && values.proof && values["expected-manifest-sha256"],
    "--bundle --proof --expected-manifest-sha256 are required",
  );
  const optional = [
    values.index,
    values.generation,
    values["expected-plan-sha256"],
    values["expected-archive-sha256"],
    values["build-state"],
  ];
  assert(
    optional.every((value) => value !== undefined) ||
      optional.every((value) => value === undefined),
    "Index/generation/plan/archive/build-state options are all-or-none",
  );
  const bundle = loadVersionJSON(values.bundle),
    proof = loadVersionJSON(values.proof),
    result: any = await verifyVersionBundle(bundle, proof, values["expected-manifest-sha256"]);
  if (values.index !== undefined)
    result.indexBinding = verifyVersionIndex(
      values.index,
      values.generation!,
      values["expected-plan-sha256"]!,
      values["expected-archive-sha256"]!,
      values["build-state"]!,
      bundle,
      proof,
    );
  console.log(canonical(result));
} catch (error) {
  console.error(
    "Independent financial version evidence verification failed: " +
      (error instanceof AssertionError ? error.message : "Invalid evidence files or syntax"),
  );
  process.exitCode = 1;
}
