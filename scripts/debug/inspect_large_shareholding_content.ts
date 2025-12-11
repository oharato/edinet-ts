import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import "dotenv/config";
import * as fs from "fs";

async function main() {
    const downloader = new EdinetXbrlDownloader();
    const date = "2024-12-04";
    console.log(`Searching for Large Shareholding Reports on ${date}...`);

    try {
        const docs = await downloader.search(date);
        // 340: 大量保有報告書, 350: 変更報告書
        const submitDocs = docs.filter(d => ["340", "350"].includes(d.docTypeCode));

        if (submitDocs.length === 0) {
            console.log("No reports found.");
            return;
        }

        const doc = submitDocs[0];
        console.log(`Downloading ${doc.docDescription} (${doc.docID})...`);

        const xbrlPath = await downloader.download(doc.docID);
        console.log(`Downloaded to ${xbrlPath}`);

        const content = fs.readFileSync(xbrlPath, "utf-8");

        // Simple regex search for 4 digit numbers that might be codes
        const codeMatches = content.match(/>\s*[0-9]{4}\s*</g);
        console.log("Potential 4-digit codes found in XML content:", codeMatches);

        // Specific tags for Large Shareholding (jplvh_cor)
        const securityCodeMatch = content.match(/<jplvh_cor:SecurityCodeOfIssuer[^>]*>(.*?)<\/jplvh_cor:SecurityCodeOfIssuer/);
        const issuerNameMatch = content.match(/<jplvh_cor:NameOfIssuer[^>]*>(.*?)<\/jplvh_cor:NameOfIssuer/);

        console.log("--- Content Inspection ---");
        console.log("SecurityCodeOfIssuer:", securityCodeMatch ? securityCodeMatch[1] : "Not found");
        console.log("NameOfIssuer:", issuerNameMatch ? issuerNameMatch[1] : "Not found");

        // Dump first 500 chars to cover more ground
        // console.log("--- First 5000 chars ---");
        // console.log(content.substring(0, 5000));

    } catch (e) {
        console.error(e);
    }
}

main();
