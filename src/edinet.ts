import { EdinetRepository } from "./db/edinet-repository";
import { EdinetXbrlDownloader, EdinetClientOptions, EdinetDocument } from "./edinet-xbrl-downloader";
import { EdinetXbrlParser } from "./edinet-xbrl-parser";
import { EdinetDocumentType } from "./edinet-document-type";
import { EdinetMetadata } from "./db/edinet-metadata";

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
                // XBRLを取得 (ダウンロード & キャッシュ)
                const xbrlPath = await this.downloader.download(doc.doc_id);

                // ファイル読み込み (Node.js環境前提)
                const fs = await import("fs"); // Dynamic import to avoid top-level node dep if used in edge (though Edinet class is node-centric mostly)
                const xbrlContent = fs.readFileSync(xbrlPath, "utf-8");

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

    /**
     * 特定の「イベント」が発生した書類を探します (横断検索)。
     * 例: TOB(公開買付)が発表された書類を直近30日分取得する場合などに使用します。
     * 
     * @param docType 書類種別 (例: EdinetDocumentType.TenderOfferStatement / "240")
     * @param days 過去何日分を検索するか (デフォルト: 30)
     */
    public async findDocumentsByType(docType: EdinetDocumentType | string, days: number = 30): Promise<EdinetMetadata[]> {
        const today = new Date();
        const pastDate = new Date();
        pastDate.setDate(today.getDate() - days);

        const startDate = pastDate.toISOString().split('T')[0]; // YYYY-MM-DD

        return this.repo.findDocuments({
            docTypeCode: docType,
            startDate: startDate
        });
    }

    /**
     * 特定の「提出者」が提出した書類を探します (横断検索)。
     * 例: "株式会社光通信" や "バークシャー" などで検索。
     * 
     * @param filerNamePartial 提出者名の一部
     */
    public async findDocumentsByFiler(filerNamePartial: string): Promise<EdinetMetadata[]> {
        return this.repo.findDocuments({
            filerName: filerNamePartial
        });
    }

    public close() {
        this.repo.close();
    }
}
