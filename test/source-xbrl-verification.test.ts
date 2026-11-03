import { expect, it } from "vitest";
import {
  expanded,
  factKey,
  readSourceXbrl,
  XBRL,
} from "../src/pipeline/verification/read-source-xbrl";

const uri = "urn:test:financial";
const xml = (body: string) =>
  Buffer.from(`<x:xbrl xmlns:x="${XBRL}" xmlns:f="${uri}">${body}</x:xbrl>`);
it("名前空間URIで対象factを選び、不要なtext blockを保持しない", () => {
  const name = expanded(uri, "Assets");
  const result = readSourceXbrl(
    xml(
      '<x:context id="c"><x:period><x:instant>2026-03-31</x:instant></x:period></x:context><f:Assets contextRef="c" unitRef="JPY">100</f:Assets><f:TextBlock>large ignored text</f:TextBlock>',
    ),
    new Set([name]),
  );
  expect(result.facts.size).toBe(1);
  expect(result.facts.get(factKey(name, "c", "JPY"))?.[0].text).toBe("100");
  expect(result.contexts.get("c")?.[0].children[0].children[0].text).toBe("2026-03-31");
});
it.each([
  '<f:Assets xmlns:f="urn:other">100</f:Assets>',
  "<f:Assets>100",
  "<f:Assets>&unknown;</f:Assets>",
])("曖昧な名前空間・不完全XML・未定義entityを拒否する: %s", (body) => {
  expect(() => readSourceXbrl(xml(body), new Set())).toThrow();
});
it("外部entityを宣言するXMLと不正なUTF-8を拒否する", () => {
  expect(() =>
    readSourceXbrl(
      Buffer.from('<!DOCTYPE x [<!ENTITY a SYSTEM "file:///etc/passwd">]><x/>'),
      new Set(),
    ),
  ).toThrow();
  expect(() => readSourceXbrl(Buffer.from([0xff]), new Set())).toThrow();
});
