import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { CompanyProfileFieldId, createCompanyProfile, EdinetXbrlParser } from "../src/index";

const dei = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor";
const context = (id = "arbitrary", date = "2025-06-20", entity = "fixture-company", extra = "") =>
    `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="fixture">${entity}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${date}</xbrli:instant></xbrli:period>${extra}</xbrli:context>`;
const fact = (tag: string, raw: string, ref = "arbitrary", attrs = "", prefix = "jpdei_cor") =>
    `<${prefix}:${tag} contextRef="${ref}" ${attrs}>${raw}</${prefix}:${tag}>`;
const facts = () => [
    fact("FilerNameInJapaneseDEI", "架空 &amp; 検証会社"), fact("EDINETCodeDEI", "E00000"),
    fact("SecurityCodeDEI", "123A0"), fact("AccountingStandardsDEI", "unknown-standard"),
    fact("CurrentFiscalYearStartDateDEI", "2024-04-01"), fact("CurrentFiscalYearEndDateDEI", "2025-03-31")
].join("");
const xml = (content = facts(), contexts = context(), namespaces = "") =>
    `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:jpdei_cor="${dei}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xbrldi="http://xbrl.org/2006/xbrldi" ${namespaces}>${contexts}${content}</xbrli:xbrl>`;
const selectName = (content: string, contexts = context(), namespaces = "") => createCompanyProfile(xml(content, contexts, namespaces), "fixture-doc").fields.filerName;

