
import { describe, it, bench } from "vitest";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import path from "path";
import fs from "fs";

describe("Performance Benchmark", () => {
    // Use the existing Nintendo file
    const nintendoPath = path.resolve(__dirname, "test_data/S100TMMG/XBRL/PublicDoc/jpcrp030000-asr-001_E02367-000_2024-03-31_01_2024-06-28.xbrl");
    const content = fs.readFileSync(nintendoPath, "utf-8");
    const parser = new EdinetXbrlParser();
    let object: any;

    it("Measure Parsing Time", () => {
        const start = performance.now();
        object = parser.parseString(content);
        const end = performance.now();
        console.log(`Parsing Time: ${(end - start).toFixed(2)}ms`);
    });

    it("Measure Data Access Time (Typed Proxy)", () => {
        if (!object) object = parser.parseString(content);
        const taxonomy = object.getJppfsCor();

        const start = performance.now();
        // Access 1000 items (some might be undefined, that's fine, we measure overhead)
        for (let i = 0; i < 1000; i++) {
            const _a = taxonomy.NetSales;
            const _b = taxonomy.CashAndDeposits;
            const _c = taxonomy.OperatingIncome;
            const _d = taxonomy.Assets;
            const _e = taxonomy.Liabilities;
        }
        const end = performance.now();
        console.log(`Access Time (5000 reads): ${(end - start).toFixed(2)}ms`);
    });

    it("Measure getKeyMetrics Time", () => {
        if (!object) object = parser.parseString(content);

        const start = performance.now();
        for (let i = 0; i < 100; i++) {
            object.getKeyMetrics();
        }
        const end = performance.now();
        console.log(`getKeyMetrics Time (100 calls): ${(end - start).toFixed(2)}ms`);
    });

});
