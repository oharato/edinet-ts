import { describe, expect, it } from "vitest";
import { FinancialStore } from "../src/db/store";
import type { CompanyFinancialComparison } from "../src/types";

describe("FinancialStore with DuckDB", () => {
  it("利益率成長率20%以上、営業利益率降順のスクリーニングが正しく動作すること", async () => {
    const store = new FinancialStore(":memory:");
    await store.init();

    // 企業A: 営業利益率 10% -> 15% (成長率 +50%)
    const companyA: CompanyFinancialComparison = {
      metadata: {
        edinetCode: "E00001",
        securityCode: "1001",
        companyName: "成長企業A",
        periodEnd: "2024-03-31",
      },
      current: { netSales: 10000, operatingIncome: 1500, isConsolidated: true },
      prior: { netSales: 10000, operatingIncome: 1000, isConsolidated: true },
      operatingMarginCurrent: 0.15,
      operatingMarginPrior: 0.10,
      operatingMarginGrowthRate: 0.50,
      salesGrowthRate: 0.0,
      operatingIncomeGrowthRate: 0.50,
    };

    // 企業B: 営業利益率 20% -> 25% (成長率 +25%)
    const companyB: CompanyFinancialComparison = {
      metadata: {
        edinetCode: "E00002",
        securityCode: "1002",
        companyName: "高収益企業B",
        periodEnd: "2024-03-31",
      },
      current: { netSales: 20000, operatingIncome: 5000, isConsolidated: true },
      prior: { netSales: 20000, operatingIncome: 4000, isConsolidated: true },
      operatingMarginCurrent: 0.25,
      operatingMarginPrior: 0.20,
      operatingMarginGrowthRate: 0.25,
      salesGrowthRate: 0.0,
      operatingIncomeGrowthRate: 0.25,
    };

    // 企業C: 営業利益率 30% -> 31% (成長率 +3.3%, 20%未満)
    const companyC: CompanyFinancialComparison = {
      metadata: {
        edinetCode: "E00003",
        securityCode: "1003",
        companyName: "安定企業C",
        periodEnd: "2024-03-31",
      },
      current: { netSales: 30000, operatingIncome: 9300, isConsolidated: true },
      prior: { netSales: 30000, operatingIncome: 9000, isConsolidated: true },
      operatingMarginCurrent: 0.31,
      operatingMarginPrior: 0.30,
      operatingMarginGrowthRate: 0.033,
      salesGrowthRate: 0.0,
      operatingIncomeGrowthRate: 0.033,
    };

    await store.insert(companyA);
    await store.insert(companyB);
    await store.insert(companyC);

    // スクリーニング: 利益率成長率 >= 20% (0.20)、当期利益率順(DESC)
    const results = await store.screen({
      minMarginGrowth: 0.20,
      orderBy: "current_margin",
      orderDirection: "desc",
    });

    // 企業C(3.3%)は除外され、企業B(25%利益率)と企業A(15%利益率)がこの順で返る
    expect(results).toHaveLength(2);
    expect(results[0].companyName).toBe("高収益企業B");
    expect(results[0].operatingMarginCurrent).toBe(0.25);
    expect(results[0].operatingMarginGrowthRate).toBe(0.25);

    expect(results[1].companyName).toBe("成長企業A");
    expect(results[1].operatingMarginCurrent).toBe(0.15);
    expect(results[1].operatingMarginGrowthRate).toBe(0.50);

    await store.close();
  });
});
