import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

export class EdinetXbrlDownloader {
    private static readonly API_ENDPOINT = "https://disclosure.edinet-fsa.go.jp/api/v2";

    constructor(private apiKey: string) { }

    public async search(date: string): Promise<any[]> {
        // date format: YYYY-MM-DD
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents.json?date=${date}&type=2`;
        const response = await fetch(url, {
            headers: {
                "Subscription-Key": this.apiKey,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch documents list: ${response.statusText}`);
        }

        const data = await response.json();
        return data.results || [];
    }

    public async download(docId: string, targetDir: string): Promise<string> {
        // type=1 for ZIP (default)
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents/${docId}?type=1`;
        const response = await fetch(url, {
            headers: {
                "Subscription-Key": this.apiKey,
            },
        });

        if (!response.ok) {
            throw new Error(`Failed to download document ${docId}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const zip = new AdmZip(Buffer.from(buffer));
        const zipEntries = zip.getEntries();

        let xbrlFile: string | null = null;
        let xbrlContent: Buffer | null = null;

        // Find the XBRL file (usually in PublicDoc/*.xbrl)
        for (const entry of zipEntries) {
            if (entry.entryName.endsWith(".xbrl") && entry.entryName.includes("PublicDoc")) {
                xbrlFile = entry.entryName;
                xbrlContent = entry.getData();
                break;
            }
        }

        if (!xbrlFile || !xbrlContent) {
            // Fallback: look for ANY .xbrl file if PublicDoc is not found
            for (const entry of zipEntries) {
                if (entry.entryName.endsWith(".xbrl")) {
                    xbrlFile = entry.entryName;
                    xbrlContent = entry.getData();
                    break;
                }
            }
        }

        if (!xbrlFile || !xbrlContent) {
            throw new Error("No XBRL file found in the downloaded ZIP.");
        }

        // Save to targetDir
        // We only save the XBRL file itself to match the Python lib behavior which provided a path to the XBRL file.
        // However, XBRL files often depend on XSDs referenced in the same directory.
        // The Python lib `download` saved the *file_name* (the ZIP? or the contents?).
        // Actually, `urllib.request.urlretrieve` saves the downloaded entity.
        // UFOCatcher URLs were likely direct links to single files OR zips.
        // If it was a ZIP, the user had to unzip.
        // If I extract ONLY the XBRL, it might fail to parse if it needs local XSDs.
        // BUT EDINET XBRLs usually reference remote or standard taxonomies.
        // Wait, `jpcrp_cor` etc. are often standard.
        // But if there are extension taxonomies (`*.xsd` in the zip), we might need them.
        // To be safe, we should extract **everything** or at least the `PublicDoc` folder.

        // For now, I will extract EVERYTHING to `targetDir/docId/`.
        // And return the path to the .xbrl file.

        const extractPath = path.join(targetDir, docId);
        zip.extractAllTo(extractPath, true);

        // Find the xbrl file path on disk
        const foundEntry = zipEntries.find(e => e.entryName === xbrlFile);
        if (foundEntry) {
            return path.join(extractPath, foundEntry.entryName);
        }
        return "";
    }

    public async downloadByTicker(ticker: string, targetDir: string, date: string = new Date().toISOString().split('T')[0]): Promise<string | null> {
        const docs = await this.search(date);
        // documentCode is NOT ticker. edinetCode is. 
        // Usually we map Ticker -> EdinetCode. 
        // But the search results contain `secCode` (e.g. "72030").
        // We look for strict match or startsWith.

        const targetDoc = docs.find((d: any) => d.secCode === ticker + "0" && d.docInfoEditStatus === 0);
        // secCode is 5 digits (ticker + char). e.g. 72030.
        // We check if it matches.
        // Also prioritize `docInfoEditStatus`?
        // Let's just look for the first match with the ticker.

        if (!targetDoc) {
            console.warn(`No document found for ticker ${ticker} on ${date}.`);
            return null;
        }

        console.log(`Found document for ${ticker}: ${targetDoc.docDescription} (${targetDoc.docID})`);
        return this.download(targetDoc.docID, targetDir);
    }
}
