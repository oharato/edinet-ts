/** 原本照合を別のNodeプロセスで実行し、照合コード一式のhashを記録する。 */
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const directory = new URL(
  import.meta.url.endsWith(".ts") ? "../../../../dist/platform/pipeline/verification/" : "./",
  import.meta.url,
);
const verifier = fileURLToPath(new URL("verify-source-values.js", directory));
const execute = promisify(execFile);
export function financialSourceVerifierSha256() {
  const digest = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
  return digest(
    JSON.stringify(
      [
        "verify-source-values.js",
        "read-source-xbrl.js",
        "source-verifier-command.js",
        "../../db/engines/sqlite/node-sqlite.js",
      ].map((path) => digest(readFileSync(new URL(path, directory)))),
    ),
  );
}
export async function runFinancialSourceVerifier(
  engine: "sqlite" | "duckdb",
  index: string,
  archive: string,
  generation: string,
  archiveSha256: string,
  signal?: AbortSignal,
) {
  // The independent child must not inherit host preloads or alternate module search paths.
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const { stdout } = await execute(
    process.execPath,
    [verifier, engine, index, archive, generation, archiveSha256],
    { signal, maxBuffer: 1024 * 1024, env },
  );
  return JSON.parse(stdout);
}
