/** 停止済みSQLiteの退避・利用検査・明示的な退役・復元を実行する。 */
import { parseArgs } from "node:util";
import {
  packColdSqlite,
  auditColdSqliteUsage,
  retireColdSqlite,
  restoreColdSqlite,
} from "../../dist/pipeline/storage/cold-sqlite-archive.js";
const command = process.argv[2];
const { values } = parseArgs({
  args: process.argv.slice(3),
  options: {
    source: { type: "string" },
    out: { type: "string" },
    "expected-sha256": { type: "string" },
    archive: { type: "string" },
    target: { type: "string" },
  },
});
let result;
if (command === "pack" && values.source && values.out && values["expected-sha256"])
  result = await packColdSqlite(values.source, values.out, values["expected-sha256"]);
else if (command === "audit" && values.archive) result = auditColdSqliteUsage(values.archive);
else if (command === "retire" && values.archive) result = await retireColdSqlite(values.archive);
else if (command === "restore" && values.archive)
  result = await restoreColdSqlite(values.archive, values.target);
else
  throw Error(
    "Expected pack --source --out --expected-sha256, or audit/retire/restore --archive [--target]",
  );
console.log(JSON.stringify(result));
