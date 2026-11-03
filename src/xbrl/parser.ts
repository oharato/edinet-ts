import { XMLParser } from "fast-xml-parser";

export interface ParsedFact {
  name: string; // ローカル名 (例: "NetSales", "OperatingIncome")
  qname: string; // 完全修飾名 (例: "jppfs_cor:NetSales")
  contextRef: string; // コンテキストID (例: "CurrentYearDuration")
  value: string; // 生の文字列値
  numericValue?: number; // 数値化された値
  decimals?: number;
  scale?: number;
}

export interface ParsedContext {
  id: string;
  startDate?: string;
  endDate?: string;
  instant?: string;
  isConsolidated: boolean;
}

export interface ParsedXbrlDocument {
  facts: ParsedFact[];
  contexts: Map<string, ParsedContext>;
  dei: Map<string, string>;
}

/**
 * XBRL / iXBRL XML をパースして、Fact一覧、Context、DEIメタデータを抽出するパーサー
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
      isArray: (name) => name === "context" || name === "xbrli:context",
    });
  }

  public parse(xmlContent: string): ParsedXbrlDocument {
    const parsed = this.parser.parse(xmlContent);
    const contexts = new Map<string, ParsedContext>();
    const facts: ParsedFact[] = [];
    const dei = new Map<string, string>();

    // 通常のXBRLではルート直下に xbrli:xbrl または xbrl がある
    const root = parsed["xbrli:xbrl"] || parsed["xbrl"] || parsed;
    this.traverse(root, contexts, facts, dei);

    return {
      facts,
      contexts,
      dei,
    };
  }

  private traverse(
    node: unknown,
    contexts: Map<string, ParsedContext>,
    facts: ParsedFact[],
    dei: Map<string, string>,
  ): void {
    if (!node || typeof node !== "object") return;

    const obj = node as Record<string, unknown>;

    for (const [key, value] of Object.entries(obj)) {
      if (key.startsWith("@_")) continue;

      const localName = key.includes(":") ? key.split(":")[1] : key;

      // 1. Context の解析
      if (localName === "context") {
        const ctxList = Array.isArray(value) ? value : [value];
        for (const ctx of ctxList) {
          this.parseContextNode(ctx, contexts);
        }
        continue;
      }

      // 2. DEI メタデータの解析
      if (key.startsWith("jpdei_cor:") || localName.endsWith("DEI")) {
        const text = this.getTextValue(value);
        if (text !== undefined) {
          dei.set(localName, text);
        }
      }

      // 3. Fact ノードの抽出
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
                decimals: itemObj["@_decimals"] ? parseInt(String(itemObj["@_decimals"]), 10) : undefined,
                scale: itemObj["@_scale"] ? parseInt(String(itemObj["@_scale"]), 10) : undefined,
              });
            }
          } else {
            // 子要素を再帰走査
            this.traverse(item, contexts, facts, dei);
          }
        }
      }
    }
  }

  private parseContextNode(value: unknown, contexts: Map<string, ParsedContext>): void {
    if (!value || typeof value !== "object") return;
    const ctx = value as Record<string, unknown>;
    const id = ctx["@_id"] as string | undefined;
    if (!id) return;

    let startDate: string | undefined;
    let endDate: string | undefined;
    let instant: string | undefined;

    // period
    const period = (ctx["period"] || ctx["xbrli:period"]) as Record<string, unknown> | undefined;
    if (period) {
      startDate = this.getTextValue(period["startDate"] || period["xbrli:startDate"]);
      endDate = this.getTextValue(period["endDate"] || period["xbrli:endDate"]);
      instant = this.getTextValue(period["instant"] || period["xbrli:instant"]);
    }

    // Consolidated か NonConsolidated かの判定
    const isNonConsolidated =
      id.includes("NonConsolidated") ||
      JSON.stringify(ctx).includes("NonConsolidatedMember");

    contexts.set(id, {
      id,
      startDate,
      endDate,
      instant,
      isConsolidated: !isNonConsolidated,
    });
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
