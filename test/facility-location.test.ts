import { it, expect } from "vitest";
import { parseFacilitySiteAndLocation as parse } from "../src/domain/disclosures/business/parse-facility-location";
it.each([
  ["本社\n(東京都中央区)", "本社", "東京都中央区", "東京都"],
  ["東京事業所(東京都府中市)", "東京事業所", "東京都府中市", "東京都"],
  [" 仙台倉庫 （宮城県仙台市宮城野区） ", "仙台倉庫", "宮城県仙台市宮城野区", "宮城県"],
  ["札幌支店(北海道札幌市)", "札幌支店", "北海道札幌市", "北海道"],
  ["支店(京都府京都市)", "支店", "京都府京都市", "京都府"],
  ["支店(大阪府大阪市)", "支店", "大阪府大阪市", "大阪府"],
  ["事業所(鹿児島県鹿児島市)", "事業所", "鹿児島県鹿児島市", "鹿児島県"],
  ["営業所(神奈川県横浜市)", "営業所", "神奈川県横浜市", "神奈川県"],
])("原表%sの単一所在地を原綴りのまま分ける", (raw, siteName, location, prefecture) => {
  expect(parse(raw)).toEqual({
    raw,
    status: "selected",
    siteName,
    location,
    prefecture,
    semantics: "reported-cell-only",
  });
});
it.each(["", "大阪支店他４支店・営業所", "厚生施設その他"])("所在地なし%sを住所にしない", (raw) => {
  expect(parse(raw)).toEqual({ raw, status: "unavailable", reason: "no-parenthesized-location" });
});
it.each([
  "工場(賃借)",
  "工場(100㎡)",
  "本社(東京都中央区）",
  "本社（東京都中央区)",
  "(東京都中央区)",
  "工場(東京都港区(借地))",
  "本社(東京都中央区) 工場(大阪府大阪市)",
  "支店(東京都港区、東京都中央区)",
  "支店(東京都港区/神奈川県横浜市)",
  "支店(東京都港区ほか)",
  "支店(東京都港区他２か所)",
  "工場(架空県架空市)",
  "Shanghai(中国上海市)",
  "本社(〒100-0001 東京都千代田区)",
])("複合・権利・未知形式%sを推定しない", (raw) => {
  expect(parse(raw)).toEqual({ raw, status: "unavailable", reason: "unsupported-format" });
});
it("大きすぎるセルを処理せず、不正型を拒否する", () => {
  const raw = "x".repeat(16385);
  expect(parse(raw)).toMatchObject({ raw, status: "unavailable", reason: "input-too-large" });
  expect(() => parse(null as any)).toThrow();
});
