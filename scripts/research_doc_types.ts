import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import * as fs from "fs";
import * as path from "path";

// Load .env manually if simple dotenv is not available
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

// Function to dump doc types for a specific date
async function checkDate(date: string, label: string) {
    console.log(`\n=== Checking ${label} (${date}) ===`);
    try {
        // Use undefined for apiKey to trigger env var fallback
        const downloader = new EdinetXbrlDownloader(undefined, { rootDir: "./tmp" });
        // We Mock the API key logic or just assume it works if env var is set.
        // Actually, downloader throws if no key.
        // We will rely on EDINET_API_KEY env var being present or passed.
        // If not, we can't run this. But the user environment likely has it (or not? previous steps implied we need one).

        // Wait, I don't have the user's API KEY.
        // But I can try to run it. If it fails, I'll ask the user.
        // Actually, the previous logs showed "test-api-key" usage in tests, but real downloads require real key.
        // If I can't access real API, I can't do this research DYNAMICALLY.

        // HOWEVER, I can assume standard EDINET codes or search online using `search_web`?
        // The user's prompt suggests "Research Document Type Codes".
        // I have `search_web` tool! That is much safer and easier than trying to hit the API without a guaranteed key.

        // Let's use search_web instead of this script if possible.
        // But if I have a key, this script is better verification.
        // Let's try to write it, but I will first use `search_web` to get the list, 
        // effectively doing the "Research" part of the plan.

        // Wait, looking at the previous conversation logs...
        // The user was running `scripts/download_test_docs.ts` which successfully downloaded files.
        // This implies `process.env.EDINET_API_KEY` IS set in the environment or `.env`.
        // So I *can* run this script.

        const docs = await downloader.search(date);
        console.log(`Found ${docs.length} documents.`);

        const typeMap = new Map<string, string>();

        docs.forEach(d => {
            // docTypeCode is not in the Interface I defined yet, but it comes from API.
            // I need to cast to any to read it.
            const code = (d as any).docTypeCode;
            const desc = d.docDescription;
            if (code && !typeMap.has(code)) {
                typeMap.set(code, desc);
                console.log(`[${code}] ${desc}`);
            }
        });

    } catch (e) {
        console.error(`Error checking ${date}:`, e);
    }
}

async function main() {
    // 2024-06-27: Likely Annual Reports (March ending companies)
    await checkDate("2024-06-27", "Annual Reports Peak");

    // 2024-11-14: Likely Quarterly Reports (Q2 for March ending) + Semi-annual
    await checkDate("2024-11-14", "Quarterly Reports Peak");

    // 2024-05-15: Also Quarterly (Q4? No, Q4 is Annual usually. Q1/Q2/Q3 are Quarterly)
    // mid-May is usually Annual Financial Results (Kessan Tanshin) which is NOT XBRL in EDINET? 
    // Wait, Annual Securities Report (Youho) comes 3 months after year end. (June for March end).

    // Check for "Large Shareholding" (Daily)
    // It should be present on almost any business day.
}

main();
