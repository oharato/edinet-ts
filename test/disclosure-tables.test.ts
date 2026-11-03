import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { extractDisclosureTables, searchDisclosureTableCells, EdinetXbrlParser, DisclosureTableKind } from "../src/index";
const ns = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor";
const escape = (s: string) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
const context = '<xbrli:context id="filing"><xbrli:entity><xbrli:identifier scheme="fixture">PARENT</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2026-06-24</xbrli:instant></xbrli:period></xbrli:context>';
const fact = (raw: string, attrs = "", tag = "MajorFacilitiesTextBlock") => `<j:${tag} contextRef="filing" ${attrs}>${escape(raw)}</j:${tag}>`;
const xml = (facts: string, contexts = context, namespace = ns) => `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:j="${namespace}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">${contexts}${facts}</xbrli:xbrl>`;
const selection = { docID: "SYNTHETIC-A", kind: DisclosureTableKind.Facilities, contextRef: "filing" };
const table = '<p>提出会社 2026年3月31日現在</p><table><thead><tr><th rowspan="2">所在地</th><th colspan="2">簿価（百万円）</th></tr><tr><th>建物</th><th>土地</th></tr></thead><tbody><tr><td>架空市<br/>本店</td><td>1,234</td><td>－</td></tr><tr><td>共同設備（賃借）</td><td></td><td>0</td></tr></tbody></table><p>注：土地面積には賃借を含む。</p>';
const extract = (raw: string) => extractDisclosureTables(xml(fact(raw)), selection);
describe("開示本文の表と結合セルの出典", () => {
    it("元本文・hash・contextを保ち、ヘッダー結合を参照で展開する", () => {
        const input = xml(fact(table)), result = extractDisclosureTables(input, selection);
        expect(result).toMatchObject({ status: "selected", reason: "parsed-tables", semanticValidation: "not-performed", inputXmlSha256: createHash("sha256").update(input).digest("hex"), source: {
            docID: "SYNTHETIC-A", key: "j:MajorFacilitiesTextBlock", namespaceURI: ns, contextRef: "filing", rawFragment: table,
            rawSha256: createHash("sha256").update(table).digest("hex"), period: { instant: "2026-06-24" }, entity: { identifier: "PARENT" }, contextTrace: { status: "resolved" } } });
        expect(result.tables[0].grid).toEqual([[0, 1, 1], [0, 2, 3], [4, 5, 6], [7, 8, 9]]);
        expect(result.tables[0].cells[4].parsedText).toBe("架空市\n本店");
        expect(result.tables[0].cells.slice(-2).map(c => c.parsedText)).toEqual(["", "0"]);
        expect(result.parsedText).toContain("注：土地面積には賃借を含む。");
        expect(result.outsideTableText).toBe("提出会社 2026年3月31日現在\n注：土地面積には賃借を含む。");
        expect(result.source).not.toHaveProperty("scope");
        expect(result.tables[0].cells[5]).not.toHaveProperty("value");
    });
    it("表の前後の本文を物理表ごとに区切り、表内数値を含めない", () => {
        const r = extract('<div><p>最初</p><table><tr><td>数値100</td></tr></table><p>次の表の注記</p><div><table><tr><td>数値200</td></tr></table></div><p>最後</p></div>');
        expect(r.tables.map(t => t.precedingText)).toEqual(["最初", "次の表の注記"]);
        expect(r.outsideTableText).toBe("最初\n次の表の注記\n\n最後");
    });
    it("表なし・空本文を欠損と混同しない", () => {
        expect(extract("<p>該当事項はありません。</p>")).toMatchObject({ status: "selected", reason: "no-tables", parsedText: "該当事項はありません。" });
        expect(extract("")).toMatchObject({ status: "unsupported", reason: "raw-unavailable" });
    });
    it("不揃い行の欠けた枠をnullにする", () => {
        expect(extract('<table><tr><td>甲</td><td>乙</td></tr><tr><td>丙</td></tr></table>').tables[0].grid).toEqual([[0, 1], [2, null]]);
    });
    it("結合の空欄、ダッシュ、ゼロ、数値の注釈を改変しない", () => {
        expect(extract('<table><tr><td colspan="2"></td><td>－</td><td>0</td><td>1,000（100）</td></tr></table>').tables[0].cells.map(c => c.parsedText)).toEqual(["", "－", "0", "1,000（100）"]);
    });
    it("実体参照・CDATA・インライン順を保持し、リンクを実行しない", () => {
        const result = extract('<table><tr><td>甲&amp;乙<span>丙</span><![CDATA[<丁>]]><a href="https://invalid.example">戊</a></td></tr></table>');
        expect(result.tables[0].cells[0].parsedText).toBe("甲&乙丙<丁>戊");
    });
    it.each([
        '<table><tr><td rowspan="0">甲</td></tr></table>', '<table><tr><td colspan="101">甲</td></tr></table>',
        '<table><tr><td rowspan="2">甲</td></tr></table>', '<table><tr><td colspan="+1">甲</td></tr></table>',
        '<table><thead><tr><td rowspan="2">甲</td></tr></thead><tbody><tr><td>乙</td></tr></tbody></table>',
        '<table><tr><td>甲</td><td rowspan="2">乙</td></tr><tr><td colspan="2">丙</td></tr></table>',
        '<table><tr><td><table><tr><td>内側</td></tr></table></td></tr></table>',
        '<table><p>行でない要素</p></table>', '<table><tr>セルでない文字<td>甲</td></tr></table>',
        '<table><tr><td>未完了</tr></table>', '<!DOCTYPE a [<!ENTITY x "x">]><table/>',
        '<table><tr><td>&nbsp;</td></tr></table>', '<script>alert(1)</script><table/>', '<iframe src="https://invalid.example"/>',
        '<x:table xmlns:x="urn:unknown"/>', '<table xmlns="urn:unknown"/>',
        '<table><tr><td>'+"x".repeat(2 * 1024 * 1024)+'</td></tr></table>',
        '<div>'.repeat(70) + '<table/>' + '</div>'.repeat(70), '<table/>'.repeat(201)
    ])("非対応の構造を値へ補完しない #%#", raw => {
        expect(extract(raw)).toMatchObject({ status: "unsupported", reason: "unsupported-fragment", tables: [], source: { rawFragment: raw } });
    });
    it("本文の欠損・nil・重複と未知名前空間を分ける", () => {
        expect(extractDisclosureTables(xml(""), selection)).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(extractDisclosureTables(xml(fact("", 'xsi:nil="true"')), selection)).toMatchObject({ status: "missing", reason: "nil" });
        expect(extractDisclosureTables(xml(fact(table)+fact(table)), selection)).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(extractDisclosureTables(xml(fact(table), context, "urn:extension"), selection)).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
    });
    it("不明・重複contextや数値単位付きの本文を拒否する", () => {
        expect(extractDisclosureTables(xml(fact(table), ""), selection)).toMatchObject({ status: "unsupported", reason: "invalid-context" });
        expect(extractDisclosureTables(xml(fact(table), context + context), selection)).toMatchObject({ status: "unsupported", reason: "invalid-context" });
        expect(extractDisclosureTables(xml(fact(table, 'unitRef="JPY"')), selection)).toMatchObject({ status: "unsupported", reason: "invalid-context" });
    });
    it.each(Object.values(DisclosureTableKind))("領域%sを別々の本文として扱う", kind => {
        const tags = { policyShareholdings: "ShareholdingsTextBlock", majorShareholders: "MajorShareholdersTextBlock", shareholderCategories: "ShareholdingByShareholderCategoryTextBlock", managementAnalysis: "ManagementAnalysisOfFinancialPositionOperatingResultsAndCashFlowsTextBlock", facilities: "MajorFacilitiesTextBlock", affiliatedEntities: "OverviewOfAffiliatedEntitiesTextBlock", mainCustomers: "InformationForEachOfMainCustomersTextBlock", segments: "NotesSegmentInformationEtcConsolidatedFinancialStatementsTextBlock", officers: "InformationAboutOfficersTextBlock", officerRemuneration: "RemunerationForDirectorsAndOtherOfficersTextBlock" };
        expect(extractDisclosureTables(xml(fact(table, "", tags[kind])), { ...selection, kind })).toMatchObject({ status: "selected", source: { kind } });
    });
    it("状態の外部変更を解析済みobjectへ戻さない", () => {
        const object = new EdinetXbrlParser().parse(xml(fact(table)), selection.docID), a = object.selectDisclosureTables(selection.kind, selection.contextRef);
        a.source.period!.instant = "2000-01-01"; a.tables[0].cells[0].parsedText = "破壊";
        expect(object.selectDisclosureTables(selection.kind, selection.contextRef).source.period!.instant).toBe("2026-06-24");
        expect(object.selectDisclosureTables(selection.kind, selection.contextRef).tables[0].cells[0].parsedText).toBe("所在地");
    });
    it("未指定ID・種類・参照は入口で拒否する", () => {
        expect(() => extractDisclosureTables(xml(fact(table)), { ...selection, docID: "" })).toThrow();
        expect(() => extractDisclosureTables(xml(fact(table)), { ...selection, kind: "other" as never })).toThrow();
        expect(() => extractDisclosureTables(xml(fact(table)), { ...selection, contextRef: "" })).toThrow();
    });
});


