import { Edinet } from "../src/edinet";
import { EdinetDocumentType } from "../src/edinet-document-type"; // Needed specifically
import "dotenv/config";

async function main() {
    console.log("=== 横断検索機能のテスト (Horizontal Analysis) ===");

    // Edinet Facade の初期化
    const edinet = new Edinet({
        apiKey: process.env.EDINET_API_KEY,
        enableRateLimit: true
    });

    try {
        // Test 1: Search by Filer Name
        const filerKey = "トヨタ";
        console.log(`\n1. 提出者名 "${filerKey}" で検索中...`);
        const filerDocs = await edinet.findDocumentsByFiler(filerKey);
        console.log(`ヒット数: ${filerDocs.length}`);
        filerDocs.slice(0, 5).forEach(doc => {
            console.log(` - [${doc.submit_date}] ${doc.filer_name} (${doc.doc_description})`);
        });

        // Test 2: Search by Doc Type (e.g. Annual Reports for everyone)
        // Since we might not have TOB docs in our seeded last 5 years random fetch or if we seeded fully,
        // let's try searching for something broader first, like Annual Reports (120) in the last 30 days of the seed range.
        // Actually the seed script runs for 5 years back from TODAY.

        const docType = "120"; // Annual Report
        const days = 100; // Last 100 days
        console.log(`\n2. 書類種別 "${docType}" (有価証券報告書) を直近 ${days} 日分検索中...`);

        const typeDocs = await edinet.findDocumentsByType(docType, days);
        console.log(`ヒット数: ${typeDocs.length}`);
        typeDocs.slice(0, 5).forEach(doc => {
            console.log(` - [${doc.submit_date}] ${doc.filer_name}: ${doc.doc_description}`);
        });

        if (typeDocs.length === 0) {
            console.log(" (注意: 直近のデータがDBにない可能性があります。seed.tsを実行した時期に依存します)");
        }

    } catch (e) {
        console.error("エラー:", e);
    } finally {
        edinet.close();
    }
}

main();
