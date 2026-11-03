import { it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { point } from "./fixtures/per-share";

it("出典付き分割台帳をEPS/支払配当の前年比とCAGRへ接続し、不正入力を公開しない", () => {
    const dir = mkdtempSync(join(tmpdir(), "split-cli-"));
    const cli = resolve("src/cli.ts"), loader = resolve("node_modules/tsx/dist/loader.mjs");
    try {
        const manifest = join(dir, "manifest.json"), ledger = join(dir, "split.json");
        const source = { name: "synthetic split notice", sha256: "a".repeat(64), observedAt: "2024-03-01T00:00:00Z" };
        const adjustment = { asOf: "2026-06-30", knownAt: "2026-06-30T00:00:00Z", targetBasisDate: "2024-04-01", sourceObservedAt: ["2026-06-24T12:00:00Z", "2026-06-24T12:00:00Z"], ledger: {
            state: "confirmed-complete", secCode: "1001", shareClass: "ordinary", basisConvention: "effective-date-inclusive", reviewedFrom: "2023-01-01", reviewedThrough: "2024-04-01", source,
            events: [{ eventId: "split", effectiveDate: "2024-04-01", oldShares: 1, newShares: 2, source }],
        } };
        const run = (...args: string[]) => spawnSync(process.execPath, ["--import", loader, cli, ...args, "--manifest", manifest], { cwd: dir, encoding: "utf8", timeout: 15000 });
        writeFileSync(ledger, JSON.stringify({ "1001": adjustment }));
        for (const kind of ["eps", "dividend"] as const) {
            const entries = [point(2024, "100", kind), point(2025, "60", kind)].map((document, i) => {
                if (document.shareBasis.state === "confirmed") document.shareBasis.basisDate = i ? "2024-04-01" : "2023-04-01";
                writeFileSync(join(dir, `${i}.xbrl`), document.xml);
                return { file: `${i}.xbrl`, metadata: document.metadata, shareBasis: document.shareBasis };
            });
            for (const cagr of [false, true]) {
                writeFileSync(manifest, JSON.stringify(cagr ? [entries] : [{ previous: entries[0], current: entries[1] }]));
                const args = cagr ? ["screen-cagr", "--metric", kind === "eps" ? "earningsPerShareCagr" : "dividendPerShareCagr"] : [`screen-${kind}-growth`];
                const before = [manifest, ledger, join(dir, "0.xbrl"), join(dir, "1.xbrl")].map(file => readFileSync(file));
                const result = run(...args, "--share-adjustments", "split.json", "--conditions", '[{"operator":"eq","value":0.2}]');
                expect(result.status, result.stderr).toBe(0);
                const parsed = JSON.parse(result.stdout);
                expect(parsed.rows[0].value).toBeCloseTo(0.2);
                expect(parsed.rows[0].exact).toEqual(cagr ? { numerator: "6", denominator: "5", root: 1 } : { numerator: "1", denominator: "5" });
                expect(parsed).toMatchObject({ total: 1, rows: [{ shareAdjustment: { status: "adjusted", points: [{ originalValue: 100, value: 50 }, { originalValue: 60, value: 60 }] } }] });
                expect([manifest, ledger, join(dir, "0.xbrl"), join(dir, "1.xbrl")].map(file => readFileSync(file))).toEqual(before);
            }
        }
        const nonPerShare = run("screen-cagr", "--metric", "netSalesCagr", "--share-adjustments", ledger);
        expect(nonPerShare.status).toBe(1); expect(nonPerShare.stdout).toBe("");
        const entries = JSON.parse(readFileSync(manifest, "utf8"))[0];
        writeFileSync(manifest, JSON.stringify([{ previous: entries[0], current: entries[1] }]));
        writeFileSync(ledger, JSON.stringify({ "1001": { ...adjustment, ledger: { state: "unknown" } } }));
        const unknown = run("screen-dividend-growth", "--share-adjustments", ledger);
        expect(unknown.status).toBe(0);
        expect(JSON.parse(unknown.stdout)).toMatchObject({ total: 0, excluded: [{ reason: "unverified-split-history" }] });
        writeFileSync(ledger, '{"PRIVATE_SPLIT_MARKER":');
        const malformed = run("screen-dividend-growth", "--share-adjustments", ledger);
        expect(malformed.status).toBe(1); expect(malformed.stdout).toBe(""); expect(malformed.stderr).not.toContain("PRIVATE_SPLIT_MARKER");
    } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
