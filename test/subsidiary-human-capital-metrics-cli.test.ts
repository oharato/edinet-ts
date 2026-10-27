import { it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { extractSubsidiaryHumanCapitalMetrics, SubsidiaryHumanCapitalMetricId as M } from "../src/index";
import { subsidiaryDocument, proof } from "./fixtures/subsidiary-metrics";
const cli = resolve("src/cli.ts"), loader = resolve("node_modules/tsx/dist/loader.mjs");
it("子会社ラベル・比率・注記宣言をCLIから検索し、不正入力を非表示で拒否", () => {
    const dir = mkdtempSync(join(tmpdir(), "subsidiary-metrics-cli-"));
    try {
        const doc = subsidiaryDocument(), rowKey = extractSubsidiaryHumanCapitalMetrics(doc.xml, doc.metadata).rows[0].label.rowKey!, manifest = join(dir, "manifest.json");
        writeFileSync(join(dir, "source.xbrl"), doc.xml);
        writeFileSync(manifest, JSON.stringify([{ file: "source.xbrl", metadata: doc.metadata, annotations: [{ kind: "childcare-method", rowKey, metric: M.MaleChildcareLeaveAllRatio, method: "ordinance-item2", proof }] }]));
        const run = (metric: string, ...args: string[]) => spawnSync(process.execPath, ["--import", loader, cli, "screen-subsidiary-human-capital", "--manifest", manifest, "--metric", metric, ...args], { cwd: dir, encoding: "utf8", timeout: 15000 });
        const female = run(M.FemaleManagerRatio, "--conditions", '[{"operator":"gte","value":0.1}]'); expect(female.status).toBe(0); expect(JSON.parse(female.stdout)).toMatchObject({ total: 1, rows: [{ label: { parsedLabel: "合成子会社" } }] });
        const childcare = run(M.MaleChildcareLeaveAllRatio, "--childcare-method", "ordinance-item2"); expect(childcare.status).toBe(0); expect(JSON.parse(childcare.stdout).total).toBe(1);
        expect(run(M.MaleChildcareLeaveAllRatio).status).toBe(1);
        writeFileSync(manifest, '{"PRIVATE_SOURCE_MARKER":'); const malformed = run(M.FemaleManagerRatio); expect(malformed.status).toBe(1); expect(malformed.stdout).toBe(""); expect(malformed.stderr).not.toContain("PRIVATE_SOURCE_MARKER");
    } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
