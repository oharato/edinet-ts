import { describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import { KeyMetricSources } from "../src/edinet-xbrl-object";
import { calculateFinancialMetrics, FINANCIAL_SCREENING_METRICS, FinancialSnapshot, screenFinancialSnapshots } from "../src/financial-screening";

const source = {
    key: "example:Fact", contextRef: "CurrentYearDuration", unitRef: "JPY", unit: "iso4217:JPY",
    periodStart: "2023-04-01", periodEnd: "2024-03-31", scope: "Consolidated" as const
};
const sources: KeyMetricSources = Object.fromEntries(["netSales", "operatingIncome", "netIncome", "operatingCashFlow", "investingCashFlow"].map(key => [key, { ...source }]));
const calculate = (metrics: FinancialSnapshot["metrics"]) => calculateFinancialMetrics(metrics, sources);
const row = (secCode: string, metrics: FinancialSnapshot["metrics"], extra: Partial<FinancialSnapshot> = {}): FinancialSnapshot => ({
    secCode, metrics, metricSources: sources, periodType: "annual", docID: `doc-${secCode}`, docTypeCode: "120", periodEnd: "2024-03-31", submitDate: "2024-06-25", ...extra
});

describe("保存済み財務の追加計算", () => {
    it("利益率は小数、FCFは営業CF+投資CF（負数も保持）", () => {
        expect(calculate({ netSales: 100, operatingIncome: 0, netIncome: -5, operatingCashFlow: 20, investingCashFlow: -30 }))
            .toEqual({ operatingMargin: 0, netMargin: -0.05, freeCashFlow: -10 });
    });
    it.each([0, -1, undefined, NaN, Infinity])("売上高 %s から利益率を計算しない", netSales => {
        expect(calculate({ netSales, operatingIncome: 10 }).operatingMargin).toBeUndefined();
    });
    it("CF片側欠損とオーバーフローを0にしない", () => {
        expect(calculate({ operatingCashFlow: 10 }).freeCashFlow).toBeUndefined();
        expect(calculate({ operatingCashFlow: Number.MAX_VALUE, investingCashFlow: Number.MAX_VALUE }).freeCashFlow).toBeUndefined();
    });
});

describe("screenFinancialSnapshots", () => {
    it("既存18指標と派生指標にAND条件を指定し、順位とページを取得", () => {
        const data = [row("1111", { netSales: 100, operatingIncome: 30 }), row("2222", { netSales: 200, operatingIncome: 20 }), row("3333", { netSales: 100, operatingIncome: -1 })];
        expect(screenFinancialSnapshots(data, { conditions: [
            { metric: "netSales", operator: "gte", value: 100 },
            { metric: "operatingMargin", operator: "gt", value: 0 }
        ], sortBy: "operatingMargin", offset: 1, limit: 1 }).map(r => r.secCode)).toEqual(["22220"]);
        expect(screenFinancialSnapshots(data, { limit: 0 })).toEqual([]);
    });
    it("最新書類を選んでから条件を適用し、過去年の好業績を混入しない", () => {
        const data = [row("1111", { netIncome: 100 }, { periodEnd: "2023-03-31" }), row("11110", { netIncome: -1 })];
        expect(screenFinancialSnapshots(data, { conditions: [{ metric: "netIncome", operator: "gte", value: 0 }] })).toEqual([]);
    });
    it("同一決算期の後提出とdocIDで決定し、入力順に依存しない", () => {
        const data = [row("1111", { netIncome: 1 }), row("1111", { netIncome: 2 }, { submitDate: "2024-06-26", docID: "b" }), row("1111", { netIncome: 3 }, { submitDate: "2024-06-26", docID: "c" })];
        expect(screenFinancialSnapshots(data)[0].metrics.netIncome).toBe(3);
        expect(screenFinancialSnapshots([...data].reverse())[0].docID).toBe("c");
    });
    it("提出日だけの行より同日で時刻がある行を新しいものとして扱う", () => {
        const data = [row("1111", { netIncome: 1 }), row("1111", { netIncome: 2 }, { submitDate: "2024-06-25T10:00:00" })];
        expect(screenFinancialSnapshots(data)[0].metrics.netIncome).toBe(2);
    });
    it("asOfで将来提出・将来決算期を除外、日付指定は当日提出を含む", () => {
        const data = [row("1111", { netIncome: 1 }, { submitDate: "2024-06-25 10:00:00" }), row("2222", { netIncome: 2 }, { submitDate: "2024-06-26" }), row("3333", {}, { periodEnd: "2025-03-31" })];
        expect(screenFinancialSnapshots(data, { asOf: "2024-06-25" }).map(r => r.secCode)).toEqual(["11110"]);
        expect(screenFinancialSnapshots(data, { asOf: "2024-06-25 09:00:00" })).toEqual([]);
    });
    it.each(["asc", "desc"] as const)("欠損は%sでも末尾、ゼロ・負数を保持、同値は証券コード順", order => {
        const data = [row("4444", {}), row("3333", { netIncome: 0 }), row("1111", { netIncome: 0 }), row("2222", { netIncome: -1 })];
        expect(screenFinancialSnapshots(data, { sortBy: "netIncome", order }).map(r => r.secCode)).toEqual(
            order === "asc" ? ["22220", "11110", "33330", "44440"] : ["11110", "33330", "22220", "44440"]);
    });
    it.each(["gte", "lte", "gt", "lt", "eq"] as const)("%sの閾値と欠損を扱う", operator => {
        const result = screenFinancialSnapshots([row("1111", { netIncome: 0 }), row("2222", {})], { conditions: [{ metric: "netIncome", operator, value: 0 }] });
        expect(result.length).toBe(operator === "gt" || operator === "lt" ? 0 : 1);
    });
    it("英字証券コードの4/5桁を正規化、年次と半期を混在させない", () => {
        const data = [row("123A", { netIncome: 1 }), row("123A0", { netIncome: 2 }, { docTypeCode: "160" })];
        expect(screenFinancialSnapshots(data, { secCodes: ["123A0"] })[0].metrics.netIncome).toBe(1);
        expect(screenFinancialSnapshots(data, { docTypeCode: "160", secCodes: ["123A"] })[0].metrics.netIncome).toBe(2);
    });
    it.each([
        { sortBy: "unknown" }, { order: "unknown" }, { limit: -1 }, { limit: 1.5 }, { offset: NaN },
        { asOf: "2024-02-30" }, { asOf: "2024-01-01 25:00:00" },
        { conditions: [{ metric: "netIncome", operator: "gte", value: Infinity }] },
        { conditions: [{ metric: "unknown", operator: "gte", value: 1 }] }
    ])("不正な検索条件を拒否: %j", options => {
        expect(() => screenFinancialSnapshots([], options as any)).toThrow();
    });
    it("数値文字列は拒否、JSON nullは欠損として扱い、入力を変更しない", () => {
        expect(() => screenFinancialSnapshots([row("1111", { netIncome: "100" } as any)])).toThrow();
        const input = [row("1111", { netIncome: null } as any)];
        const before = JSON.stringify(input);
        expect(screenFinancialSnapshots(input, { conditions: [{ metric: "netIncome", operator: "gte", value: 0 }] })).toEqual([]);
        const result = screenFinancialSnapshots(input);
        result[0].metrics.netIncome = 5;
        expect(JSON.stringify(input)).toBe(before);
    });
    it("保存済みNintendo/Softbank XBRLで、営業利益が欠ける連結企業を条件から除外", () => {
        const parser = new EdinetXbrlParser();
        const paths = [
            ["7974", "S100TMMG/XBRL/PublicDoc/jpcrp030000-asr-001_E02367-000_2024-03-31_01_2024-06-28.xbrl"],
            ["9984", "S100TP3N/XBRL/PublicDoc/jpcrp030000-asr-001_E02778-000_2024-03-31_01_2024-06-21.xbrl"]
        ];
        const data = paths.map(([code, file]) => {
            const extracted = parser.parse(readFileSync(resolve(__dirname, "test_data", file), "utf8")).getKeyMetricsWithSources();
            return row(code, extracted.metrics, { metricSources: extracted.metricSources });
        });
        const result = screenFinancialSnapshots(data, { conditions: [{ metric: "operatingMargin", operator: "gt", value: 0 }] });
        expect(result.map(r => r.secCode)).toEqual(["79740"]);
        expect(result[0].derivedMetrics.operatingMargin).toBeGreaterThan(0.3);
    });
});

describe("来歴と比較基準の安全性", () => {
    it("来歴なし・期間種別不明では派生値を出さず、raw値は保持", () => {
        expect(calculateFinancialMetrics({ netSales: 100, operatingIncome: 10 }).operatingMargin).toBeUndefined();
        for (const extra of [{ metricSources: undefined }, { periodType: undefined }]) {
            const result = screenFinancialSnapshots([row("1111", { netSales: 100, operatingIncome: 10 }, extra)])[0];
            expect(result.derivedMetrics.operatingMargin).toBeUndefined();
            expect(result.unavailableDerivedMetrics).toContain("operatingMargin");
            expect(result.metrics.operatingIncome).toBe(10);
        }
    });
    it.each([
        { periodStart: "2023-10-01" }, { periodEnd: "2023-12-31" }, { scope: "NonConsolidated" },
        { unit: "iso4217:USD" }, { unit: undefined }, { contextRef: "another" }
    ])("組合せの来歴が異なる時は営業利益率を出さない: %j", changed => {
        const metadata = { ...sources, operatingIncome: { ...source, ...changed } } as KeyMetricSources;
        expect(calculateFinancialMetrics({ netSales: 100, operatingIncome: 10 }, metadata).operatingMargin).toBeUndefined();
    });
    it("FCFの通貨・期間・scopeが異なる時も計算しない", () => {
        expect(calculateFinancialMetrics({ operatingCashFlow: 10, investingCashFlow: -1 }, {
            ...sources, investingCashFlow: { ...source, unit: "iso4217:USD" }
        }).freeCashFlow).toBeUndefined();
    });
    it("snapshot決算日と元factの期末が違う時は派生値を出さない", () => {
        expect(screenFinancialSnapshots([row("1111", { netSales: 100, operatingIncome: 10 }, { periodEnd: "2025-03-31" })])[0].derivedMetrics.operatingMargin).toBeUndefined();
    });
    it.each(["currency", "scope", "periodType"])("判明している異なる%sの混在を拒否", field => {
        const extra: Partial<FinancialSnapshot> = field === "periodType" ? { periodType: "ytd" } : {
            metricSources: { ...sources, netSales: { ...source, ...(field === "currency" ? { unit: "iso4217:USD" } : { scope: "NonConsolidated" }) } } as KeyMetricSources
        };
        expect(() => screenFinancialSnapshots([row("1111", { netSales: 100 }), row("2222", { netSales: 200 }, extra)], { sortBy: "netSales" })).toThrow();
    });
    it("同じperiodTypeでも半年と通年の期間長は混在させない", () => {
        const shorter = { ...sources, netSales: { ...source, periodStart: "2023-10-01" } };
        expect(() => screenFinancialSnapshots([
            row("1111", { netSales: 100 }), row("2222", { netSales: 50 }, { metricSources: shorter })
        ], { sortBy: "netSales" })).toThrow("期間長");
    });
    it("時刻cutoff当日の提出時刻不明は保守的に除外する", () => {
        const data = [row("1111", { netIncome: 1 })];
        expect(screenFinancialSnapshots(data, { asOf: "2024-06-25 09:00:00" })).toEqual([]);
        expect(screenFinancialSnapshots(data, { asOf: "2024-06-25" })).toHaveLength(1);
    });
    it("公開21指標とgetKeyMetricsの18項目が一致", () => {
        const extracted = new EdinetXbrlParser().parse("<xbrli:xbrl/>").getKeyMetrics();
        expect([...FINANCIAL_SCREENING_METRICS.slice(0, 18)].sort()).toEqual(Object.keys(extracted).sort());
    });
    it("単位参照の名前だけで通貨を推測せず、未知単位を未確定にする", () => {
        const xml = `<xbrli:xbrl xmlns:iso4217="http://www.xbrl.org/2003/iso4217">
          <xbrli:context id="CurrentYearDuration"><xbrli:period><xbrli:startDate>2023-04-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate></xbrli:period></xbrli:context>
          <xbrli:unit id="money"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>
          <jppfs_cor:NetSales contextRef="CurrentYearDuration" unitRef="money">100</jppfs_cor:NetSales>
          <jppfs_cor:OperatingIncome contextRef="CurrentYearDuration" unitRef="JPY">10</jppfs_cor:OperatingIncome>
        </xbrli:xbrl>`;
        const { metrics, metricSources } = new EdinetXbrlParser().parse(xml).getKeyMetricsWithSources();
        expect(metricSources.netSales?.unit).toBe("iso4217:USD");
        expect(metricSources.operatingIncome?.unit).toBeUndefined();
        expect(calculateFinancialMetrics(metrics, metricSources).operatingMargin).toBeUndefined();
        expect(metrics).toEqual(new EdinetXbrlParser().parse(xml).getKeyMetrics());
    });
});

describe("screen CLI", () => {
    it("ネットワークを使わずJSONを検索し、不正な条件では終了コード1", () => {
        const dir = mkdtempSync(join(tmpdir(), "edinet-screen-"));
        try {
            const file = join(dir, "snapshots.json");
            writeFileSync(file, JSON.stringify([row("1111", { netSales: 100, operatingIncome: 10 })]));
            const args = ["--import", "tsx", "src/cli.ts", "screen", "--file", file];
            const output = execFileSync(process.execPath, [...args, "--sort-by", "operatingMargin"], { encoding: "utf8" });
            expect(JSON.parse(output)[0].derivedMetrics.operatingMargin).toBe(0.1);
            const failure = spawnSync(process.execPath, [...args, "--conditions", '[{"metric":"invalid","operator":"gte","value":1}]'], { encoding: "utf8" });
            expect(failure.status).toBe(1);
            expect(failure.stdout).toBe("");
        } finally {
            rmSync(dir, { recursive: true, force: true });
        }
    });
});
