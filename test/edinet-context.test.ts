import { describe, it, expect } from "vitest";
import { ContextParser } from "../src/edinet-context";

describe("ContextParser", () => {
    describe("parse", () => {
        /**
         * 無効な入力（nullや空オブジェクト）に対して null を返すことを確認します。
         */
        it("returns null for invalid node", () => {
            expect(ContextParser.parse(null)).toBeNull();
            expect(ContextParser.parse({})).toBeNull();
        });

        /**
         * 期間（Duration）コンテキストのパース処理をテストします。
         * 開始日（startDate）と終了日（endDate）が正しく抽出されるか確認します。
         */
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
            expect(ctx!.scope).toBe("Consolidated"); // デフォルトは連結
            expect(ctx!.dimensions).toEqual([]);
        });

        /**
         * 時点（Instant）コンテキストのパース処理をテストします。
         * 指定された時点（instant）の日付が正しく抽出されるか確認します。
         */
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

        /**
         * 明示的なメンバー（explicitMember）を持つコンテキストを非連結（NonConsolidated）として検出するかテストします。
         * ディメンション情報も正しく抽出されるか確認します。
         */
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
