import { createHash } from "node:crypto";
import type { PerShareAnnualDocument, PerShareAnnualPair } from "../../src/index";
import { instance, fact, standalone } from "./metric-boundaries";
export const proofKey = "jpcrp_cor:BusinessResultsOfGroupTextBlock" as const, text = "合成の確認済み株式基準。配当の状態は各対象期について呼出元が確認。";
const digest = createHash("sha256").update(text).digest("hex");
export function point(year: number, raw = "10", metric: "eps" | "dividend" = "eps", code = "1001"): PerShareAnnualDocument {
    const tag = metric === "eps" ? "jpcrp_cor:BasicEarningsLossPerShareSummaryOfBusinessResults" : "jpcrp_cor:DividendPaidPerShareSummaryOfBusinessResults";
    const context = `<xbrli:context id="annual"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${year-1}-04-01</xbrli:startDate><xbrli:endDate>${year}-03-31</xbrli:endDate></xbrli:period>${metric === "dividend" ? `<xbrli:scenario>${standalone}</xbrli:scenario>` : ""}</xbrli:context>` +
        `<xbrli:context id="filing"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-24</xbrli:instant></xbrli:period></xbrli:context>`;
    const units = '<xbrli:unit id="money"><xbrli:divide><xbrli:unitNumerator><xbrli:measure>iso4217:JPY</xbrli:measure></xbrli:unitNumerator><xbrli:unitDenominator><xbrli:measure>xbrli:shares</xbrli:measure></xbrli:unitDenominator></xbrli:divide></xbrli:unit>';
    return { xml: instance(fact(raw, "", tag, "annual") + `<${proofKey} contextRef="filing">${text}</${proofKey}>`, context, units),
        metadata: { secCode: code, docID: `SYNTHETIC${code}-${year}`, scope: metric === "eps" ? "Consolidated" : "NonConsolidated", accountingStandard: "J-GAAP", currency: "JPY", periodType: "annual", period: { startDate: `${year-1}-04-01`, endDate: `${year}-03-31` } },
        shareBasis: { state: "confirmed", shareClass: "ordinary", basisDate: "2024-04-01", proof: { key: proofKey, contextRef: "filing", rawSha256: digest }, ...(metric === "dividend" ? { dividendStatus: "paid" as const } : {}) } };
}
export const pair = (metric: "eps" | "dividend" = "eps", code = "1001"): PerShareAnnualPair => ({ previous: point(2024, "10", metric, code), current: point(2025, "12", metric, code) });
