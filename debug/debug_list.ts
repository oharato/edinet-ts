import { EdinetXbrlDownloader } from "../src";

async function main() {
    const apiKey = process.env.EDINET_API_KEY!;
    const downloader = new EdinetXbrlDownloader(apiKey);

    // Search a range around late July
    const dates = [
        "2024-07-25", "2024-07-26", "2024-07-29", "2024-07-30", "2024-07-31", "2024-08-01", "2024-08-02"
    ];

    console.log("Searching for Raccoon (3031) in late July 2024...");

    for (const date of dates) {
        try {
            const docs = await downloader.search(date);
            // Search loosely
            const targets = docs.filter(d =>
                (d.secCode && String(d.secCode).startsWith("3031")) ||
                (d.filerName && d.filerName.includes("ラクーン"))
            );

            if (targets.length > 0) {
                console.log(`\n[FOUND] Date: ${date} (${targets.length} docs)`);
                targets.forEach(t => {
                    console.log(`  - ${t.filerName} (${t.secCode}): ${t.docDescription} [ID: ${t.docID}]`);
                });
            } else {
                process.stdout.write(`.`); // Progress dot
            }
        } catch (e) {
            console.error(`\nError on ${date}:`, e);
        }
    }
    console.log("\nSearch complete.");
}

main();
