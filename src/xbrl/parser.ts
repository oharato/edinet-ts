import { XMLParser } from "fast-xml-parser";

export interface ParsedFact {
  name: string; // ローカル名 (例: "NetSales", "OperatingIncome")
  qname: string; // 完全修飾名 (例: "jppfs_cor:NetSales")
  contextRef: string; // コンテキストID (例: "CurrentYearDuration")
  value: string; // 生の文字列値
  numericValue?: number; // 数値化された値
  unitRef?: string; // 単位 (例: "JPY")
  decimals?: number;
  scale?: number;
}

export interface ParsedXbrlDocument {
  facts: ParsedFact[];
  dei: Map<string, string>;
}

/**
 * XBRL / iXBRL XML をパースして、Fact一覧とDEIメタデータを抽出するパーサー。
 * Context は Fact の contextRef（CurrentYearDuration 等）で識別するため、定義の解析は行わない。
 */
export class XbrlParser {
  private parser: XMLParser;

  constructor() {
    this.parser = new XMLParser({
      ignoreAttributes: false,
      attributeNamePrefix: "@_",
      textNodeName: "#text",
      parseTagValue: false,
      trimValues: true,
    });
  }

  public parse(xmlContent: string): ParsedXbrlDocument {
    const parsed = this.parser.parse(xmlContent);
    const facts: ParsedFact[] = [];
    const dei = new Map<string, string>();

    // 通常のXBRLではルート直下に xbrli:xbrl または xbrl がある
    const root = parsed["xbrli:xbrl"] || parsed["xbrl"] || parsed;
    this.traverse(root, facts, dei);

    return {
      facts,
      dei,
    };
  }

  private traverse(node: unknown, facts: ParsedFact[], dei: Map<string, string>): void {
    if (!node || typeof node !== "object") return;

    const obj = node as Record<string, unknown>;

    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith("@_")) continue;

      const localName = key.includes(":") ? key.split(":")[1] : key;

      // Context 定義は Fact 抽出に不要なので走査しない。
      if (localName === "context") continue;

      // 1. DEI メタデータの解析
      if (key.startsWith("jpdei_cor:") || localName.endsWith("DEI")) {
        const text = this.getTextValue(value);
        if (text !== undefined) {
          dei.set(localName, text);
        }
      }

      // 2. Fact ノードの抽出
      const items = Array.isArray(value) ? value : [value];
      for (const item of items) {
        if (item && typeof item === "object") {
          const itemObj = item as Record<string, unknown>;
          const contextRef = itemObj["@_contextRef"] as string | undefined;

          if (contextRef) {
            const text = this.getTextValue(itemObj);
            if (text !== undefined) {
              const num = parseFloat(text.replace(/,/g, ""));
              facts.push({
                name: localName,
                qname: key,
                contextRef,
                value: text,
                numericValue: Number.isNaN(num) ? undefined : num,
                unitRef: itemObj["@_unitRef"] as string | undefined,
                decimals: itemObj["@_decimals"]
                  ? parseInt(String(itemObj["@_decimals"]), 10)
                  : undefined,
                scale: itemObj["@_scale"] ? parseInt(String(itemObj["@_scale"]), 10) : undefined,
              });
            }
          } else {
            // 子要素を再帰走査
            this.traverse(item, facts, dei);
          }
        }
      }
    }
  }

  private getTextValue(val: unknown): string | undefined {
    if (val === undefined || val === null) return undefined;
    if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") {
      return String(val).trim();
    }
    if (typeof val === "object") {
      const obj = val as Record<string, unknown>;
      if ("#text" in obj) {
        return String(obj["#text"]).trim();
      }
    }
    return undefined;
  }
}
