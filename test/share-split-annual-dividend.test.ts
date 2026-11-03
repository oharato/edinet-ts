import { describe, it, expect } from "vitest";
import {
    reconstructAnnualDividendPerShare,
    type AnnualDividendPayment,
    type AnnualDividendReconstructionOptions,
    type ShareSplitLedger,
} from "../src/share-split-adjustment";

const source = { name: "reviewed synthetic split notice", sha256: "a".repeat(64), observedAt: "2024-01-01T00:00:00Z" };
const observedAt = "2025-06-01T00:00:00Z";

function options(overrides: Partial<AnnualDividendReconstructionOptions> = {}): AnnualDividendReconstructionOptions & {
    ledger: Extract<ShareSplitLedger, { state: "confirmed-complete" }>;
} {
    return {
        asOf: "2025-06-30",
        knownAt: "2025-06-30T00:00:00Z",
        targetBasisDate: "2025-04-01",
        sourceObservedAt: [observedAt],
        annualPeriod: { start: "2024-04-01", end: "2025-03-31" },
        ledger: {
            state: "confirmed-complete",
            secCode: "1001",
            shareClass: "ordinary",
            basisConvention: "effective-date-inclusive",
            reviewedFrom: "2024-04-01",
            reviewedThrough: "2025-04-01",
            source,
            events: [{ eventId: "split-2024", effectiveDate: "2024-10-01", oldShares: 1, newShares: 2, source }],
        },
        ...overrides,
    };
}

function payment(paymentId: string, amountPerShare: number, basisDate: string, dividendStatus: AnnualDividendPayment["dividendStatus"] = "paid"): AnnualDividendPayment {
    return { paymentId, amountPerShare, basisDate, dividendStatus, sourceObservedAt: observedAt };
}

