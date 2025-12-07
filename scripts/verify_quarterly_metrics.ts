import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import * as fs from "fs";
import * as path from "path";

async function main() {
    const filePath = "downloads/S100U7PK/XBRL/PublicDoc/jpcrp040300-q1r-001_E03387-000_2024-05-31_01_2024-08-14.xbrl";
    const absolutePath = path.resolve(__dirname, "../", filePath);

    if (!fs.existsSync(absolutePath)) {
        console.error("File not found:", absolutePath);
        return;
    }

    const xml = fs.readFileSync(absolutePath, "utf-8");
    const parser = new EdinetXbrlParser();
    const object = parser.parse(xml);
    const metrics = object.getKeyMetrics();

    console.log("=== Quarterly Metrics ===");
    console.log(`NetSales: ${metrics.netSales}`);
    console.log(`OperatingIncome: ${metrics.operatingIncome}`);
    console.log(`NetIncome: ${metrics.netIncome}`);
    console.log(`NetAssets: ${metrics.netAssets}`);
    console.log(`EquityRatio: ${metrics.equityToTotalAssetsRatio}`);

    if (metrics.netSales) {
        console.log("SUCCESS: NetSales extracted.");
    } else {
        console.error("FAILURE: NetSales is undefined.");
    }
}

main();
