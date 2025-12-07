import { describe, it, expect } from "vitest";
import { ContextParser } from "../src/edinet-context";

describe("ContextParser", () => {
    describe("parse", () => {
        it("returns null for invalid node", () => {
            expect(ContextParser.parse(null)).toBeNull();
            expect(ContextParser.parse({})).toBeNull();
        });

        it("parses Duration context correctly", () => {
            const node = {
                "@_id": "CurrentYearDuration",
                "xbrli:period": {
                    "xbrli:startDate": { "#text": "2023-04-01" },
                    "xbrli:endDate": { "#text": "2024-03-31" }
                }
            };
            const ctx = ContextParser.parse(node);
            expect(ctx).not.toBeNull();
            expect(ctx!.id).toBe("CurrentYearDuration");
            expect(ctx!.period.startDate).toBe("2023-04-01");
            expect(ctx!.period.endDate).toBe("2024-03-31");
            expect(ctx!.scope).toBe("Consolidated"); // Default
            expect(ctx!.dimensions).toEqual([]);
        });

        it("parses Instant context correctly", () => {
            const node = {
                "@_id": "CurrentYearInstant",
                "xbrli:period": {
                    "xbrli:instant": { "#text": "2024-03-31" }
                }
            };
            const ctx = ContextParser.parse(node);
            expect(ctx).not.toBeNull();
            expect(ctx!.period.instant).toBe("2024-03-31");
        });

        it("detects NonConsolidated scope via explicit member", () => {
            const node = {
                "@_id": "NonConsolidated",
                "xbrli:period": {},
                "xbrli:scenario": {
                    "xbrldi:explicitMember": { "#text": "jpcrp_cor:NonConsolidatedMember" }
                }
            };
            const ctx = ContextParser.parse(node);
            expect(ctx!.scope).toBe("NonConsolidated");
            expect(ctx!.dimensions).toContain("NonConsolidatedMember");
        });
    });
});
