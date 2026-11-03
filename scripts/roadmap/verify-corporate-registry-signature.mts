/** 署名検証後だけ、新規directoryにreceipt/import入力を作る。 */
import { parseArgs } from "node:util";
import { mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { verifyDetachedSignature } from "../../dist/platform/registry/verify-detached-signature.js";
import { writeJSON } from "../../dist/platform/registry/verify-archive-parts.js";
const { values } = parseArgs({
  options: { manifest: { type: "string" }, out: { type: "string" } },
});
if (!values.manifest || !values.out) throw Error("--manifest and --out are required");
const receipt = await verifyDetachedSignature(values.manifest),
  out = resolve(values.out);
mkdirSync(out, { mode: 0o700 });
try {
  writeJSON(join(out, "receipt.json"), receipt);
  writeJSON(join(out, "import.json"), receipt.importManifest);
} catch (error) {
  rmSync(out, { recursive: true, force: true });
  throw error;
}
console.log(
  JSON.stringify({
    verified: true,
    receipt: join(out, "receipt.json"),
    importManifest: join(out, "import.json"),
  }),
);
