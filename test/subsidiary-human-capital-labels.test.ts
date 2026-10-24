import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { extractSubsidiaryHumanCapitalLabels, searchSubsidiaryHumanCapitalLabels, SubsidiaryHumanCapitalLabelOperator,
    SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS, EdinetXbrlParser, type SubsidiaryHumanCapitalLabelDocument, type SubsidiaryHumanCapitalLabelSearchOptions } from "../src/index";
const ns = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor", instant = "2026-03-31";
const tag = "ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
const member = (row: string | number = 1, prefix = "jpcrp_cor") => `<xbrldi:explicitMember dimension="${prefix}:SequentialNumbersAxis">${prefix}:Row${row}Member</xbrldi:explicitMember>`;
function context(id = "row1", row: string | number = 1, options: { entity?: string; date?: string; dimensions?: string; segment?: boolean } = {}) {
    const dimensions = options.dimensions ?? member(row);
    return `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">${options.entity ?? "PARENT"}</xbrli:identifier>${options.segment ? `<xbrli:segment>${dimensions}</xbrli:segment>` : ""}</xbrli:entity><xbrli:period><xbrli:instant>${options.date ?? instant}</xbrli:instant></xbrli:period>${options.segment ? "" : `<xbrli:scenario>${dimensions}</xbrli:scenario>`}</xbrli:context>`;
}
const label = (value = "架空会社", ref = "row1", attrs = "", prefix = "jpcrp_cor") => `<${prefix}:${tag} contextRef="${ref}" ${attrs}>${escape(value)}</${prefix}:${tag}>`;
const xml = (facts = label(), contexts = context(), extraNamespaces = "") => `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" xmlns:jpcrp_cor="${ns}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:extension="urn:fixture" ${extraNamespaces}>${contexts}${facts}</xbrli:xbrl>`;
const metadata = (docID = "DOC-A") => ({ docID, instant, secCode: "1001" });
const document = (docID: string, value = "架空会社", options: { row?: number; entity?: string } = {}): SubsidiaryHumanCapitalLabelDocument => ({ xml: xml(label(value), context("row1", options.row ?? 1, { entity: options.entity ?? docID })), metadata: metadata(docID) });

