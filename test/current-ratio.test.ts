import { describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { AccountingStandard, BALANCE_SHEET_REGISTRY, BalanceSheetScreeningMetric, ComparisonOperator,
    ConsolidationScope, CURRENT_RATIO_DEFINITION, SortOrder, calculateCurrentRatio, createBalanceSheetSnapshot,
    screenBalanceSheetSnapshots, type BalanceSheetSnapshot } from "../src/index";
import { fact, instance } from "./fixtures/metric-boundaries";

const instant = "2025-03-31";
const context = (id = "current") => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period></xbrli:context>`;
const keys = ["jppfs_cor:CurrentAssets", "jppfs_cor:CurrentLiabilities", "jppfs_cor:Liabilities"];
const xml = (a = "120", b = "40", c = "80") => instance([a, b, c].map((v, i) => v === "absent" ? "" : v === "nil" ? fact("", 'xsi:nil="true"', keys[i]) : fact(v, "", keys[i])).join(""), context());
const meta = { secCode: "1001", docID: "SYNTHETIC1", instant, scope: ConsolidationScope.Consolidated, accountingStandard: AccountingStandard.JGAAP, currency: "JPY" as const };
const row = (a = "120", b = "40", code = "1001", c = "80") => createBalanceSheetSnapshot(xml(a, b, c), { ...meta, secCode: code, docID: `SYNTHETIC${code}` });
const metric = BalanceSheetScreeningMetric.CurrentRatio;
const ratioSearch = (rows: BalanceSheetSnapshot[], extra: Parameters<typeof screenBalanceSheetSnapshots>[1] = {}) => screenBalanceSheetSnapshots(rows, { sortBy: metric, ...extra });

describe("流動比率の計算", () => {
    it("小数1=100%の定義と検索定数を公開し、金額3項目は増やさない", () => {
        expect(CURRENT_RATIO_DEFINITION).toMatchObject({ id: metric, unit: "ratio", formula: "currentAssets / currentLiabilities", inputs: ["currentAssets", "currentLiabilities"] });
        expect(Object.isFrozen(CURRENT_RATIO_DEFINITION.inputs)).toBe(true);
        expect(Object.isFrozen(BalanceSheetScreeningMetric)).toBe(true);
        expect(Object.keys(BALANCE_SHEET_REGISTRY)).toHaveLength(3);
        expect(calculateCurrentRatio(row())).toMatchObject({ status: "calculated", value: 3, unit: "ratio", exact: { numerator: "3", denominator: "1" } });
    });
    it.each([["0", "40", 0, "0", "1"], ["0.3", "0.1", 3, "3", "1"], ["1", "3", 1 / 3, "1", "3"], ["+00120.00", "040.0", 3, "3", "1"]])("%s / %sの報告値を分数として保持する", (a, b, value, numerator, denominator) => {
        expect(calculateCurrentRatio(row(String(a), String(b)))).toMatchObject({ status: "calculated", value, exact: { numerator, denominator } });
    });
    it.each(["0", "-0"])("分母%sは計算しない", denominator => expect(calculateCurrentRatio(row("1", denominator))).toMatchObject({ status: "unavailable", reason: "zero-denominator" }));
    it.each([["-1", "2"], ["1", "-2"], ["-1", "-2"]])("負値%s / %sは比率にしない", (a, b) => expect(calculateCurrentRatio(row(a, b))).toMatchObject({ status: "unavailable", reason: "negative-input" }));
    it.each([["absent", "2"], ["1", "nil"]])("欠損%s / %sは0で補わない", (a, b) => expect(calculateCurrentRatio(row(a, b))).toMatchObject({ status: "unavailable", reason: "missing-input" }));
    it.each([["9007199254740993", "9007199254740993"], ["0.10000000000000001", "1"]])("不安全な入力は商が小さくても計算しない", (a, b) => expect(calculateCurrentRatio(row(a, b))).toMatchObject({ status: "unavailable", reason: "unsafe-input" }));
    it("候補が重複した入力と外貨を別理由で残す", () => {
        const ambiguous = createBalanceSheetSnapshot(instance(fact("1", "", keys[0]) + fact("3", "", keys[0]) + fact("2", "", keys[1]), context()), meta);
        expect(calculateCurrentRatio(ambiguous)).toMatchObject({ status: "unavailable", reason: "ambiguous-input", inputs: { currentAssets: { status: "ambiguous" } } });
        const usd = createBalanceSheetSnapshot(xml().replace("iso4217:JPY", "iso4217:USD"), meta);
        expect(calculateCurrentRatio(usd)).toMatchObject({ status: "unavailable", reason: "unsupported-input", inputs: { currentAssets: { reason: "unsupported-unit" } } });
    });
    it("商の安全整数上限を丸める前の分数で検査する", () => {
        expect(calculateCurrentRatio(row("9007199254740991", "1"))).toMatchObject({ status: "calculated", value: Number.MAX_SAFE_INTEGER });
        expect(calculateCurrentRatio(row("9007199254740991", "0.9999999999999999"))).toMatchObject({ status: "unavailable", reason: "unsafe-result" });
    });
    it("計算値のunderflowを0と誤認しない", () => {
        const tiny = `0.${"0".repeat(323)}5`;
        expect(calculateCurrentRatio(row(tiny, "9007199254740991"))).toMatchObject({ status: "unavailable", reason: "unsafe-result" });
        expect(calculateCurrentRatio(row(tiny, "1"))).toMatchObject({ status: "calculated", value: 5e-324 });
    });
    it("decimalsを倍率とせず、報告精度と採用元を保持する", () => {
        const input = createBalanceSheetSnapshot(xml().replaceAll('decimals="INF"', 'decimals="-6"'), meta);
        expect(calculateCurrentRatio(input)).toMatchObject({ value: 3, inputs: { currentAssets: { raw: "120", source: { decimals: "-6", period: { instant }, unit: "iso4217:JPY" } } } });
    });
    it("同じ対象の別context IDは拒否せず、対象情報を照合する", () => {
        const input = createBalanceSheetSnapshot(instance(fact("120", "", keys[0]) + fact("40", "", keys[1], "other"), context() + context("other")), meta);
        expect(calculateCurrentRatio(input)).toMatchObject({ status: "calculated", value: 3 });
    });
    it.each(["entity", "instant", "scope", "unit", "safeNumber"])("不整合な%sは計算前に拒否する", field => {
        const input = row(); const selected = input.selections.currentLiabilities;
        if (selected.status !== "selected") throw new Error("fixture");
        if (field === "entity") selected.source.entity!.identifier = "OTHER";
        if (field === "instant") selected.source.period!.instant = "2024-03-31";
        if (field === "scope") selected.source.scope = "NonConsolidated";
        if (field === "unit") selected.source.unit = "iso4217:USD";
        if (field === "safeNumber") selected.safeNumber = 123;
        expect(() => calculateCurrentRatio(input)).toThrow();
    });
    it("返値と入力を切り離し、入力された派生値を信用しない", () => {
        const input = row() as any; input.derivedMetrics = { currentRatio: { value: 999 } };
        const result = calculateCurrentRatio(input);
        expect(result).toMatchObject({ value: 3 });
        expect(screenBalanceSheetSnapshots([input]).rows[0]).not.toHaveProperty("derivedMetrics");
        result.inputs.currentAssets.evidence[0].reason = "nil";
        expect(input.selections.currentAssets.evidence[0].reason).toBe("selected");
        expect(ratioSearch([input]).rows[0].derivedMetrics!.currentRatio).toMatchObject({ value: 3 });
    });
});

describe("流動比率の条件検索と並べ替え", () => {
    it("表示近似の等値と、厳密な分数の等値を区別する", () => {
        const input = row("1", "3");
        expect(ratioSearch([input], { conditions: [{ metric, operator: "eq", value: 1 / 3 }] })).toMatchObject({ total: 0, filteredRows: 1 });
        expect(ratioSearch([input], { conditions: [{ metric, operator: "gt", value: 1 / 3 }] }).total).toBe(1);
        expect(ratioSearch([row("0.3", "0.1")], { conditions: [{ metric, operator: "eq", value: 3 }] }).total).toBe(1);
    });
    it.each([["gte", 1], ["lte", 1], ["gt", 0], ["lt", 0], ["eq", 1]] as const)("境界の%sを正しく判定する", (operator, count) => {
        expect(ratioSearch([row("2", "1")], { conditions: [{ metric, operator, value: 2 }] }).total).toBe(count);
    });
    it("指数表記の小数条件も十進値として比較する", () => expect(ratioSearch([row("0.0000001", "1")], { conditions: [{ metric, operator: "eq", value: 1e-7 }] }).total).toBe(1));
    it("同じnumber表示に丸められても分数の大小順を保つ", () => {
        const smaller = row("9007199254740991", "9007199254740990", "1002");
        const larger = row("9007199254740990", "9007199254740989", "1001");
        expect(calculateCurrentRatio(smaller).value).toBe(calculateCurrentRatio(larger).value);
        expect(ratioSearch([larger, smaller], { order: "asc" }).rows.map(r => r.secCode)).toEqual(["10020", "10010"]);
    });
    it("AND・同値の証券コード順・ページ指定とtotalを維持する", () => {
        const input = [row("6", "2", "1002"), row("3", "1", "1001"), row("2", "1", "1003")];
        const result = ratioSearch(input, { conditions: [{ metric, operator: ComparisonOperator.GreaterThanOrEqual, value: 3 }, { metric: BalanceSheetScreeningMetric.CurrentAssets, operator: "gte", value: 1 }], offset: 1, limit: 1 });
        expect(result.total).toBe(2); expect(result.rows.map(r => r.secCode)).toEqual(["10020"]);
        expect(ratioSearch(input, { limit: 0 })).toMatchObject({ total: 3, rows: [] });
    });
    it("分母0・負値・欠損・不安全入力を理由付きで除外する", () => {
        const result = ratioSearch([row("1", "0", "1001"), row("-1", "1", "1002"), row("nil", "1", "1003"), row("9007199254740993", "1", "1004")]);
        expect(result).toMatchObject({ total: 0, excludedRows: 4 });
        expect(result.diagnostics.filter(d => d.metric === metric).map(d => d.selectionReason)).toEqual(["zero-denominator", "negative-input", "missing-input", "unsafe-input"]);
        expect(result.reasonCounts).toEqual({ missing: 2, unsupported: 2, ambiguous: 0, "unsafe-number": 2 });
    });
    it("負債合計は流動比率の依存項目にしない", () => {
        const input = row("120", "40", "1001", "absent");
        expect(ratioSearch([input])).toMatchObject({ total: 1, excludedRows: 0, diagnostics: [{ metric: "totalLiabilities", required: false }] });
        expect(screenBalanceSheetSnapshots([input])).toMatchObject({ total: 0, excludedRows: 1 });
    });
    it("従来の検索では派生フィールドや理由分類を増やさない", () => {
        const result = screenBalanceSheetSnapshots([row()]);
        expect(result.rows[0]).not.toHaveProperty("derivedMetrics");
        expect(Object.keys(result.reasonCounts)).toEqual(["missing", "unsupported", "ambiguous", "unsafe-number"]);
        expect(screenBalanceSheetSnapshots([row("-1", "0")], { sortBy: "currentAssets" }).total).toBe(1);
    });
    it("比率条件が不成立でも別scope・企業混入を先に拒否する", () => {
        const bad = row(); bad.scope = ConsolidationScope.NonConsolidated;
        expect(() => ratioSearch([bad], { conditions: [{ metric, operator: "gt", value: 999 }] })).toThrow();
    });
});

describe("流動比率CLI", () => {
    it("同じmanifestで比率条件・厳密な等値・並び順・診断をJSONで返す", () => {
        const dir = mkdtempSync(join(tmpdir(), "current-ratio-"));
        try {
            writeFileSync(join(dir, "one.xbrl"), xml("0.3", "0.1"));
            writeFileSync(join(dir, "zero.xbrl"), xml("1", "0"));
            writeFileSync(join(dir, "manifest.json"), JSON.stringify([
                { ...(({ currency, ...m }) => m)(meta), file: "./one.xbrl" },
                { ...(({ currency, ...m }) => m)(meta), secCode: "1002", docID: "SYNTHETIC2", file: "./zero.xbrl" }
            ]));
            const result = spawnSync(process.execPath, ["--import", resolve("node_modules/tsx/dist/loader.mjs"), resolve("src/cli.ts"), "screen-bs", "--manifest", join(dir, "manifest.json"), "--conditions", '[{"metric":"currentRatio","operator":"eq","value":3}]', "--sort-by", "currentRatio", "--order", SortOrder.Descending], { cwd: "/tmp", encoding: "utf8" });
            expect(result.status).toBe(0); expect(result.stderr).toBe("");
            expect(JSON.parse(result.stdout)).toMatchObject({ total: 1, excludedRows: 1, rows: [{ derivedMetrics: { currentRatio: { value: 3, exact: { numerator: "3", denominator: "1" }, unit: "ratio" } } }], diagnostics: [{ metric, selectionReason: "zero-denominator" }] });
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});
