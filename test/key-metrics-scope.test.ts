import { describe, expect, it } from "vitest";
import { EdinetContext } from "../src/edinet-context";
import { EdinetData, EdinetXbrlObject, KeyMetrics } from "../src/edinet-xbrl-object";

type PeriodType = "Duration" | "Instant";
type MetricCase = [keyof KeyMetrics, PeriodType, string];

const strictMetrics: MetricCase[] = [
    ["netSales", "Duration", "jppfs_cor:NetSales"],
    ["operatingIncome", "Duration", "jppfs_cor:OperatingIncome"],
    ["ordinaryIncome", "Duration", "jppfs_cor:OrdinaryIncome"],
    ["netIncome", "Duration", "jppfs_cor:ProfitLossAttributableToOwnersOfParent"],
    ["netAssets", "Instant", "jppfs_cor:NetAssets"],
    ["totalAssets", "Instant", "jppfs_cor:Assets"],
    ["operatingCashFlow", "Duration", "jppfs_cor:NetCashProvidedByUsedInOperatingActivities"],
    ["investingCashFlow", "Duration", "jppfs_cor:NetCashProvidedByUsedInInvestmentActivities"],
    ["financingCashFlow", "Duration", "jppfs_cor:NetCashProvidedByUsedInFinancingActivities"],
    ["cashAndEquivalents", "Instant", "jppfs_cor:CashAndCashEquivalents"]
];

const compatibleMetrics: MetricCase[] = [
    ["earningsPerShare", "Duration", "jppfs_cor:BasicEarningsLossPerShare"],
    ["bookValuePerShare", "Instant", "jppfs_cor:NetAssetsPerShare"],
    ["equityToTotalAssetsRatio", "Instant", "jpcrp_cor:EquityToAssetRatioSummaryOfBusinessResults"],
    ["rateOfReturnOnEquity", "Duration", "jpcrp_cor:RateOfReturnOnEquitySummaryOfBusinessResults"],
    ["priceEarningsRatio", "Duration", "jpcrp_cor:PriceEarningsRatioSummaryOfBusinessResults"],
    ["payoutRatio", "Duration", "jpcrp_cor:PayoutRatioSummaryOfBusinessResults"],
    ["numberOfIssuedShares", "Instant", "jpcrp_cor:TotalNumberOfIssuedSharesSummaryOfBusinessResults"],
    ["dividendPaidPerShare", "Duration", "jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults"]
];

const alternativeMetrics: MetricCase[] = [
    ["netSales", "Duration", "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults"],
    ["operatingIncome", "Duration", "jpcrp_cor:OperatingIncomeIFRSSummaryOfBusinessResults"],
    ["netIncome", "Duration", "jpcrp_cor:ProfitLossAttributableToOwnersOfParentIFRSSummaryOfBusinessResults"],
    ["netAssets", "Instant", "jpcrp_cor:EquityAttributableToOwnersOfParentIFRSSummaryOfBusinessResults"],
    ["totalAssets", "Instant", "jpcrp_cor:TotalAssetsIFRSSummaryOfBusinessResults"],
    ["operatingCashFlow", "Duration", "jpcrp_cor:CashFlowsFromUsedInOperatingActivitiesIFRSSummaryOfBusinessResults"],
    ["investingCashFlow", "Duration", "jpcrp_cor:CashFlowsFromUsedInInvestingActivitiesIFRSSummaryOfBusinessResults"],
    ["investingCashFlow", "Duration", "jppfs_cor:NetCashProvidedByUsedInInvestingActivities"],
    ["financingCashFlow", "Duration", "jpcrp_cor:CashFlowsFromUsedInFinancingActivitiesIFRSSummaryOfBusinessResults"],
    ["cashAndEquivalents", "Instant", "jpcrp_cor:CashAndCashEquivalentsIFRSSummaryOfBusinessResults"],
    ["cashAndEquivalents", "Instant", "jppfs_cor:CashAndCashEquivalentsEndOfPeriod"]
];

