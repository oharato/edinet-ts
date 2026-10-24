import { describe, it, expect, vi } from "vitest";
import { XMLValidator } from "fast-xml-parser";
import { createHash } from "node:crypto";
import { EdinetXbrlParser, createCompanyProfile, createWorkforceSnapshot, createFinancialDetailSnapshot, createBalanceSheetSnapshot,
    calculateAnnualRevenueGrowth, BalanceSheetSqliteStore, importBalanceSheets } from "../src/index";
import { assertXmlInput, XML_INPUT_MAX_BYTES } from "../src/xml-input";
import { instance, fact } from "./fixtures/metric-boundaries";
const metadata = { secCode: "1001", docID: "SYNTHETIC1", scope: "Consolidated" as const, accountingStandard: "J-GAAP" as const, currency: "JPY" as const, period: { instant: "2025-03-31" } };
const bsMetadata = { secCode: metadata.secCode, docID: metadata.docID, scope: metadata.scope, accountingStandard: metadata.accountingStandard, currency: metadata.currency, instant: metadata.period.instant };
const ordinary = instance(fact("100", "", "jppfs_cor:CurrentAssets"));
const dtds = ['<!DOCTYPE xbrli:xbrl>', '<!DOCTYPE xbrli:xbrl [<!ENTITY custom "expanded">]>', '<!DOCTYPE xbrli:xbrl SYSTEM "https://example.invalid/never-fetch.dtd">', '<!DOCTYPE xbrli:xbrl [<!ENTITY ext SYSTEM "file:///never-read">]>'];

describe("XML共通の入力境界", () => {
    it.each([undefined, null, 1, true, {}, [], new Uint8Array()])("string以外を解析前に拒否: %j", value => {
        expect(() => assertXmlInput(value)).toThrow(/XML/);
        expect(() => new EdinetXbrlParser().parse(value as any)).toThrow(/XML/);
    });
    it.each(["", "<broken>", "<a></b>", "<a/><b/>", "<!--unterminated", "<![CDATA[unterminated"])("不正構文を拒否: %s", value => {
        expect(() => new EdinetXbrlParser().parse(value)).toThrow(/XML/);
    });
    it.each(["<a>&undefinedEntity;</a>", "<a>&#0;</a>", "<a>&#xD800;</a>", "<a>\u0001</a>", '<a x="<"/>', "<a>\ud800</a>", "<a>\udc00</a>", "<a>\ufffe</a>", "<a>\uffff</a>", "<a>&#x110000;</a>", "<a>&#xFFFE;</a>", "<a>&#xFFFF;</a>", "<a>&#1;</a>", "<a>&AMP;</a>", "<a>&broken</a>", "<a>]]></a>"])("依存validatorの許容する不正境界を拒否: %s", value => {
        expect(() => new EdinetXbrlParser().parse(value)).toThrow(/XML/);
    });
    it.each(["<a>\t\n\r &#9;&#10;&#13;</a>", "<a>\u0020\ud7ff\ue000\ufffd😀</a>", "<a>&#32;&#xD7FF;&#xE000;&#xFFFD;&#x10000;&#x10FFFF;</a>", '<a x="&lt;&amp;&quot;&apos;&gt;&#x41;"/>', '<a><!--&undefinedEntity;--><![CDATA[&undefinedEntity;]]><?test &undefinedEntity;?></a>'])("近傍の合法文字・参照を受理: %s", value => {
        expect(() => new EdinetXbrlParser().parse(value)).not.toThrow();
    });
    it.each(dtds)("実DTD宣言を解析前に拒否: %s", dtd => {
        const validator = vi.spyOn(XMLValidator, "validate");
        try { expect(() => assertXmlInput(dtd + ordinary)).toThrow(/DOCTYPE/); expect(validator).not.toHaveBeenCalled(); }
        finally { validator.mockRestore(); }
    });
    it("コメント/CDATA/処理命令のDOCTYPE文字列は宣言と扱わない", () => {
        const xml = instance('<!-- <!DOCTYPE ignored> --><?example <!DOCTYPE ignored?><extension:Text contextRef="current"><![CDATA[<!DOCTYPE ignored>]]></extension:Text>');
        const result = new EdinetXbrlParser().parse(xml).getDataList("extension:Text");
        expect(result[0].rawValue).toBe("<!DOCTYPE ignored>");
        expect(() => assertXmlInput('<!-- <!DOCTYPE ignored> -->' + dtds[0] + ordinary)).toThrow(/DOCTYPE/);
    });
    it("BOM・XML宣言・日本語・組込み/数値文字参照を従来どおり解析", () => {
        const xml = '\ufeff<?xml version="1.0" encoding="UTF-8"?>' + instance('<extension:Text contextRef="current" label="&lt;合成&amp;会社&gt;">日本語&amp;&lt;&gt;&quot;&apos;&#65;&#x1F600;</extension:Text>');
        const result = new EdinetXbrlParser().parse(xml).getDataList("extension:Text");
        expect(result[0].rawValue).toBe('日本語&<>"\'&#65;&#x1F600;');
    });
    it("ASCIIの64MiBちょうどは許可、1byte超過は構文検査前に拒否", () => {
        const prefix = "<x><!--", suffix = "--></x>";
        const xml = prefix + "a".repeat(XML_INPUT_MAX_BYTES - prefix.length - suffix.length) + suffix;
        expect(Buffer.byteLength(xml, "utf8")).toBe(XML_INPUT_MAX_BYTES);
        expect(() => assertXmlInput(xml)).not.toThrow();
        const validator = vi.spyOn(XMLValidator, "validate");
        try { expect(() => assertXmlInput(xml + " ")).toThrow(/byte上限/); expect(validator).not.toHaveBeenCalled(); }
        finally { validator.mockRestore(); }
    }, 15000);
    it("UTF-16文字数でなくUTF-8 byteで日本語/補助文字/BOMの境界を検査", () => {
        // 多byteを含む有効XMLをちょうど上限にし、最後のASCIIを日本語へ換えると2byte超過。
        const prefix = "\ufeff<x><!--日本語😀", suffix = "--></x>";
        const xml = prefix + "a".repeat(XML_INPUT_MAX_BYTES - Buffer.byteLength(prefix + suffix, "utf8")) + suffix;
        expect(Buffer.byteLength(xml, "utf8")).toBe(XML_INPUT_MAX_BYTES);
        expect(() => assertXmlInput(xml)).not.toThrow();
        const beyond = xml.replace("a--></x>", "日--></x>");
        expect(beyond.length).toBeLessThan(XML_INPUT_MAX_BYTES);
        expect(() => assertXmlInput(beyond)).toThrow(/byte上限/);
    }, 15000);
});

