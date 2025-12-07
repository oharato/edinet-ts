import "dotenv/config"; // .envファイルから環境変数をロード
import { EdinetXbrlDownloader } from "../src/edinet-xbrl-downloader";
import { EdinetRepository } from "../src/db/edinet-repository";
import dayjs from "dayjs";
import cliProgress from "cli-progress";
import * as path from "path";
import * as fs from "fs";

async function main() {
    // 1. セットアップ
    const repo = new EdinetRepository(); // デフォルトの ./data/edinet.db を使用
    const options = {
        apiKey: process.env.EDINET_API_KEY,
        requestsPerSecond: 2, // 1.0より少し積極的に設定
        // ドキュメントには「過度なリクエストを避ける」とある。
        // 1 RPS は安全圏。2 RPS なら15分程度で完了する計算。
        // RateLimiterがあるので2 RPSに設定。
        enableRateLimit: true
    };

    // APIキーの設定確認
    if (!options.apiKey) {
        console.warn("警告: EDINET_API_KEY が設定されていません。認証なしユーザーに対する制限が厳しい場合、API呼び出しが失敗する可能性があります（v2ではリスト取得にもキーが必要です）。");
        // Actually v2 documents.json logic: "Subscription-Key" is query param.
        // If undefined, EdinetXbrlDownloader might fail or work for free tier?
        // Edinet v2 requires an API Key (Account).
    }

    const downloader = new EdinetXbrlDownloader(options);

    // 2. 日付範囲の定義 (過去5年分)
    const end = dayjs();
    const start = end.subtract(5, "year");
    const totalDays = end.diff(start, "day");

    console.log(`=== EDINET DB Seeding ===`);
    console.log(`期間: ${start.format("YYYY-MM-DD")} から ${end.format("YYYY-MM-DD")} (${totalDays} 日間)`);
    console.log(`DBパス: ./data/edinet.db`);

    // 3. プログレスバー
    const bar = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
    bar.start(totalDays, 0);

    // 4. ループ処理
    let current = start;
    let errors = 0;

    // シーケンシャルなループを使用し、一度に大量のプロミスをスタックさせないようにする
    while (current.isBefore(end) || current.isSame(end, "day")) {
        const dateStr = current.format("YYYY-MM-DD");

        try {
            const docs = await downloader.search(dateStr);
            if (docs.length > 0) {
                // 一括挿入
                repo.insertBatch(docs, dateStr);
            }
        } catch (e) {
            errors++;
            // エラーをログに出力するが、Seeding自体は止めない
            // console.error(`Failed ${dateStr}`, e); 
        }

        bar.increment();
        current = current.add(1, "day");

        // 待機処理（Polite Wait）は主にダウンローダーの RateLimiter で処理される。
        // シーケンシャルに await しているため、実質的な間隔は RTT + RateLimiter となる。
    }

    bar.stop();
    repo.close();
    console.log(`\nSeeding完了。エラー数: ${errors}`);
}

main();
