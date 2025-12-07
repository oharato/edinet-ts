import { describe, it, expect } from "vitest";
import { EdinetDataUtil } from "../src/edinet-data-util";

describe("EdinetDataUtil", () => {
    describe("getKey", () => {
        it("removes namespace prefix if present", () => {
            expect(EdinetDataUtil.getKey("jppfs_cor:NetSales")).toBe("NetSales");
        });

        it("returns original key if no namespace", () => {
            expect(EdinetDataUtil.getKey("NetSales")).toBe("NetSales");
        });
    });

    describe("getNamespace", () => {
        it("returns namespace prefix if present", () => {
            expect(EdinetDataUtil.getNamespace("jppfs_cor:NetSales")).toBe("jppfs_cor");
        });

        it("returns empty string if no namespace", () => {
            expect(EdinetDataUtil.getNamespace("NetSales")).toBe("");
        });
    });

    describe("getValue", () => {
        it("returns string value directly", () => {
            expect(EdinetDataUtil.getValue("100")).toBe("100");
        });

        it("returns empty string for null/undefined", () => {
            expect(EdinetDataUtil.getValue(null)).toBe("");
            expect(EdinetDataUtil.getValue(undefined)).toBe("");
        });

        it("extracts #text property from object", () => {
            const node = { "#text": "200" };
            expect(EdinetDataUtil.getValue(node)).toBe("200");
        });
    });

    describe("getContextRef", () => {
        it("returns @contextRef attribute", () => {
            const node = { "@_contextRef": "CurrentYear" };
            expect(EdinetDataUtil.getContextRef(node)).toBe("CurrentYear");
        });

        it("returns empty string if no contextRef", () => {
            const node = { "#text": "100" };
            expect(EdinetDataUtil.getContextRef(node)).toBe("");
        });
    });


});
