import * as path from "path";
import JSZip from "jszip";
import { EdinetDocumentType } from "./edinet-document-type";
import { RateLimiter } from "./utils/rate-limiter";

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
        title: string;
        date: string;
        parameter: {
            date: string;
            type: string;
        };
        resultset: {
            count: number;
        };
    };
    results: EdinetDocument[];
}

export interface EdinetClientOptions {
    apiKey?: string;
    rootDir?: string;
    /** trueの場合、レートリミットを有効にする (デフォルト: true) */
    enableRateLimit?: boolean;
    /** 1秒あたりのリクエスト数 (デフォルト: 1) - 1000/N ms の間隔を設定するのと同等 */
    requestsPerSecond?: number;
    /** 429/5xx エラー発生時の最大リトライ回数 (デフォルト: 3) */
    maxRetries?: number;
}

/**
 * EDINET API から XBRL ファイルをダウンロードするためのクラス。
 * 書類リストの検索や、特定の書類のダウンロード・ZIP展開を行います。
 */
export class EdinetXbrlDownloader {
    private static readonly API_ENDPOINT = "https://api.edinet-fsa.go.jp/api/v2";

    private apiKey: string;
    private rootDir: string;
    private rateLimiter: RateLimiter;
    private options: EdinetClientOptions;

    /**
     * @param options Configuration options
     */
    constructor(options?: EdinetClientOptions) {
        this.options = options || {};
        this.apiKey = this.options.apiKey || process.env.EDINET_API_KEY || "";

        if (!this.apiKey) {
            console.warn("Warning: EDINET_API_KEY is not provided. API calls may fail.");
        }

        this.rootDir = this.options.rootDir || process.env.EDINET_DOWNLOAD_DIR || "downloads";

        // レートリミッターの設定
        const enableLimit = this.options.enableRateLimit ?? true; // デフォルト ON
        const rps = this.options.requestsPerSecond || 1;
        const interval = enableLimit ? Math.ceil(1000 / rps) : 0;

        this.rateLimiter = new RateLimiter(1, interval);
    }

    private async fetchWithRetry(url: string, options?: RequestInit): Promise<Response> {
        const maxRetries = this.options.maxRetries ?? 3;
        let attempt = 0;

        while (attempt <= maxRetries) {
            try {
                // レートリミッター経由で実行
                const response = await this.rateLimiter.schedule(() => fetch(url, options));

                if (response.ok) {
                    return response;
                }

                // 429 (Too Many Requests) または 5xx (Server Error) のハンドリング
                if (response.status === 429 || response.status >= 500) {
                    const delay = 1000 * Math.pow(2, attempt);
                    console.warn(`API Error ${response.status}. Retrying in ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                    attempt++;
                    continue;
                }

                return response; // その他のエラー (400, 404 等) はそのまま返す

            } catch (e) {
                // ネットワークエラー
                const delay = 1000 * Math.pow(2, attempt);
                console.warn(`Network Error. Retrying in ${delay}ms...`, e);
                await new Promise(r => setTimeout(r, delay));
                attempt++;
            }
        }

        throw new Error(`Failed to fetch ${url} after ${maxRetries} retries.`);
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
        const response = await this.fetchWithRetry(url);

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
        const response = await this.fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(`Failed to download document ${docId}: ${response.statusText}`);
        }

        const buffer = await response.arrayBuffer();
        const zip = await JSZip.loadAsync(buffer);

        // XBRLファイルを探す
        const files = Object.keys(zip.files);
        // PublicDocフォルダ内のファイルを優先し、なければ任意の.xbrlファイルを取得します
        const xbrlFileName =
            files.find(name => name.endsWith(".xbrl") && name.includes("PublicDoc")) ||
            files.find(name => name.endsWith(".xbrl"));

        if (!xbrlFileName) {
            throw new Error("No XBRL file found in the downloaded ZIP.");
        }

        // 全ファイルを展開（adm-zipの挙動に合わせて同期的に見せるが、JSZipは非同期）
        // 注: JSZipは非同期なのでイテレートします
        const extractPath = path.join(dir, docId);

        // この部分はNode.jsのfsに依存しています。
        // ブラウザ環境ではこのメソッドは呼ぶべきではありません。
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
        const response = await this.fetchWithRetry(url);

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
     * 指定した期間の書類を検索します。
     * @param startDate 開始日 (YYYY-MM-DD)
     * @param endDate 終了日 (YYYY-MM-DD)
     * @param typeFilter 書類種別 (オプション)
     * @returns 書類リスト
     */
    public async searchPeriod(startDate: string, endDate: string, typeFilter?: EdinetDocumentType): Promise<EdinetDocument[]> {
        const start = new Date(startDate);
        const end = new Date(endDate);
        const results: EdinetDocument[] = [];

        for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0];
            try {
                const docs = await this.search(dateStr, typeFilter);
                results.push(...docs);
            } catch (e) {
                console.warn(`Failed to search on ${dateStr}:`, e);
            }
            // 範囲が広い場合、レートリミットを避けるための待機
            if (d.getTime() < end.getTime()) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return results;
    }

    /**
     * 指定した銘柄の最新の書類を、過去に遡って検索します。
     * @param ticker 証券コード (例: "7203")
     * @param type 書類種別 (例: EdinetDocumentType.AnnualCards)
     * @param lookbackDays 遡る日数 (デフォルト: 90日)
     * @returns 見つかった書類情報、または null
     */
    public async findLatest(ticker: string, type: EdinetDocumentType, lookbackDays: number = 90): Promise<EdinetDocument | null> {
        const today = new Date();
        const secCode = ticker + "0";

        for (let i = 0; i < lookbackDays; i++) {
            const d = new Date(today);
            d.setDate(today.getDate() - i);
            const dateStr = d.toISOString().split("T")[0];

            try {
                // 特定の日付・種別で検索
                // searchメソッド内でフィルタリングされるため、通信量は削減できませんが、
                // クライアント側で無駄なループを回すよりは良いでしょう。
                // 日付ごとにAPIコールが発生するため、長期間の遡及は時間がかかります。
                const docs = await this.search(dateStr, type);
                const match = docs.find(doc => doc.secCode === secCode && doc.docInfoEditStatus === 0);

                if (match) {
                    return match;
                }
            } catch (e) {
                console.warn(`Error searching on ${dateStr}:`, e);
            }

            // レート制限への配慮
            await new Promise(resolve => setTimeout(resolve, 100));
        }

        return null;
    }

    /**
     * ティッカー（証券コード）を指定して、最新の有価証券報告書をダウンロードします。
     * 内部で `search()` を呼び出し、該当する最新の書類を特定します。
     * 
     * ※ 注意: このメソッドは指定された `date` (デフォルトは当日) のみを検索します。
     * 過去に遡って最新を探したい場合は `findLatest()` を使用して docID を取得し、`download()` してください。
     * 
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
