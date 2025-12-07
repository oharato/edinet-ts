/**
 * XBRLノードからデータを抽出するためのユーティリティクラス。
 * 属性（'@_'接頭辞）へのアクセスやテキストコンテンツの抽出を処理します。
 */
export class EdinetDataUtil {
    private static readonly CONTEXT_REF = "contextRef";
    private static readonly UNIT_REF = "unitRef";
    private static readonly DECIMALS = "decimals";
    private static readonly FORMAT = "format";
    private static readonly NAME = "name";
    private static readonly SCALE = "scale";

    /**
     * ノードキーからタグ名を抽出します。名前空間が存在する場合は除去します。
     * @param nodeKey 例: "jpcrp_cor:NetSales"
     * @returns 例: "NetSales"
     */
    public static getKey(nodeKey: string): string {
        return nodeKey.includes(":") ? nodeKey.split(":")[1] : nodeKey;
    }

    /**
     * ノードキーから名前空間を抽出します。
     * @param nodeKey 例: "jpcrp_cor:NetSales"
     * @returns 例: "jpcrp_cor"
     */
    public static getNamespace(nodeKey: string): string {
        return nodeKey.includes(":") ? nodeKey.split(":")[0] : "";
    }

    /**
     * ノードからテキスト値を抽出します。
     * ノードが'#text'プロパティを持つオブジェクトである場合や、プリミティブ値である場合を処理します。
     */
    public static getValue(node: unknown): string {
        if (this.isObject(node) && "#text" in node) {
            return String(node["#text"]);
        }
        if (node === undefined || node === null) {
            return "";
        }
        if (typeof node !== "object") {
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

    /**
     * ノードの `contextRef` 属性を取得します。
     */
    public static getContextRef(node: unknown): string {
        return this.getAttribute(node, this.CONTEXT_REF);
    }

    /**
     * ノードの `unitRef` 属性を取得します。
     */
    public static getUnitRef(node: unknown): string {
        return this.getAttribute(node, this.UNIT_REF);
    }

    /**
     * ノードの `decimals` 属性（精度）を取得します。
     */
    public static getDecimals(node: unknown): number {
        const val = this.getAttribute(node, this.DECIMALS);
        return val ? parseInt(val, 10) : 0;
    }

    /**
     * ノードの `format` 属性を取得します。
     */
    public static getFormat(node: unknown): string {
        return this.getAttribute(node, this.FORMAT);
    }

    /**
     * ノードの `name` 属性を取得します。
     */
    public static getName(node: unknown): string {
        return this.getAttribute(node, this.NAME);
    }

    /**
     * ノードの `scale` 属性を取得します。
     */
    public static getScale(node: unknown): number {
        const val = this.getAttribute(node, this.SCALE);
        return val ? parseInt(val, 10) : 0;
    }

    private static isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }
}
