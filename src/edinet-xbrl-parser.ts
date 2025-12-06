import * as fs from "fs";
import { XMLParser } from "fast-xml-parser";
import { EdinetXbrlObject, EdinetData } from "./edinet-xbrl-object";
import { EdinetDataUtil } from "./edinet-data-util";

/**
 * Parsed XBRL content traversal and extraction logic.
 */
export class EdinetXbrlParser {
    private parser: XMLParser;

    constructor() {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
        });
    }

    public parseFile(filePath: string): EdinetXbrlObject {
        const content = fs.readFileSync(filePath, "utf-8");
        return this.parseString(content);
    }

    public parseString(xmlContent: string): EdinetXbrlObject {
        const parsed = this.parser.parse(xmlContent);
        const xbrlObject = new EdinetXbrlObject();

        this.traverse(parsed, xbrlObject);

        return xbrlObject;
    }

    /**
     * Recursively traverses the parsed XML object to find and store XBRL facts.
     */
    private traverse(node: unknown, xbrlObject: EdinetXbrlObject): void {
        if (!this.isObject(node)) {
            return;
        }

        for (const key of Object.keys(node)) {
            // Skip attributes and text content identifiers
            if (key.startsWith("@_") || key === "#text") continue;

            const value = node[key];

            if (Array.isArray(value)) {
                for (const item of value) {
                    this.processNode(key, item, xbrlObject);
                    this.traverse(item, xbrlObject);
                }
            } else if (this.isObject(value)) {
                this.processNode(key, value, xbrlObject);
                this.traverse(value, xbrlObject);
            }
        }
    }

    private processNode(key: string, node: unknown, xbrlObject: EdinetXbrlObject): void {
        // If it has a contextRef, it's definitely a fact.
        // If it has a value, it might be a fact or metadata.
        // We store it if either condition matches to be comprehensive.
        // This aligns with the original Python logic which was permissive.
        const contextRef = EdinetDataUtil.getContextRef(node);
        const value = EdinetDataUtil.getValue(node);

        if (contextRef || value) {
            const edinetData = EdinetData.create(node, key);
            xbrlObject.put(key, edinetData);
        }
    }

    private isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }
}
