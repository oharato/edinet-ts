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
        throw new Error(`API Error: ${safeStatus(data.statusCode)}`);
    }
    const metadata = data.metadata;
    if (!isRecord(metadata) || (typeof metadata.status !== "string" && typeof metadata.status !== "number")) {
        throw new Error("Invalid EDINET documents response: missing metadata.status");
    }
    if (metadata.status !== "200" && metadata.status !== 200) {
        throw new Error(`API Error: ${safeStatus(metadata.status)}`);
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

/** 中断理由や元例外を含めない、通信エラーの安定した分類。 */
export const EdinetRequestErrorCode = Object.freeze({ Aborted: "aborted", Timeout: "timeout", Network: "network" } as const);
export type EdinetRequestErrorCode = typeof EdinetRequestErrorCode[keyof typeof EdinetRequestErrorCode];
export class EdinetRequestError extends Error {
    constructor(public readonly code: EdinetRequestErrorCode) {
        super(code === "aborted" ? "EDINET通信が中断されました" : code === "timeout" ? "EDINET通信が時間制限を超えました" : "EDINET応答の受信に失敗しました（詳細は非表示）");
        this.name = "EdinetRequestError";
    }
}
export interface EdinetRequestOptions { signal?: AbortSignal; }
/** 呼出元のgetterや後からの差替えを非同期処理へ持ち込みません。 */
function snapshotRequest(request?: EdinetRequestOptions): EdinetRequestOptions | undefined {
    if (request === undefined) return undefined;
    let signal: AbortSignal | undefined;
    try { signal = request.signal; }
    catch { throw new Error("signalはAbortSignalまたはundefinedで指定してください"); }
    if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error("signalはAbortSignalまたはundefinedで指定してください");
    return { signal };
}
class ResponseValidationError extends Error {}
function safeStatus(value: unknown): string {
    return (typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599) ||
        (typeof value === "string" && /^[1-5]\d{2}$/.test(value)) ? String(value) : "不正な状態値";
}
function abortError(signal?: AbortSignal): EdinetRequestError {
    // この関数に渡す内部signalのreasonだけを利用し、任意の呼出元reasonは公開しません。
    return signal?.reason instanceof EdinetRequestError ? signal.reason : new EdinetRequestError(EdinetRequestErrorCode.Aborted);
}
function checkAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new EdinetRequestError(EdinetRequestErrorCode.Aborted);
}
function cancelBody(response: Response): void {
    try { void response.body?.cancel().catch(() => {}); } catch { /* 本文・元例外は公開しません。 */ }
}
function withAbort<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return operation;
    return new Promise<T>((resolve, reject) => {
        const stop = () => { signal.removeEventListener("abort", stop); reject(abortError(signal)); };
        signal.addEventListener("abort", stop, { once: true });
        operation.then(value => { signal.removeEventListener("abort", stop); resolve(value); }, () => {
            signal.removeEventListener("abort", stop);
            reject(signal.aborted ? abortError(signal) : new EdinetRequestError(EdinetRequestErrorCode.Network));
        });
        if (signal.aborted) stop();
    });
}
function waitForRequest(ms: number, signal?: AbortSignal): Promise<void> {
    checkAborted(signal);
    return new Promise<void>((resolve, reject) => {
        const stop = () => { clearTimeout(timer); signal?.removeEventListener("abort", stop); reject(new EdinetRequestError(EdinetRequestErrorCode.Aborted)); };
        const timer = setTimeout(() => { signal?.removeEventListener("abort", stop); resolve(); }, ms);
        signal?.addEventListener("abort", stop, { once: true });
    });
}
/** Retry-Afterの整数秒と現行IMF-fixdateだけを扱います。原文はログ・例外へ出しません。 */
function retryAfterDelay(value: string | null, now: number): number | undefined {
    if (value === null) return undefined;
    if (/^\d+$/.test(value)) return Number(value) * 1000;
    // 旧式HTTP-dateは解釈を推測せず、自動再試行を止めて早い再送を避けます。
    if (/^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday), \d{2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{2} [0-2]\d:[0-5]\d:(?:[0-5]\d|60) GMT$/.test(value) ||
        /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (?: \d|\d{2}) [0-2]\d:[0-5]\d:(?:[0-5]\d|60) \d{4}$/.test(value)) return Infinity;
    // Date.parseの寛容な補正に頼らず、曜日・日付・時刻をUTC表記と照合します。
    if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} [0-2]\d:[0-5]\d:(?:[0-5]\d|60) GMT$/.test(value)) return undefined;
    const year = Number(value.slice(12, 16));
    if (year < 1900) return undefined;
    const leapSecond = value.endsWith(":60 GMT");
    const ordinary = leapSecond ? value.slice(0, -6) + "59 GMT" : value;
    const date = new Date(ordinary);
    if (!Number.isFinite(date.getTime()) || date.toUTCString() !== ordinary) return undefined;
    // JS Dateではうるう秒を正確に表せないため、こちらも自動再試行しません。
    if (leapSecond) return Infinity;
    return Math.max(0, date.getTime() - now);
}
interface ReceivedResponse { ok: boolean; status: number; contentType: string | null; retryAfter: string | null; bytes: Uint8Array; }

