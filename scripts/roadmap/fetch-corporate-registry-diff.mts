/** 日付と信頼鍵を明示して、国税庁の一日分のXML差分を取得・検証する。 */
import { parseArgs } from "node:util";
import { fetchRegistryDifference } from "../../dist/platform/registry/fetch-difference.js";
const { values } = parseArgs({
  options: {
    date: { type: "string" },
    "public-key": { type: "string" },
    fingerprint: { type: "string" },
    out: { type: "string" },
  },
});
if (!values.date || !values["public-key"] || !values.fingerprint || !values.out)
  throw Error("--date --public-key --fingerprint --out are required");
console.log(
  JSON.stringify(
    await fetchRegistryDifference(
      values.date,
      values["public-key"],
      values.fingerprint,
      values.out,
    ),
  ),
);
