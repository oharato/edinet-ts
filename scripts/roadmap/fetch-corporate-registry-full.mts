/** 全国全件XMLを、取得ZIP数の予算と容量保護を保って取得・検証する。 */
import { parseArgs } from "node:util";
import { fetchNationalRegistry } from "../../dist/platform/registry/fetch-national-baseline.js";
const { values } = parseArgs({
  options: {
    date: { type: "string" },
    "public-key": { type: "string" },
    fingerprint: { type: "string" },
    out: { type: "string" },
    "max-zips": { type: "string", default: "1" },
  },
});
if (!values.date || !values["public-key"] || !values.fingerprint || !values.out)
  throw Error("--date --public-key --fingerprint --out are required");
console.log(
  JSON.stringify(
    await fetchNationalRegistry(
      values.date,
      values["public-key"],
      values.fingerprint,
      values.out,
      Number(values["max-zips"]),
    ),
  ),
);