export interface EdinetClientOptions {
    apiKey?: string;
    rootDir?: string;
    /** trueの場合、レートリミットを有効にする (デフォルト: true) */
    enableRateLimit?: boolean;
    /** 1秒あたりのリクエスト数 (デフォルト: 1) - 1000/N ms の間隔を設定するのと同等 */
    requestsPerSecond?: number;
    /** 429/5xx エラー発生時の最大リトライ回数 (デフォルト: 3) */
    maxRetries?: number;
    /** 1回の通信開始から本文受信完了までの上限ms。省略時は従来どおり無制限。待ち行列/再試行待ちは含みません。 */
    requestTimeoutMs?: number;
    /** 再試行待ちの上限ms（既定60000）。サーバーの指定がこれを超える場合は再試行せず終了します。 */
    maxRetryDelayMs?: number;
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
        this.options = { ...options };
        if (this.options.maxRetries !== undefined && (!Number.isSafeInteger(this.options.maxRetries) || this.options.maxRetries < 0)) throw new Error("maxRetriesは0以上の安全な整数で指定してください");
        const timeout = this.options.requestTimeoutMs;
        if (timeout !== undefined && (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647)) throw new Error("requestTimeoutMsは1以上2147483647以下の整数で指定してください");
        const maxDelay = this.options.maxRetryDelayMs;
        if (maxDelay !== undefined && (!Number.isInteger(maxDelay) || maxDelay < 1 || maxDelay > 2147483647)) throw new Error("maxRetryDelayMsは1以上2147483647以下の整数で指定してください");
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