describe("出典付き会社情報", () => {
    it("6項目の原文と出典を返し、未知の会計基準と英字証券コードを変換しない", () => {
        const input = xml(), result = createCompanyProfile(input, "fixture-doc");
        expect(Object.keys(result.fields)).toHaveLength(6);
        expect(result.fields[CompanyProfileFieldId.FilerName].raw).toBe("架空 & 検証会社");
        expect(result.fields.securityCode.raw).toBe("123A0");
        expect(result.fields.accountingStandard.raw).toBe("unknown-standard");
        expect(result.consistency).toEqual({ status: "consistent", diagnostics: [] });
        expect(result.selectionVersion).toBe("1");
        expect(result.sourceXmlHash).toBe(createHash("sha256").update(input).digest("hex"));
        expect(result.fields.filerName.source).toMatchObject({ docID: "fixture-doc", contextRef: "arbitrary", namespaceURI: dei,
            entity: { scheme: "fixture", identifier: "fixture-company" }, period: { instant: "2025-06-20" }, raw: "架空 & 検証会社" });
    });
    it("既存Object入口にはhashがなく、従来の共通メタデータを変えない", () => {
        const object = new EdinetXbrlParser().parse(xml(), "fixture-doc");
        const before = object.getCommonMetadata();
        expect(object.getCompanyProfile().sourceXmlHash).toBeUndefined();
        expect(object.getCommonMetadata()).toEqual(before);
        expect(object.getCompanyProfile().fields.edinetCode.raw).toBe(before.edinetCode);
    });
    it("返却値の変更は元Objectに反映しない", () => {
        const object = new EdinetXbrlParser().parse(xml(), "fixture-doc");
        const profile = object.getCompanyProfile();
        profile.fields.filerName.evidence[0].period!.instant = "2000-01-01";
        profile.fields.filerName.evidence[0].entity!.identifier = "other";
        expect(object.getCompanyProfile().fields.filerName.source?.period?.instant).toBe("2025-06-20");
        expect(object.getCompanyProfile().fields.filerName.source?.entity?.identifier).toBe("fixture-company");
    });
    it("名前空間のprefix別名をURIで判定する", () => {
        const field = selectName(fact("FilerNameInJapaneseDEI", "会社", "arbitrary", "", "alias"), context(), `xmlns:alias="${dei}"`);
        expect(field.status).toBe("selected");
        expect(field.source?.key).toBe("alias:FilerNameInJapaneseDEI");
    });
    it.each(["https://example.test/jpdei_cor", "http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2025-02-30/jpdei_cor", dei + "/fake"])("未知namespaceを拒否 %s", namespace => {
        const field = selectName(fact("FilerNameInJapaneseDEI", "会社", "arbitrary", `xmlns:jpdei_cor="${namespace}"`));
        expect(field).toMatchObject({ status: "unsupported", reason: "unknown-namespace" });
        expect(field.evidence[0].raw).toBe("会社");
    });
    it("同値の重複も採用しない", () => {
        const field = selectName(fact("FilerNameInJapaneseDEI", "会社").repeat(2));
        expect(field).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(field.evidence).toHaveLength(2);
        expect(field.raw).toBeUndefined();
    });
    it("標準タグと企業拡張の同名タグを黙って絞らない", () => {
        const field = selectName(fact("FilerNameInJapaneseDEI", "会社") + fact("FilerNameInJapaneseDEI", "拡張", "arbitrary", "", "extension"), context(), 'xmlns:extension="urn:fixture"');
        expect(field.status).toBe("ambiguous");
        expect(field.evidence.map(e => e.reason)).toContain("unknown-namespace");
    });
    it("重複contextを拒否", () => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社"), context().repeat(2))).toMatchObject({ status: "ambiguous", reason: "duplicate-context" });
    });
    it.each(["", "missing"])("contextが解決できなければ拒否: %s", ref => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社", ref))).toMatchObject({ status: "unsupported", reason: "unknown-context" });
    });
    it.each(["2025-02-30", "bad-date"])("不正なcontext instantを拒否: %s", date => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社"), context("arbitrary", date))).toMatchObject({ status: "unsupported", reason: "unsupported-context" });
    });
    it("durationを提出時点として採用しない", () => {
        const duration = context().replace('<xbrli:instant>2025-06-20</xbrli:instant>', '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>');
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社"), duration).reason).toBe("unsupported-context");
    });
    it("contextの偽namespaceを拒否", () => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社"), context().replace('id="arbitrary"', 'id="arbitrary" xmlns:xbrli="urn:fake"')).reason).toBe("unsupported-context");
    });
    it("次元付きcontextを拒否", () => {
        const dimension = '<xbrli:scenario><xbrldi:typedMember dimension="jpdei_cor:Other"><item>text</item></xbrldi:typedMember></xbrli:scenario>';
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社"), context("arbitrary", "2025-06-20", "fixture-company", dimension))).toMatchObject({ status: "unsupported", reason: "unsupported-dimensions" });
    });
    it("別のentityがある文書では主提出者を推測しない", () => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社"), context() + context("other", "2025-06-20", "other-company"))).toMatchObject({ status: "unsupported", reason: "unsupported-entity" });
    });
    it("不明entityを拒否", () => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社"), context().replace('scheme="fixture"', 'scheme=""')).reason).toBe("unsupported-entity");
    });
    it("nilと空欄と不在を区別し、0の文字列は保持する", () => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "0", "arbitrary", 'xsi:nil="true"'))).toMatchObject({ status: "missing", reason: "nil" });
        expect(selectName("")).toMatchObject({ status: "missing", reason: "tag-absent" });
        expect(selectName(fact("FilerNameInJapaneseDEI", "0"))).toMatchObject({ status: "selected", raw: "0" });
        const blank = selectName(fact("FilerNameInJapaneseDEI", ""));
        expect(blank.status).not.toBe("selected");
    });
    it("単位付きと文字列のない複合内容を拒否", () => {
        expect(selectName(fact("FilerNameInJapaneseDEI", "会社", "arbitrary", 'unitRef="JPY"')).reason).toBe("unsupported-unit");
        expect(selectName(fact("FilerNameInJapaneseDEI", "<nested>会社</nested>")).reason).toBe("raw-unavailable");
    });
    it("不正な会計年度の日付はraw evidenceを残す", () => {
        const result = createCompanyProfile(xml(fact("CurrentFiscalYearEndDateDEI", "2025-02-30")), "fixture-doc");
        expect(result.fields.fiscalYearEndDate).toMatchObject({ status: "unsupported", reason: "invalid-date" });
        expect(result.fields.fiscalYearEndDate.evidence[0].raw).toBe("2025-02-30");
        expect(result.consistency.status).toBe("incomplete");
    });
    it("採用fieldの時点不一致を個別rawを変えず報告", () => {
        const input = xml(facts().replace('SecurityCodeDEI contextRef="arbitrary"', 'SecurityCodeDEI contextRef="other"'), context() + context("other", "2025-06-21"));
        const result = createCompanyProfile(input, "fixture-doc");
        expect(result.fields.securityCode.status).toBe("selected");
        expect(result.consistency.status).toBe("inconsistent");
        expect(result.consistency.diagnostics[0].reason).toBe("instant-mismatch");
    });
    it("開始終了逆転を個別採用値と分けて報告", () => {
        const result = createCompanyProfile(xml(facts().replace("2024-04-01", "2026-04-01")), "fixture-doc");
        expect(result.fields.fiscalYearStartDate).toMatchObject({ status: "selected", raw: "2026-04-01" });
        expect(result.consistency).toMatchObject({ status: "inconsistent", diagnostics: [{ reason: "fiscal-year-reversed" }] });
    });
    it.each(["", " ", " doc", "doc id", "doc\n"])("docIDを明示しない入力を拒否 %j", docID => {
        expect(() => createCompanyProfile(xml(), docID)).toThrow("docID");
    });
    it.each(["", "<broken>", '<!DOCTYPE x [<!ENTITY a "value">]><x>&a;</x>'])("不正構文/DOCTYPEを拒否", input => {
        expect(() => createCompanyProfile(input, "fixture-doc")).toThrow("XML");
    });
});