describe("annual dividend reconstruction across split bases", () => {
    it("sums interim and year-end dividends after converting each to the target basis", () => {
        const result = reconstructAnnualDividendPerShare([
            payment("interim", 40, "2024-09-30"),
            payment("year-end", 25, "2025-03-31"),
        ], "1001", options());
        expect(result).toMatchObject({
            status: "reconstructed",
            dividendStatus: "paid",
            paid: true,
            totalPerShare: 45,
            exact: { numerator: "45", denominator: "1" },
            payments: [
                { paymentId: "interim", originalAmountPerShare: 40, value: 20, eventIds: ["split-2024"], exact: { numerator: "20", denominator: "1" } },
                { paymentId: "year-end", originalAmountPerShare: 25, value: 25, eventIds: [] },
            ],
        });
    });

    it("converts back to a basis before the split without changing original amounts", () => {
        const result = reconstructAnnualDividendPerShare([
            payment("interim", 20, "2024-12-31"),
            payment("year-end", 25, "2025-03-31"),
        ], "1001", options({ targetBasisDate: "2024-04-01", ledger: { ...options().ledger, reviewedFrom: "2024-04-01", reviewedThrough: "2025-03-31" } }));
        expect(result).toMatchObject({
            status: "reconstructed",
            totalPerShare: 90,
            exact: { numerator: "90", denominator: "1" },
            payments: [
                { paymentId: "interim", originalAmountPerShare: 20, value: 40, eventIds: ["split-2024"] },
                { paymentId: "year-end", originalAmountPerShare: 25, value: 50, eventIds: ["split-2024"] },
            ],
        });
    });

    it("keeps exact fractions when a split does not produce a finite decimal", () => {
        const settings = options();
        settings.ledger.events[0] = { ...settings.ledger.events[0], newShares: 3 };
        const result = reconstructAnnualDividendPerShare([
            payment("interim", 100, "2024-09-30"),
            payment("year-end", 10, "2025-03-31"),
        ], "1001", settings);
        expect(result).toMatchObject({
            status: "reconstructed",
            totalPerShare: 130 / 3,
            exact: { numerator: "130", denominator: "3" },
            payments: [{ exact: { numerator: "100", denominator: "3" } }, { exact: { numerator: "10", denominator: "1" } }],
        });
    });

    it("marks a year containing proposed dividends as unpaid but still reconstructs it", () => {
        const result = reconstructAnnualDividendPerShare([
            payment("interim", 40, "2024-09-30"),
            payment("year-end", 25, "2025-03-31", "proposed"),
        ], "1001", options());
        expect(result).toMatchObject({ status: "reconstructed", dividendStatus: "proposed", paid: false, payments: [{ dividendStatus: "paid" }, { dividendStatus: "proposed" }] });
    });

    it("does not promote an unknown dividend status", () => {
        expect(reconstructAnnualDividendPerShare([
            payment("interim", 40, "2024-09-30", "unknown"),
        ], "1001", options())).toMatchObject({ status: "unavailable", reason: "unverified-dividend-status" });
    });

    it("propagates split-ledger unavailability instead of returning a partial annual total", () => {
        const settings = options({ ledger: { state: "unknown" } });
        expect(reconstructAnnualDividendPerShare([payment("interim", 40, "2024-09-30")], "1001", settings))
            .toMatchObject({ status: "unavailable", reason: "unverified-split-history" });
        const late = payment("interim", 40, "2024-09-30");
        late.sourceObservedAt = "2025-07-01T00:00:00Z";
        expect(reconstructAnnualDividendPerShare([late], "1001", options())).toMatchObject({ status: "unavailable", reason: "split-source-after-cutoff" });
    });

    it("rejects a fiscal period that extends beyond the observation cutoff", () => {
        const settings = options({ asOf: "2025-03-31", knownAt: "2025-03-31T00:00:00Z", targetBasisDate: "2025-03-01",
            annualPeriod: { start: "2024-04-01", end: "2025-04-01" },
            ledger: { ...options().ledger, reviewedFrom: "2024-04-01", reviewedThrough: "2025-03-31" } });
        const early = payment("interim", 40, "2025-03-31");
        early.sourceObservedAt = "2025-03-01T00:00:00Z";
        expect(reconstructAnnualDividendPerShare([early], "1001", settings))
            .toMatchObject({ status: "unavailable", reason: "annual-period-after-as-of" });
    });

    it("rejects duplicate payment ids, out-of-period dates, negative amounts, and sparse arrays", () => {
        expect(() => reconstructAnnualDividendPerShare([payment("same", 1, "2024-09-30"), payment("same", 2, "2025-03-31")], "1001", options())).toThrow("重複");
        expect(() => reconstructAnnualDividendPerShare([payment("early", 1, "2024-03-31")], "1001", options())).toThrow("年額配当");
        expect(() => reconstructAnnualDividendPerShare([payment("negative", -1, "2024-09-30")], "1001", options())).toThrow("年額配当");
        expect(() => reconstructAnnualDividendPerShare(Array(1), "1001", options())).toThrow("疎配列");
        expect(() => reconstructAnnualDividendPerShare([{ ...payment("extra", 1, "2024-09-30"), note: "x" } as any], "1001", options())).toThrow();
    });

    it("does not hide injected iterator values or unsafe totals", () => {
        const payments = [payment("interim", 40, "2024-09-30"), payment("year-end", 25, "2025-03-31")];
        Object.defineProperty(payments, Symbol.iterator, { value: function* () { yield payment("fake", 999, "2024-09-30"); } });
        expect(reconstructAnnualDividendPerShare(payments, "1001", options())).toMatchObject({ status: "reconstructed", totalPerShare: 45 });

        const settings = options();
        settings.ledger.events = Array.from({ length: 30 }, (_, index) => ({
            eventId: `huge-${index}`, effectiveDate: new Date(Date.UTC(2024, 3, index + 1)).toISOString().slice(0, 10),
            oldShares: 1, newShares: Number.MAX_SAFE_INTEGER, source,
        })).filter(event => event.effectiveDate >= settings.annualPeriod.start && event.effectiveDate <= settings.ledger.reviewedThrough);
        settings.ledger.reviewedFrom = settings.annualPeriod.start;
        expect(reconstructAnnualDividendPerShare([payment("interim", 40, "2024-04-01")], "1001", settings))
            .toMatchObject({ status: "unavailable", reason: "unsafe-split-adjustment" });
    });
});
