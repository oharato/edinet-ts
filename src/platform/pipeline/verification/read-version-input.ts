/** 版の証拠照合専用reader。重複JSONキーと外部entityを拒否し、XMLの名前空間scopeを保持する。 */
import { strict as assert } from "node:assert";
import { SaxesParser } from "saxes";
import { RetainedFile } from "../../files/retained-files";
import { expanded, type SourceXmlNode } from "./read-source-xbrl";
export const MIB = 1024 ** 2;
export function bounded(path: string, limit: number) {
  const file = new RetainedFile(path, limit);
  try {
    const bytes = file.read(0, file.bytes);
    file.unchanged();
    return bytes;
  } finally {
    file.close();
  }
}
export function strictJSON(text: string): any {
  const stack: (Set<string> | null)[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "{") stack.push(new Set());
    else if (c === "[") stack.push(null);
    else if (c === "}" || c === "]") stack.pop();
    else if (c === '"') {
      const start = i++;
      for (; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
      const token = JSON.parse(text.slice(start, i + 1));
      let next = i + 1;
      while (/\s/.test(text[next] ?? "") && next < text.length) next++;
      if (text[next] === ":" && stack.at(-1)) {
        const keys = stack.at(-1)!;
        assert(!keys.has(token), "Duplicate JSON key");
        keys.add(token);
      }
    }
  }
  return JSON.parse(text, (_key, value) => {
    assert(typeof value !== "number" || Number.isFinite(value), "Nonfinite JSON");
    return value;
  });
}
export const loadVersionJSON = (path: string) =>
  strictJSON(new TextDecoder("utf-8", { fatal: true }).decode(bounded(path, 272 * MIB)));
export interface VersionXmlNode extends SourceXmlNode {
  children: VersionXmlNode[];
  namespaces: ReadonlyMap<string, string>;
}
export function readVersionXml(raw: Uint8Array): VersionXmlNode {
  assert(raw.byteLength <= 64 * MIB, "XML size limit");
  const text = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  assert(!/<!\s*(DOCTYPE|ENTITY)/i.test(text), "Unsafe XML");
  const parser = new SaxesParser({ xmlns: true }),
    stack: VersionXmlNode[] = [];
  let root: VersionXmlNode | undefined;
  parser.on("doctype", () => {
    throw Error("Unsafe XML declaration");
  });
  parser.on("opentag", (tag) => {
    const parent = stack.at(-1),
      declarations = Object.entries(tag.ns),
      ns = declarations.length
        ? new Map([...(parent?.namespaces ?? []), ...declarations])
        : (parent?.namespaces ?? new Map<string, string>());
    const node: VersionXmlNode = {
      tag: expanded(tag.uri, tag.local),
      attributes: Object.create(null),
      children: [],
      text: "",
      namespaces: ns,
    };
    for (const a of Object.values(tag.attributes))
      node.attributes[expanded(a.uri, a.local)] = a.value;
    if (parent) parent.children.push(node);
    else root = node;
    stack.push(node);
  });
  const append = (value: string) => {
    const node = stack.at(-1);
    if (node && !node.children.length) node.text += value;
  };
  parser.on("text", append);
  parser.on("cdata", append);
  parser.on("closetag", () => {
    stack.pop();
  });
  parser.write(text).close();
  assert(root && !stack.length, "Incomplete XML");
  return root;
}
