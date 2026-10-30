import { createHash } from "node:crypto";
import { DisclosureTableKind } from "../../src/disclosure-tables";
import type { FacilityDetailDocument } from "../../src/facility-details";
const ns = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor";
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
export function facilityTable(kind: 9 | 11 | 12 = 9, row = ["本社（架空市）", "通信", "1,234.5", "9", "100.25", "2,000", "－", "3,300", "10"]): string {
    if (kind === 9) return `<table><thead><tr><td rowspan="3">事業所名（所在地）</td><td rowspan="3">セグメントの名称</td><td colspan="6">帳簿価額</td><td rowspan="3">従業員数（人）</td></tr><tr><td rowspan="2">建物・構築物（百万円）</td><td rowspan="2">機械・運搬具・工具器具備品（百万円）</td><td colspan="2">土地</td><td rowspan="2">リース資産（百万円）</td><td rowspan="2">合計（百万円）</td></tr><tr><td>面積（㎡）</td><td>金額（百万円）</td></tr></thead><tbody><tr>${row.map(c => `<td>${c}</td>`).join("")}</tr></tbody></table>`;
    const company = kind === 12 ? '<td rowspan="3">会社名</td>' : '';
    return `<table><thead><tr>${company}<td rowspan="3">事業所名(所在地)</td><td rowspan="3">セグメントの名称</td><td rowspan="3">設備の内容</td><td colspan="7">帳簿価額（百万円）</td><td rowspan="3">従業員数(人)</td></tr><tr><td rowspan="2">建物及び構築物</td><td rowspan="2">機械装置及び運搬具</td><td colspan="2">土地</td><td rowspan="2">リース資産</td><td rowspan="2">その他</td><td rowspan="2">合計</td></tr><tr><td>面積(㎡)</td><td>金額</td></tr></thead><tbody><tr>${(kind === 12 ? ['架空子会社'] : []).concat([row[0],row[1],'事務所',row[2],row[3],row[4],row[5],row[6],'0',row[7],row[8]]).map(c => `<td>${c}</td>`).join('')}</tr></tbody></table>`;
}
const context = '<xbrli:context id="filing"><xbrli:entity><xbrli:identifier scheme="fixture">PARENT</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-24</xbrli:instant></xbrli:period></xbrli:context>';
export function facilityDocument(docID = "A", rawTable = facilityTable(), year = 2026): FacilityDetailDocument {
    const raw = `<p>${year}年３月31日現在 提出会社</p>${rawTable}<p>注：賃借及び複数拠点を含む場合があります。</p>`;
    const xml = `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:j="${ns}">${context.replace("PARENT", docID)}<j:MajorFacilitiesTextBlock contextRef="filing">${escape(raw)}</j:MajorFacilitiesTextBlock></xbrli:xbrl>`;
    return { xml, accountingStandard: "J-GAAP", selection: { docID, kind: DisclosureTableKind.Facilities, contextRef: "filing" }, declarations: [{ tableIndex: 0, asOfDate: `${year}-03-31`, organization: "reporting-company", rawSha256: createHash("sha256").update(raw).digest("hex") }] };
}
