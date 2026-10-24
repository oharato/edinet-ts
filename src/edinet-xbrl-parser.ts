import { collectContextDimensionTraces } from "./context-dimension-traces";
import { assertXmlInput } from "./xml-input";
import { XMLParser } from "fast-xml-parser";
import { EdinetXbrlObject, EdinetData } from "./edinet-xbrl-object";
import { EdinetDataUtil } from "./edinet-data-util";
import { ContextParser } from "./edinet-context";

/**
 * XBRLファイル（XML形式）をパースし、扱いやすい `EdinetXbrlObject` に変換するクラス。
 * `fast-xml-parser` を使用して解析を行います。
 */
export class EdinetXbrlParser {
    private parser: XMLParser;

    constructor() {
        this.parser = new XMLParser({
            ignoreAttributes: false,
            attributeNamePrefix: "@_",
            textNodeName: "#text",
            parseTagValue: false,
        });
    }

    /**
     * XML文字列をパースして `EdinetXbrlObject` を返します。
     * @param xmlContent XBRLファイルのテキスト内容
     * @param docID 書類管理ID (オプション)。指定すると `getCommonMetadata().docID` に反映されます。
     * @returns パース済みのオブジェクト
     */
    public parse(xmlContent: string, docID: string = ""): EdinetXbrlObject {
        assertXmlInput(xmlContent);
        const parsed = this.parser.parse(xmlContent);
        const xbrlObject = new EdinetXbrlObject(docID, collectContextDimensionTraces(parsed));

        // 1. 最初にコンテキストを解析
        this.parseContexts(parsed, xbrlObject);
        this.parseUnits(parsed, xbrlObject);

        // 2. データをトラバースして解析
        this.traverse(parsed, xbrlObject);

        return xbrlObject;
    }

    private namespaces(node: unknown, inherited: Readonly<Record<string, string>> = {}): Record<string, string> {
        const result = { ...inherited };
        if (this.isObject(node)) for (const [name, uri] of Object.entries(node)) {
            if (name.startsWith("@_xmlns:") && typeof uri === "string") result[name.slice(8)] = uri;
        }
        return result;
    }

    private parseUnits(root: unknown, object: EdinetXbrlObject): void {
        if (!this.isObject(root)) return;
        for (const [key, value] of Object.entries(root)) {
            if (!key.includes("xbrl") || !this.isObject(value)) continue;
            const rootNS = this.namespaces(value);
            const validXbrli = (ns: Readonly<Record<string, string>>) => ns.xbrli === "http://www.xbrl.org/2003/instance" ||
                (ns.xbrli === undefined && rootNS.xbrli === undefined);
            const resolveMeasure = (node: unknown, inherited: Readonly<Record<string, string>>): string | undefined => {
                if (Array.isArray(node)) return undefined;
                const ns = this.namespaces(node, inherited);
                if (!validXbrli(ns)) return undefined;
                const [prefix, local, extra] = EdinetDataUtil.getValue(node).split(":");
                if (extra || !local) return undefined;
                if (ns[prefix] === "http://www.xbrl.org/2003/iso4217" && /^[A-Z]{3}$/.test(local)) return `iso4217:${local}`;
                if (ns[prefix] === "http://www.xbrl.org/2003/instance" && ["pure", "shares"].includes(local)) return `xbrli:${local}`;
                return undefined;
            };
            const units = value["xbrli:unit"];
            for (const unit of Array.isArray(units) ? units : units ? [units] : []) {
                if (!this.isObject(unit) || typeof unit["@_id"] !== "string") continue;
                const ns = this.namespaces(unit, rootNS);
                let measure: string | undefined;
                if (validXbrli(ns)) {
                    const divide = unit["xbrli:divide"];
                    if (!divide) measure = resolveMeasure(unit["xbrli:measure"], ns);
                    else if (this.isObject(divide) && !unit["xbrli:measure"]) {
                        const divideNS = this.namespaces(divide, ns);
                        const top = divide["xbrli:unitNumerator"], bottom = divide["xbrli:unitDenominator"];
                        if (divideNS.xbrli === "http://www.xbrl.org/2003/instance" && this.isObject(top) && this.isObject(bottom)) {
                            const numerator = resolveMeasure(top["xbrli:measure"], this.namespaces(top, divideNS));
                            const denominator = resolveMeasure(bottom["xbrli:measure"], this.namespaces(bottom, divideNS));
                            if (numerator === "iso4217:JPY" && denominator === "xbrli:shares") measure = "iso4217:JPY/xbrli:shares";
                        }
                    }
                }
                // 不明単位も記録し、同じIDの有効/無効定義の混在を拒否します。
                object.addUnit(unit["@_id"], measure ?? "unsupported:unit");
            }
        }
    }

