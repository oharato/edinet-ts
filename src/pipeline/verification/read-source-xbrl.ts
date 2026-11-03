/** 原本照合専用のXML reader。本体のfast-xml-parserや財務抽出関数を共有しない。 */
import { SaxesParser } from "saxes";
import { strict as assert } from "node:assert";
export const XBRL = "http://www.xbrl.org/2003/instance",
  DIMENSION = "http://xbrl.org/2006/xbrldi",
  NIL = "{http://www.w3.org/2001/XMLSchema-instance}nil";
export interface SourceXmlNode {
  tag: string;
  attributes: Record<string, string>;
  text: string;
  children: SourceXmlNode[];
}
export interface SourceXbrl {
  namespaces: Map<string, string>;
  contexts: Map<string, SourceXmlNode[]>;
  units: Map<string, SourceXmlNode[]>;
  facts: Map<string, SourceXmlNode[]>;
  dei: Map<string, string[]>;
}
export const expanded = (uri: string, local: string) => (uri ? `{${uri}}${local}` : local);
export const factKey = (tag: string, context: string, unit?: string) =>
  JSON.stringify([tag, context, unit ?? null]);
export const children = (node: SourceXmlNode, uri: string, local: string) =>
  node.children.filter((n) => n.tag === expanded(uri, local));
export function descendants(node: SourceXmlNode, uri: string, local: string): SourceXmlNode[] {
  const result: SourceXmlNode[] = [],
    pending = [...node.children];
  while (pending.length) {
    const item = pending.pop()!;
    if (item.tag === expanded(uri, local)) result.push(item);
    pending.push(...item.children);
  }
  return result;
}
export const deiName = (tag: string) =>
  /^\{http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpdei\/\d{4}-\d{2}-\d{2}\/jpdei_cor\}(.+)$/.exec(
    tag,
  )?.[1];
function append<T>(map: Map<string, T[]>, key: string, value: T) {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}
/** context/unitと検査対象のfactだけを保持し、不要な巨大text blockをDOM化しない。 */
export function readSourceXbrl(bytes: Uint8Array, wanted: ReadonlySet<string>): SourceXbrl {
  const result: SourceXbrl = {
      namespaces: new Map(),
      contexts: new Map(),
      units: new Map(),
      facts: new Map(),
      dei: new Map(),
    },
    parser = new SaxesParser({ xmlns: true });
  let depth = 0,
    capturing = false;
  const stack: SourceXmlNode[] = [];
  parser.on("doctype", () => {
    throw Error("Unsupported XML declaration");
  });
  parser.on("opentag", (tag) => {
    depth++;
    for (const [prefix, uri] of Object.entries(tag.ns)) {
      assert(
        !result.namespaces.has(prefix) || result.namespaces.get(prefix) === uri,
        "Namespace rebinding requires separate verification",
      );
      result.namespaces.set(prefix, uri);
    }
    const name = expanded(tag.uri, tag.local);
    if (depth === 2)
      capturing =
        name === expanded(XBRL, "context") ||
        name === expanded(XBRL, "unit") ||
        wanted.has(name) ||
        deiName(name) !== undefined;
    if (!capturing) return;
    const node: SourceXmlNode = {
      tag: name,
      attributes: Object.create(null),
      text: "",
      children: [],
    };
    for (const a of Object.values(tag.attributes))
      node.attributes[expanded(a.uri, a.local)] = a.value;
    if (stack.length) stack.at(-1)!.children.push(node);
    stack.push(node);
  });
  const text = (value: string) => {
    const node = stack.at(-1);
    if (node && !node.children.length) node.text += value;
  };
  parser.on("text", text);
  parser.on("cdata", text);
  parser.on("closetag", () => {
    if (capturing) {
      const node = stack.pop()!;
      if (depth === 2) {
        if (node.tag === expanded(XBRL, "context"))
          append(result.contexts, node.attributes.id, node);
        else if (node.tag === expanded(XBRL, "unit"))
          append(result.units, node.attributes.id, node);
        else {
          if (node.attributes.contextRef !== undefined)
            append(
              result.facts,
              factKey(node.tag, node.attributes.contextRef, node.attributes.unitRef),
              node,
            );
          const name = deiName(node.tag);
          if (name) append(result.dei, name, node.text.trim());
        }
        capturing = false;
      }
    }
    depth--;
  });
  // EDINET originals use UTF-8; unsupported encodings fail instead of replacing bytes silently.
  const xml = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  assert(!/<!DOCTYPE|<!ENTITY/i.test(xml), "Unsupported XML declaration");
  parser.write(xml).close();
  assert(depth === 0 && stack.length === 0, "Incomplete XML");
  return result;
}
