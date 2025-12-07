
import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const EXCEL_PATH = path.resolve(__dirname, "../taxonomy/AccountList.xlsx");
const OUTPUT_PATH = path.resolve(__dirname, "../src/types/jppfs_cor_taxonomy.ts");

// 列インデックス（0始まり）
const COL_LABEL_JP = 1;
const COL_NAMESPACE = 7;
const COL_ELEMENT_NAME = 8;
const COL_TYPE = 9;
// const COL_PERIOD_TYPE = 11;

function main() {
    console.log("Reading Account List Excel...");
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = "一般商工業"; // General Commercial and Industrial
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
        console.error(`Sheet '${sheetName}' not found.`);
        process.exit(1);
    }

    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    // 空行とヘッダーをスキップ（データ開始位置から開始）
    // 行1がヘッダーで、データは行2から開始

    const properties: string[] = [];
    const processedKeys = new Set<string>();

    console.log("Processing rows...");
    for (let i = 2; i < data.length; i++) {
        const row = data[i];
        const namespace = row[COL_NAMESPACE];
        const elementName = row[COL_ELEMENT_NAME];
        const labelJp = row[COL_LABEL_JP];
        const type = row[COL_TYPE];

        // 有効な項目をフィルタリング
        if (namespace !== "jppfs_cor") continue;
        if (!elementName || !type) continue;

        // 抽象項目はスキップ（データポイントのみ対象）
        // タイプが item, stringItemType, monetaryItemType かチェック
        // 抽象項目は 'abstract' 列 (Col 13) が 'true' だが、内容で判断

        // データを保持する金額または文字列項目のみを含める
        const isMonetary = type.includes("monetaryItemType");
        const isString = type.includes("stringItemType") || type.includes("textBlockItemType");
        const isDate = type.includes("dateItemType");

        let tsType = "string";
        if (isMonetary) tsType = "number";
        else if (isDate) tsType = "string"; // 日付はJSON/XBRLでは通常文字列
        else if (!isString) continue; // その他の型（boolean、巨大なテキストブロックなど）は一旦スキップ

        // 重複を回避
        if (processedKeys.has(elementName)) continue;
        processedKeys.add(elementName);

        // JSDocを生成
        const jsDoc = `    /**\n     * ${labelJp || elementName}\n     * Namespace: ${namespace}\n     */`;
        const property = `${jsDoc}\n    ${elementName}?: ${tsType};`;
        properties.push(property);
    }

    const fileContent = `
/**
 * EDINET Taxonomy Types (Auto-generated)
 * Based on: 2024 Version EDINET Taxonomy - General Commercial and Industrial
 */
export interface JppfsCorTaxonomy {
${properties.join("\n\n")}
}
`;

    // ディレクトリが存在することを確認
    const outDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, fileContent);
    console.log(`Generated types with ${properties.length} properties at ${OUTPUT_PATH}`);
}

main();
