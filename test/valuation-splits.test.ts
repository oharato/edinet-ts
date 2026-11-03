import { it, expect } from "vitest";
import { calculateValuation, screenValuation, type ValuationInput } from "../src/valuation";
import { point } from "./fixtures/per-share";

const source = { name: "reviewed synthetic split", sha256: "a".repeat(64), observedAt: "2024-03-01T00:00:00Z" };
function input(kind: "eps" | "bps" | "dividend" = "eps", code = "1001"): ValuationInput {
    const document = point(2025, "100", kind === "dividend" ? "dividend" : "eps", code);
    if (document.shareBasis.state === "confirmed") document.shareBasis.basisDate = "2023-04-01";
    if (kind === "dividend" && document.shareBasis.state === "confirmed") {
        const key = "jpcrp_cor:BusinessResultsOfReportingCompanyTextBlock";
        document.xml = document.xml.replaceAll(document.shareBasis.proof.key, key);
        document.shareBasis.proof.key = key;
    }
    if (kind === "bps") {
        document.xml = document.xml.replaceAll("jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults", "jppfs_cor:NetAssetsPerShare").replace('<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>', '<xbrli:instant>2025-03-31</xbrli:instant>');
        document.metadata = { ...document.metadata, period: { instant: "2025-03-31" }, periodType: undefined };
    }
    return { financial: { ...document, observedAt: "2026-06-24T12:00:00Z" }, price: {
        rows: [{ date: "2026-06-24", ticker: `${code}.T`, close: 200, volume: 100 }],
        request: { secCode: code, asOf: "2026-06-24", knownAt: "2026-06-25T00:00:00Z", source: { ...source, observedAt: "2026-06-24T12:00:00Z" } },
        shareBasis: { state: "confirmed", shareClass: "ordinary", basisDate: "2024-04-01", reviewedThrough: "2026-06-24", adjustment: "unadjusted" }, maxAgeDays: 0,
    }, splitLedger: { state: "confirmed-complete", secCode: code, shareClass: "ordinary", basisConvention: "effective-date-inclusive", reviewedFrom: "2023-01-01", reviewedThrough: "2024-04-01", source,
        events: [{ eventId: "split", effectiveDate: "2024-04-01", oldShares: 1, newShares: 2, source }] } };
}
it.each([["eps", "priceToAnnualEarnings", 4], ["bps", "priceToBookValue", 4], ["dividend", "annualPaidDividendYield", .25]] as const)("%sを明示価格基準へ換算し、原財務値・未調整終値を保持する", (kind, metric, value) => {
    const data = input(kind), before = structuredClone(data);
    expect(calculateValuation({ ...data, splitLedger: undefined }, metric)).toMatchObject({ reason: "incompatible-share-basis" });
    expect(calculateValuation(data, metric)).toMatchObject({ status: "calculated", value, financial: { selection: { raw: "100" } }, price: { close: 200, adjustment: "unadjusted" }, shareAdjustment: { status: "adjusted", points: [{ originalValue: 100, value: 50, eventIds: ["split"] }] } });
    expect(data).toEqual(before);
});
it("遡及済み財務値を二重換算せず、確認済みの空台帳も扱う", () => {
    const data = input(); if (data.financial.shareBasis.state === "confirmed") data.financial.shareBasis.basisDate = "2024-04-01";
    expect(calculateValuation(data, "priceToAnnualEarnings")).toMatchObject({ value: 2, shareAdjustment: { points: [{ value: 100, eventIds: [] }] } });
    if (data.splitLedger?.state === "confirmed-complete") data.splitLedger.events = [];
    expect(calculateValuation(data, "priceToAnnualEarnings")).toMatchObject({ value: 2 });
});
it.each(["unknown", "incomplete", "future-source", "wrong-code", "unreviewed-price", "unknown-price", "proposed-dividend"])("%sを推測で補わない", kind => {
    const data = input(kind === "proposed-dividend" ? "dividend" : "eps");
    if (kind === "unknown") data.splitLedger = { state: "unknown" };
    if (data.splitLedger?.state === "confirmed-complete") {
        if (kind === "incomplete") data.splitLedger.reviewedFrom = "2024-01-01";
        if (kind === "future-source") data.splitLedger.source = { ...source, observedAt: "2027-01-01T00:00:00Z" };
        if (kind === "wrong-code") data.splitLedger.secCode = "9999";
    }
    if (kind === "unreviewed-price" && data.price.shareBasis.state === "confirmed") data.price.shareBasis.reviewedThrough = "2026-06-23";
    if (kind === "unknown-price") data.price.shareBasis = { state: "unknown" };
    if (kind === "proposed-dividend" && data.financial.shareBasis.state === "confirmed") data.financial.shareBasis.dividendStatus = "proposed";
    if (kind === "wrong-code") expect(() => calculateValuation(data, "priceToAnnualEarnings")).toThrow();
    else expect(calculateValuation(data, kind === "proposed-dividend" ? "annualPaidDividendYield" : "priceToAnnualEarnings").status).toBe("unavailable");
});
it("企業別台帳を厳密分数の絞込・順序・ページングへ伝える", () => {
    const a = input(), b = input("eps", "1002"), c = input("eps", "1003"); b.price.rows[0].close = 150; c.splitLedger = { state: "unknown" };
    const result = screenValuation([a, b, c], "priceToAnnualEarnings", { conditions: [{ operator: "gte", value: 3 }], order: "asc", offset: 1, limit: 1 });
    expect(result).toMatchObject({ total: 2, excludedRows: 1, rows: [{ value: 4, exact: { numerator: "4", denominator: "1" } }], excluded: [{ reason: "unverified-split-history" }] });
});
it("丸めた一株値を割り戻さず、分割・併合の正確な分数を使う", () => {
    const data = input();
    if (data.splitLedger?.state !== "confirmed-complete") throw Error("fixture");
    data.splitLedger.events = [{ eventId: "thirds", effectiveDate: "2024-04-01", oldShares: 1, newShares: 3, source }];
    expect(calculateValuation(data, "priceToAnnualEarnings")).toMatchObject({ value: 6, exact: { numerator: "6", denominator: "1" } });
    data.splitLedger.events = [{ eventId: "reverse", effectiveDate: "2024-04-01", oldShares: 3, newShares: 1, source }];
    expect(calculateValuation(data, "priceToAnnualEarnings")).toMatchObject({ exact: { numerator: "2", denominator: "3" } });
});