const entries = [
    ["parser", (xml: string) => new EdinetXbrlParser().parse(xml)],
    ["会社情報", (xml: string) => createCompanyProfile(xml, metadata.docID)],
    ["人的資本", (xml: string) => createWorkforceSnapshot(xml, metadata)],
    ["財務明細", (xml: string) => createFinancialDetailSnapshot(xml, metadata)],
    ["BS", (xml: string) => createBalanceSheetSnapshot(xml, bsMetadata)],
    ["前年比", (xml: string) => {
        const current = { xml, metadata: { ...metadata, periodType: "annual" as const, period: { startDate: "2024-04-01", endDate: "2025-03-31" } } };
        return calculateAnnualRevenueGrowth({ current, previous: current });
    }]
] as const;
describe.each(entries)("公開XML入口: %s", (_name, action) => {
    it("DTDと不正XMLを拒否", () => {
        for (const xml of [...dtds.map(dtd => dtd + ordinary), "<broken>"]) expect(() => action(xml)).toThrow(/XML/);
    });
    it("通常XMLを処理し、DTDの文字列を含むコメントも保持", () => {
        expect(() => action(ordinary.replace('<xbrli:xbrl ', '<!-- <!DOCTYPE is only text> --><xbrli:xbrl '))).not.toThrow();
    });
});
describe("BS取り込みの原子性", () => {
    it("DOCTYPE原本を保存せず試験DBを空のまま保持", () => {
        const store = new BalanceSheetSqliteStore(":memory:");
        const bytes = new TextEncoder().encode(dtds[0] + ordinary);
        const source = { metadata: bsMetadata, provenance: { extractorVersion: "synthetic-v1", mappingVersion: "1", sourceSha256: createHash("sha256").update(bytes).digest("hex") } };
        try { expect(() => importBalanceSheets(store, [source], () => bytes)).toThrow(/DOCTYPE/); expect(store.inventory().entries).toHaveLength(0); }
        finally { store.close(); }
    });
});
