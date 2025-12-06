import * as fs from "fs";
import { XMLParser } from "fast-xml-parser";
import { EdinetXbrlObject, EdinetData } from "./edinet-xbrl-object";
import { EdinetDataUtil } from "./edinet-data-util";

export class EdinetXbrlParser {
    private parser: XMLParser;

    constructor() {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            // Namespaces are important!
            // We want to keep raw tag names like 'jpcrp_cor:NetSales' to extract namespace later.
        });
    }

    public parseFile(filePath: string): EdinetXbrlObject {
        const content = fs.readFileSync(filePath, "utf-8");
        return this.parseString(content);
    }

    public parseString(xmlContent: string): EdinetXbrlObject {
        const parsed = this.parser.parse(xmlContent);
        const xbrlObject = new EdinetXbrlObject();

        // Traverse the parsed object to find facts
        this.traverse(parsed, xbrlObject);

        return xbrlObject;
    }

    private traverse(node: any, xbrlObject: EdinetXbrlObject): void {
        if (!node || typeof node !== "object") {
            return;
        }

        // Iterate over keys
        for (const key of Object.keys(node)) {
            // Skip attributes
            if (key.startsWith("@_")) continue;
            if (key === "#text") continue;

            const value = node[key];

            // value can be an object (single child) or array (multiple children with same tag)
            if (Array.isArray(value)) {
                value.forEach((item) => {
                    this.processNode(key, item, xbrlObject);
                    // Recurse? Facts usually don't contain other facts, but structure might usually be root -> fact.
                    // IF the item is complex, it might contain children.
                    // But strict XBRL facts are elements.
                    // If we recurse indiscriminately, we might process children of facts as facts, which might be wrong or right depending on taxonomy (tuples?).
                    // For financial statements in EDINET, standard facts (Item) are leaf-ish.
                    // Tuples exist but are less common for the "Mats" (Pine) level indicators.
                    // Let's recurse to be safe, but 'processNode' adds the current node.
                    this.traverse(item, xbrlObject);
                });
            } else if (typeof value === "object") {
                this.processNode(key, value, xbrlObject);
                this.traverse(value, xbrlObject);
            }
        }
    }

    private processNode(key: string, node: any, xbrlObject: EdinetXbrlObject): void {
        // Determine if this is a worthwhile node to store.
        // In Python's case, it seems to store *everything* found by `find_all()`.
        // We can filter by checking if it has a contextRef (which implies it's a fact).
        // Or just store everything. Storing everything is safer but memory intensive.
        // Given we want to support 'EdinetDataUtil.getKey', let's use that.

        // Check if it has contextRef, which is a strong indicator of a financial fact.
        const contextRef = EdinetDataUtil.getContextRef(node);
        if (contextRef) {
            // It's a fact!
            const edinetData = EdinetData.create(node, key);
            xbrlObject.put(key, edinetData);
        } else {
            // Even without contextRef, some metadata tags might be useful?
            // But for the purpose of "Financial Analysis", contextRef is usually required.
            // Let's strictly stick to what extracts meaningful data for now.
            // However, if we miss something critical...
            // The python lib `put_node` adds everything. 
            // Let's add everything that "looks" like an element with text content.

            // Actually, let's just add everything. The user can filter.
            // But we need to be careful about not adding structure nodes (like xbrli:xbrl itself) as data?
            // xbrli:xbrl doesn't have a value usually.

            // Let's refine: Add if it has a value OR contextRef.
            const val = EdinetDataUtil.getValue(node);
            if (val || contextRef) {
                const edinetData = EdinetData.create(node, key);
                xbrlObject.put(key, edinetData);
            }
        }
    }
}
