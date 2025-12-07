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
    console.log("=== Rate Limit Test ===");
    console.log("Initializing downloader with 2 requests per second (500ms interval)...");

    const downloader = new EdinetXbrlDownloader({
        rootDir: "./downloads",
        requestsPerSecond: 2, // 2 RPS = 500ms interval
        enableRateLimit: true
    });

    const start = Date.now();
    const tasks: Promise<void>[] = [];

    // Fire 5 requests in parallel
    for (let i = 0; i < 5; i++) {
        tasks.push((async () => {
            const tStart = Date.now();
            try {
                // Just search metadata for a specific date
                await downloader.search("2024-11-14", EdinetDocumentType.SemiAnnualReport);
                const tEnd = Date.now();
                console.log(`Request ${i} completed at T+${tEnd - start}ms (Duration: ${tEnd - tStart}ms)`);
            } catch (e) {
                console.error(`Request ${i} failed:`, e);
            }
        })());
    }

    await Promise.all(tasks);
    const totalTime = Date.now() - start;
    console.log(`Total time: ${totalTime}ms`);

    // Expected:
    // Req 0: 0ms (immediate)
    // Req 1: 500ms
    // Req 2: 1000ms
    // Req 3: 1500ms
    // Req 4: 2000ms
    // Total approx 2000ms + API latency
    if (totalTime >= 2000) {
        console.log("SUCCESS: Requests were throttled.");
    } else {
        console.warn("FAILURE: Requests finished too quickly.");
    }
}

main();
