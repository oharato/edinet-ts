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

    // Target date: 2024-11-14
    const date = "2024-11-14";
    console.log(`Searching for Large Shareholding Reports (350 - Change Report) on ${date}...`);

    // Type 350 (Change Report) is common
    const docs = await downloader.search(date, EdinetDocumentType.ChangeReport);
    console.log(`Found ${docs.length} change reports.`);

    if (docs.length === 0) return;

    // Pick first one
    const doc = docs[0];
    console.log(`Downloading ${doc.docDescription} (${doc.docID})...`);

    const xbrlPath = await downloader.download(doc.docID);
    console.log(`Downloaded to ${xbrlPath}`);

    const xml = fs.readFileSync(xbrlPath, "utf-8");
    const object = parser.parse(xml);

    // Inspect Keys/Namespaces
    const keys = object.getKeys();
    console.log(`\n=== Keys Found (${keys.length}) ===`);

    const namespaces = new Set<string>();

    // Print first 50 keys and collect namespaces
    for (let i = 0; i < Math.min(keys.length, 50); i++) {
        console.log(keys[i]);
        const ns = keys[i].split(":")[0];
        if (ns) namespaces.add(ns);
    }

    console.log("\n=== Namespaces ===");
    namespaces.forEach(ns => console.log(ns));

    // Try to find Name tags
    const names = keys.filter(k => k.toLowerCase().includes("name"));

    console.log(`\n=== Name Tags (${names.length}) ===`);
    names.forEach(k => {
        const data = object.getDataList(k)[0];
        console.log(`${k}: ${data.value} (Ctx: ${data.contextRef})`);
    });

    // Try to find specific interesting tags
    const interesting = keys.filter(k =>
        k.toLowerCase().includes("holder") ||
        k.toLowerCase().includes("ratio") ||
        k.toLowerCase().includes("share")
    );

    console.log(`\n=== Interesting Tags (${interesting.length}) ===`);
    interesting.slice(0, 20).forEach(k => {
        const data = object.getDataList(k)[0]; // Get first data point
        console.log(`${k}: ${data.value} (Ctx: ${data.contextRef})`);
    });
}

main();
