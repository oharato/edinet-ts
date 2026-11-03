import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { calculateCagr, screenCagr, CagrMetricId, type AnnualRevenueDocument } from "../src/index";
import { instance, fact } from "./fixtures/metric-boundaries";
function series(values = ["100", "110", "121", "133.1"], code = "1001"): AnnualRevenueDocument[] {
    return values.map((value, i) => {
        const startDate = `${2021 + i}-04-01`, endDate = `${2022 + i}-03-31`;
        const c = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${startDate}</xbrli:startDate><xbrli:endDate>${endDate}</xbrli:endDate></xbrli:period></xbrli:context>`;
        return { xml: instance(fact(value), c), metadata: { secCode: code, docID: `${code}-${i}`, accountingStandard: "J-GAAP", scope: "Consolidated", currency: "JPY", periodType: "annual", period: { startDate, endDate } } };
    });
}
describe("明示連続年次系列のCAGR", () => {
    it("3年CAGRには4原値を要求し、根の中の分数を正確に保持", () => {
        const result = calculateCagr(series(), CagrMetricId.NetSales);
        expect(result).toMatchObject({ status: "calculated", years: 3, exact: { numerator: "1331", denominator: "1000", root: 3 } });
        expect(result.value).toBeCloseTo(0.1, 14); expect(result.points).toHaveLength(4);
        expect(result.points[0].inputXmlSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(result.points[0]).not.toHaveProperty("xml");
    });
    it("近接する巨大な値の成長を表示0に丸めない", () => {
        const result = calculateCagr(series(["9007199254740990", "9007199254740991"]), CagrMetricId.NetSales);
        expect(result.status).toBe("calculated"); expect(result.value).toBeGreaterThan(0);
    });
    it.each([[CagrMetricId.OperatingIncome, "OperatingIncome"], [CagrMetricId.NetIncome, "ProfitLossAttributableToOwnersOfParent"]] as const)("%sを指定した直接利益から計算", (id, tag) => {
        const data = series().map(d => ({ ...d, xml: d.xml.replaceAll("jppfs_cor:NetSales", `jppfs_cor:${tag}`) }));
        expect(calculateCagr(data, id)).toMatchObject({ status: "calculated", metricId: id, years: 3 });
    });
    it("0の終値は-100%、0基数は理由付き不可", () => {
        expect(calculateCagr(series(["100", "0"]), CagrMetricId.NetSales)).toMatchObject({ status: "calculated", value: -1, exact: { numerator: "0", denominator: "1", root: 1 } });
        expect(calculateCagr(series(["0", "100"]), CagrMetricId.NetSales).reason).toBe("zero-base");
    });
    it.each(["gap", "quarter", "short", "company", "entity", "scope", "standard", "negative", "unsafe", "absent"])("%sを補完しない", kind => {
        const data: any = series();
        if (kind === "gap") data.splice(1, 1);
        if (kind === "quarter") data[1].metadata.periodType = "quarterly";
        if (kind === "short") data[1].metadata.period.startDate = "2022-10-01";
        if (kind === "company") data[1].metadata.secCode = "1002";
        if (kind === "entity") data[1].xml = data[1].xml.replace('scheme="synthetic">1001', 'scheme="synthetic">OTHER');
        if (kind === "scope") data[1].metadata.scope = "NonConsolidated";
        if (kind === "standard") data[1].metadata.accountingStandard = "IFRS";
        if (kind === "negative") data[1] = series(["100", "-10", "121", "133.1"])[1];
        if (kind === "unsafe") data[1] = series(["100", "9007199254740993", "121", "133.1"])[1];
        if (kind === "absent") data[1].xml = data[1].xml.replaceAll("jppfs_cor:NetSales", "jppfs_cor:Other");
        const result = calculateCagr(data, CagrMetricId.NetSales);
        expect(result.status).toBe("unavailable"); expect(result.value).toBeUndefined();
        expect(result.reason).toBe(({gap:"non-consecutive-periods",quarter:"not-annual",short:"unsupported-annual-period",company:"incompatible-metadata",entity:"incompatible-entity",scope:"incompatible-metadata",standard:"unsupported-standard",negative:"negative-input",unsafe:"unsafe-input",absent:"unavailable-input"} as Record<string,string>)[kind]);
    });
    it.each([[], new Array(1), series().slice(0, 1), Array(22).fill(series()[0])])("不正な系列は設定エラー", data => expect(() => calculateCagr(data, CagrMetricId.NetSales)).toThrow());
    it.each(["gte", "lte", "gt", "lt", "eq"] as const)("%sの条件は近似表示値でなく分数の累乗で比較", operator => {
        const data = [series(["100", "110", "121", "133.1"], "1001"), series(["100", "120", "144", "172.8"], "1002")];
        const result = screenCagr(data, CagrMetricId.NetSales, { conditions: [{ operator, value: 0.1 }], order: "asc" });
        const codes = operator === "gt" ? ["10020"] : operator === "lt" ? [] : operator === "lte" || operator === "eq" ? ["10010"] : ["10010", "10020"];
        expect(result.rows.map(r => r.points[0].metadata.secCode)).toEqual(codes);
        expect(screenCagr(data, CagrMetricId.NetSales, { order: "desc", offset: 1, limit: 1 }).rows[0].points[0].metadata.secCode).toBe("10010");
    });
    it("-100%未満の閾値・ゼロ倍率・欠損を区別", () => {
        const data = [series(["100", "0"], "1001"), series(["0", "0"], "1002")];
        expect(screenCagr(data, CagrMetricId.NetSales, { conditions: [{ operator: "gt", value: -2 }] })).toMatchObject({ total: 1, excludedRows: 1 });
        expect(screenCagr(data, CagrMetricId.NetSales, { conditions: [{ operator: "eq", value: -1 }] })).toMatchObject({ total: 1 });
    });
    it("期間/企業重複と別企業の書類ID共有は条件で隠さない", () => {
        expect(() => screenCagr([series(), series()], CagrMetricId.NetSales)).toThrow();
        expect(() => screenCagr([series(), series(["100", "110"], "1002")], CagrMetricId.NetSales)).toThrow();
        const other = series(undefined, "1002"); other[1].metadata.docID = series()[0].metadata.docID;
        expect(() => screenCagr([series(), other], CagrMetricId.NetSales)).toThrow();
    });
    it("不正設定を空集合でも受け入れない", () => {
        expect(() => screenCagr([], "bad" as any)).toThrow();
        expect(() => screenCagr([], CagrMetricId.NetSales, { conditions: [{ operator: "eq", value: NaN }] })).toThrow();
        expect(() => screenCagr([], CagrMetricId.NetSales, { offset: -1 })).toThrow();
    });
    it("CLIの系列・相対パス・条件・原本不変とエラーを確認", () => {
        const dir = mkdtempSync(join(tmpdir(), "cagr-cli-"));
        try {
            const data = series();
            const manifest = data.map((d, i) => { writeFileSync(join(dir, `${i}.xbrl`), d.xml); return { file: `${i}.xbrl`, metadata: d.metadata }; });
            const file = join(dir, "series.json"); writeFileSync(file, JSON.stringify([manifest]));
            const args = ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), "screen-cagr", "--manifest", file, "--metric", "netSalesCagr"];
            const result = spawnSync(process.execPath, [...args, "--conditions", '[{"operator":"eq","value":0.1}]'], { cwd: "/tmp", encoding: "utf8" });
            expect(result.status, result.stderr).toBe(0); expect(JSON.parse(result.stdout)).toMatchObject({ total: 1 });
            expect(readFileSync(join(dir, "0.xbrl"), "utf8")).toBe(data[0].xml);
            writeFileSync(file, "PRIVATE_INVALID_JSON");
            const invalid = spawnSync(process.execPath, args, { encoding: "utf8" });
            expect(invalid.status).toBe(1); expect(invalid.stderr).not.toContain("PRIVATE_INVALID_JSON");
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });

});
