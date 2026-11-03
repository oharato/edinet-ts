import { describe, expect, it } from "vitest";
import { EdinetXbrlParser } from "../src/core/parser/parse-xbrl";
import {
  METRIC_REGISTRY,
  METRIC_REGISTRY_VERSION,
  type MetricId,
} from "../src/domain/financial/extraction/metric-definitions";
import { context, fact, instance, period, standalone } from "./fixtures/metric-boundaries";
const definitions = [
  ["netSales", "Revenues", "duration"],
  ["operatingIncome", "OperatingIncomeLoss", "duration"],
  ["netAssets", "EquityIncludingPortionAttributableToNonControllingInterest", "instant"],
  ["totalAssets", "TotalAssets", "instant"],
  ["operatingCashFlow", "CashFlowsFromUsedInOperatingActivities", "duration"],
  ["investingCashFlow", "CashFlowsFromUsedInInvestingActivities", "duration"],
  ["financingCashFlow", "CashFlowsFromUsedInFinancingActivities", "duration"],
  ["cashAndEquivalents", "CashAndCashEquivalents", "instant"],
] as const;
const instantContext = context().replace(
  /<xbrli:startDate>.*?<\/xbrli:endDate>/,
  "<xbrli:instant>2025-03-31</xbrli:instant>",
);
const parse = (xml: string) => new EdinetXbrlParser().parse(xml);
describe("US-GAAPの意味が一致する要約指標だけを明示選択する", () => {
  it("nil・複数通貨・異なる精度のfactを補完や換算で採用しない", () => {
    const key = "jpcrp_cor:RevenuesUSGAAPSummaryOfBusinessResults";
    const opts = { accountingStandard: "US-GAAP", scope: "Consolidated", period } as const;
    expect(
      parse(instance(fact("", 'xsi:nil="true"', key))).selectMetric("netSales", opts),
    ).toMatchObject({ status: "missing", reason: "nil" });
    const extraUnit =
      '<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>';
    const both = instance(
      fact("5", "", key) + fact("7", "", key).replace('unitRef="money"', 'unitRef="usd"'),
    ).replace("</xbrli:xbrl>", extraUnit + "</xbrli:xbrl>");
    expect(parse(both).selectMetric("netSales", opts)).toMatchObject({
      status: "ambiguous",
      reason: "multiple-facts",
    });
    expect(
      parse(
        instance(
          fact("5", "", key) + fact("5", "", key).replace('decimals="INF"', 'decimals="-6"'),
        ),
      ).selectMetric("netSales", opts),
    ).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
    expect(
      parse(
        instance(fact("5", "", key)).replace('decimals="INF"', 'decimals="invalid"'),
      ).selectMetric("netSales", opts),
    ).toMatchObject({ status: "unsupported", reason: "invalid-decimals" });
  });

  it("追加8候補をUS基準として版2に固定する", () => {
    expect(METRIC_REGISTRY_VERSION).toBe("2");
    expect(
      Object.values(METRIC_REGISTRY).flatMap((d) =>
        d.candidates.filter((c) => c.standard === "US-GAAP"),
      ),
    ).toHaveLength(8);
  });
  it.each(definitions)("%sは実期間・範囲・円unitと原精度を保持する", (id, local, type) => {
    const key = `jpcrp_cor:${local}USGAAPSummaryOfBusinessResults`;
    const ctx = type === "instant" ? instantContext : context();
    const target = type === "instant" ? { instant: "2025-03-31" } : period;
    const doc = parse(instance(fact("9007199254740993", "", key), ctx));
    const result = doc.selectMetric(id, {
      accountingStandard: "US-GAAP",
      scope: "Consolidated",
      period: target,
    });
    expect(result).toMatchObject({
      status: "selected",
      raw: "9007199254740993",
      reason: "selected-raw-only",
      source: { key, unit: "iso4217:JPY", decimals: "INF", period: target, scope: "Consolidated" },
    });
    expect(result.safeNumber).toBeUndefined();
    expect(
      doc.selectMetric(id, { accountingStandard: "J-GAAP", scope: "Consolidated", period: target })
        .status,
    ).not.toBe("selected");
    expect(
      doc.selectMetric(id, { accountingStandard: "IFRS", scope: "Consolidated", period: target })
        .status,
    ).not.toBe("selected");
    expect(
      doc.selectMetric(id, {
        accountingStandard: "US-GAAP",
        scope: "NonConsolidated",
        period: target,
      }),
    ).toMatchObject({ status: "missing", reason: "context-mismatch" });
    expect(
      doc.selectMetric(id, {
        accountingStandard: "US-GAAP",
        scope: "Consolidated",
        period:
          type === "instant"
            ? { instant: "2024-03-31" }
            : { startDate: "2023-04-01", endDate: "2024-03-31" },
      }),
    ).toMatchObject({ status: "missing", reason: "context-mismatch" });
    const usd = parse(
      instance(fact("5", "", key), ctx).replace(
        "<xbrli:measure>iso4217:JPY</xbrli:measure>",
        "<xbrli:measure>iso4217:USD</xbrli:measure>",
      ),
    );
    expect(
      usd.selectMetric(id, {
        accountingStandard: "US-GAAP",
        scope: "Consolidated",
        period: target,
      }),
    ).toMatchObject({ status: "unsupported", reason: "unsupported-unit" });
  });
  it("単体のJ-GAAPやUS親会社持分を純資産に読み替えない", () => {
    const doc = parse(
      instance(
        fact("1", "", "jppfs_cor:NetAssets") +
          fact(
            "2",
            "",
            "jpcrp_cor:EquityAttributableToOwnersOfParentUSGAAPSummaryOfBusinessResults",
          ),
        instantContext,
      ),
    );
    expect(
      doc.selectMetric("netAssets", {
        accountingStandard: "US-GAAP",
        scope: "Consolidated",
        period: { instant: "2025-03-31" },
      }),
    ).toMatchObject({ status: "missing", reason: "tag-absent" });
    const stand = parse(
      instance(
        fact("8", "", "jpcrp_cor:RevenuesUSGAAPSummaryOfBusinessResults"),
        context("current", standalone),
      ),
    );
    expect(
      stand.selectMetric("netSales", {
        accountingStandard: "US-GAAP",
        scope: "Consolidated",
        period,
      }),
    ).toMatchObject({ status: "missing", reason: "context-mismatch" });
  });
  it.each(["netIncome", "ordinaryIncome", "bookValuePerShare", "earningsPerShare"] as MetricId[])(
    "%sは未対応を維持する",
    (id) => {
      const doc = parse(
        instance(
          fact(
            "7",
            "",
            "jpcrp_cor:NetIncomeLossAttributableToOwnersOfParentUSGAAPSummaryOfBusinessResults",
          ),
        ),
      );
      expect(
        doc.selectMetric(id, {
          accountingStandard: "US-GAAP",
          scope: "Consolidated",
          period: id === "bookValuePerShare" ? { instant: "2025-03-31" } : period,
        }),
      ).toMatchObject({ status: "unsupported", reason: "unsupported-standard" });
    },
  );
});
