
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

    // Inspect first 100 rows to see if jpcrp exists
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 }) as any[][];

    console.log(`Inspecting ${targetSheetName}...`);
    // Print header
    console.log("Header:", data[0]);

    // Check first column usually contains namespace? or 6th column?
    // Let's print rows where namespace might be "jpcrp_cor"
    for (let i = 1; i < 500; i++) {
        const row = data[i];
        if (!row) continue;
        const rowStr = JSON.stringify(row);
        if (rowStr.includes("jpcrp_cor")) {
            console.log(`Found jpcrp_cor at row ${i}:`, row);
            break; // Found one example
        }
    }
}

main();
