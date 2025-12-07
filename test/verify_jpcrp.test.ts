
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import path from "path";
import fs from "fs";

const SOFTBANK_DOC_ID = "S100TP3N";
const FILE_PATH = `downloads/${SOFTBANK_DOC_ID}/XBRL/PublicDoc/jpcrp030000-asr-001_E02778-000_2024-03-31_01_2024-06-21_ixbrl.htm`;

// Note: Softbank file is inline XBRL (htm). My parser handles .xbrl.
// Wait, I need to check if I have .xbrl file.
// The downloader extracts .xbrl if available.
// Let's check what's in downloads/S100TP3N.

async function main() {
    const downloadDir = path.join(__dirname, "../downloads", SOFTBANK_DOC_ID);

    // Find .xbrl file (Prioritize PublicDoc)
    const files = fs.readdirSync(downloadDir, { recursive: true }) as string[];
    const xbrlFile = files.find(f => f.endsWith(".xbrl") && f.includes("PublicDoc")) || files.find(f => f.endsWith(".xbrl"));

    if (!xbrlFile) {
        console.warn("No .xbrl file found for verification. Skipping.");
        // Try finding any xbrl in downloads
        return;
    }

    const fullPath = path.join(downloadDir, xbrlFile);
    console.log(`Testing with: ${fullPath}`);

    const parser = new EdinetXbrlParser();
    const xbrl = parser.parseFile(fullPath);

    const jpcrp = xbrl.getJpcrpCor();

    // Test access via Proxy
    // We need to guess a property that exists. 
    // Usually "CompanyNameCoverPage" or similar exists in Cover Page.
    // Let's dump all keys starting with jpcrp_cor first to see what we have.

    console.log("Searching for jpcrp_cor keys in raw map...");
    const keys = Array.from(xbrl.getKeys()).filter(k => k.startsWith("jpcrp_cor:"));
    console.log(`Found ${keys.length} jpcrp_cor items.`);

    if (keys.length > 0) {
        console.log("Sample keys:", keys.slice(0, 5));

        // Try accessing one
        const sampleKeyFull = keys[0];
        const sampleProp = sampleKeyFull.replace("jpcrp_cor:", "");

        console.log(`Accessing getJpcrpCor().${sampleProp}...`);
        // @ts-ignore
        const value = jpcrp[sampleProp];
        console.log(`Value: ${value}`);

        if (value !== undefined) {
            console.log("SUCCESS: Retrieved value via proxy.");
        } else {
            console.error("FAILURE: Value undefined via proxy (context mismatch?)");
        }
    } else {
        console.warn("No jpcrp_cor data found in this file.");
    }
}

main();
