import * as fs from "fs";
import * as path from "path";
import AdmZip from "adm-zip";

export interface EdinetDocument {
    secCode: string;
    docID: string;
    docDescription: string;
    docInfoEditStatus: number;
    [key: string]: unknown;
}

export interface EdinetListResponse {
    metadata: {
        resultset: {
            count: number;
        };
    };
    results: EdinetDocument[];
}

/**
 * Handles downloading of XBRL files from the EDINET API.
 */
export class EdinetXbrlDownloader {
    private static readonly API_ENDPOINT = "https://api.edinet-fsa.go.jp/api/v2";

    private apiKey: string;
    private rootDir?: string;

    constructor(apiKey?: string, options?: { rootDir?: string }) {
        const key = apiKey || process.env.EDINET_API_KEY;
        if (!key) {
            throw new Error("API Key is required. Provide it as an argument or set EDINET_API_KEY environment variable.");
        }
        this.apiKey = key;
        this.rootDir = options?.rootDir || process.env.EDINET_DOWNLOAD_DIR;
    }

    /**
     * 最新の書類IDを取得します。
     * @param date Format: YYYY-MM-DD
     */
    public async search(date: string): Promise<EdinetDocument[]> {
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents.json?date=${date}&type=2&Subscription-Key=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch documents list: ${response.statusText}`);
        }

        const data = (await response.json()) as any; // Using any temporarily to check for error schema
        if (data.statusCode && data.statusCode !== 200) {
            throw new Error(`API Error: ${data.statusCode} - ${data.message}`);
        }
        return (data as EdinetListResponse).results || [];
    }

    /**
     * 指定されたティッカー（証券コード）の最新の有価証券報告書をダウンロードし、XBRLファイルを展開します。
     * @param docId The EDINET document ID. // e.g., "S100XXXX"
     * @param targetDir 保存先のディレクトリ (オプショナル: 指定がない場合はコンストラクタまたは環境変数の設定を使用)
     * @returns 展開された .xbrl ファイルの絶対パス。見つからない場合は null。
     */
    public async download(docId: string, targetDir?: string): Promise<string> {
        const dir = targetDir || this.rootDir;
        if (!dir) {
            throw new Error("Target directory is not specified. Set it via argument or EDINET_DOWNLOAD_DIR environment variable.");
        }

        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents/${docId}?type=1&Subscription-Key=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to download document ${docId}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const zip = new AdmZip(Buffer.from(buffer));
        const zipEntries = zip.getEntries();

        // Prioritize file in PublicDoc folder, otherwise take any .xbrl
        const xbrlEntry =
            zipEntries.find((e) => e.entryName.endsWith(".xbrl") && e.entryName.includes("PublicDoc")) ||
            zipEntries.find((e) => e.entryName.endsWith(".xbrl"));

        if (!xbrlEntry) {
            throw new Error("No XBRL file found in the downloaded ZIP.");
        }

        const extractPath = path.join(dir, docId);
        zip.extractAllTo(extractPath, true);

        return path.join(extractPath, xbrlEntry.entryName);
    }

    /**
     * Convenience method to find and download the latest document for a ticker.
     * @param ticker Stock ticker (e.g. "7203")
     * @param targetDir Directory to save the downloaded file.
     * @param date Date to search (YYYY-MM-DD). Defaults to today.
     */
    public async downloadByTicker(
        ticker: string,
        targetDir?: string,
        date: string = new Date().toISOString().split("T")[0]
    ): Promise<string | null> {
        const docs = await this.search(date);

        // secCode matches ticker + "0" typically (e.g. 72030)
        // We prioritize original documents (docInfoEditStatus === 0)
        const targetDoc = docs.find(
            (d) => d.secCode === ticker + "0" && d.docInfoEditStatus === 0
        );

        if (!targetDoc) {
            console.warn(`No document found for ticker ${ticker} on ${date}.`);
            return null;
        }

        console.log(`Found document for ${ticker}: ${targetDoc.docDescription} (${targetDoc.docID})`);
        return this.download(targetDoc.docID, targetDir);
    }
}