describe("人的資本表に記載された解析済み会社ラベル", () => {
    it("原文ではなく解析済みラベル・明示行・trace・hashを返す", () => {
        const input = "\uFEFF" + xml(label("  架空 & 会社  "));
        const result = extractSubsidiaryHumanCapitalLabels(input, metadata());
        expect(result.summary).toEqual({ candidateFacts: 1, selectedRows: 1, excludedRows: 0 });
        expect(result).toMatchObject({ dtsValidation: "not-performed", originalLexicalValidation: "not-performed", inputXmlSha256: createHash("sha256").update(input).digest("hex") });
        expect(result.rows[0]).toMatchObject({ status: "selected", parsedLabel: "架空 & 会社", consolidationDeclaration: "not-declared", metadata: metadata(), entity: { scheme: "synthetic", identifier: "PARENT" },
            dimensions: [{ axisNamespaceURI: ns, axis: "SequentialNumbersAxis", memberNamespaceURI: ns, member: "Row1Member" }] });
        expect(result.rows[0].rowKey).toMatch(/^[a-f0-9]{64}$/);
        expect(result.rows[0].candidates[0]).toMatchObject({ parsedText: "架空 & 会社", contextRef: "row1", namespaceURI: ns, traceRef: 0 });
        expect(result.traces[0]).toMatchObject({ contextRef: "row1", trace: { status: "resolved", dtsValidation: "not-performed", originalLexicalValidation: "not-performed" } });
        expect(result.rows[0]).not.toHaveProperty("scope");
    });
    it.each([1, 300])("公式Row%sを受け付ける", row => {
        expect(extractSubsidiaryHumanCapitalLabels(xml(label(), context("row1", row)), metadata()).rows[0].status).toBe("selected");
    });
    it.each([0, 301, "01", "-1"])("未対応Row%sを推測しない", row => {
        expect(extractSubsidiaryHumanCapitalLabels(xml(label(), context("row1", row)), metadata()).rows[0]).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" });
    });
    it("factと軸/memberの別prefix同URIを解決しcontext名に依存しない", () => {
        const input = xml(label("会社", "arbitrary", "", "alias"), context("arbitrary", 1, { dimensions: member(1, "alias") }), `xmlns:alias="${ns}"`);
        expect(extractSubsidiaryHumanCapitalLabels(input, metadata()).rows[0]).toMatchObject({ status: "selected", parsedLabel: "会社" });
    });
    it("同名でも異なるrowは統合しない", () => {
        const input = xml(label("同名", "row1") + label("同名", "row2"), context() + context("row2", 2));
        const result = extractSubsidiaryHumanCapitalLabels(input, metadata());
        expect(result.summary.selectedRows).toBe(2); expect(new Set(result.rows.map(row => row.rowKey)).size).toBe(2);
    });
    it.each(["同名", "別名"])("同rowの複数context候補は%sでも曖昧", second => {
        const input = xml(label("同名", "row1") + label(second, "other"), context() + context("other", 1));
        const result = extractSubsidiaryHumanCapitalLabels(input, metadata());
        expect(result.rows).toHaveLength(1); expect(result.rows[0]).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(result.rows[0].candidates).toHaveLength(2); expect(result.rows[0].parsedLabel).toBeUndefined();
    });
    it("同context同値重複も採用しない", () => {
        expect(extractSubsidiaryHumanCapitalLabels(xml(label().repeat(2)), metadata()).rows[0]).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
    });
    it("重複contextでは上書き後のmetadataを根拠に採用しない", () => {
        const result = extractSubsidiaryHumanCapitalLabels(xml(label(), context() + context("row1", 2)), metadata());
        expect(result.rows[0]).toMatchObject({ status: "ambiguous", reason: "duplicate-context", rowKey: null, consolidationDeclaration: "uninterpreted" });
        expect(result.traces[result.rows[0].candidates[0].traceRef].trace.candidates).toHaveLength(2);
    });
    it("同contextの多数factと重複contextでもtraceを一回取得・一回保存する", () => {
        const input = xml(label().repeat(20), context().repeat(20)), parsed = new EdinetXbrlParser().parse(input, "DOC-A");
        const originalTrace = parsed.traceContextDimensions.bind(parsed); let calls = 0;
        parsed.traceContextDimensions = id => { calls++; return originalTrace(id); };
        const result = parsed.selectSubsidiaryHumanCapitalLabels(metadata());
        expect(calls).toBe(1); expect(result.traces).toHaveLength(1); expect(result.traces[0].trace.candidates).toHaveLength(20);
        expect(result.summary.candidateFacts).toBe(20);
        expect(result.rows.flatMap(row => row.candidates).every(candidate => candidate.traceRef === 0 && !Object.hasOwn(candidate, "trace"))).toBe(true);
        expect((JSON.stringify(result).match(/"contextElement":/g) ?? []).length).toBe(20);
        const searched = searchSubsidiaryHumanCapitalLabels([{ xml: input, metadata: metadata() }]);
        expect(searched.sources[0].traces).toHaveLength(1); expect(searched.sources[0].traces[0].trace.candidates).toHaveLength(20);
        expect((JSON.stringify(searched).match(/"contextElement":/g) ?? []).length).toBe(20);
        expect(searched.diagnostics.every(diagnostic => diagnostic.candidates.every(candidate => candidate.traceRef === 0 && !Object.hasOwn(candidate, "trace")))).toBe(true);
    });
    it("nil・空解析済み文字列・文字列0を区別する", () => {
        expect(extractSubsidiaryHumanCapitalLabels(xml(label("", "row1", 'xsi:nil="true"')), metadata()).rows[0]).toMatchObject({ status: "missing", reason: "nil" });
        expect(extractSubsidiaryHumanCapitalLabels(xml(label("")), metadata()).rows[0]).toMatchObject({ status: "missing", reason: "empty-parsed-label" });
        expect(extractSubsidiaryHumanCapitalLabels(xml(label("0")), metadata()).rows[0]).toMatchObject({ status: "selected", parsedLabel: "0" });
    });
    it("target tag不在で汎用Rowcontextから架空行や300欠損を作らない", () => {
        const result = extractSubsidiaryHumanCapitalLabels(xml(""), metadata());
        expect(result.rows).toEqual([]); expect(result.summary).toEqual({ candidateFacts: 0, selectedRows: 0, excludedRows: 0 });
        expect(result.reasonCounts).toEqual({ "tag-absent": 1 });
    });
    it("元字面へ復元できない参照様の解析値は推測decodeしない", () => {
        const result = extractSubsidiaryHumanCapitalLabels(xml(label("&#65;")), metadata());
        expect(result.rows[0]).toMatchObject({ status: "unsupported", reason: "reference-like-text" });
        expect(result.rows[0].candidates[0].parsedText).toBe("&#65;");
    });
    it.each(["typed", "extra-axis", "duplicate-axis", "no-axis", "unknown-axis", "unknown-member-uri", "segment"])("%sを表行へ推測変換しない", kind => {
        let dimensions = member();
        if (kind === "typed") dimensions = '<xbrldi:typedMember dimension="jpcrp_cor:SequentialNumbersAxis"><value>1</value></xbrldi:typedMember>';
        if (kind === "extra-axis") dimensions += '<xbrldi:explicitMember dimension="extension:OtherAxis">extension:Member</xbrldi:explicitMember>';
        if (kind === "duplicate-axis") dimensions += member(2);
        if (kind === "no-axis") dimensions = "";
        if (kind === "unknown-axis") dimensions = member().replace("jpcrp_cor:SequentialNumbersAxis", "extension:SequentialNumbersAxis");
        if (kind === "unknown-member-uri") dimensions = member().replace("jpcrp_cor:Row1Member", "extension:Row1Member");
        const result = extractSubsidiaryHumanCapitalLabels(xml(label(), context("row1", 1, { dimensions, segment: kind === "segment" })), metadata());
        expect(result.rows[0].status).toBe("unsupported"); expect(result.rows[0].consolidationDeclaration).toBe("uninterpreted");
        expect(result.traces[result.rows[0].candidates[0].traceRef].trace.candidates).toHaveLength(1);
    });
    it("明示連結軸も今回は余分軸として保持しdefaultを補わない", () => {
        const dimensions = member() + '<xbrldi:explicitMember dimension="jppfs_cor:ConsolidatedOrNonConsolidatedAxis">jppfs_cor:ConsolidatedMember</xbrldi:explicitMember>';
        const result = extractSubsidiaryHumanCapitalLabels(xml(label(), context("row1", 1, { dimensions }), 'xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2025-11-01/jppfs_cor"'), metadata());
        expect(result.rows[0].status).toBe("unsupported"); expect(result.rows[0].consolidationDeclaration).toBe("uninterpreted");
        expect(result.traces[result.rows[0].candidates[0].traceRef].trace.candidates[0].dimensions).toHaveLength(2);
    });
    it.each(["namespace", "version", "unit", "period", "context", "entity", "context-alias"])("%s不足/不一致を採用しない", kind => {
        let input = xml();
        if (kind === "namespace") input = xml(label("会社", "row1", 'xmlns:jpcrp_cor="urn:fake"'));
        if (kind === "version") input = input.replaceAll("2025-11-01", "2024-11-01");
        if (kind === "unit") input = xml(label("会社", "row1", 'unitRef="money"'));
        if (kind === "period") input = xml(label(), context("row1", 1, { date: "2025-03-31" }));
        if (kind === "context") input = xml(label("会社", "missing"));
        if (kind === "entity") input = xml(label(), context() + context("other", 2, { entity: "OTHER" }));
        if (kind === "context-alias") input = input.replaceAll("xbrli:", "i:").replace("xmlns:xbrli=", "xmlns:i=");
        expect(extractSubsidiaryHumanCapitalLabels(input, metadata()).rows[0].status).toBe("unsupported");
    });
    it("金融ContextParser/selectorの次元契約は変更しない", () => {
        const input = xml(label() + '<jppfs_cor:CurrentAssets contextRef="row1" unitRef="money" decimals="INF">10</jppfs_cor:CurrentAssets>', context(), 'xmlns:jppfs_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2025-11-01/jppfs_cor"');
        const parsed = new EdinetXbrlParser().parse(input, "DOC-A");
        expect(parsed.selectSubsidiaryHumanCapitalLabels(metadata()).rows[0].status).toBe("selected");
        expect(parsed.selectBalanceSheetMetric("currentAssets", { accountingStandard: "J-GAAP", scope: "Consolidated", period: { instant } }).status).not.toBe("selected");
        expect(parsed.selectSubsidiaryHumanCapitalLabels(metadata()).inputXmlSha256).toBeUndefined();
        expect(() => parsed.selectSubsidiaryHumanCapitalLabels(metadata("OTHER-DOC"))).toThrow("docID");
    });
});

