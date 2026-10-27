import { it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { pair } from "./fixtures/per-share";
const cli = resolve("src/cli.ts"), loader = resolve("node_modules/tsx/dist/loader.mjs");
it("EPS/配当前年比とCAGRの根拠付きmanifest、未知基準の除外、エラー非表示", () => {
    const dir = mkdtempSync(join(tmpdir(), "per-share-cli-"));
    try {
        const manifest = join(dir, "manifest.json");
        const save = (kind: "eps" | "dividend", cagr = false, unknown = false) => {
            const data = pair(kind), entries = [data.previous, data.current].map((p, i) => {
                writeFileSync(join(dir, `${i}.xbrl`), p.xml);
                return { file: `${i}.xbrl`, metadata: p.metadata, shareBasis: unknown ? { state: "unknown" } : p.shareBasis };
            });
            writeFileSync(manifest, JSON.stringify(cagr ? [entries] : [{ previous: entries[0], current: entries[1] }]));
        };
        const run = (...args: string[]) => spawnSync(process.execPath, ["--import", loader, cli, ...args, "--manifest", manifest], { cwd: dir, encoding: "utf8", timeout: 15000 });
        for (const [kind, command, metric] of [["eps", "screen-eps-growth", "earningsPerShareGrowth"], ["dividend", "screen-dividend-growth", "dividendPerShareGrowth"]] as const) {
            save(kind); const r = run(command); expect(r.status).toBe(0); expect(JSON.parse(r.stdout)).toMatchObject({ total: 1, rows: [{ metricId: metric, exact: { numerator: "1", denominator: "5" } }] });
        }
        save("eps", true); const cagr = run("screen-cagr", "--metric", "earningsPerShareCagr"); expect(cagr.status).toBe(0); expect(JSON.parse(cagr.stdout)).toMatchObject({ total: 1 });
        save("eps", false, true); const unknown = run("screen-eps-growth"); expect(unknown.status).toBe(0); expect(JSON.parse(unknown.stdout)).toMatchObject({ total: 0, excluded: [{ reason: "unverified-share-basis" }] });
        writeFileSync(manifest, '{"PRIVATE_MANIFEST_MARKER":'); const bad = run("screen-eps-growth"); expect(bad.status).toBe(1); expect(bad.stdout).toBe(""); expect(bad.stderr).not.toContain("PRIVATE_MANIFEST_MARKER");
    } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
