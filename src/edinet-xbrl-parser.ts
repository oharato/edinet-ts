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
        });
    }

    /**
     * XML文字列をパースして `EdinetXbrlObject` を返します。
     * @param xmlContent XBRLファイルのテキスト内容
     * @returns パース済みのオブジェクト
     */
    public parse(xmlContent: string): EdinetXbrlObject {
        const parsed = this.parser.parse(xmlContent);
        const xbrlObject = new EdinetXbrlObject();

        // 1. 最初にコンテキストを解析
        this.parseContexts(parsed, xbrlObject);

        // 2. データをトラバースして解析
        this.traverse(parsed, xbrlObject);

        return xbrlObject;
    }

    private parseContexts(root: unknown, xbrlObject: EdinetXbrlObject): void {
        // xbrli:context 要素を探します。通常は root -> xbrli:xbrl -> xbrli:context の階層にあります。
        // ルート要素名が不確定（xbrl以外の場合など）でも対応できるよう、キーを検索します。
        if (!this.isObject(root)) return;

        // 簡略化のため、第1階層の子要素から "xbrli:context" または "xbrl含有キー" -> "context" をスキャンします

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

            // 念のため子要素もチェック
            for (const key of Object.keys(node)) {
                if (key !== "xbrli:context" && !key.startsWith("@_") && typeof node[key] === 'object') {
                    // 最適化: 深すぎる探索を避けます。コンテキストは通常 <xbrl> の直下にあります。
                    if (key.includes("xbrl") || key === "link:linkbaseRef") { // ヒューリスティックな判定
                        findContextsRecursive(node[key]);
                    } else if (key.endsWith("xbrl")) {
                        findContextsRecursive(node[key]);
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
    private traverse(node: unknown, xbrlObject: EdinetXbrlObject): void {
        if (!this.isObject(node)) {
            return;
        }

        for (const key of Object.keys(node)) {
            // 属性（Attribute）とテキストコンテンツ識別子（#text）はスキップします
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
        // contextRefがあれば、それは確実にファクト（事実データ）です。
        // valueがあれば、それはファクトかメタデータの可能性があります。
        // どちらかの条件に合致すれば、包括的にデータを格納します。
        // これは、幅広い構造を許容するオリジナルのPythonライブラリのロジックに合わせています。
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
