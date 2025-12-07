import { Edinet } from "../src/edinet";
import "dotenv/config";

async function main() {
    console.log("=== 財務分析機能のテスト (Historical Data Analysis) ===");

    // Edinet Facade の初期化
    const edinet = new Edinet({
        apiKey: process.env.EDINET_API_KEY,
        enableRateLimit: true
    });

    try {
        const ticker = "7203"; // トヨタ自動車
        const years = 3;
        console.log(`${ticker} の過去 ${years} 年分の有価証券報告書を取得中...`);

        const history = await edinet.getFinancialHistory(ticker, years);

        console.log(`\n${history.length} 件のレポートが見つかりました:`);
        history.forEach(h => {
            console.log(`\n[決算日: ${h.periodEnd}] (提出日: ${h.submitDate})`);
            console.log(`  売上高: ${h.metrics.netSales}`);
            console.log(`  営業利益: ${h.metrics.operatingIncome}`);
            console.log(`  当期純利益: ${h.metrics.netIncome}`);
        });

    } catch (e) {
        console.error("エラー:", e);
    } finally {
        edinet.close();
    }
}

main();
