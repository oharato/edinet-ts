
import XLSX from "xlsx";
import path from "path";

const EXCEL_PATH = path.resolve(__dirname, "../taxonomy/AccountList.xlsx");

function main() {
    const workbook = XLSX.readFile(EXCEL_PATH);
    console.log("All Sheet Names:", workbook.SheetNames);

    const targetSheetName = "一般商工業";

    if (workbook.SheetNames.includes(targetSheetName)) {
        console.log(`\nInspecting Sheet: ${targetSheetName}`);
        const sheet = workbook.Sheets[targetSheetName];
        // Read raw rows
        const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

        console.log("Rows 0-15 details:");
        data.slice(0, 15).forEach((row, index) => {
            console.log(`Row ${index}:`, row);
        });
    } else {
        console.log(`Sheet '${targetSheetName}' not found.`);
    }
}

main();
