import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
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

    // Debug: Search wider period for Toyota (7203)
    console.log("Searching period 2024-11-01 to 2024-11-30 for Toyota Motor (72030)...");
    // Search specific type 140 (Quarterly) this time, or both if possible? 
    // Let's search period without type filter to see what they filed.
    const periods = await downloader.searchPeriod("2024-11-01", "2024-11-30");

    // Find exact match for 72030
    const toyota = periods.find(d => d.secCode === "72030");

    if (toyota) {
        console.log("SUCCESS: Found Toyota (72030)!");
        console.log(`Date: ${toyota.submitDateTime}`);
        console.log(`Title: ${toyota.docDescription}`);
        console.log(`Type: ${toyota.docTypeCode}`);
    } else {
        console.warn("FAILURE: Could not find Toyota (72030) in Nov 2024.");
        // List any Toyota group companies found
        const others = periods.filter(d => d.filerName?.includes("トヨタ自動車"));
        if (others.length > 0) {
            console.log("Found others with similar name:", others.map(d => `${d.secCode}:${d.docDescription}`).join(", "));
        }
    }
}

main();
