import { EdinetRepository } from "./db/edinet-repository";
import { EdinetXbrlDownloader, EdinetClientOptions, EdinetDocument } from "./edinet-xbrl-downloader";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { EdinetDocumentType } from "./edinet-document-type";

export interface EdinetConfig extends EdinetClientOptions {
    dbPath?: string;
}

export interface FinancialHistory {
    periodEnd: string;
    submitDate: string;
    docID: string;
    filerName: string;
    metrics: any; // KeyMetrics
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
        docType: string = EdinetDocumentType.AnnualCards // 120
    ): Promise<FinancialHistory[]> {
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
                // XBRLを取得 (メモリまたはダウンロード)
                // fetchXbrl を使用してコンテンツを直接文字列として取得
                const xbrlContent = await this.downloader.fetchXbrl(doc.doc_id);

                // 解析
                const object = this.parser.parse(xbrlContent);
                const metrics = object.getKeyMetrics();

                history.push({
                    periodEnd: doc.period_end,
                    submitDate: doc.submit_date,
                    docID: doc.doc_id,
                    filerName: doc.filer_name,
                    metrics: metrics
                });

            } catch (e) {
                console.error(`書類の処理に失敗しました ${doc.doc_id} (${doc.submit_date}):`, e);
            }
        }

        // DB検索時点で period_end の降順になっているが、念のため
        return history;
    }

    public close() {
        this.repo.close();
    }
}