function context(id: string, type: PeriodType, scope: EdinetContext["scope"], date = "2024-03-31"): EdinetContext {
    return {
        id,
        period: type === "Duration" ? { startDate: "2023-04-01", endDate: date } : { instant: date },
        scope,
        dimensions: scope === "Consolidated" ? [] : ["NonConsolidatedMember"]
    };
}

function put(object: EdinetXbrlObject, key: string, id: string, value = "500"): void {
    object.put(key, new EdinetData(key, value, 0, "JPY", id));
}

describe("getKeyMetrics の連結・単体の探索範囲", () => {
    it.each(strictMetrics)("%s: 連結にタグがなくても単体・固定IDへ移らない", (metric, type, key) => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated", type, "Consolidated"));
        object.addContext(context("standalone", type, "NonConsolidated"));
        put(object, key, "standalone");
        put(object, key, `CurrentYear${type}_NonConsolidatedMember`, "700");
        expect(object.getKeyMetrics()[metric]).toBeUndefined();
    });

    it.each(strictMetrics)("%s: 連結の定義がなければ単体値を返す", (metric, type, key) => {
        const object = new EdinetXbrlObject();
        object.addContext(context("standalone", type, "NonConsolidated"));
        put(object, key, "standalone");
        expect(object.getKeyMetrics()[metric]).toBe(500);
    });

    it.each(strictMetrics)("%s: 連結のゼロを欠落扱いしない", (metric, type, key) => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated", type, "Consolidated"));
        object.addContext(context("standalone", type, "NonConsolidated"));
        put(object, key, "consolidated", "0");
        put(object, key, "standalone");
        expect(object.getKeyMetrics()[metric]).toBe(0);
    });

    it.each(alternativeMetrics)("%s: 同じ連結範囲内の代替タグ %s / %s を取得する", (metric, type, key) => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated", type, "Consolidated"));
        object.addContext(context("standalone", type, "NonConsolidated"));
        put(object, key, "consolidated", "-123.5");
        put(object, key, "standalone");
        expect(object.getKeyMetrics()[metric]).toBe(-123.5);
    });

    it.each(compatibleMetrics)("%s: 単体への互換フォールバックを維持する", (metric, type, key) => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated", type, "Consolidated"));
        object.addContext(context("standalone", type, "NonConsolidated"));
        put(object, key, "standalone");
        expect(object.getKeyMetrics()[metric]).toBe(500);
        put(object, key, "consolidated", "0");
        expect(object.getKeyMetrics()[metric]).toBe(0);
    });

    it.each(compatibleMetrics)("%s: 定義済み連結があっても単体の固定IDを探索する", (metric, type, key) => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated", type, "Consolidated"));
        put(object, key, `CurrentYear${type}_NonConsolidatedMember`);
        expect(object.getKeyMetrics()[metric]).toBe(500);
    });

    it.each(["Duration", "Instant"] as const)("%s: 同じ範囲の候補は最新から順に探す", type => {
        const object = new EdinetXbrlObject();
        const key = type === "Duration" ? "jppfs_cor:NetSales" : "jppfs_cor:Assets";
        const metric = type === "Duration" ? "netSales" : "totalAssets";
        object.addContext(context("older", type, "Consolidated", "2024-03-30"));
        object.addContext(context("latest", type, "Consolidated"));
        object.addContext(context("standalone", type, "NonConsolidated"));
        put(object, key, "latest", "NaN");
        put(object, key, "older", "123");
        put(object, key, "standalone");
        expect(object.getKeyMetrics()[metric]).toBe(123);
    });

    it.each(["", "NaN"])("連結の値が %j でも単体へ移らず、同じ範囲の代替タグは使う", value => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated", "Duration", "Consolidated"));
        object.addContext(context("standalone", "Duration", "NonConsolidated"));
        put(object, "jppfs_cor:NetSales", "consolidated", value);
        put(object, "jppfs_cor:NetSales", "standalone");
        expect(object.getKeyMetrics().netSales).toBeUndefined();
        put(object, "jpcrp_cor:RevenueIFRSSummaryOfBusinessResults", "consolidated", "123");
        expect(object.getKeyMetrics().netSales).toBe(123);
    });

    it.each(["Duration", "Instant"] as const)("%s: 180日以上古い固定IDを再採用しない", type => {
        const object = new EdinetXbrlObject();
        const key = type === "Duration" ? "jppfs_cor:NetSales" : "jppfs_cor:Assets";
        const metric = type === "Duration" ? "netSales" : "totalAssets";
        object.addContext(context("latest", type, "Consolidated", "2024-09-27"));
        object.addContext(context(`CurrentYear${type}`, type, "Consolidated", "2024-03-31"));
        object.addContext(context("standalone", type, "NonConsolidated", "2024-09-27"));
        put(object, key, `CurrentYear${type}`, "123");
        put(object, key, "standalone");
        expect(object.getKeyMetrics()[metric]).toBeUndefined();
    });

    it("期間と時点の連結存在判定は独立している", () => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated-duration", "Duration", "Consolidated"));
        object.addContext(context("standalone-duration", "Duration", "NonConsolidated"));
        object.addContext(context("standalone-instant", "Instant", "NonConsolidated"));
        put(object, "jppfs_cor:NetSales", "standalone-duration");
        put(object, "jppfs_cor:Assets", "standalone-instant");
        expect(object.getKeyMetrics().netSales).toBeUndefined();
        expect(object.getKeyMetrics().totalAssets).toBe(500);
    });

    it("提出日メタデータだけなら単体の時点指標を妨げない", () => {
        const object = new EdinetXbrlObject();
        object.addContext(context("FilingDateInstant", "Instant", "Consolidated", "2024-06-30"));
        object.addContext(context("standalone", "Instant", "NonConsolidated"));
        put(object, "jpdei_cor:FilerNameInJapaneseDEI", "FilingDateInstant", "企業名");
        put(object, "jppfs_cor:Assets", "standalone");
        expect(object.getKeyMetrics().totalAssets).toBe(500);
        expect(object.findContexts({ type: "Instant", scope: "Consolidated" })).toHaveLength(1);
    });

    it("連結コンテキストの日付が不正でも単体へ切り替えない", () => {
        const object = new EdinetXbrlObject();
        object.addContext(context("consolidated", "Duration", "Consolidated", "invalid"));
        object.addContext(context("standalone", "Duration", "NonConsolidated"));
        put(object, "jppfs_cor:NetSales", "standalone");
        expect(object.getKeyMetrics().netSales).toBeUndefined();
    });

    it.each(["Duration", "Instant"] as const)("%s: セグメントを連結全体とみなさず、固定IDでも復活させない", type => {
        const object = new EdinetXbrlObject();
        const key = type === "Duration" ? "jppfs_cor:NetSales" : "jppfs_cor:Assets";
        const metric = type === "Duration" ? "netSales" : "totalAssets";
        const segment = context(`CurrentYear${type}`, type, "Consolidated");
        segment.dimensions = ["SomeSegmentMember"];
        object.addContext(segment);
        put(object, key, segment.id, "999");
        expect(object.getKeyMetrics()[metric]).toBeUndefined();
        object.addContext(context("standalone", type, "NonConsolidated"));
        put(object, key, "standalone");
        expect(object.getKeyMetrics()[metric]).toBe(500);
    });

    it.each(strictMetrics)("%s: 定義なしの固定IDでも連結の実データがあれば範囲を固定する", (metric, type, key) => {
        const object = new EdinetXbrlObject();
        put(object, key, `CurrentYear${type}_NonConsolidatedMember`);
        expect(object.getKeyMetrics()[metric]).toBe(500);
        put(object, "company:OtherFinancialFact", `CurrentYear${type}`, "1");
        expect(object.getKeyMetrics()[metric]).toBeUndefined();
        put(object, key, `CurrentYear${type}`, "0");
        expect(object.getKeyMetrics()[metric]).toBe(0);
    });

    it("データがなければすべての指標が undefined になる", () => {
        expect(Object.values(new EdinetXbrlObject().getKeyMetrics()).every(value => value === undefined)).toBe(true);
    });
});
