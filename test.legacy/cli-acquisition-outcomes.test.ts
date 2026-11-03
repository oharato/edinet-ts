import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { it, expect } from "vitest";

function fixture(
  work: (run: (args: string[], mode?: string) => ReturnType<typeof spawnSync>) => void,
) {
  const dir = mkdtempSync(join(tmpdir(), "cli-outcomes-"));
  try {
    const preload = join(dir, "mock.mjs"),
      xml = join(dir, "source.xbrl");
    writeFileSync(xml, "<xbrl/>");
    writeFileSync(
      preload,
      `import {EdinetXbrlDownloader as D} from ${JSON.stringify(pathToFileURL(resolve("src/edinet/api-client.ts")).href)};import {EdinetXbrlParser as P} from ${JSON.stringify(pathToFileURL(resolve("src/xbrl/parse-xbrl.ts")).href)};
const mode=process.env.CLI_TEST_MODE;D.prototype.search=async()=>mode==='empty'?[]:[{docID:'S100TEST'},{docID:'S100NEXT'}];D.prototype.download=async function(id){if(mode==='fail'||mode==='partial'&&id==='S100NEXT')throw Error('SECRET_API_VALUE');return ${JSON.stringify(xml)}};D.prototype.downloadByTicker=async function(id){if(mode==='fail'||mode==='partial'&&id==='9984')throw Error('SECRET_API_VALUE');return mode==='empty'?null:${JSON.stringify(xml)}};P.prototype.parse=()=>({getKeyMetrics:()=>({revenue:1}),getLargeShareholdingInfo:()=>({})});`,
    );
    work((args, mode = "success") =>
      spawnSync(
        process.execPath,
        [
          "--import",
          resolve("node_modules/tsx/dist/loader.mjs"),
          "--import",
          pathToFileURL(preload).href,
          resolve("src/cli.ts"),
          ...args,
        ],
        { cwd: dir, encoding: "utf8", env: { ...process.env, CLI_TEST_MODE: mode } },
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
it.each(["success", "partial", "fail"])("get preserves successful JSON and signals %s", (mode) =>
  fixture((run) => {
    const r = run(["get", "--date", "2024-06-25"], mode);
    expect(r.status).toBe(mode === "success" ? 0 : 1);
    expect(JSON.parse(String(r.stdout))).toHaveLength(
      mode === "success" ? 2 : mode === "partial" ? 1 : 0,
    );
    expect(String(r.stderr)).not.toContain("SECRET_API_VALUE");
    if (mode !== "success")
      expect(String(r.stderr)).toContain(mode === "partial" ? "S100NEXT" : "S100TEST");
  }),
);
it.each(["success", "partial", "fail", "empty"])("download reports %s safely", (mode) =>
  fixture((run) => {
    const r = run(["download", "--ticker", "7203,9984", "--date", "2024-06-25"], mode);
    expect(r.status).toBe(mode === "partial" || mode === "fail" ? 1 : 0);
    expect(String(r.stderr)).not.toContain("SECRET_API_VALUE");
    if (mode === "partial" || mode === "fail")
      expect(String(r.stderr)).toContain("Failed to download");
  }),
);
it("rejects ambiguous get inputs and missing download ticker before I/O", () =>
  fixture((run) => {
    const r = run(["get", "--ticker", "7203", "--date", "2024-06-25"], "fail");
    expect(r.status).toBe(1);
    expect(String(r.stderr)).toContain("併用できません");
    expect(r.stdout).toBe("");
    const d = run(["download", "--date", "2024-06-25"]);
    expect(d.status).toBe(1);
    expect(String(d.stderr)).toContain("--ticker");
    expect(d.stdout).toBe("");
  }));
