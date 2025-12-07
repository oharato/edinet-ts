import { Edinet } from "../src/edinet";
import "dotenv/config";

import * as fs from "fs";

async function main() {
    console.log("=== キャッシュ機能のテスト ===");

    // テスト前にキャッシュディレクトリをクリア
    const cacheDir = "downloads_cache_test";
    if (fs.existsSync(cacheDir)) {
        console.log(`Clearing cache directory: ${cacheDir}`);
        fs.rmSync(cacheDir, { recursive: true, force: true });
    }

    const edinet = new Edinet({
        apiKey: process.env.EDINET_API_KEY,
        rootDir: cacheDir
    });

    const ticker = "7203"; // Toyota
    const years = 1; // 1 year (usually 1 doc)

    console.log("\n1. 初回実行 (ダウンロード発生)...");
    const start1 = Date.now();
    const history1 = await edinet.getFinancialHistory(ticker, years);
    const end1 = Date.now();
    console.log(`取得書類数: ${history1.length}`);
    console.log(`所要時間: ${(end1 - start1) / 1000}秒`);

    console.log("\n2. 2回目実行 (キャッシュ使用)...");
    const start2 = Date.now();
    const history2 = await edinet.getFinancialHistory(ticker, years);
    const end2 = Date.now();
    console.log(`取得書類数: ${history2.length}`);
    console.log(`所要時間: ${(end2 - start2) / 1000}秒`);

    if (end2 - start2 < end1 - start1) {
        console.log("\nSUCCESS: 2回目の実行が高速化されました。");
    } else {
        console.log("\nWARNING: 高速化が確認できませんでした。");
    }
}

main();
