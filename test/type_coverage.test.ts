import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import * as path from "path";
import * as fs from "fs";

describe("Type Coverage Integration Test", () => {
    // ダウンロード済みの任天堂レポート（J-GAAP）を使用
    // Note: パスはプロジェクトルートからの相対パス、または絶対パスを使用
    const nintendoFile = path.resolve(__dirname, "test_data/S100TMMG/XBRL/PublicDoc/jpcrp030000-asr-001_E02367-000_2024-03-31_01_2024-06-28.xbrl");

    it("should access data via getJppfsCor() typed proxy", () => {
        const parser = new EdinetXbrlParser();
        const xml = fs.readFileSync(nintendoFile, "utf-8");
        const object = parser.parse(xml);
        const jppfs = object.getJppfsCor();

        // デバッグ: キーとコンテキストを確認
        console.log("Keys matching CashAndDeposits:", object.getKeys().filter(k => k.includes("CashAndDeposits")));
        console.log("Contexts:", object.findContexts({ type: "Instant", scope: "Consolidated" }).map(c => c.id));

        // 1. CashAndDeposits (現金及び預金) を確認
        // jppfs_cor の標準タグ
        const cashAndDeposits = jppfs.CashAndDeposits;
        console.log("CashAndDeposits:", cashAndDeposits);
        expect(cashAndDeposits).toBeDefined();
        expect(typeof cashAndDeposits).toBe("number");
        expect(cashAndDeposits).toBeGreaterThan(0);

        // 2. Check NetSales (売上高)
        const netSales = jppfs.NetSales;
        console.log("NetSales:", netSales);
        expect(netSales).toBeDefined();
        // 任天堂の売上高は巨大 (~1.6兆)
        expect(netSales).toBeGreaterThan(1000000000000);

        // 3. 未定義プロパティの確認
        // @ts-ignore
        const nonExistent = jppfs.NoSuchProperty;
        expect(nonExistent).toBeUndefined();
    });
});
