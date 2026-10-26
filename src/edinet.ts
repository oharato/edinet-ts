import { EdinetRepository } from "./db/edinet-repository";
import { EdinetXbrlDownloader, EdinetClientOptions, EdinetDocument, EdinetRequestOptions, EdinetRequestError, EdinetRequestErrorCode } from "./edinet-xbrl-downloader";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { EdinetDocumentType } from "./edinet-document-type";
import { EdinetMetadata } from "./db/edinet-metadata";
import { KeyMetrics } from "./edinet-xbrl-object";

export interface EdinetConfig extends EdinetClientOptions {
    dbPath?: string;
}

export interface FinancialHistory {
    periodEnd: string;
    submitDate: string;
    docID: string;
    filerName: string;
    metrics: KeyMetrics;
}

/**
 * EDINETライブラリの高レベルファサード。
 * ローカルデータベース（メタデータ）とAPI（XBRLダウンロード）を統合します。
 */
export class Edinet {
    private repo: EdinetRepository;
    private downloader: EdinetXbrlDownloader;
    private parser: EdinetXbrlParser;

    constructor(config?: EdinetConfig) {
        this.repo = new EdinetRepository(config?.dbPath);
        this.downloader = new EdinetXbrlDownloader(config);
        this.parser = new EdinetXbrlParser();
    }

    /**
     * 特定の銘柄の財務推移を取得します。
     * ローカルDBを使用して書類IDを検索し、その後API（またはキャッシュ）からXBRLを取得します。
     * 
     * @param ticker 証券コード (例: "7203")
     * @param years 取得する年数 (デフォルト: 5)
     * @param docType 書類種別 (デフォルト: 有価証券報告書 / 120)
     */
    public async getFinancialHistory(
        ticker: string,
        years: number = 5,
        docType: string = EdinetDocumentType.AnnualCards, // 120
        request?: EdinetRequestOptions
    ): Promise<FinancialHistory[]> {
        if (request !== undefined) {
            let signal: AbortSignal | undefined;
            try { signal = request.signal; }
            catch { throw new Error("signalはAbortSignalまたはundefinedで指定してください"); }
            if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error("signalはAbortSignalまたはundefinedで指定してください");
            request = { signal };
        }
        if (request?.signal?.aborted) throw new EdinetRequestError(EdinetRequestErrorCode.Aborted);
        // ティッカーを正規化 (7203 -> 72030)
        const secCode = ticker.length === 4 ? `${ticker}0` : ticker;

        // 1. DB検索
        const docs = this.repo.findDocuments({
            secCode: secCode,
            docTypeCode: docType,
            limit: years
        });

        if (docs.length === 0) {
            console.warn(`DBに対象の書類が見つかりませんでした (銘柄: ${ticker}, 種別: ${docType})。seedスクリプトを実行しましたか？`);
            return [];
        }

        const history: FinancialHistory[] = [];

        // 2. 取得 & 解析
        // APIへの負荷を考慮して直列処理 (またはダウンローダー内のRateLimiterを使用)
        for (const doc of docs) {
            try {
                // XBRLを取得 (ダウンロード & キャッシュ)
                const xbrlPath = await (request === undefined ? this.downloader.download(doc.docID) : this.downloader.download(doc.docID, undefined, request));
                if (request?.signal?.aborted) throw new EdinetRequestError(EdinetRequestErrorCode.Aborted);

                // ファイル読み込み (Node.js環境前提)
                const fs = await import("fs"); // Dynamic import to avoid top-level node dep if used in edge (though Edinet class is node-centric mostly)
                if (request?.signal?.aborted) throw new EdinetRequestError(EdinetRequestErrorCode.Aborted);
                const xbrlContent = fs.readFileSync(xbrlPath, "utf-8");

                // 解析
                const object = this.parser.parse(xbrlContent);
                const metrics = object.getKeyMetrics();

                history.push({
                    periodEnd: doc.periodEnd,
                    submitDate: doc.submitDate,
                    docID: doc.docID,
                    filerName: doc.filerName,
                    metrics: metrics
                });

            } catch (e) {
                if (e instanceof EdinetRequestError && e.code !== EdinetRequestErrorCode.Network) throw e;
                console.error("書類の処理に失敗しました（詳細は非表示）");
            }
        }

        // DB検索時点で period_end の降順になっているが、念のため
        return history;
    }

    /**
     * 横断検索の前に、対象期間のメタデータをローカルDBへ補います。
     * DBに無い日だけ書類一覧APIを取得し、結果をDBへ保存します。
     * 取得に失敗した日は警告だけを出し、DBにある範囲で検索を続けます。
     * 提出が0件の日は取得済みを記録できないため、次回も再取得します。
     */
    private async ensureMetadataRange(startDate: string, endDate: string, request?: EdinetRequestOptions): Promise<void> {
        const start = new Date(`${startDate}T00:00:00Z`);
        const end = new Date(`${endDate}T00:00:00Z`);
        for (let d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
            const dateStr = d.toISOString().split("T")[0];
            if (this.repo.hasMetadataForDate(dateStr)) continue;
            try {
                const docs = await (request === undefined
                    ? this.downloader.search(dateStr)
                    : this.downloader.search(dateStr, undefined, request));
                if (docs.length > 0) {
                    this.repo.insertBatch(docs, dateStr);
                }
            } catch (e) {
                if (e instanceof EdinetRequestError && e.code !== EdinetRequestErrorCode.Network) throw e;
                console.warn("EDINET書類一覧の補完取得に失敗しました（詳細は非表示）");
            }
            if (request?.signal?.aborted) throw new EdinetRequestError(EdinetRequestErrorCode.Aborted);
        }
    }

    /**
     * 特定の「イベント」が発生した書類を探します (横断検索)。
     * 例: TOB(公開買付)が発表された書類を直近30日分取得する場合などに使用します。
     * 対象期間のうちDBに無い日は、検索の前に書類一覧APIから補います。
     *
     * @param docType 書類種別 (例: EdinetDocumentType.TenderOfferStatement / "240")
     * @param days 過去何日分を検索するか (デフォルト: 30)
     */
    public async findDocumentsByType(docType: EdinetDocumentType | string, days: number = 30, request?: EdinetRequestOptions): Promise<EdinetMetadata[]> {
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - days);

        const startDate = pastDate.toISOString().split('T')[0]; // YYYY-MM-DD
        const endDate = today.toISOString().split('T')[0];

        await this.ensureMetadataRange(startDate, endDate, request);

        return this.repo.findDocuments({
            docTypeCode: docType,
            startDate: startDate
        });
    }

    /**
     * 特定の「提出者」が提出した書類を探します (横断検索)。
     * 例: "株式会社光通信" や "バークシャー" などで検索。
     * 検索自体はDBの全期間が対象です。直近days日のうちDBに無い日は、
     * 検索の前に書類一覧APIから補います。
     *
     * @param filerNamePartial 提出者名の一部
     * @param days メタデータをAPIから補う直近の日数 (デフォルト: 30)
     */
    public async findDocumentsByFiler(filerNamePartial: string, days: number = 30, request?: EdinetRequestOptions): Promise<EdinetMetadata[]> {
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - days);

        await this.ensureMetadataRange(
            pastDate.toISOString().split('T')[0],
            today.toISOString().split('T')[0],
            request
        );

        return this.repo.findDocuments({
            filerName: filerNamePartial
        });
    }

    public close() {
        this.repo.close();
    }
}