    /** fetchと本文受信を同じslot内に置き、解析・保存はこの再試行の外で行います。 */
    private async fetchWithRetry(url: string, request?: EdinetRequestOptions, format: "json" | "zip" = "json"): Promise<ReceivedResponse> {
        const signal = snapshotRequest(request)?.signal;
        const maxRetries = this.options.maxRetries ?? 3;
        for (let attempt = 0; ; attempt++) {
            checkAborted(signal);
            let received: ReceivedResponse | undefined;
            let failure: EdinetRequestError | undefined;
            try {
                received = await this.rateLimiter.schedule(async () => {
                    checkAborted(signal);
                    const controller = new AbortController();
                    const stop = () => controller.abort(new EdinetRequestError(EdinetRequestErrorCode.Aborted));
                    signal?.addEventListener("abort", stop, { once: true });
                    if (signal?.aborted) stop();
                    const timeout = this.options.requestTimeoutMs;
                    const timer = timeout === undefined ? undefined : setTimeout(() => controller.abort(new EdinetRequestError(EdinetRequestErrorCode.Timeout)), timeout);
                    let response: Response | undefined;
                    try {
                        const pending = Promise.resolve().then(() => { if (controller.signal.aborted) throw abortError(controller.signal); return fetch(url, { signal: controller.signal }); });
                        // fetch実装がsignalを無視して遅れて返っても、本文を破棄します。
                        void pending.then(response => { if (controller.signal.aborted) cancelBody(response); }, () => {});
                        response = await withAbort(pending, controller.signal);
                        const contentType = response.headers.get("content-type");
                        const retryAfter = response.headers.get("retry-after");
                        if (!response.ok || (format === "zip" && contentType?.toLowerCase().includes("application/json"))) {
                            cancelBody(response);
                            return { ok: response.ok, status: response.status, contentType, retryAfter, bytes: new Uint8Array() };
                        }
                        const bytes = await this.readResponse(response, format === "zip" ? ZIP_LIMITS.compressedBytes : undefined, controller.signal);
                        if (controller.signal.aborted) throw abortError(controller.signal);
                        return { ok: response.ok, status: response.status, contentType, retryAfter, bytes };
                    } catch (error) {
                        if (response) cancelBody(response);
                        if (error instanceof EdinetRequestError || error instanceof ResponseValidationError) throw error;
                        throw new EdinetRequestError(EdinetRequestErrorCode.Network);
                    } finally {
                        if (timer !== undefined) clearTimeout(timer);
                        signal?.removeEventListener("abort", stop);
                    }
                }, signal);
            } catch (error) {
                checkAborted(signal);
                if (!(error instanceof EdinetRequestError)) throw error;
                if (error.code === EdinetRequestErrorCode.Aborted) throw error;
                failure = error;
            }
            checkAborted(signal);
            const retryableStatus = received && (received.status === 429 || (received.status >= 500 && received.status <= 599));
            if (!failure && !retryableStatus) return received!;
            if (attempt >= maxRetries) {
                if (failure) throw failure;
                return received!;
            }
            const maxDelay = this.options.maxRetryDelayMs ?? 60000;
            const serverWait = retryableStatus ? retryAfterDelay(received!.retryAfter, Date.now()) : undefined;
            // 長いサーバー指定を上限へ切り詰めると、指定時刻より前に再送してしまいます。
            if (serverWait !== undefined && serverWait > maxDelay) return received!;
            const ownBackoff = Math.min(maxDelay, 1000 * 2 ** attempt);
            const jitterRoom = Math.min(maxDelay - ownBackoff, ownBackoff * 0.25);
            const ownJitter = ownBackoff + Math.floor(Math.random() * (Math.floor(jitterRoom) + 1));
            const delay = Math.max(ownJitter, serverWait ?? 0);
            console.warn(`EDINET通信を${delay}ms後に再試行します。`);
            await waitForRequest(delay, signal);
        }
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
    public async search(date: string, typeFilter?: EdinetDocumentType | EdinetDocumentType[], request?: EdinetRequestOptions): Promise<EdinetDocument[]> {
        request = snapshotRequest(request);
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents.json?date=${date}&type=2&Subscription-Key=${this.apiKey}`;
        const response = await this.fetchWithRetry(url, request);

        if (!response.ok) {
            throw new Error(`Failed to fetch documents list: HTTP ${response.status}`);
        }

        let data: unknown;
        try { data = JSON.parse(new TextDecoder().decode(response.bytes)); }
        catch { throw new Error("Invalid EDINET documents response: invalid JSON（詳細は非表示）"); }
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
    public async download(docId: string, targetDir?: string, request?: EdinetRequestOptions): Promise<string> {
        request = snapshotRequest(request);
        checkAborted(request?.signal);
        assertDownloadDocId(docId);
        const dir = targetDir || this.rootDir;
        if (!dir) throw new Error("Target directory is not specified.");
        let cache: typeof import("./zip-cache");
        try { cache = await import("./zip-cache"); }
        catch { throw new Error("File system access is not available. Use fetchXbrl() instead."); }
        checkAborted(request?.signal);
        const cached = cache.findCachedXbrl(dir, docId);
        if (cached) return cached;
        const archive = await this.loadDocumentArchive(docId, request);
        checkAborted(request?.signal);
        return cache.persistZipArchive(dir, docId, archive, this.xbrlEntryName(archive));
    }

    /** 明示書類の安全に検査したZIP、または通常ファイルのキャッシュからUTF-8本文を返します。 */
    public async fetchXbrl(docId: string, request?: EdinetRequestOptions): Promise<string> {
        request = snapshotRequest(request);
        checkAborted(request?.signal);
        assertDownloadDocId(docId);
        if (this.rootDir) {
            let cache: typeof import("./zip-cache") | undefined;
            try { cache = await import("./zip-cache"); }
            catch (error) {
                // Nodeでの権限/実装エラーを、キャッシュなしへ変換して通信しません。
                if (typeof process !== "undefined" && process.versions?.node) throw error;
            }
            checkAborted(request?.signal);
            if (cache) {
                const cached = cache.findCachedXbrl(this.rootDir, docId);
                if (cached) return cache.readCachedXbrl(cached);
            }
        }
        const archive = await this.loadDocumentArchive(docId, request);
        checkAborted(request?.signal);
        const bytes = await archive.readEntry(this.xbrlEntryName(archive));
        checkAborted(request?.signal);
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
        return this.readResponse(response, maxBytes);
    }

    private async readResponse(response: Response, maxBytes?: number, signal?: AbortSignal): Promise<Uint8Array> {
        let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
        const chunks: Uint8Array[] = []; let total = 0;
        try {
            if (!response.body) return new Uint8Array();
            reader = response.body.getReader();
            const declared = response.headers.get("content-length");
            if (maxBytes !== undefined && declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) throw new ResponseValidationError("ZIP受信量が上限を超えています");
            for (;;) {
                let item: ReadableStreamReadResult<Uint8Array>;
                try { item = await withAbort(reader.read(), signal); }
                catch (error) { throw error instanceof EdinetRequestError ? error : new EdinetRequestError(EdinetRequestErrorCode.Network); }
                if (signal?.aborted) throw abortError(signal);
                const { done, value } = item;
                if (done) break;
                if (!(value instanceof Uint8Array) || (maxBytes !== undefined && value.byteLength > maxBytes - total)) throw new ResponseValidationError("ZIP受信量が上限を超えています");
                total += value.byteLength; chunks.push(new Uint8Array(value));
            }
            const bytes = new Uint8Array(total); let offset = 0;
            for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
            return bytes;
        } catch (error) {
            try { void reader?.cancel().catch(() => {}); } catch { /* 取消し完了を待たず、元の検査エラーを保持します。 */ }
            if (error instanceof EdinetRequestError || error instanceof ResponseValidationError) throw error;
            throw new EdinetRequestError(EdinetRequestErrorCode.Network);
        } finally { try { reader?.releaseLock(); } catch { /* pending readの取消し後も永久待ちしません。 */ } }
    }

    private async loadDocumentArchive(docId: string, request?: EdinetRequestOptions): Promise<LoadedZipArchive> {
        const url = `${EdinetXbrlDownloader.API_ENDPOINT}/documents/${docId}?type=1&Subscription-Key=${this.apiKey}`;
        const response = await this.fetchWithRetry(url, request, "zip");
        if (!response.ok) throw new Error(`Failed to download document ${docId}: HTTP ${response.status}`);
        if (response.contentType?.toLowerCase().includes("application/json")) throw new Error("EDINETのZIP取得応答がJSONでした（本文は非表示）");
        checkAborted(request?.signal);
        return loadZipArchive(response.bytes);
    }

    /**
     * 指定した期間の書類を検索します。
     * @param startDate 開始日 (YYYY-MM-DD)
     * @param endDate 終了日 (YYYY-MM-DD)
     * @param typeFilter 書類種別 (オプション)
     * @returns 書類リスト
     */
    public async searchPeriod(startDate: string, endDate: string, typeFilter?: EdinetDocumentType, request?: EdinetRequestOptions): Promise<EdinetDocument[]> {
        request = snapshotRequest(request);
        checkAborted(request?.signal);
        const start = new Date(startDate);
        const end = new Date(endDate);
        const results: EdinetDocument[] = [];

        for (let d = start; d <= end; d.setDate(d.getDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0];
            try {
                const docs = await (request === undefined ? this.search(dateStr, typeFilter) : this.search(dateStr, typeFilter, request));
                results.push(...docs);
            } catch (e) {
                if (e instanceof EdinetRequestError && e.code !== EdinetRequestErrorCode.Network) throw e;
                console.warn("EDINET書類一覧の検索に失敗しました（詳細は非表示）");
            }
            // 範囲が広い場合、レートリミットを避けるための待機
            if (d.getTime() < end.getTime()) {
                await waitForRequest(100, request?.signal);
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
    public async findLatest(ticker: string, type: EdinetDocumentType | EdinetDocumentType[], lookbackDays: number = 90, request?: EdinetRequestOptions): Promise<EdinetDocument | null> {
        request = snapshotRequest(request);
        checkAborted(request?.signal);
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
                const docs = await (request === undefined ? this.search(dateStr, type) : this.search(dateStr, type, request));
                const match = docs.find(doc => doc.secCode === secCode && doc.docInfoEditStatus === 0);

                if (match) {
                    return match;
                }
            } catch (e) {
                if (e instanceof EdinetRequestError && e.code !== EdinetRequestErrorCode.Network) throw e;
                console.warn("EDINET書類一覧の検索に失敗しました（詳細は非表示）");
            }

            // レート制限への配慮
            if (i + 1 < lookbackDays) await waitForRequest(100, request?.signal);
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
        type: EdinetDocumentType | EdinetDocumentType[] = EdinetDocumentType.AnnualCards,
        request?: EdinetRequestOptions
    ): Promise<string | null> {
        request = snapshotRequest(request);
        const docs = await (request === undefined ? this.search(date) : this.search(date, undefined, request));

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
            console.warn("対象書類が見つかりませんでした。");
            return null;
        }

        console.log("対象書類を取得します。");
        return request === undefined ? this.download(targetDoc.docID, targetDir) : this.download(targetDoc.docID, targetDir, request);
    }
}
