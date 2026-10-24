import { assertDownloadDocId, loadZipArchive, ZIP_LIMITS, type LoadedZipArchive } from "./zip-archive";
import { EdinetDocumentType } from "./edinet-document-type";
import { RateLimiter } from "./utils/rate-limiter";

export interface EdinetDocument {
    secCode: string | null;
    docID: string;
    docDescription: string | null;
    docTypeCode: string | null;
    /** API の文字列区分を数値 0 / 1 / 2 に正規化します。 */
    docInfoEditStatus: number;
    filerName?: string | null;
    edinetCode?: string | null;
    submitDateTime?: string | null;
    date?: string | null;
    [key: string]: unknown;
}

export interface EdinetListResponse {
    metadata: {
        title: string;
        processDateTime: string;
        status: string;
        message: string;
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

/** 配列や null を通常の JSON オブジェクトとして扱わないための境界チェック。 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 書類一覧の利用に必要な項目を検証します。壊れた応答を「提出書類なし」に変換しません。
 * 区分だけを正規化し、null・未知の追加項目を含む元の書類情報は保持します。
 */
function parseDocumentList(data: unknown): EdinetDocument[] {
    if (!isRecord(data)) {
        throw new Error("Invalid EDINET documents response: expected an object");
    }

    // API ゲートウェイのエラー形式と、EDINET 本体の metadata.status を両方確認します。
    if (data.statusCode !== undefined && data.statusCode !== 200 && data.statusCode !== "200") {
        throw new Error(`API Error: ${String(data.statusCode)} - ${typeof data.message === "string" ? data.message : "Unknown error"}`);
    }
    const metadata = data.metadata;
    if (!isRecord(metadata) || (typeof metadata.status !== "string" && typeof metadata.status !== "number")) {
        throw new Error("Invalid EDINET documents response: missing metadata.status");
    }
    if (metadata.status !== "200" && metadata.status !== 200) {
        throw new Error(`API Error: ${String(metadata.status)} - ${typeof metadata.message === "string" ? metadata.message : "Unknown error"}`);
    }
    if (!Array.isArray(data.results)) {
        throw new Error("Invalid EDINET documents response: results must be an array");
    }
    const resultset = metadata.resultset;
    if (!isRecord(resultset) || !Number.isInteger(resultset.count) || resultset.count !== data.results.length) {
        throw new Error("Invalid EDINET documents response: resultset.count must match results.length");
    }

    return data.results.map((value: unknown, index: number): EdinetDocument => {
        const invalid = (field: string): never => {
            throw new Error(`Invalid EDINET document at results[${index}]: ${field}`);
        };
        if (!isRecord(value)) return invalid("expected an object");
        if (typeof value.docID !== "string" || value.docID.trim() === "") return invalid("docID");

        // 非上場提出者や取下げ済み書類等では null が正しい値です。
        const nullableString = (field: string): string | null => {
            const v = value[field];
            if (typeof v !== "string" && v !== null) return invalid(field);
            return v;
        };
        const secCode = nullableString("secCode");
        const docTypeCode = nullableString("docTypeCode");
        const docDescription = nullableString("docDescription");
        const optionalString = (field: string): string | null | undefined =>
            value[field] === undefined ? undefined : nullableString(field);

        const status = value.docInfoEditStatus;
        // Number(null)、空文字、真偽値などが誤って 0 になる広い型変換は行いません。
        if (status !== "0" && status !== "1" && status !== "2" && status !== 0 && status !== 1 && status !== 2) {
            return invalid("docInfoEditStatus must be 0, 1 or 2 (string or number)");
        }
        return {
            ...value,
            docID: value.docID,
            secCode,
            docTypeCode,
            docDescription,
            docInfoEditStatus: Number(status),
            filerName: optionalString("filerName"),
            edinetCode: optionalString("edinetCode"),
            submitDateTime: optionalString("submitDateTime"),
            date: optionalString("date")
        };
    });
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
                console.warn(`EDINET通信エラー。${delay}ms後に再試行します。`);
                await new Promise(r => setTimeout(r, delay));
                attempt++;
            }
        }

