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
 * EDINET API から XBRL ファイルをダウンロードするためのクラス。
 * 書類リストの検索や、特定の書類のダウンロード・ZIP展開を行います。
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
     * 指定した日付に提出された書類のリストを取得します。
     * @param date 検索対象日 (YYYY-MM-DD)
     * @returns 書類情報のリスト
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
     * 指定されたドキュメントIDの XBRL ファイルをダウンロードし、展開します。
     * @param docId EDINET書類管理ID (例: "S100XXXX")
     * @param targetDir 保存先ディレクトリ (省略時はコンストラクタまたは環境変数の設定を使用)
     * @returns 展開された .xbrl ファイルの絶対パス
     * @throws ディレクトリが未指定の場合や、ダウンロード/展開に失敗した場合
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
     * ティッカー（証券コード）を指定して、最新の有価証券報告書をダウンロードします。
     * 内部で `search()` を呼び出し、該当する最新の書類を特定します。
     * @param ticker 証券コード (例: "7203")
     * @param targetDir 保存先ディレクトリ
     * @param date 検索対象日 (YYYY-MM-DD)。デフォルトは当日。
     * @returns ダウンロードされた .xbrl ファイルのパス。見つからなかった場合は null。
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