describe("解析済みラベルのliteral検索", () => {
    it("eq/containsのAND、原文字列順・ページと原本帰属を返す", () => {
        const docs = [document("C", "Beta 会社"), document("B", "Alpha 社"), document("A", "Alpha 会社")];
        const result = searchSubsidiaryHumanCapitalLabels(docs, { conditions: [{ operator: SubsidiaryHumanCapitalLabelOperator.Contains, value: "Alpha" }], limit: 1 });
        expect(result.total).toBe(2); expect(result.filteredRows).toBe(1); expect(result.rows).toHaveLength(1);
        expect(result.rows[0].parsedLabel).toBe("Alpha 会社"); expect(result.rows[0].metadata.docID).toBe("A");
        expect(result.rows[0].inputXmlSha256).toBe(createHash("sha256").update(docs[2].xml).digest("hex"));
        expect(searchSubsidiaryHumanCapitalLabels(docs, { conditions: [{ operator: "contains", value: "Alpha" }, { operator: "eq", value: "Alpha 社" }] }).total).toBe(1);
        expect(result).toMatchObject({ dtsValidation: "not-performed", originalLexicalValidation: "not-performed" });
    });
    it("大小文字/Unicode正規化/正規表現を行わない", () => {
        const docs = [document("A", "Aa%_[x].* café"), document("B", "aa%_[x].* cafe\u0301")];
        for (const [value, count] of [["Aa", 1], ["aa", 1], ["%_[x].*", 2], ["café", 1], ["cafe\u0301", 1]] as const) {
            expect(searchSubsidiaryHumanCapitalLabels(docs, { conditions: [{ operator: "contains", value }] }).total).toBe(count);
        }
        expect(searchSubsidiaryHumanCapitalLabels([document("A", "  Name  ")], { conditions: [{ operator: "eq", value: "  Name  " }] }).total).toBe(0);
    });
    it("同値別行/別書類を統合せず、逆順でもtieはdocID/rowkey昇順", () => {
        const result = searchSubsidiaryHumanCapitalLabels([document("B", "同名"), document("A", "同名")], { order: "desc" });
        expect(result.total).toBe(2); expect(result.rows.map(row => row.metadata.docID)).toEqual(["A", "B"]);
    });
    it("欠損/曖昧/候補0と条件不一致の件数を分ける", () => {
        const docs = [document("A", "match"), document("B", "other"), { xml: xml(label("", "row1", 'xsi:nil="true"'), context("row1", 1, { entity: "N" })), metadata: metadata("N") },
            { xml: xml(label().repeat(2), context("row1", 1, { entity: "D" })), metadata: metadata("D") }, { xml: xml("", context("row1", 1, { entity: "E" })), metadata: metadata("E") }];
        const result = searchSubsidiaryHumanCapitalLabels(docs, { conditions: [{ operator: "eq", value: "match" }] });
        expect(result).toMatchObject({ total: 1, filteredRows: 1, excludedRows: 2, summary: { documents: 5, candidateFacts: 5, emptyDocuments: 1 } });
        expect(result.reasonCounts).toMatchObject({ nil: 1, "multiple-facts": 1, "tag-absent": 1 });
        expect(result.diagnostics.find(item => item.reason === "multiple-facts")!.candidates).toHaveLength(2);
    });
    it("空集合・limit0・範囲外ページでも未検証flagとページ前件数を保持", () => {
        expect(searchSubsidiaryHumanCapitalLabels([])).toMatchObject({ rows: [], total: 0, dtsValidation: "not-performed", originalLexicalValidation: "not-performed" });
        for (const options of [{ limit: 0 }, { offset: 10 }]) expect(searchSubsidiaryHumanCapitalLabels([document("A")], options)).toMatchObject({ rows: [], total: 1 });
    });
    it("同書類/同entity/異期末を条件で隠さない", () => {
        for (const kind of ["doc", "entity", "period"]) {
            const a = document("A"), b = document(kind === "doc" ? "A" : "B", "other", { entity: kind === "entity" ? "A" : "B" });
            if (kind === "period") b.metadata.instant = "2025-03-31";
            expect(() => searchSubsidiaryHumanCapitalLabels([a, b], { conditions: [{ operator: "eq", value: "never-match" }], limit: 0 })).toThrow();
        }
    });
    it("対象tagがない書類の既知entityも重複検査へ含める", () => {
        const a = document("A"), b = { xml: xml("", context("row1", 1, { entity: "A" })), metadata: metadata("B") };
        expect(() => searchSubsidiaryHumanCapitalLabels([a, b], { limit: 0 })).toThrow("entity");
    });
});

