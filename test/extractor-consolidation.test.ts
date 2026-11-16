import { describe, expect, it } from "vitest";
import { FinancialExtractor } from "../src/financial/extractor";
import type { ParsedContext, ParsedFact, ParsedXbrlDocument } from "../src/xbrl/parser";

/**
 * 実データの構造を再現した最小限の ParsedXbrlDocument を作る。
 * XBRL 全体を固定する代わりに、抽出ロジックが参照する Fact / DEI / Context だけを渡す。
 */
function makeDoc(options: {
  dei: Record<string, string>;
  facts: Array<{ name: string; contextRef: string; value: number }>;
  contexts?: ParsedContext[];
}): ParsedXbrlDocument {
  const facts: ParsedFact[] = options.facts.map((fact) => ({
    name: fact.name,
    qname: `test:${fact.name}`,
    contextRef: fact.contextRef,
    value: String(fact.value),
    numericValue: fact.value,
    unitRef: "JPY",
  }));

  return {
    facts,
    contexts: new Map((options.contexts ?? []).map((context) => [context.id, context])),
    dei: new Map(Object.entries(options.dei)),
  };
}

const FY = {
  TypeOfCurrentPeriodDEI: "FY",
  WhetherConsolidatedFinancialStatementsArePreparedDEI: "true",
  FilerNameInJapaneseDEI: "テスト株式会社",
  SecurityCodeDEI: "99990",
  CurrentPeriodEndDateDEI: "2026-03-31",
};

describe("FinancialExtractor の連結・IFRS 判定", () => {
  const extractor = new FinancialExtractor();

  it("IFRS の連結売上・営業利益（NetSalesIFRS / OperatingProfitLossIFRS）を抽出する", () => {
    const doc = makeDoc({
      dei: FY,
      facts: [
        { name: "NetSalesIFRS", contextRef: "CurrentYearDuration", value: 12_479_620_000_000 },
        {
          name: "OperatingProfitLossIFRS",
          contextRef: "CurrentYearDuration",
          value: 1_447_507_000_000,
        },
        { name: "NetSalesIFRS", contextRef: "Prior1YearDuration", value: 12_034_917_000_000 },
        {
          name: "OperatingProfitLossIFRS",
          contextRef: "Prior1YearDuration",
          value: 1_276_635_000_000,
        },
      ],
    });

    const result = extractor.extract(doc);

    expect(result.current.isConsolidated).toBe(true);
    expect(result.current.netSales).toBe(12_479_620_000_000);
    expect(result.current.operatingIncome).toBe(1_447_507_000_000);
    expect(result.operatingMarginCurrent).toBeCloseTo(0.11599, 4);
    expect(result.operatingMarginPrior).toBeCloseTo(0.10608, 4);
    expect(result.operatingMarginGrowthRate).toBeCloseTo(0.09344, 4);
  });

  it("連結財務諸表を作成している企業では、連結タグが見つからなくても単体値にフォールバックしない", () => {
    const doc = makeDoc({
      dei: FY,
      facts: [
        {
          name: "NetSales",
          contextRef: "CurrentYearDuration_NonConsolidatedMember",
          value: 164_460_000_000,
        },
        {
          name: "OperatingIncome",
          contextRef: "CurrentYearDuration_NonConsolidatedMember",
          value: 626_673_000_000,
        },
        {
          name: "NetSales",
          contextRef: "Prior1YearDuration_NonConsolidatedMember",
          value: 173_940_000_000,
        },
        {
          name: "OperatingIncome",
          contextRef: "Prior1YearDuration_NonConsolidatedMember",
          value: 320_175_000_000,
        },
      ],
    });

    const result = extractor.extract(doc);

    // 親会社単体の 1,644 億円 / 6,266 億円（利益率 381%）を連結値として採用しない。
    expect(result.current.isConsolidated).toBe(true);
    expect(result.current.netSales).toBeUndefined();
    expect(result.current.operatingIncome).toBeUndefined();
    expect(result.operatingMarginCurrent).toBeUndefined();
  });

  it("連結財務諸表を作成していない企業（DEI=false）は単体値を採用する", () => {
    const doc = makeDoc({
      dei: { ...FY, WhetherConsolidatedFinancialStatementsArePreparedDEI: "false" },
      facts: [
        {
          name: "NetSales",
          contextRef: "CurrentYearDuration_NonConsolidatedMember",
          value: 7_162_872_000,
        },
        {
          name: "OperatingIncome",
          contextRef: "CurrentYearDuration_NonConsolidatedMember",
          value: 103_118_000,
        },
      ],
    });

    const result = extractor.extract(doc);

    expect(result.current.isConsolidated).toBe(false);
    expect(result.current.netSales).toBe(7_162_872_000);
    expect(result.current.operatingIncome).toBe(103_118_000);
  });

  it("半期報告書（HY）は InterimDuration / Prior1InterimDuration を使う", () => {
    const doc = makeDoc({
      dei: {
        ...FY,
        TypeOfCurrentPeriodDEI: "HY",
        CurrentPeriodEndDateDEI: "2026-09-30",
      },
      facts: [
        {
          name: "NetSalesSummaryOfBusinessResults",
          contextRef: "InterimDuration",
          value: 6_267_217_000_000,
        },
        {
          name: "OperatingProfitLossIFRS",
          contextRef: "InterimDuration",
          value: 1_098_828_000_000,
        },
        {
          name: "NetSalesSummaryOfBusinessResults",
          contextRef: "Prior1InterimDuration",
          value: 5_729_522_000_000,
        },
        {
          name: "OperatingProfitLossIFRS",
          contextRef: "Prior1InterimDuration",
          value: 768_929_000_000,
        },
      ],
    });

    const result = extractor.extract(doc);

    expect(result.metadata.periodType).toBe("HY");
    expect(result.current.netSales).toBe(6_267_217_000_000);
    expect(result.current.operatingIncome).toBe(1_098_828_000_000);
    expect(result.prior.netSales).toBe(5_729_522_000_000);
    expect(result.prior.operatingIncome).toBe(768_929_000_000);
    expect(result.operatingMarginCurrent).toBeCloseTo(0.17533, 4);
  });

  it("OperatingProfitIFRS と OperatingProfitLossIFRS が併存する場合は Loss 側を優先する", () => {
    const doc = makeDoc({
      dei: FY,
      facts: [
        { name: "NetSalesIFRS", contextRef: "CurrentYearDuration", value: 20_313_000_000 },
        // 一部の開示では OperatingProfitIFRS に営業収益合計が入っている。
        { name: "OperatingProfitIFRS", contextRef: "CurrentYearDuration", value: 20_844_000_000 },
        { name: "OperatingProfitLossIFRS", contextRef: "CurrentYearDuration", value: -627_000_000 },
      ],
    });

    const result = extractor.extract(doc);

    expect(result.current.operatingIncome).toBe(-627_000_000);
    expect(result.operatingMarginCurrent).toBeCloseTo(-0.03087, 4);
  });
});
