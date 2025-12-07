
import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import * as path from "path";
import * as fs from "fs";

describe("Integration Test - New Real Data", () => {
    const parser = new EdinetXbrlParser();
    const downloadDir = path.resolve(__dirname, "test_data");

    // ヘルパー: 正確なファイル名をハードコードせずにXBRLパスを見つける (今回はダウンロード出力から判明済み)
    const nintendoPath = path.join(downloadDir, "S100TMMG/XBRL/PublicDoc/jpcrp030000-asr-001_E02367-000_2024-03-31_01_2024-06-28.xbrl");
    const softbankPath = path.join(downloadDir, "S100TP3N/XBRL/PublicDoc/jpcrp030000-asr-001_E02778-000_2024-03-31_01_2024-06-21.xbrl");

    /**
     * 任天堂（J-GAAP基準）の2024年有価証券報告書を用いた統合テストです。
     * 実際のXBRLファイルから、売上高や営業利益、事業リスク情報が抽出できるかを確認します。
     * ファイルが存在しない場合（ダウンロード前など）はスキップされます。
     */
    it("parses Nintendo (J-GAAP) 2024", () => {
        if (!fs.existsSync(nintendoPath)) {
            console.warn("Skipping Nintendo test (file not found)");
            return;
        }

        const xml = fs.readFileSync(nintendoPath, "utf-8");
        const data = parser.parse(xml);
        const metrics = data.getKeyMetrics();

        // 公式サマリーまたはファイル内容の確認値
        // 売上高: 1,671,862 百万円 -> 1671862000000
        expect(metrics.netSales).toBeGreaterThan(1000000000000);
        expect(metrics.operatingIncome).toBeGreaterThan(0);

        // 定性情報の存在確認
        const qual = data.getQualitativeInfo();
        expect(qual.businessRisks).toBeDefined();
        expect(qual.businessRisks?.length).toBeGreaterThan(100);
    });

    /**
     * ソフトバンクグループ（IFRS基準）の2024年有価証券報告書を用いた統合テストです。
     * IFRS特有のタグ（Revenueなど）からデータが抽出できるか確認します。
     */
    it("parses Softbank Group (IFRS) 2024", () => {
        if (!fs.existsSync(softbankPath)) {
            console.warn("Skipping Softbank test (file not found)");
            return;
        }

        const xml = fs.readFileSync(softbankPath, "utf-8");
        const data = parser.parse(xml);
        const metrics = data.getKeyMetrics();

        // IFRSチェック
        // 収益: 6,756,462 百万円
        expect(metrics.netSales).toBeGreaterThan(6000000000000);

        // 純利益 (親会社所有者に帰属): 
        // 損失 -227,646 百万円? または特定の値を確認。
        // ソフトバンク2024 (2024年3月31日終了):
        // 親会社所有者に帰属する純損失: 227,646 百万円 (損失)
        // 負の値であるか、存在するかを確認
        expect(metrics.netIncome).toBeDefined();

        // 定性情報
        const qual = data.getQualitativeInfo();
        expect(qual.businessRisks).toBeDefined();
    });
});
