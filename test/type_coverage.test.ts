
import { describe, it, expect } from "vitest";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import path from "path";

describe("Type Coverage Integration Test", () => {
    // Use the downloaded Nintendo report (J-GAAP)
    // Note: Path is relative to project root or use absolute path
    const nintendoFile = path.resolve(__dirname, "test_data/S100TMMG/XBRL/PublicDoc/jpcrp030000-asr-001_E02367-000_2024-03-31_01_2024-06-28.xbrl");

    it("should access data via getJppfsCor() typed proxy", () => {
        const parser = new EdinetXbrlParser();
        const object = parser.parseFile(nintendoFile);
        const jppfs = object.getJppfsCor();

        // Debug: Check keys and contexts
        console.log("Keys matching CashAndDeposits:", object.getKeys().filter(k => k.includes("CashAndDeposits")));
        console.log("Contexts:", object.findContexts({ type: "Instant", scope: "Consolidated" }).map(c => c.id));

        // 1. Check CashAndDeposits (現金及び預金)
        // This is a standard tag in jppfs_cor
        const cashAndDeposits = jppfs.CashAndDeposits;
        console.log("CashAndDeposits:", cashAndDeposits);
        expect(cashAndDeposits).toBeDefined();
        expect(typeof cashAndDeposits).toBe("number");
        expect(cashAndDeposits).toBeGreaterThan(0);

        // 2. Check NetSales (売上高)
        const netSales = jppfs.NetSales;
        console.log("NetSales:", netSales);
        expect(netSales).toBeDefined();
        // Nintendo has HUGE sales (~1.6T)
        expect(netSales).toBeGreaterThan(1000000000000);

        // 3. Check undefined property
        // @ts-ignore
        const nonExistent = jppfs.NoSuchProperty;
        expect(nonExistent).toBeUndefined();
    });
});
