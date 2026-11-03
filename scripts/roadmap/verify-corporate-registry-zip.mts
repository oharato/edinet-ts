/** 保存済みZIPと署名をオフライン検証して、新規directoryへ結果を出力する。 */
import { parseArgs } from "node:util";
import { join, resolve } from "node:path";
import { verifyRegistryZip } from "../../dist/companies/registry/verify-archive-parts.js";
const { values } = parseArgs({
  options: { manifest: { type: "string" }, out: { type: "string" } },
});
if (!values.manifest || !values.out) throw Error("--manifest and --out are required");
const receipt = await verifyRegistryZip(values.manifest, values.out);
console.log(
  JSON.stringify({
    verified: true,
    parts: receipt.parts.length,
    receipt: join(resolve(values.out), "receipt.json"),
  }),
);
