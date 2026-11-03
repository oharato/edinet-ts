import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { XbrlParser } from "../src/xbrl/parser";
import { FinancialExtractor } from "../src/financial/extractor";

describe("FinancialExtractor & XbrlParser", () => {
  const parser = new XbrlParser();
  const extractor = new FinancialExtractor();

  it("J-GAAP カカクコムの当期・前期財務データと利益率が正しく抽出されること", () => {
    const xbrlPath = resolve(__dirname, "test_data/CJ_2371_kakakucom.xbrl");
    const xml = readFileSync(xbrlPath, "utf8");

    const doc = parser.parse(xml);
    const result = extractor.extract(doc);

    expect(result.metadata.companyName).toBe("株式会社カカクコム");
    expect(result.metadata.securityCode).toBe("2371");
    expect(result.metadata.periodEnd).toBe("2017-03-31");

    // 当期 (2017-03-31期)
    expect(result.current.netSales).toBe(45089432000);
    expect(result.current.operatingIncome).toBe(21161251000);
    expect(result.current.isConsolidated).toBe(true);

    // 前期 (2016-03-31期)
    expect(result.prior.netSales).toBe(41275187000);
    expect(result.prior.operatingIncome).toBe(19534956000);

    // 営業利益率
    // 当期: 21161251000 / 45089432000 ≈ 0.4693
    // 前期: 19534956000 / 41275187000 ≈ 0.4733
    expect(result.operatingMarginCurrent).toBeCloseTo(0.4693, 3);
    expect(result.operatingMarginPrior).toBeCloseTo(0.4733, 3);

    // 売上成長率: (45089432000 - 41275187000) / 41275187000 ≈ 0.0924 (9.24%)
    expect(result.salesGrowthRate).toBeCloseTo(0.0924, 3);
  });

  it("IFRS ヤフーの当期・前期財務データと利益率が正しく抽出されること", () => {
    const xbrlPath = resolve(__dirname, "test_data/CI_4689_yahoo.xbrl");
    const xml = readFileSync(xbrlPath, "utf8");

    const doc = parser.parse(xml);
    const result = extractor.extract(doc);

    expect(result.metadata.companyName).toBe("ヤフー株式会社");

    // ヤフーの売上 (Revenue)
    // 当期: 853730000000
    // 前期: 652327000000
    expect(result.current.netSales).toBe(853730000000);
    expect(result.prior.netSales).toBe(652327000000);

    // ヤフーの営業利益 (OperatingProfit)
    // 当期: 192049000000
    // 前期: 224997000000
    expect(result.current.operatingIncome).toBe(192049000000);
    expect(result.prior.operatingIncome).toBe(224997000000);

    // 営業利益率
    expect(result.operatingMarginCurrent).toBeCloseTo(192049000000 / 853730000000, 3);
    expect(result.operatingMarginPrior).toBeCloseTo(224997000000 / 652327000000, 3);
  });
});
