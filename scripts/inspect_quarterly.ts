import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import { EdinetDocumentType } from "../src/edinet-document-type";
import * as fs from "fs";
import * as path from "path";

// Load .env manually
try {
    const envPath = path.resolve(__dirname, "../.env");
    if (fs.existsSync(envPath)) {
        const envConfig = fs.readFileSync(envPath, "utf-8");
        envConfig.split("\n").forEach(line => {
            const [key, val] = line.split("=");
            if (key && val && !process.env[key.trim()]) {
                process.env[key.trim()] = val.trim();
            }
        });
    }
} catch (e) {
    console.warn("Failed to load .env manually", e);
}

async function main() {
    const downloader = new EdinetXbrlDownloader(undefined, { rootDir: "./downloads" });
    const parser = new EdinetXbrlParser();

    // Try 2024-08-14 for Q1 (Type 140)
    console.log("Searching for Q1 Reports (140) on 2024-08-14...");
    let docs = await downloader.search("2024-08-14", EdinetDocumentType.QuarterlyReport);

    if (docs.length === 0) {
        console.log("No Q1 reports found. Trying Q2/Semi-annual (160) on 2024-11-14...");
        docs = await downloader.search("2024-11-14", EdinetDocumentType.SemiAnnualReport);
    }

    console.log(`Found ${docs.length} reports.`);

    if (docs.length === 0) return;

    // Pick one, e.g., a well known company if possible, or just the first one.
    // Let's try to find a specific one if possible, otherwise first regular one.
    const doc = docs[0];
    console.log(`Downloading ${doc.docDescription} (${doc.docID})...`);

    const xbrlPath = await downloader.download(doc.docID);
    console.log(`Downloaded to ${xbrlPath}`);

    const xml = fs.readFileSync(xbrlPath, "utf-8");
    const object = parser.parse(xml);

    // Verify Key Metrics Extraction
    console.log("\n=== Key Metrics Extraction ===");
    try {
        const metrics = object.getKeyMetrics();
        console.log("NetSales:", metrics.netSales);
        console.log("OperatingIncome:", metrics.operatingIncome);
        console.log("NetIncome:", metrics.netIncome);
        console.log("NetAssets:", metrics.netAssets);
        console.log("EPS:", metrics.earningsPerShare);

        if (metrics.netSales) {
            console.log("SUCCESS: Extracted Key Metrics from Quarterly Report!");
        } else {
            console.warn("FAILURE: Could not extract NetSales.");
        }
    } catch (e) {
        console.error("Error extracting metrics:", e);
    }

    // Use internal map to dump ALL contexts regardless of scope/type
    const contextMap = (object as any).contextMap as Map<string, any>;
    console.log(`\n=== All Contexts (${contextMap.size}) ===`);

    // Sort by ID for readability
    const sortedKeys = Array.from(contextMap.keys()).sort();

    sortedKeys.forEach(key => {
        const ctx = contextMap.get(key);
        const periodStr = ctx.period.instant
            ? `Instant: ${ctx.period.instant}`
            : `Duration: ${ctx.period.startDate} - ${ctx.period.endDate}`;
        console.log(`[${key}] Scope: ${ctx.scope}, ${periodStr}, Dims: ${ctx.dimensions.join(", ")}`);
    });

}

main();
