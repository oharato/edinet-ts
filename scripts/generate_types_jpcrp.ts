
import fs from "fs";
import path from "path";
import { XMLParser } from "fast-xml-parser";

const XSD_PATH = path.join(__dirname, "../taxonomy/タクソノミ/taxonomy/jpcrp/2023-12-01/jpcrp_cor_2023-12-01.xsd");
const LABEL_PATH = path.join(__dirname, "../taxonomy/タクソノミ/taxonomy/jpcrp/2023-12-01/label/jpcrp_2023-12-01_lab.xml");
const OUTPUT_ts = path.join(__dirname, "../src/types/jpcrp_taxonomy.ts");
const OUTPUT_md = path.join(__dirname, "../docs/TAXONOMY_JPCRP_COR.md");

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

    // 1. Parse Elements from XSD
    const elements: Map<string, ElementInfo> = new Map();
    const xsdElements = xsdObj["xsd:schema"]["xsd:element"];

    if (Array.isArray(xsdElements)) {
        xsdElements.forEach((el: any) => {
            const name = el["@_name"];
            const type = el["@_type"];
            if (name && type) {
                // Mapping XBRL types to TS types
                let tsType = "string";
                if (type.includes("Monetary")) tsType = "number";
                if (type.includes("Shares")) tsType = "number";
                if (type.includes("PerShare")) tsType = "number";
                if (type.includes("Decimal")) tsType = "number";
                if (type.includes("Integer")) tsType = "number";
                if (type.includes("Percent")) tsType = "number"; // Ratios are decimal numbers

                // TextBlock is string
                if (type.includes("TextBlock")) tsType = "string";

                elements.set(name, { name, type: tsType });
            }
        });
    }

    console.log(`Found ${elements.size} elements in XSD.`);

    // 2. Parse Labels
    const labels: Map<string, string> = new Map();
    const resources = labelObj["link:linkbase"]["link:labelLink"]["link:label"];

    // Create a map of IDs to Labels first
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

    // Link locators to arcs to resources
    // Actually, structure is:
    // <link:loc xlink:href="#jpcrp_cor_ElementName" xlink:label="LabelName" />
    // <link:labelArc xlink:from="LabelName" xlink:to="LabelID" />
    // <link:label id="LabelID">Text</link:label>

    // Ideally we parse arcs, but simple heuristic: label ID often contains element name?
    // Let's check arcs.
    const arcs = labelObj["link:linkbase"]["link:labelLink"]["link:labelArc"];
    const locs = labelObj["link:linkbase"]["link:labelLink"]["link:loc"];

    const labelMap: Map<string, string> = new Map(); // LabelName -> LabelText (via ID)
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

    // Map Locators to Element Names
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

    // 3. Generate TS Interface
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

    // 4. Generate Markdown Documentation
    let mdContent = `# EDINET Taxonomy List (jpcrp_cor)

Namespace: \`jpcrp_cor\`
Total Items: ${elements.size}

| Element Name | Type | Label (JA) |
| :--- | :--- | :--- |
`;

    // Sort by name
    const sortedElements = Array.from(elements.values()).sort((a, b) => a.name.localeCompare(b.name));

    sortedElements.forEach((info) => {
        mdContent += `| \`${info.name}\` | \`${info.type}\` | ${info.label || "-"} |\n`;
    });

    fs.writeFileSync(OUTPUT_md, mdContent);
    console.log(`Generated ${OUTPUT_md}`);
}

main();
