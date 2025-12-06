import * as fs from "fs";
import { XMLParser } from "fast-xml-parser";
import { EdinetXbrlObject, EdinetData } from "./edinet-xbrl-object";
import { EdinetDataUtil } from "./edinet-data-util";
import { ContextParser } from "./edinet-context";

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

        // 1. Parse Contexts first
        this.parseContexts(parsed, xbrlObject);

        // 2. Traverse for Data
        this.traverse(parsed, xbrlObject);

        return xbrlObject;
    }

    private parseContexts(root: unknown, xbrlObject: EdinetXbrlObject): void {
        // Find xbrli:context elements. usually under root -> xbrli:xbrl -> xbrli:context
        // Since we don't know exact root name (sometimes xbrl, sometimes something else?), we can search keys.
        if (!this.isObject(root)) return;

        // Usually root is like { "xbrli:xbrl": { ... } }
        // We look for any key that contains "xbrl" or search recursively?
        // Actually, traverse is generic, maybe we can just find them there?
        // BUT we need contexts indexed BEFORE processing data if we want to validate?
        // No, we can process contexts independently.

        // Let's assume standard structure or search a bit.
        // For simplicity, let's scan the first level children for "xbrli:context" or "xbrl" -> "context"

        const findContextsRecursive = (node: unknown) => {
            if (!this.isObject(node)) return;

            if ("xbrli:context" in node) {
                const contexts = node["xbrli:context"];
                if (Array.isArray(contexts)) {
                    contexts.forEach(c => {
                        const ctx = ContextParser.parse(c);
                        if (ctx) xbrlObject.addContext(ctx);
                    });
                } else {
                    const ctx = ContextParser.parse(contexts);
                    if (ctx) xbrlObject.addContext(ctx);
                }
            }

            // Also check children just in case
            for (const key of Object.keys(node)) {
                if (key !== "xbrli:context" && !key.startsWith("@_") && typeof node[key] === 'object') {
                    // Optimization: don't go too deep. Contexts are usually top level in <xbrl>
                    if (key.includes("xbrl") || key === "link:linkbaseRef") { // Just heuristics
                        findContextsRecursive(node[key]);
                    } else if (key.endsWith("xbrl")) {
                        findContextsRecursive(node[key]);
                    }
                }
            }
        };

        // Most EDINET files have root key like "xbrli:xbrl"
        const rootKeys = Object.keys(root);
        for (const k of rootKeys) {
            if (k.includes("xbrl")) {
                findContextsRecursive(root[k]);
            }
        }
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
