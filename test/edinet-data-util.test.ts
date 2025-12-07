import { describe, it, expect } from "vitest";
import { EdinetDataUtil } from "../src/edinet-data-util";

describe("EdinetDataUtil", () => {
    describe("getKey", () => {
        /**
         * 名前空間プレフィックス（例: "jppfs_cor:"）が付いている場合、それを除去してキー名のみを返すことを確認します。
         */
        it("removes namespace prefix if present", () => {
            expect(EdinetDataUtil.getKey("jppfs_cor:NetSales")).toBe("NetSales");
        });

        /**
         * 名前空間がない場合は、元のキーをそのまま返すことを確認します。
         */
        it("returns original key if no namespace", () => {
            expect(EdinetDataUtil.getKey("NetSales")).toBe("NetSales");
        });
    });

    describe("getNamespace", () => {
        /**
         * キーに名前空間が含まれる場合、そのプレフィックス部分のみを抽出することを確認します。
         */
        it("returns namespace prefix if present", () => {
            expect(EdinetDataUtil.getNamespace("jppfs_cor:NetSales")).toBe("jppfs_cor");
        });

        /**
         * 名前空間が含まれない場合、空文字を返すことを確認します。
         */
        it("returns empty string if no namespace", () => {
            expect(EdinetDataUtil.getNamespace("NetSales")).toBe("");
        });
    });

    describe("getValue", () => {
        /**
         * 文字列が渡された場合、そのまま返すことを確認します。
         */
        it("returns string value directly", () => {
            expect(EdinetDataUtil.getValue("100")).toBe("100");
        });

        /**
         * null または undefined が渡された場合、空文字を返すことを確認します。
         */
        it("returns empty string for null/undefined", () => {
            expect(EdinetDataUtil.getValue(null)).toBe("");
            expect(EdinetDataUtil.getValue(undefined)).toBe("");
        });

        /**
         * オブジェクト（XMLノード）が渡された場合、"#text" プロパティの値を抽出して返すことを確認します。
         */
        it("extracts #text property from object", () => {
            const node = { "#text": "200" };
            expect(EdinetDataUtil.getValue(node)).toBe("200");
        });
    });

    describe("getContextRef", () => {
        /**
         * ノードの属性から "@_contextRef" を正しく抽出できることを確認します。
         */
        it("returns @contextRef attribute", () => {
            const node = { "@_contextRef": "CurrentYear" };
            expect(EdinetDataUtil.getContextRef(node)).toBe("CurrentYear");
        });

        /**
         * contextRef属性が存在しない場合、空文字を返すことを確認します。
         */
        it("returns empty string if no contextRef", () => {
            const node = { "#text": "100" };
            expect(EdinetDataUtil.getContextRef(node)).toBe("");
        });
    });


});