describe("本文セルの明示集合からの文字列逆引き", () => {
    const document = (docID: string, raw = table) => ({ xml: xml(fact(raw)), selection: { ...selection, docID } });
    it("結合セルを1件として数え、原本/表/セルへの参照を返す", () => {
        const result = searchDisclosureTableCells([document("B"), document("A"), document("C", "<script/>")], { contains: "所在地", offset: 1, limit: 1 });
        expect(result).toMatchObject({ matched: 2, rows: [{ sourceIndex: 1, tableIndex: 0, cellIndex: 0, row: 0, column: 0, parsedText: "所在地", semanticRole: "unclassified" }], excluded: [{ docID: "C", status: "unsupported" }] });
        expect(result.sources.map(s => s.docID)).toEqual(["A", "B"]);
        expect(result.sources[0]).not.toHaveProperty("rawFragment");
        expect(result.sources[0].rawSha256).toMatch(/^[a-f0-9]{64}$/);
    });
    it("検索文字列は正規表現ではなく、空集合/未一致は0件", () => {
        expect(searchDisclosureTableCells([], { contains: "甲" }).matched).toBe(0);
        expect(searchDisclosureTableCells([document("A")], { contains: ".*" }).matched).toBe(0);
    });
    it("重複指定や不正なページ/文字列を拒否する", () => {
        expect(() => searchDisclosureTableCells([document("A"), document("A")], { contains: "甲" })).toThrow();
        for (const options of [{ contains: "" }, { contains: "甲", offset: -1 }, { contains: "甲", limit: 0 }, { contains: "甲", limit: 1001 }]) expect(() => searchDisclosureTableCells([], options)).toThrow();
        expect(() => searchDisclosureTableCells(Array(101).fill(document("A")), { contains: "甲" })).toThrow();
    });
    it.each(["2024-11-01", "2025-11-01"])("異なる年度の公式名前空間%sを本文単位で保持する", date => {
        const result = extractDisclosureTables(xml(fact(table), context, ns.replace("2025-11-01", date)), selection);
        expect(result.status).toBe("selected"); expect(result.source.namespaceURI).toContain(date);
    });
});