describe("入力固定と境界", () => {
    it("metadata/options/条件/XMLgetterを各一回読み同じ文字列をhashする", () => {
        const original = document("A"), reads: Record<string, number> = {}, m: any = {}, d: any = {}, c: any = {}, o: any = {};
        const once = (object: any, key: string, value: unknown) => Object.defineProperty(object, key, { enumerable: true, get() { reads[key] = (reads[key] ?? 0) + 1; if (reads[key] > 1) throw new Error("read twice"); return value; } });
        for (const [key, value] of Object.entries(original.metadata)) once(m, key, value);
        once(d, "metadata", m); once(d, "xml", original.xml); once(c, "operator", "eq"); once(c, "value", "架空会社");
        once(o, "conditions", [c]); once(o, "order", "asc"); once(o, "offset", 0); once(o, "limit", 1);
        const result = searchSubsidiaryHumanCapitalLabels([d], o);
        expect(result.total).toBe(1); expect(Object.values(reads).every(value => value === 1)).toBe(true);
        expect(result.rows[0].inputXmlSha256).toBe(createHash("sha256").update(original.xml).digest("hex"));
    });
    it("XMLgetterで他社metadata/元条件を書き換えても固定済み設定を使う", () => {
        const a = document("A"), b = document("B"), saved = a.xml, condition = { operator: "contains" as const, value: "会社" };
        Object.defineProperty(a, "xml", { enumerable: true, get() { b.metadata.instant = "2025-03-31"; condition.value = "never"; return saved; } });
        const result = searchSubsidiaryHumanCapitalLabels([a, b], { conditions: [condition] });
        expect(result.total).toBe(2); expect(result.rows[1].metadata.instant).toBe(instant);
    });
    it("配列の独自iteratorを実行せず、疎配列を拒否", () => {
        const docs = [document("A")], conditions = [{ operator: "contains" as const, value: "会社" }];
        for (const list of [docs, conditions]) Object.defineProperty(list, Symbol.iterator, { value() { throw new Error("must not iterate"); } });
        expect(searchSubsidiaryHumanCapitalLabels(docs, { conditions }).total).toBe(1);
        expect(() => searchSubsidiaryHumanCapitalLabels(new Array(1))).toThrow();
    });
    it("入力不変・返却traceから内部Objectを変更できない", () => {
        const d = document("A"), before = JSON.stringify(d), parsed = new EdinetXbrlParser().parse(d.xml, d.metadata.docID);
        const first = parsed.selectSubsidiaryHumanCapitalLabels(d.metadata);
        first.rows[0].metadata.docID = "changed"; first.rows[0].candidates[0].entity!.identifier = "changed";
        expect(JSON.stringify(d)).toBe(before); expect(parsed.selectSubsidiaryHumanCapitalLabels(d.metadata).rows[0].candidates[0].entity!.identifier).toBe("A");
    });
    it.each([{ conditions: null }, { conditions: new Array(1) }, { conditions: [{ operator: "regex", value: "x" }] }, { conditions: [{ operator: "eq", value: "" }] },
        { conditions: [{ operator: "contains", value: 0 }] }, { scope: "Consolidated" }, { order: "ASC" }, { offset: -1 }, { limit: 1.5 }])("不正設定を空集合でも拒否 %j", options => {
        expect(() => searchSubsidiaryHumanCapitalLabels([], options as unknown as SubsidiaryHumanCapitalLabelSearchOptions)).toThrow();
    });
    it("不正metadata/XMLと旧版の推測対応を拒否", () => {
        expect(() => extractSubsidiaryHumanCapitalLabels(xml(), { docID: "", instant })).toThrow();
        expect(() => extractSubsidiaryHumanCapitalLabels(xml(), { docID: "D", instant: "2026-02-30" })).toThrow();
        expect(() => extractSubsidiaryHumanCapitalLabels("<broken>", metadata())).toThrow();
        expect(() => extractSubsidiaryHumanCapitalLabels('<!DOCTYPE a><a/>', metadata())).toThrow();
    });
    it("原本/条件100件と候補10000件を上限にする", () => {
        expect(() => searchSubsidiaryHumanCapitalLabels(Array.from({ length: SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS.documents + 1 }, () => document("A")))).toThrow("100");
        expect(() => searchSubsidiaryHumanCapitalLabels([], { conditions: Array.from({ length: 101 }, () => ({ operator: "eq", value: "x" })) })).toThrow("100");
        const many = label("x", "unavailable").repeat(SUBSIDIARY_HUMAN_CAPITAL_LABEL_LIMITS.candidates + 1);
        expect(() => extractSubsidiaryHumanCapitalLabels(xml(many, ""), metadata())).toThrow("10000");
    });
});
