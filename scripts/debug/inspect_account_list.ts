
import XLSX from "xlsx";
import path from "path";

const EXCEL_PATH = path.resolve(__dirname, "../taxonomy/AccountList.xlsx");

function main() {
    const workbook = XLSX.readFile(EXCEL_PATH);
    const targetSheetName = "一般商工業";
    const sheet = workbook.Sheets[targetSheetName];

    if (!sheet) {
        console.error(`Sheet ${targetSheetName} not found.`);
        return;
    }

    // jpcrpが存在するか確認するために最初の100行を検査
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    console.log(`Inspecting ${targetSheetName}...`);
    // ヘッダーを表示
    console.log("Header:", data[0]);

    // 1列目（または6列目）に名前空間が含まれているか確認
    // 名前空間が "jpcrp_cor" の可能性がある行を表示
    for (let i = 1; i < 500; i++) {
        const row = data[i];
        if (!row) continue;
        const rowStr = JSON.stringify(row);
        if (rowStr.includes("jpcrp_cor")) {
            console.log(`Found jpcrp_cor at row ${i}:`, row);
            break; // 1つ例が見つかった
        }
    }
}

main();
