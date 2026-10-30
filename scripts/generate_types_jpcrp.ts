
import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const XSD_PATH = path.join(__dirname, "../taxonomy/タクソノミ/taxonomy/jpcrp/2023-12-01/jpcrp_cor_2023-12-01.xsd");
const LABEL_PATH = path.join(__dirname, "../taxonomy/タクソノミ/taxonomy/jpcrp/2023-12-01/label/jpcrp_2023-12-01_lab.xml");
const OUTPUT_ts = path.join(__dirname, "../src/types/jpcrp_cor_taxonomy.ts");
const OUTPUT_md = path.join(__dirname, "../docs/generated/TAXONOMY_JPCRP_COR.md");

interface ElementInfo {
    name: string;
    type: string;
    label?: string;
}

function main() {
    console.log("Reading XSD...");
    const xsdContent = fs.readFileSync(XSD_PATH, "utf-8");
    const labelContent = fs.readFileSync(LABEL_PATH, "utf-8");

    const parser = new XMLParser({
        ignoreAttributes: false,
        attributeNamePrefix: "@_",
        textNodeName: "#text"
    });

    const xsdObj = parser.parse(xsdContent);
    const labelObj = parser.parse(labelContent);

    // 1. XSDから要素をパース
    const elements: Map<string, ElementInfo> = new Map();
    const xsdElements = xsdObj["xsd:schema"]["xsd:element"];

    if (Array.isArray(xsdElements)) {
        xsdElements.forEach((el: any) => {
            const name = el["@_name"];
            const type = el["@_type"];
            if (name && type) {
                // XBRL型をTS型にマッピング
                let tsType = "string";
                if (type.includes("Monetary")) tsType = "number";
                if (type.includes("Shares")) tsType = "number";
                if (type.includes("PerShare")) tsType = "number";
                if (type.includes("Decimal")) tsType = "number";
                if (type.includes("Integer")) tsType = "number";
                if (type.includes("Percent")) tsType = "number"; // 比率は数値

                // TextBlockは文字列
                if (type.includes("TextBlock")) tsType = "string";

                elements.set(name, { name, type: tsType });
            }
        });
    }

    console.log(`Found ${elements.size} elements in XSD.`);

    // 2. ラベルをパース
    const labels: Map<string, string> = new Map();
    const resources = labelObj["link:linkbase"]["link:labelLink"]["link:label"];

    // IDからラベルへのマップを先に作成
    const labelResourceMap = new Map<string, string>();
    if (Array.isArray(resources)) {
        resources.forEach((res: any) => {
            if (res["@_xml:lang"] === "ja" && res["@_xlink:role"] === "http://www.xbrl.org/2003/role/label") {
                const id = res["@_id"];
                const text = res["#text"];
                labelResourceMap.set(id, text);
            }
        });
    }

    // ロケータ、アーク、リソースをリンク
    // 実際の構造:
    // <link:loc xlink:href="#jpcrp_cor_ElementName" xlink:label="LabelName" />
    // <link:labelArc xlink:from="LabelName" xlink:to="LabelID" />
    // <link:label id="LabelID">Text</link:label>

    // 本来はアークをパースすべきだが、簡易的なヒューリスティックで処理: label ID often contains element name?
    // アークを確認
    const arcs = labelObj["link:linkbase"]["link:labelLink"]["link:labelArc"];
    const locs = labelObj["link:linkbase"]["link:labelLink"]["link:loc"];

    const labelMap: Map<string, string> = new Map(); // LabelName -> LabelText (ID経由)
    if (Array.isArray(arcs)) {
        arcs.forEach((arc: any) => {
            if (arc["@_xlink:arcrole"] === "http://www.xbrl.org/2003/arcrole/concept-label") {
                const from = arc["@_xlink:from"];
                const to = arc["@_xlink:to"]; // ID of the label resource
                const text = labelResourceMap.get(to);
                if (from && text) {
                    labelMap.set(from, text);
                }
            }
        });
    }

    // ロケータを要素名にマッピング
    if (Array.isArray(locs)) {
        locs.forEach((loc: any) => {
            const href = loc["@_xlink:href"]; // e.g. "../jpcrp_cor_2023-12-01.xsd#jpcrp_cor_NetSales"
            const labelName = loc["@_xlink:label"];

            if (href && labelName) {
                const elementName = href.split("#")[1].replace("jpcrp_cor_", "");
                const labelText = labelMap.get(labelName);

                if (elements.has(elementName) && labelText) {
                    const info = elements.get(elementName);
                    if (info) info.label = labelText;
                }
            }
        });
    }

    // 3. TSインターフェースを生成
    let tsContent = `/**
 * EDINET Taxonomy (jpcrp_cor: Corporate Information)
 * Generated automatically.
 */
export interface JpcrpCorTaxonomy {
`;

    elements.forEach((info) => {
        const doc = info.label ? `    /** ${info.label} */\n` : "";
        tsContent += `${doc}    ${info.name}?: ${info.type};\n`;
    });
    tsContent += "}\n";

    fs.writeFileSync(OUTPUT_ts, tsContent);
    console.log(`Generated ${OUTPUT_ts}`);

    // 4. Markdownドキュメントを生成
    let mdContent = `# 企業情報本表のタグ一覧（jpcrp_cor）

企業情報本表のXSDとラベルから生成した項目一覧です。開示項目の日本語名やタグ名を探すときに使います。

## 一覧の読み方

- **要素名**: \`jpcrp_cor\` 名前空間のタグ名です。要素名の順に並べています。
- **データ型**: 生成したTypeScript型での表現です。
- **日本語ラベル**: 元資料から取得した項目名です。取得できなかったものは \`-\` で示します。

一覧にあることは、すべての原本に値が存在することや、開示表APIで構造化できることを意味しません。表を読み取る場合は[開示表の使い方](../disclosures/DISCLOSURE_TABLES.md)を確認してください。

更新方法は[タクソノミの更新手順](../development/TAXONOMY_UPDATE.md)を参照してください。表は生成スクリプトで更新します。

名前空間: \`jpcrp_cor\` / 項目数: ${elements.size}

## 項目一覧

| 要素名 | データ型 | 日本語ラベル |
| :--- | :--- | :--- |
`;

    // 名前順にソート
    const sortedElements = Array.from(elements.values()).sort((a, b) => a.name.localeCompare(b.name));

    sortedElements.forEach((info) => {
        mdContent += `| \`${info.name}\` | \`${info.type}\` | ${info.label || "-"} |\n`;
    });

    fs.writeFileSync(OUTPUT_md, mdContent);
    console.log(`Generated ${OUTPUT_md}`);
}

main();
