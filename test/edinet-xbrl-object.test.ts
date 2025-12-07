import { describe, it, expect, beforeEach } from "vitest";
import { EdinetXbrlObject, EdinetData } from "../src/edinet-xbrl-object";
import { EdinetContext } from "../src/edinet-context";

describe("EdinetXbrlObject", () => {
    let xbrlObject: EdinetXbrlObject;

    beforeEach(() => {
        xbrlObject = new EdinetXbrlObject();
    });

    describe("Data Storage", () => {
        it("stores and retrieves data by key and contextRef", () => {
            const data1 = new EdinetData("NetSales", "1000", 0, "JPY", "ctx1");
            const data2 = new EdinetData("NetSales", "2000", 0, "JPY", "ctx2");

            xbrlObject.put("NetSales", data1);
            xbrlObject.put("NetSales", data2);

            expect(xbrlObject.getDataByContextRef("NetSales", "ctx1")).toEqual(data1);
            expect(xbrlObject.getDataByContextRef("NetSales", "ctx2")).toEqual(data2);
            expect(xbrlObject.getDataByContextRef("NetSales", "ctx3")).toBeNull();
        });
    });

    describe("Context Logic", () => {
        const createCtx = (id: string, endDate: string, scope: "Consolidated" | "NonConsolidated", dims: string[] = []): EdinetContext => ({
            id,
            period: { startDate: "2023-04-01", endDate },
            scope,
            dimensions: dims
        });

        beforeEach(() => {
            xbrlObject.addContext(createCtx("c_recent_cons", "2024-03-31", "Consolidated"));
            xbrlObject.addContext(createCtx("c_old_cons", "2023-03-31", "Consolidated"));
            xbrlObject.addContext(createCtx("c_recent_non", "2024-03-31", "NonConsolidated", ["NonConsolidatedMember"]));
            xbrlObject.addContext(createCtx("c_invalid_dim", "2024-03-31", "Consolidated", ["SomeSegment"])); // Should be ignored
        });

        it("finds Consolidated contexts sorted by date", () => {
            const ctxs = xbrlObject.findContexts({ type: "Duration", scope: "Consolidated" });
            expect(ctxs).toHaveLength(2);
            expect(ctxs[0].id).toBe("c_recent_cons");
            expect(ctxs[1].id).toBe("c_old_cons");
        });

        it("excludes contexts with unexpected dimensions", () => {
            // c_invalid_dim has "Consolidated" scope but has dimensions, so it should be filtered out from strict check
            const ctxs = xbrlObject.findContexts({ type: "Duration", scope: "Consolidated" });
            const ids = ctxs.map(c => c.id);
            expect(ids).not.toContain("c_invalid_dim");
        });

        it("finds NonConsolidated contexts", () => {
            const ctxs = xbrlObject.findContexts({ type: "Duration", scope: "NonConsolidated" });
            expect(ctxs).toHaveLength(1);
            expect(ctxs[0].id).toBe("c_recent_non");
        });

        it("handles Year offset", () => {
            const current = xbrlObject.findContext({ type: "Duration", scope: "Consolidated", year: "Current" });
            const prior = xbrlObject.findContext({ type: "Duration", scope: "Consolidated", year: "Prior1Year" });

            expect(current?.id).toBe("c_recent_cons");
            expect(prior?.id).toBe("c_old_cons");
        });
    });

    describe("getKeyMetrics", () => {
        it("extracts metrics prioritizing Consolidated", () => {
            // Setup contexts
            const consCtx = { id: "cons_2024", period: { startDate: "2023-04-01", endDate: "2024-03-31" }, scope: "Consolidated", dimensions: [] } as any;
            const nonConsCtx = { id: "non_2024", period: { startDate: "2023-04-01", endDate: "2024-03-31" }, scope: "NonConsolidated", dimensions: ["NonConsolidatedMember"] } as any;

            xbrlObject.addContext(consCtx);
            xbrlObject.addContext(nonConsCtx);

            // Setup data
            xbrlObject.put("jppfs_cor:NetSales", new EdinetData("jppfs_cor:NetSales", "1000", 0, "JPY", "cons_2024"));
            xbrlObject.put("jppfs_cor:NetSales", new EdinetData("jppfs_cor:NetSales", "500", 0, "JPY", "non_2024"));

            const metrics = xbrlObject.getKeyMetrics();
            expect(metrics.netSales).toBe(1000);
        });

        it("falls back to NonConsolidated if Consolidated missing", () => {
            // Setup contexts
            const nonConsCtx = { id: "non_2024", period: { startDate: "2023-04-01", endDate: "2024-03-31" }, scope: "NonConsolidated", dimensions: ["NonConsolidatedMember"] } as any;
            xbrlObject.addContext(nonConsCtx);

            // Setup data
            xbrlObject.put("jppfs_cor:NetSales", new EdinetData("jppfs_cor:NetSales", "500", 0, "JPY", "non_2024"));

            const metrics = xbrlObject.getKeyMetrics();
            expect(metrics.netSales).toBe(500);
        });
    });
});
