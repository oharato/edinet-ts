/** 固定SDKのカレンダー計画に従い、指定日数ずつXML差分の取得を進める。 */
import { parseArgs } from "node:util";
import { collectRegistryDifferences } from "../../dist/companies/registry/collect-differences.js";
const { values } = parseArgs({
  options: {
    calendar: { type: "string" },
    query: { type: "string" },
    "public-key": { type: "string" },
    fingerprint: { type: "string" },
    out: { type: "string" },
    "max-downloads": { type: "string", default: "1" },
    "sdk-cli": { type: "string" },
    node: { type: "string" },
  },
});
if (
  !values.calendar ||
  !values.query ||
  !values["public-key"] ||
  !values.fingerprint ||
  !values.out
)
  throw Error("--calendar --query --public-key --fingerprint --out are required");
console.log(
  JSON.stringify(
    await collectRegistryDifferences(
      values.calendar,
      values.query,
      values["public-key"],
      values.fingerprint,
      values.out,
      Number(values["max-downloads"]),
      values["sdk-cli"],
      values.node,
    ),
  ),
);
