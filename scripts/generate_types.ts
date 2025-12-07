
import XLSX from "xlsx";
import fs from "fs";
import path from "path";

const EXCEL_PATH = path.resolve(__dirname, "../taxonomy/AccountList.xlsx");
const OUTPUT_PATH = path.resolve(__dirname, "../src/types/taxonomy.ts");

// Column Indices (0-based) based on inspection
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
    // Skip empty rows and headers (start from where data likely begins, e.g. row 2 or based on content)
    // Actually, Row 1 is header, data starts from Row 2.

    const properties: string[] = [];
    const processedKeys = new Set<string>();

    console.log("Processing rows...");
    for (let i = 2; i < data.length; i++) {
        const row = data[i];
        const namespace = row[COL_NAMESPACE];
        const elementName = row[COL_ELEMENT_NAME];
        const labelJp = row[COL_LABEL_JP];
        const type = row[COL_TYPE];

        // Filter valid items
        if (namespace !== "jppfs_cor") continue;
        if (!elementName || !type) continue;

        // Skip abstract items often (unless we want them for structure, but usually we want data points)
        // Checking if type is item or stringItemType or monetary
        // Abstract items have 'true' in 'abstract' column (Col 13), but let's check content.

        // Only include monetary or string items that hold data
        const isMonetary = type.includes("monetaryItemType");
        const isString = type.includes("stringItemType") || type.includes("textBlockItemType");
        const isDate = type.includes("dateItemType");

        let tsType = "string";
        if (isMonetary) tsType = "number";
        else if (isDate) tsType = "string"; // Dates are strings in JSON/XBRL usually
        else if (!isString) continue; // Skip other types for now (e.g., boolean, huge text blocks if not wanted)

        // Avoid duplicates
        if (processedKeys.has(elementName)) continue;
        processedKeys.add(elementName);

        // Generate JSDoc
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

    // Ensure directory exists
    const outDir = path.dirname(OUTPUT_PATH);
    if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
    }

    fs.writeFileSync(OUTPUT_PATH, fileContent);
    console.log(`Generated types with ${properties.length} properties at ${OUTPUT_PATH}`);
}

main();
