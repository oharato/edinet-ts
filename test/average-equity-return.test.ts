import { describe, it, expect } from "vitest";
import { calculateAverageEquityReturn, screenAverageEquityReturn, EdinetXbrlParser, type AverageEquityReturnInput } from "../src/index";
import { instance, fact } from "./fixtures/metric-boundaries";
function input(profit = "20", opening = "90", closing = "290", code = "1001", adjustment = "10"): AverageEquityReturnInput {
    const common = { secCode: code, docID: `SYNTHETIC${code}`, scope: "Consolidated" as const, accountingStandard: "J-GAAP" as const, currency: "JPY" as const };
    const c = (id: string, dates: string) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period>${dates}</xbrli:period></xbrli:context>`;
    const contexts = c("income", '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>') + c("opening", '<xbrli:instant>2024-03-31</xbrli:instant>') + c("closing", '<xbrli:instant>2025-03-31</xbrli:instant>');
    const xml = instance(fact(profit, "", "jppfs_cor:ProfitLossAttributableToOwnersOfParent", "income") +
        fact(opening, "", "jppfs_cor:ShareholdersEquity", "opening") + fact(closing, "", "jppfs_cor:ShareholdersEquity", "closing") +
        ["opening", "closing"].map(id => fact(adjustment, "", "jppfs_cor:ValuationAndTranslationAdjustments", id) +
            fact("999", "", "jppfs_cor:NetAssets", id) + fact("500", "", "jppfs_cor:NonControllingInterests", id)).join(""), contexts);
    return { income: { xml, metadata: { ...common, periodType: "annual", period: { startDate: "2024-04-01", endDate: "2025-03-31" } } },
        opening: { xml, metadata: { ...common, period: { instant: "2024-03-31" } } }, closing: { xml, metadata: { ...common, period: { instant: "2025-03-31" } } } };
}
describe("掲載値とは別の計算ROE", () => {
    it("株主資本+評価換算差額等の平均を使い、純資産/非支配持分を代入しない", () => {
        expect(calculateAverageEquityReturn(input())).toMatchObject({ metricId: "netIncomeToAverageEquity", status: "calculated", value: 0.1,
            exact: { numerator: "1", denominator: "10" }, openingEquity: { numerator: "100", denominator: "1" }, closingEquity: { numerator: "300", denominator: "1" } });
    });
    it("負の評価差額・赤字・利益0を保持し、平均自己資本が非正なら計算しない", () => {
        expect(calculateAverageEquityReturn(input("-20", "110", "310", "1001", "-10"))).toMatchObject({ value: -0.1 });
        expect(calculateAverageEquityReturn(input("0"))).toMatchObject({ value: 0 });
        expect(calculateAverageEquityReturn(input("20", "-110", "90"))).toMatchObject({ reason: "nonpositive-average-equity" });
        expect(calculateAverageEquityReturn(input("20", "-110", "290"))).toMatchObject({ status: "calculated" });
    });
    it("計算ROEの利益は完全一致重複だけを明示採用し、既定selectMetricは維持", () => {
        const data = input(), duplicate = fact("20", "", "jppfs_cor:ProfitLossAttributableToOwnersOfParent", "income");
        data.income.xml = data.income.xml.replace('</xbrli:xbrl>', duplicate + '</xbrli:xbrl>');
        expect(calculateAverageEquityReturn(data)).toMatchObject({ status: "calculated", income: { selection: { reason: "selected-identical-duplicates" } } });
        const object = new EdinetXbrlParser().parse(data.income.xml, "synthetic");
        expect(object.selectMetric("netIncome", data.income.metadata)).toMatchObject({ status: "ambiguous" });
        expect(object.selectMetric("netIncome", data.income.metadata, { collapseIdenticalDuplicates: false })).toMatchObject({ status: "ambiguous" });
        data.income.xml = data.income.xml.replace(duplicate, duplicate.replace('>20<', '>21<'));
        expect(calculateAverageEquityReturn(data)).toMatchObject({ status: "unavailable", reason: "unavailable-input" });
    });
    it("不正な重複採用設定を拒否し、getterを一度だけ読む", () => {
        const data = input(), object = new EdinetXbrlParser().parse(data.income.xml, "synthetic");
        expect(() => object.selectMetric("netIncome", data.income.metadata, { collapseIdenticalDuplicates: "false" } as any)).toThrow();
        let calls = 0; object.selectMetric("netIncome", data.income.metadata, { get collapseIdenticalDuplicates() { calls++; return true; } }); expect(calls).toBe(1);
    });
    it.each(["missing", "unsafe", "entity", "date", "scope", "company", "standard", "quarter", "short", "duplicate-component"])("%sを別原値や期末だけで補完しない", kind => {
        const data: any = input();
        if (kind === "missing") data.opening.xml = data.opening.xml.replaceAll('jppfs_cor:ValuationAndTranslationAdjustments', 'jppfs_cor:Other');
        if (kind === "unsafe") data.opening = input("20", "9007199254740993").opening;
        if (kind === "entity") data.opening.xml = data.opening.xml.replaceAll('scheme="synthetic">1001', 'scheme="synthetic">OTHER');
        if (kind === "date") data.opening.metadata.period.instant = "2024-04-01";
        if (kind === "scope") data.opening.metadata.scope = "NonConsolidated";
        if (kind === "company") data.closing.metadata.secCode = "1002";
        if (kind === "standard") data.closing.metadata.accountingStandard = "IFRS";
        if (kind === "quarter") data.income.metadata.periodType = "quarterly";
        if (kind === "short") data.income.metadata.period.startDate = "2024-10-01";
        if (kind === "duplicate-component") data.opening.xml = data.opening.xml.replace('</xbrli:xbrl>', fact("90", "", "jppfs_cor:ShareholdersEquity", "opening") + '</xbrli:xbrl>');
        expect(calculateAverageEquityReturn(data).status).toBe("unavailable");
    });
    it.each([["gt", ["10020"]], ["gte", ["10020", "10010"]], ["lt", ["10030"]], ["lte", ["10010", "10030"]], ["eq", ["10010"]]] as const)("%sを厳密分数で比較", (operator, codes) => {
        const inputs = [input(), input("30", "90", "290", "1002"), input("0", "90", "290", "1003")];
        expect(screenAverageEquityReturn(inputs, { conditions: [{ operator, value: 0.1 }] }).rows.map(r => r.income.metadata.secCode)).toEqual(codes);
        expect(screenAverageEquityReturn(inputs, { order: "asc", offset: 1, limit: 1 }).rows[0].income.metadata.secCode).toBe("10010");
    });
    it("条件で重複会社を隠さず、空集合でも不正設定を拒否", () => {
        expect(() => screenAverageEquityReturn([input(), input()], { conditions: [{ operator: "gt", value: 999 }] })).toThrow();
        expect(() => screenAverageEquityReturn([], { limit: -1 })).toThrow();
        expect(() => screenAverageEquityReturn([], { conditions: [{ operator: "eq", value: NaN }] })).toThrow();
    });
});
