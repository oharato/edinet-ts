
import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const EXCEL_PATH = path.resolve(__dirname, "../taxonomy/AccountList.xlsx");
const OUTPUT_PATH = path.resolve(__dirname, "../docs/TAXONOMY_JPPFS_COR.md");

// 列インデックス（0始まり） scripts/generate_types.ts での確認に基づく
const COL_LABEL_JP = 1;      // B列: 標準ラベル（日本語）
const COL_LABEL_JP_VERBOSE = 2; // C列: 冗長ラベル（日本語）- optional usage
const COL_LABEL_EN = 3;      // D列: 標準ラベル（英語）
const COL_NAMESPACE = 7;     // H列: 名前空間プレフィックス
const COL_ELEMENT_NAME = 8;  // I列: 要素名
const COL_TYPE = 9;          // J列: type
const COL_REFERENCE = 15;    // P列: 参照リンク (法令など)

function main() {
    console.log("Reading Account List Excel...");
    const workbook = XLSX.readFile(EXCEL_PATH);
    const sheetName = "一般商工業";
    const sheet = workbook.Sheets[sheetName];

    if (!sheet) {
        console.error(`Sheet '${sheetName}' not found.`);
        process.exit(1);
    }

    const data: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1 });

    let content = "# EDINET タクソノミ (jppfs_cor) 項目一覧\n\n";
    content += "2024年版 EDINETタクソノミ「財務諸表本表 (jppfs_cor) - 一般商工業」に含まれる項目の一覧です。\n";
    content += "`getJppfsCor()` メソッド経由でアクセス可能なプロパティ名として使用できます。\n\n";
    content += `生成日時: ${new Date().toISOString().split('T')[0]}\n\n`;
    content += "| 要素名 (Property Name) | 標準ラベル (Japanese) | 英語ラベル (English) | データ型 |\n";
    content += "| :--- | :--- | :--- | :--- |\n";

    let count = 0;
    const processedKeys = new Set<string>();

    console.log("Processing rows...");
    // 行0,1はヘッダーのため、行2（インデックス2）から開始
    for (let i = 2; i < data.length; i++) {
        const row = data[i];
        const namespace = row[COL_NAMESPACE];
        const elementName = row[COL_ELEMENT_NAME];
        const labelJp = row[COL_LABEL_JP] || "";
        const labelEn = row[COL_LABEL_EN] || "";
        const type = row[COL_TYPE] || "";

        // フィルタ: jppfs_cor のみ
        if (namespace !== "jppfs_cor") continue;
        if (!elementName) continue;

        // フィルタ: データ項目のみ（金額、文字列など） - 抽象項目は除外
        // ユーザー要望の「1800項目」に合わせて、型定義生成時と同じロジックを使用
        // インターフェースと一致させるため、generate_types.ts と同じフィルタリングロジックを使用

        const isMonetary = type.includes("monetaryItemType");
        const isString = type.includes("stringItemType") || type.includes("textBlockItemType");
        const isDate = type.includes("dateItemType");

        if (!isMonetary && !isString && !isDate) continue;

        if (processedKeys.has(elementName)) continue;
        processedKeys.add(elementName);

        // Markdownテーブル用にパイプをエスケープ
        const safeLabelJp = String(labelJp).replace(/\|/g, "｜").replace(/\r?\n/g, " ");
        const safeLabelEn = String(labelEn).replace(/\|/g, "｜").replace(/\r?\n/g, " ");

        let simpleType = "string";
        if (isMonetary) simpleType = "number";

        content += `| \`${elementName}\` | ${safeLabelJp} | ${safeLabelEn} | ${simpleType} |\n`;
        count++;
    }

    // ディレクトリが存在することを確認
    const outDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, content);
    console.log(`Generated documentation for ${count} items at ${OUTPUT_PATH}`);
}

main();