        throw new Error(`EDINET通信に失敗しました（最大再試行${maxRetries}回）。`);
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
    public async search(date: string, typeFilter?: EdinetDocumentType | EdinetDocumentType[]): Promise<EdinetDocument[]> {
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents.json?date=${date}&type=2&Subscription-Key=${this.apiKey}`;
        const response = await this.fetchWithRetry(url);

        if (!response.ok) {
            throw new Error(`Failed to fetch documents list: ${response.statusText}`);
        }

        const data: unknown = await response.json();
        const results = parseDocumentList(data);

        if (typeFilter) {
            if (Array.isArray(typeFilter)) {
                return results.filter(d => typeFilter.includes(d.docTypeCode as EdinetDocumentType));
            }
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
        assertDownloadDocId(docId);
        const dir = targetDir || this.rootDir;
        if (!dir) throw new Error("Target directory is not specified.");
        let cache: typeof import("./zip-cache");
        try { cache = await import("./zip-cache"); }
        catch { throw new Error("File system access is not available. Use fetchXbrl() instead."); }
        const cached = cache.findCachedXbrl(dir, docId);
        if (cached) return cached;
        const archive = await this.loadDocumentArchive(docId);
        return cache.persistZipArchive(dir, docId, archive, this.xbrlEntryName(archive));
    }

    /** 明示書類の安全に検査したZIP、または通常ファイルのキャッシュからUTF-8本文を返します。 */
    public async fetchXbrl(docId: string): Promise<string> {
        assertDownloadDocId(docId);
        if (this.rootDir) {
            let cache: typeof import("./zip-cache") | undefined;
            try { cache = await import("./zip-cache"); }
            catch (error) {
                // Nodeでの権限/実装エラーを、キャッシュなしへ変換して通信しません。
                if (typeof process !== "undefined" && process.versions?.node) throw error;
            }
            if (cache) {
                const cached = cache.findCachedXbrl(this.rootDir, docId);
                if (cached) return cache.readCachedXbrl(cached);
            }
        }
        const archive = await this.loadDocumentArchive(docId);
        const bytes = await archive.readEntry(this.xbrlEntryName(archive));
        if (bytes.byteLength === 0) throw new Error("XBRL本文が空です");
        return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
    }

    private xbrlEntryName(archive: LoadedZipArchive): string {
        const names = archive.entries.filter(entry => !entry.dir && entry.name.endsWith(".xbrl")).map(entry => entry.name);
        names.sort((left, right) => Number(right.split("/").includes("PublicDoc")) - Number(left.split("/").includes("PublicDoc")) || (left < right ? -1 : left > right ? 1 : 0));
        const name = names[0];
        if (!name) throw new Error("No XBRL file found in the downloaded ZIP.");
        return name;
    }

    /** 圧縮応答もstreamで上限まで読み、応答本文や鍵をエラーメッセージへ混ぜません。 */
    private async readZipResponse(response: Response, maxBytes = ZIP_LIMITS.compressedBytes): Promise<Uint8Array> {
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > ZIP_LIMITS.compressedBytes) throw new Error("ZIP受信上限が不正です");
        if (!response.body || typeof response.body.getReader !== "function") throw new Error("ZIP応答に読み取り可能なbodyがありません");
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = []; let total = 0;
        try {
            const declared = response.headers.get("content-length");
            if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw new Error("ZIP受信量が上限を超えています");
            for (;;) {
                let item: ReadableStreamReadResult<Uint8Array>;
                try { item = await reader.read(); }
                catch { throw new Error("ZIP応答の受信に失敗しました（詳細は非表示）"); }
                const { done, value } = item;
                if (done) break;
                if (!(value instanceof Uint8Array) || value.byteLength > maxBytes - total) throw new Error("ZIP受信量が上限を超えています");
                total += value.byteLength; chunks.push(new Uint8Array(value));
            }
            const bytes = new Uint8Array(total); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            return bytes;
        } catch (error) {
            try { await reader.cancel(); } catch { /* 元の検査エラーを保持します。 */ }
            throw error;
        } finally { reader.releaseLock(); }
    }

    private async loadDocumentArchive(docId: string): Promise<LoadedZipArchive> {
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents/${docId}?type=1&Subscription-Key=${this.apiKey}`;
        const response = await this.fetchWithRetry(url);
        if (!response.ok) throw new Error(`Failed to download document ${docId}: HTTP ${response.status}`);
        if (response.headers.get("content-type")?.toLowerCase().includes("application/json")) {
            try { await response.body?.cancel(); } catch { /* 応答本文は出力しません。 */ }
            throw new Error("EDINETのZIP取得応答がJSONでした（本文は非表示）");
        }
        return loadZipArchive(await this.readZipResponse(response));
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
    public async findLatest(ticker: string, type: EdinetDocumentType | EdinetDocumentType[], lookbackDays: number = 90): Promise<EdinetDocument | null> {
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
        type: EdinetDocumentType | EdinetDocumentType[] = EdinetDocumentType.AnnualCards
    ): Promise<string | null> {
        const docs = await this.search(date);

        // secCodeは通常、証券コード+0（例: 72030）となります
        // 指定された書類種別かつ、書類情報修正区分が 0 の書類を選びます。
        // docInfoEditStatus は訂正報告書の区分ではありません。選択条件自体は従来どおりです。
        const targetDoc = docs.find(
            (d) => {
                const matchType = Array.isArray(type) ? type.includes(d.docTypeCode as EdinetDocumentType) : d.docTypeCode === type;
                return d.secCode === ticker + "0" && matchType && d.docInfoEditStatus === 0;
            }
        );

        if (!targetDoc) {
            console.warn(`No document of type ${type} found for ticker ${ticker} on ${date}.`);
            return null;
        }

        console.log(`Found document for ${ticker}: ${targetDoc.docDescription} (${targetDoc.docID})`);
        return this.download(targetDoc.docID, targetDir);
    }
}