    private parseContexts(root: unknown, xbrlObject: EdinetXbrlObject): void {
        // xbrli:context 要素を探します。通常は root -> xbrli:xbrl -> xbrli:context の階層にあります。
        // ルート要素名が不確定（xbrl以外の場合など）でも対応できるよう、キーを検索します。
        if (!this.isObject(root)) return;

        // 簡略化のため、第1階層の子要素から "xbrli:context" または "xbrl含有キー" -> "context" をスキャンします

        const findContextsRecursive = (node: unknown, inherited: Readonly<Record<string, string>> = {}) => {
            if (!this.isObject(node)) return;

            const namespaces = this.namespaces(node, inherited);
            if ("xbrli:context" in node) {
                const contexts = node["xbrli:context"];
                if (Array.isArray(contexts)) {
                    contexts.forEach(c => {
                        const ctx = ContextParser.parse(c, namespaces);
                        if (ctx) xbrlObject.addContext(ctx);
                    });
                } else {
                    const ctx = ContextParser.parse(contexts, namespaces);
                    if (ctx) xbrlObject.addContext(ctx);
                }
            }

            // 念のため子要素もチェック
            for (const key of Object.keys(node)) {
                if (key !== "xbrli:context" && !key.startsWith("@_") && typeof node[key] === 'object') {
                    // 最適化: 深すぎる探索を避けます。コンテキストは通常 <xbrl> の直下にあります。
                    if (key.includes("xbrl") || key === "link:linkbaseRef") { // ヒューリスティックな判定
                        findContextsRecursive(node[key], namespaces);
                    } else if (key.endsWith("xbrl")) {
                        findContextsRecursive(node[key], namespaces);
                    }
                }
            }
        };

        // 多くのEDINETファイルは "xbrli:xbrl" のようなルートキーを持っています
        const rootKeys = Object.keys(root);
        for (const k of rootKeys) {
            if (k.includes("xbrl")) {
                findContextsRecursive(root[k]);
            }
        }
    }

    /**
     * XMLノードを再帰的にトラバースし、すべての要素を `EdinetXbrlObject` に格納します。
     */
    private traverse(node: unknown, xbrlObject: EdinetXbrlObject, inherited: Readonly<Record<string, string>> = {}): void {
        if (!this.isObject(node)) {
            return;
        }

        const namespaces = { ...inherited };
        for (const [key, uri] of Object.entries(node)) {
            if (key.startsWith("@_xmlns:") && typeof uri === "string") namespaces[key.slice(8)] = uri;
        }
        for (const key of Object.keys(node)) {
            // 属性（Attribute）とテキストコンテンツ識別子（#text）はスキップします
            if (key.startsWith("@_") || key === "#text") continue;

            const value = node[key];

            if (Array.isArray(value)) {
                for (const item of value) {
                    this.processNode(key, item, xbrlObject, namespaces);
                    this.traverse(item, xbrlObject, namespaces);
                }
            } else if (this.isObject(value)) {
                this.processNode(key, value, xbrlObject, namespaces);
                this.traverse(value, xbrlObject, namespaces);
            }
        }
    }

    private processNode(key: string, node: unknown, xbrlObject: EdinetXbrlObject, inherited: Readonly<Record<string, string>>): void {
        // contextRefがあれば、それは確実にファクト（事実データ）です。
        // valueがあれば、それはファクトかメタデータの可能性があります。
        // どちらかの条件に合致すれば、包括的にデータを格納します。
        // これは、幅広い構造を許容するオリジナルのPythonライブラリのロジックに合わせています。
        const contextRef = EdinetDataUtil.getContextRef(node);
        const value = EdinetDataUtil.getValue(node);

        if (contextRef || value) {
            const namespaces = { ...inherited };
            if (this.isObject(node)) for (const [name, uri] of Object.entries(node)) {
                if (name.startsWith("@_xmlns:") && typeof uri === "string") namespaces[name.slice(8)] = uri;
            }
            const edinetData = EdinetData.create(node, key, namespaces);
            xbrlObject.put(key, edinetData);
        }
    }

    private isObject(value: unknown): value is Record<string, unknown> {
        return typeof value === "object" && value !== null;
    }
}
