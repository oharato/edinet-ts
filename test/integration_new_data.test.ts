
import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import * as path from "path";
import * as fs from "fs";

describe("Integration Test - New Real Data", () => {
    const parser = new EdinetXbrlParser();
    const downloadDir = path.resolve(__dirname, "test_data");

    // Helper to find XBRL path without hardcoding exact filename if possible, 
    // but we know the paths from download output.
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

        const data = parser.parseFile(nintendoPath);
        const metrics = data.getKeyMetrics();

        // Values from official summary or checking the file content
        // Sales: 1,671,862 million yen -> 1671862000000
        expect(metrics.netSales).toBeGreaterThan(1000000000000);
        expect(metrics.operatingIncome).toBeGreaterThan(0);

        // Check qualitative info presence
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

        const data = parser.parseFile(softbankPath);
        const metrics = data.getKeyMetrics();

        // IFRS checks
        // Revenue: 6,756,462 million yen
        expect(metrics.netSales).toBeGreaterThan(6000000000000);

        // Net Income (Attributable to owners): 
        // Loss -227,646 million yen? Or check specific value.
        // Softbank 2024 (ended March 31 2024): 
        // Net loss attributable to owners: 227,646 million JPY (Loss)
        // Check if it's negative or just exists
        expect(metrics.netIncome).toBeDefined();

        // Qualitative
        const qual = data.getQualitativeInfo();
        expect(qual.businessRisks).toBeDefined();
    });
});
