/** Parts of a reported cell. No geocoding, parcel matching, or property identity is established. */
export type FacilityLocationParts = { raw: string } & (
    { status: "selected"; siteName: string; location: string; prefecture: string; semantics: "reported-cell-only" } |
    { status: "unavailable"; reason: "no-parenthesized-location" | "unsupported-format" | "input-too-large" }
);
const prefectures = "北海道 青森県 岩手県 宮城県 秋田県 山形県 福島県 茨城県 栃木県 群馬県 埼玉県 千葉県 東京都 神奈川県 新潟県 富山県 石川県 福井県 山梨県 長野県 岐阜県 静岡県 愛知県 三重県 滋賀県 京都府 大阪府 兵庫県 奈良県 和歌山県 鳥取県 島根県 岡山県 広島県 山口県 徳島県 香川県 愛媛県 高知県 福岡県 佐賀県 長崎県 熊本県 大分県 宮崎県 鹿児島県 沖縄県".split(" ");
/** Split a single trailing (所在地) or （所在地） with an explicit Japanese prefecture. Preserve the original spelling. */
export function parseFacilitySiteAndLocation(raw: string): FacilityLocationParts {
    if (typeof raw !== "string") throw new Error("設備の事業所名・所在地の原文を指定してください");
    if (Buffer.byteLength(raw) > 16384) return { raw, status: "unavailable", reason: "input-too-large" };
    const text = raw.trim();
    if (!/[()（）]/.test(text)) return { raw, status: "unavailable", reason: "no-parenthesized-location" };
    const match = /^([^()（）]+?)(?:\(([^()（）]+)\)|（([^()（）]+)）)$/.exec(text);
    if (match) {
        const siteName = match[1].trim(), location = (match[2] ?? match[3]).trim();
        const prefecture = prefectures.find(p => location.startsWith(p));
        if (siteName && prefecture && !/[,、;；/／]|(?:ほか|他)(?:[0-9０-９一二三四五六七八九十]|$)/.test(location) && !prefectures.some(p => location.slice(prefecture.length).includes(p)))
            return { raw, status: "selected", siteName, location, prefecture, semantics: "reported-cell-only" };
    }
    return { raw, status: "unavailable", reason: "unsupported-format" };
}
