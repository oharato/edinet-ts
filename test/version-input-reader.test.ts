import { expect, it } from "vitest";
import { strictJSON, readVersionXml } from "../src/pipeline/verification/read-version-input";
it.each(['{"a":1,"a":2}', '{"a":1,"\\u0061":2}', '{"nested":{"key":1,"key":2}}', '{"x":1e400}'])(
  "重複キー・非有限値を証拠として受け付けない: %s",
  (text) => {
    expect(() => strictJSON(text)).toThrow();
  },
);
it("文字列内のJSONらしい内容をキーと取り違えない", () => {
  const value = { text: '{"a":1,"a":2}', nested: [{ a: 1 }, { a: 2 }] };
  expect(strictJSON(JSON.stringify(value))).toEqual(value);
});
it("XMLのQName解決では、各nodeの名前空間scopeを保つ", () => {
  const root = readVersionXml(
    Buffer.from(
      '<root xmlns:p="urn:first"><a><p:measure>p:pure</p:measure></a><b xmlns:p="urn:second"><p:measure>p:pure</p:measure></b></root>',
    ),
  );
  expect(root.children[0].children[0].namespaces.get("p")).toBe("urn:first");
  expect(root.children[1].children[0].namespaces.get("p")).toBe("urn:second");
});
it("XMLの外部entityを読まない", () => {
  expect(() =>
    readVersionXml(
      Buffer.from('<!DOCTYPE root [<!ENTITY a SYSTEM "file:///etc/passwd">]><root>&a;</root>'),
    ),
  ).toThrow();
});
