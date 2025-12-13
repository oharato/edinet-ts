import { EdinetXbrlDownloader } from "./edinet-xbrl-downloader";
import { EdinetRepository } from "./db/edinet-repository";
import dayjs from "dayjs";

export interface EdinetInfoSeederOptions {
    /** API Key for EDINET API */
    apiKey?: string;
    /** Path to sqlite database file. Default: ./data/edinet.db */
    dbPath?: string;
    /** Start date for seeding. Default: 5 years ago */
    start?: string | Date | dayjs.Dayjs;
    /** End date for seeding. Default: Today */
    end?: string | Date | dayjs.Dayjs;
    /** Call back on progress increment */
    onProgress?: (processed: number, total: number) => void;
    /** Callback on error */
    onError?: (error: unknown, dateStr: string) => void;
}

export class EdinetInfoSeeder {
    constructor(private options: EdinetInfoSeederOptions) { }

    async run(): Promise<void> {
        // 1. セットアップ
        const repo = new EdinetRepository(this.options.dbPath);
        const downloaderOptions = {
            apiKey: this.options.apiKey,
            requestsPerSecond: 2,
            enableRateLimit: true
        };

        if (!downloaderOptions.apiKey) {
            console.warn("警告: EDINET_API_KEY が設定されていません。");
        }

        const downloader = new EdinetXbrlDownloader(downloaderOptions);

        // 2. 日付範囲の定義
        const end = dayjs(this.options.end || undefined);
        const start = this.options.start ? dayjs(this.options.start) : end.subtract(5, "year");
        const totalDays = end.diff(start, "day") + 1; // inclusive

        // 4. ループ処理
        let current = start;
        let processed = 0;

        while (current.isBefore(end) || current.isSame(end, "day")) {
            const dateStr = current.format("YYYY-MM-DD");

            try {
                const docs = await downloader.search(dateStr);
                if (docs.length > 0) {
                    repo.insertBatch(docs, dateStr);
                }
            } catch (e) {
                if (this.options.onError) {
                    this.options.onError(e, dateStr);
                }
            }

            processed++;
            if (this.options.onProgress) {
                this.options.onProgress(processed, totalDays);
            }

            current = current.add(1, "day");
        }

        repo.close();
    }
}
