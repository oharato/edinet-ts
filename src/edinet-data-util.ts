/**
 * Utility class for extracting data from parsed XBRL nodes.
 * Handles attribute access (prefixed with '@_') and text content extraction.
 */
export class EdinetDataUtil {
    private static readonly CONTEXT_REF = "contextRef";
    private static readonly UNIT_REF = "unitRef";
    private static readonly DECIMALS = "decimals";
    private static readonly FORMAT = "format";
    private static readonly NAME = "name";
    private static readonly SCALE = "scale";

    /**
     * Extract the tag name from a node key, stripping namespace if present.
     * @param nodeKey e.g. "jpcrp_cor:NetSales"
     * @returns e.g. "NetSales"
     */
    public static getKey(nodeKey: string): string {
        return nodeKey.includes(":") ? nodeKey.split(":")[1] : nodeKey;
    }

    /**
     * Extract the namespace from a node key.
     * @param nodeKey e.g. "jpcrp_cor:NetSales"
     * @returns e.g. "jpcrp_cor"
     */
    public static getNamespace(nodeKey: string): string {
        return nodeKey.includes(":") ? nodeKey.split(":")[0] : "";
    }

    /**
     * Extract the text value from a node.
     * Handles cases where the node is an object with '#text' property or a primitive value.
     */
    public static getValue(node: unknown): string {
        if (this.isObject(node) && "#text" in node) {
            return String(node["#text"]);
        }
        if (node !== null && typeof node !== "object") {
            return String(node);
        }
        return "";
    }

    private static getAttribute(node: unknown, attrName: string): string {
        const key = `@_${attrName}`;
        if (this.isObject(node) && key in node) {
            return String(node[key]);
        }
        return "";
    }

    public static getContextRef(node: unknown): string {
        return this.getAttribute(node, this.CONTEXT_REF);
    }

    public static getUnitRef(node: unknown): string {
        return this.getAttribute(node, this.UNIT_REF);
    }

    public static getDecimals(node: unknown): number {
        const val = this.getAttribute(node, this.DECIMALS);
        return val ? parseInt(val, 10) : 0;
    }

    public static getFormat(node: unknown): string {
        return this.getAttribute(node, this.FORMAT);
    }

    public static getName(node: unknown): string {
        return this.getAttribute(node, this.NAME);
    }

    public static getScale(node: unknown): number {
        const val = this.getAttribute(node, this.SCALE);
        return val ? parseInt(val, 10) : 0;
    }

    private static isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }
}
