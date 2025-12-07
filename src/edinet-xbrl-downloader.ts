import * as path from "path";
import JSZip from "jszip";
import { EdinetDocumentType } from "./edinet-document-type";

export interface EdinetDocument {
    secCode: string;
    docID: string;
    docDescription: string;
    docTypeCode: string;
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
        const key = apiKey || (typeof process !== "undefined" ? process.env.EDINET_API_KEY : undefined);
        if (!key) {
            throw new Error("API Key is required. Provide it as an argument or set EDINET_API_KEY environment variable.");
        }
        this.apiKey = key;
        this.rootDir = options?.rootDir || (typeof process !== "undefined" ? process.env.EDINET_DOWNLOAD_DIR : undefined);
    }

    /**
     * 指定した日付に提出された書類のリストを取得します。
     * @param date 検索対象日 (YYYY-MM-DD)
     * @returns 書類情報のリスト
     */
    /**
     * 指定した日付に提出された書類のリストを取得します。
     * @param date 検索対象日 (YYYY-MM-DD)
     * @param typeFilter 取得する書類種別 (オプション)。指定した場合、その種別のみを返します。
     * @returns 書類情報のリスト
     */
    public async search(date: string, typeFilter?: EdinetDocumentType): Promise<EdinetDocument[]> {
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents.json?date=${date}&type=2&Subscription-Key=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch documents list: ${response.statusText}`);
        }

        const data = (await response.json()) as any;
        if (data.statusCode && data.statusCode !== 200) {
            throw new Error(`API Error: ${data.statusCode} - ${data.message}`);
        }

        const results = (data as EdinetListResponse).results || [];

        if (typeFilter) {
            return results.filter(d => d.docTypeCode === typeFilter);
        }

        return results;
    }

    /**
     * 指定されたドキュメントIDの XBRL ファイルをダウンロードし、展開します。
     * @param docId EDINET書類管理ID (例: "S100XXXX")
     * @param targetDir 保存先ディレクトリ (省略時はコンストラクタまたは環境変数の設定を使用)
     * @returns 展開された .xbrl ファイルの絶対パス
     * @throws ディレクトリが未指定の場合や、ダウンロード/展開に失敗した場合
     */
    public async download(docId: string, targetDir?: string): Promise<string> {
        let fs;
        try {
            fs = await import("fs");
        } catch (e) {
            throw new Error("File system access is not available in this environment. Use fetchXbrl() instead.");
        }

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
        const zip = await JSZip.loadAsync(buffer);

        // Find XBRL file
        const files = Object.keys(zip.files);
        // PublicDocフォルダ内のファイルを優先し、なければ任意の.xbrlファイルを取得します
        const xbrlFileName =
            files.find(name => name.endsWith(".xbrl") && name.includes("PublicDoc")) ||
            files.find(name => name.endsWith(".xbrl"));

        if (!xbrlFileName) {
            throw new Error("No XBRL file found in the downloaded ZIP.");
        }

        // Extract all files (syncing behavior to adm-zip approach for compatibility)
        // Note: JSZip is async, so we iterate.
        const extractPath = path.join(dir, docId);

        // This part strictly depends on Node.js fs. 
        // In a browser environment, this method should likely not be called, 
        // or we should provide a way to get the blob directly.
        if (!fs.existsSync(extractPath)) {
            fs.mkdirSync(extractPath, { recursive: true });
        }

        for (const filename of files) {
            const fileData = await zip.file(filename)?.async("nodebuffer");
            if (fileData) {
                const dest = path.join(extractPath, filename);
                const destDir = path.dirname(dest);
                if (!fs.existsSync(destDir)) fs.mkdirSync(destDir, { recursive: true });
                fs.writeFileSync(dest, fileData);
            }
        }

        return path.join(extractPath, xbrlFileName);
    }

    /**
     * 指定されたドキュメントIDの XBRL ファイルをメモリ上にダウンロード・展開し、テキストとして返します。
     * ファイルシステムへの保存は行いません。ブラウザ環境等での利用に適しています。
     * @param docId EDINET書類管理ID
     * @returns XBRLファイルの内容 (string)
     */
    public async fetchXbrl(docId: string): Promise<string> {
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents/${docId}?type=1&Subscription-Key=${this.apiKey}`;
        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`Failed to download document ${docId}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);

        const files = Object.keys(zip.files);
        const xbrlFileName =
            files.find(name => name.endsWith(".xbrl") && name.includes("PublicDoc")) ||
            files.find(name => name.endsWith(".xbrl"));

        if (!xbrlFileName) {
            throw new Error("No XBRL file found in the downloaded ZIP.");
        }

        const content = await zip.file(xbrlFileName)?.async("string");
        if (!content) {
            throw new Error("Failed to read XBRL file content.");
        }

        return content;
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
        date: string = new Date().toISOString().split("T")[0],
        type: EdinetDocumentType = EdinetDocumentType.AnnualCards
    ): Promise<string | null> {
        const docs = await this.search(date);

        // secCodeは通常、証券コード+0（例: 72030）となります
        // 指定された書類種別 (docTypeCode) かつ、訂正報告書等ではなくオリジナルの書類（docInfoEditStatus === 0）を優先します
        const targetDoc = docs.find(
            (d) => d.secCode === ticker + "0" && d.docTypeCode === type && d.docInfoEditStatus === 0
        );

        if (!targetDoc) {
            console.warn(`No document of type ${type} found for ticker ${ticker} on ${date}.`);
            return null;
        }

        console.log(`Found document for ${ticker}: ${targetDoc.docDescription} (${targetDoc.docID})`);
        return this.download(targetDoc.docID, targetDir);
    }
}
