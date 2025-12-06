export class EdinetDataUtil {
    private static readonly CONTEXT_REF = "contextRef";
    private static readonly UNIT_REF = "unitRef";
    private static readonly DECIMALS = "decimals";
    private static readonly FORMAT = "format";
    private static readonly NAME = "name";
    private static readonly SCALE = "scale";

    // fast-xml-parser default attribute prefix is usually empty or '@_' depending on config.
    // We will assume a consistent usage where attributes are accessible.
    // Since we haven't configured the parser yet, I'll design this to work with
    // the expected output structure of fast-xml-parser when `ignoreAttributes: false` is set.
    // Usually, attributes can be accessed via a property if configured, or directly if flattened.
    // However, fast-xml-parser often puts attributes in a separate property or prefixes them.
    // Let's assume we use `attributeNamePrefix: ""` and `attributesGroupName: "@_attributes"`.
    // Wait, the simplest for `fast-xml-parser` is often just to have attributes as properties prefixed with `@_`.
    // Let's defer strict type checking for the node structure and assume it's an object with keys.

    public static getKey(nodeKey: string): string {
        // In fast-xml-parser, the "key" is usually the property name in the parent object.
        // However, if we preserve namespaces, it might be "jpcrp_cor:NetSales".
        if (nodeKey.includes(":")) {
            return nodeKey.split(":")[1];
        }
        return nodeKey;
    }

    public static getNamespace(nodeKey: string): string {
        if (nodeKey.includes(":")) {
            return nodeKey.split(":")[0];
        }
        return "";
    }

    public static getValue(node: any): string {
        // fast-xml-parser stores text content in `#text` by default if there are attributes.
        if (node && typeof node === "object" && "#text" in node) {
            return node["#text"];
        }
        // If it's a simple value
        if (typeof node !== "object") {
            return String(node);
        }
        return "";
    }

    private static getAttribute(node: any, attrName: string): string {
        // Assuming attributes are prefixed with '@_' based on typical fast-xml-parser defaults
        // or we will configure the parser to use '@_' prefix.
        const key = `@_${attrName}`;
        return node[key] || "";
    }

    public static getContextRef(node: any): string {
        return this.getAttribute(node, this.CONTEXT_REF);
    }

    public static getUnitRef(node: any): string {
        return this.getAttribute(node, this.UNIT_REF);
    }

    public static getDecimals(node: any): number {
        const val = this.getAttribute(node, this.DECIMALS);
        return val ? parseInt(val, 10) : 0;
    }

    public static getFormat(node: any): string {
        return this.getAttribute(node, this.FORMAT);
    }

    public static getName(node: any): string {
        return this.getAttribute(node, this.NAME);
    }

    public static getScale(node: any): number {
        const val = this.getAttribute(node, this.SCALE);
        return val ? parseInt(val, 10) : 0;
    }
}
