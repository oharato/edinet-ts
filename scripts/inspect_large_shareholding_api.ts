import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import { EdinetDocumentType } from "../src/edinet-document-type";
import "dotenv/config";

async function main() {
    const downloader = new EdinetXbrlDownloader();
    // User reported issue on 2025-12-05
    const date = "2025-12-05";
    console.log(`Searching for Large Shareholding Reports on ${date}...`);

    try {
        const docs = await downloader.search(date);
        // Count by type
        const counts: Record<string, number> = {};
        docs.forEach(d => {
            counts[d.docTypeCode] = (counts[d.docTypeCode] || 0) + 1;
        });
        console.log("Counts by docTypeCode:", counts);

        // Find specific filer "E40592" or "パーム"
        const specificDocs = docs.filter(d =>
            (d.filerName && d.filerName.includes("パーム")) ||
            (d.edinetCode && d.edinetCode === "E40592")
        );

        console.log(`Found ${specificDocs.length} documents for Palm/E40592.`);
        specificDocs.forEach(d => {
            console.log("--- Match ---");
            console.log("DocType:", d.docTypeCode);
            console.log("Description:", d.docDescription);
            console.log("Filer:", d.filerName);
            console.log("SubmitDate:", d.submitDateTime);
            console.log("DocID:", d.docID);
        });

        // Check if any match a known ticker but have different secCode
        // This is hard without knowing what was submitted.
        // But the sample inspection is enough to see if secCode matches Filer.

    } catch (e) {
        console.error(e);
    }
}

main();
