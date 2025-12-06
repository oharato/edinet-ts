import { EdinetXbrlDownloader, EdinetXbrlParser, EdinetDataUtil } from "../src";
import * as path from "path";
import * as fs from "fs";

async function main() {
    const apiKey = process.env.EDINET_API_KEY!;
    const downloader = new EdinetXbrlDownloader(apiKey);
    const parser = new EdinetXbrlParser();

    // Raccoon Holdings (3031) - Yuho 2024-07-30
    // Identified DocID from debug_list: S100U4EY
    const docId = "S100U4EY";
    const ticker = "3031";
    const targetDir = path.resolve(__dirname, "test/test_data");

    if (!fs.existsSync(targetDir)) {
        fs.mkdirSync(targetDir, { recursive: true });
    }

    console.log(`Downloading DocID ${docId} (Raccoon ${ticker})...`);

    try {
        // Direct download using DocID
        const xbrlPath = await downloader.download(docId, targetDir);

        if (xbrlPath) {
            console.log(`Downloaded: ${xbrlPath}`);
            const newPath = path.join(targetDir, "3031_raccoon.xbrl");
            fs.copyFileSync(xbrlPath, newPath);
            console.log(`Saved as: ${newPath}`);

            // Parse and Print Metadata
            console.log("\n--- Parsing Data for Test Case ---");
            const data = parser.parseFile(newPath);

            const keys = [
                "jppfs_cor:NetSales",
                "jppfs_cor:OperatingIncome",
                "jppfs_cor:OrdinaryIncome",
                "jppfs_cor:ProfitLossAttributableToOwnersOfParent",
                "jpcrp_cor:NetSales",
                "jpcrp_cor:OrdinaryIncome",
            ];

            // Try Consolidated Current Year Duration
            const context = "CurrentYearDuration";

            for (const key of keys) {
                const d = data.getDataByContextRef(key, context);
                if (d) {
                    console.log(`${key} (${context}): ${d.value}`);
                }
            }

        } else {
            console.error("Failed to download.");
        }
    } catch (e) {
        console.error("Error:", e);
    }
}

main();
