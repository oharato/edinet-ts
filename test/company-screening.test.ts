import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { screenCompanyDocuments, CompanyProfileFieldId, CompanyProfileOperator, SortOrder,
    type CompanyDocument, type CompanyScreeningOptions } from "../src/index";

const tags = { filerName: "FilerNameInJapaneseDEI", edinetCode: "EDINETCodeDEI", securityCode: "SecurityCodeDEI",
    accountingStandard: "AccountingStandardsDEI", fiscalYearStartDate: "CurrentFiscalYearStartDateDEI", fiscalYearEndDate: "CurrentFiscalYearEndDateDEI" } as const;
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
type Values = Record<CompanyProfileFieldId, string>;
function document(code: string, overrides: Partial<Values> = {}, config: { entity?: string; omit?: CompanyProfileFieldId; nil?: CompanyProfileFieldId; contextDate?: string; extra?: string } = {}): CompanyDocument {
    const values: Values = { filerName: `会社 ${code}`, edinetCode: code, securityCode: `${code}A0`, accountingStandard: "unknown-standard",
        fiscalYearStartDate: "2024-04-01", fiscalYearEndDate: "2025-03-31", ...overrides };
    const context = `<xbrli:context id="filing"><xbrli:entity><xbrli:identifier scheme="synthetic">${escape(config.entity ?? code)}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${config.contextDate ?? "2025-06-20"}</xbrli:instant></xbrli:period></xbrli:context>`;
    const facts = Object.entries(tags).filter(([id]) => id !== config.omit).map(([id, tag]) =>
        `<dei:${tag} contextRef="filing" ${id === config.nil ? 'xsi:nil="true"' : ""}>${escape(values[id as CompanyProfileFieldId])}</dei:${tag}>`).join("");
    return { docID: `DOC-${code}`, xml: `<xbrli:xbrl xmlns:xbrli="http://www.xbrl.org/2003/instance" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:dei="http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor">${context}${facts}${config.extra ?? ""}</xbrli:xbrl>` };
}
const codes = (result: ReturnType<typeof screenCompanyDocuments>) => result.rows.map(row => row.fields.edinetCode.raw);

describe("明示した会社情報集合の検索", () => {
    it("既定で原文EDINETコード昇順、出典・hash・未知会計基準を保持する", () => {
        const inputs = [document("C"), document("A"), document("B")];
        const before = JSON.stringify(inputs);
        const result = screenCompanyDocuments(inputs);
        expect(codes(result)).toEqual(["A", "B", "C"]);
        expect(result).toMatchObject({ total: 3, filteredRows: 0, excludedRows: 0, diagnostics: [], reasonCounts: { incomplete: 0, inconsistent: 0 } });
        expect(result.rows[0].fields.accountingStandard.raw).toBe("unknown-standard");
        expect(result.rows[0].sourceXmlHash).toBe(createHash("sha256").update(inputs[1].xml).digest("hex"));
        expect(result.rows[0].fields.edinetCode.source).toMatchObject({ docID: "DOC-A", key: "dei:EDINETCodeDEI", entity: { identifier: "A" } });
        expect(JSON.stringify(inputs)).toBe(before);
        expect(Object.isFrozen(CompanyProfileOperator)).toBe(true);
    });
    it.each(Object.values(CompanyProfileFieldId))("%sをeq/containsの原文で検索", field => {
        const raw = field === "fiscalYearStartDate" ? "2023-04-01" : field === "fiscalYearEndDate" ? "2026-03-31" : "Aa%_.*[value]";
        const other = field === "fiscalYearStartDate" ? "2024-04-01" : field === "fiscalYearEndDate" ? "2025-03-31" : "other";
        const inputs = [document("A", { [field]: raw }), document("B", { [field]: other })];
        const eq = screenCompanyDocuments(inputs, { conditions: [{ field, operator: CompanyProfileOperator.Equal, value: raw }] });
        const contains = screenCompanyDocuments(inputs, { conditions: [{ field, operator: CompanyProfileOperator.Contains, value: raw.slice(0, -1) }] });
        expect(eq.rows.map(row => row.docID)).toEqual(["DOC-A"]);
        expect(contains.rows.map(row => row.docID)).toEqual(["DOC-A"]);
        expect(eq.filteredRows).toBe(1);
    });
    it("会社名の部分一致・コード完全一致・決算月をANDで指定する", () => {
        const result = screenCompanyDocuments([document("A", { filerName: "Alpha 社", securityCode: "123A0" }),
            document("B", { filerName: "Alpha 社", securityCode: "123B0" }), document("C", { filerName: "Beta 社", securityCode: "123C0", fiscalYearEndDate: "2025-12-31" })], {
            conditions: [{ field: CompanyProfileFieldId.FilerName, operator: CompanyProfileOperator.Contains, value: "Alpha" },
                { field: CompanyProfileFieldId.SecurityCode, operator: CompanyProfileOperator.Equal, value: "123A0" }], fiscalYearEndMonth: 3 });
        expect(codes(result)).toEqual(["A"]);
        expect(result.filteredRows).toBe(2);
    });
    it("大小文字・Unicode表記・英字コード・正規表現文字を変換しない", () => {
        const inputs = [document("A", { filerName: "Abc%_[x].* café", securityCode: "123A0" }),
            document("B", { filerName: "abc%_[x].* cafe\u0301", securityCode: "123a0" })];
        for (const [value, expected] of [["Abc", ["A"]], ["abc", ["B"]], ["%_[x].*", ["A", "B"]], ["café", ["A"]], ["cafe\u0301", ["B"]]] as const) {
            expect(codes(screenCompanyDocuments(inputs, { conditions: [{ field: "filerName", operator: "contains", value }] }))).toEqual(expected);
        }
        expect(codes(screenCompanyDocuments(inputs, { conditions: [{ field: "securityCode", operator: "eq", value: "123A0" }] }))).toEqual(["A"]);
        expect(screenCompanyDocuments(inputs, { conditions: [{ field: "securityCode", operator: "eq", value: "123A" }] }).total).toBe(0);
    });
    it("空白だけの非空条件をraw文字列として扱う", () => {
        expect(screenCompanyDocuments([document("A")], { conditions: [{ field: "filerName", operator: "contains", value: " " }] }).total).toBe(1);
    });
    it("異なる提出時点・年度・会計基準名の会社も属性集合として一覧できる", () => {
        const result = screenCompanyDocuments([document("A"), document("B", { fiscalYearEndDate: "2026-12-31", accountingStandard: "Other" }, { contextDate: "2027-06-20" })]);
        expect(result.total).toBe(2);
        expect(codes(screenCompanyDocuments([document("A"), document("B", { fiscalYearEndDate: "2026-12-31" })], { fiscalYearEndMonth: 12 }))).toEqual(["B"]);
    });
    it.each(Object.values(CompanyProfileFieldId))("%sの両順序とページ指定", field => {
        const dates = field === "fiscalYearStartDate" || field === "fiscalYearEndDate";
        const values = dates ? field === "fiscalYearStartDate" ? ["2021-04-01", "2022-04-01", "2023-04-01"] : ["2025-03-31", "2026-03-31", "2027-03-31"] : ["a", "b", "c"];
        const inputs = values.map((value, i) => document(String(i), { [field]: value }));
        for (const order of [SortOrder.Ascending, SortOrder.Descending]) {
            const result = screenCompanyDocuments(inputs, { sortBy: field, order });
            expect(result.rows.map(row => row.docID)).toEqual(order === "asc" ? ["DOC-0", "DOC-1", "DOC-2"] : ["DOC-2", "DOC-1", "DOC-0"]);
            const page = screenCompanyDocuments(inputs, { sortBy: field, order, offset: 1, limit: 1 });
            expect(page.total).toBe(3); expect(page.rows.map(row => row.docID)).toEqual(["DOC-1"]);
        }
    });
    it("同値の並びはEDINET原文昇順、localeで順序を変えない", () => {
        const inputs = [document("b", { filerName: "同値" }), document("a", { filerName: "同値" }), document("A", { filerName: "同値" })];
        expect(codes(screenCompanyDocuments(inputs, { sortBy: "filerName", order: "desc" }))).toEqual(["A", "a", "b"]);
    });
    it("0件・limit0・範囲外ページでもページ前件数を返す", () => {
        expect(screenCompanyDocuments([])).toMatchObject({ rows: [], total: 0, excludedRows: 0, filteredRows: 0 });
        for (const options of [{ limit: 0 }, { offset: 4 }]) expect(screenCompanyDocuments([document("A")], options)).toMatchObject({ rows: [], total: 1 });
    });
    it("欠損と不整合は条件不一致と分け、項目候補と理由を保持", () => {
        const missing = document("M", {}, { omit: "filerName" });
        const nil = document("N", {}, { nil: "securityCode" });
        const reversed = document("R", { fiscalYearStartDate: "2026-04-01" });
        const result = screenCompanyDocuments([document("A"), document("B"), missing, nil, reversed], { conditions: [{ field: "edinetCode", operator: "eq", value: "A" }] });
        expect(result).toMatchObject({ total: 1, filteredRows: 1, excludedRows: 3, reasonCounts: { incomplete: 2, inconsistent: 1 } });
        expect(result.diagnostics[0]).toMatchObject({ docID: "DOC-M", reason: "incomplete", fields: [{ fieldId: "filerName", status: "missing", reason: "tag-absent", evidence: [] }] });
        expect(result.diagnostics[1].fields[0].evidence[0]).toMatchObject({ nil: true, contextRef: "filing" });
        expect(result.diagnostics[2]).toMatchObject({ reason: "inconsistent", fields: [], consistencyDiagnostics: [{ reason: "fiscal-year-reversed" }] });
    });
    it("曖昧/非対応は不足診断で採用せず、欠損決算月も条件で隠さない", () => {
        const duplicate = document("D", {}, { extra: '<dei:FilerNameInJapaneseDEI contextRef="filing">別候補</dei:FilerNameInJapaneseDEI>' });
        const unknown = document("U"); unknown.xml = unknown.xml.replace("http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor", "urn:fake");
        const missingDate = document("M", {}, { omit: "fiscalYearEndDate" });
        const result = screenCompanyDocuments([duplicate, unknown, missingDate], { fiscalYearEndMonth: 12 });
        expect(result).toMatchObject({ total: 0, excludedRows: 3, filteredRows: 0, reasonCounts: { incomplete: 3 } });
        expect(result.diagnostics.find(d => d.docID === "DOC-D")!.fields[0]).toMatchObject({ status: "ambiguous", reason: "multiple-facts" });
        expect(result.diagnostics.find(d => d.docID === "DOC-U")!.fields[0].status).toBe("unsupported");
    });
    it("docID重複を構文解析より先に拒否", () => {
        expect(() => screenCompanyDocuments([{ xml: "<broken>", docID: "same" }, { xml: "<also-broken>", docID: "same" }])).toThrow("同一docID");
    });
    it("getter入力は1回ずつ取得し検査したXMLとdocIDで解析・hashする", () => {
        const original = document("A"), replacement = document("B");
        let xmlReads = 0, idReads = 0;
        const changing = {
            get xml() { return ++xmlReads === 1 ? original.xml : replacement.xml; },
            get docID() { return ++idReads === 1 ? original.docID : replacement.docID; }
        };
        const result = screenCompanyDocuments([changing, replacement]);
        expect([xmlReads, idReads]).toEqual([1, 1]);
        expect(codes(result)).toEqual(["A", "B"]);
        expect(result.rows[0].docID).toBe(original.docID);
        expect(result.rows[0].sourceXmlHash).toBe(createHash("sha256").update(original.xml).digest("hex"));
        expect(result.rows[0].fields.filerName.source?.docID).toBe(original.docID);
    });
    it.each(["edinet", "entity"])("採用可能な%s重複を条件・ページ前に拒否", kind => {
        const second = document("B", kind === "edinet" ? { edinetCode: "A" } : {}, kind === "entity" ? { entity: "A" } : {});
        expect(() => screenCompanyDocuments([document("A"), second], { conditions: [{ field: "securityCode", operator: "eq", value: "AA0" }], limit: 0 })).toThrow("複数候補");
    });
    it("除外行の同一コードから自動で履歴選択したとは扱わない", () => {
        const incomplete = document("B", { edinetCode: "A" }, { omit: "securityCode", entity: "A" });
        expect(screenCompanyDocuments([document("A"), incomplete])).toMatchObject({ total: 1, excludedRows: 1 });
    });
    it.each([
        { unknown: true }, { sortBy: "unknown" }, { order: "ASC" }, { offset: -1 }, { limit: 1.5 }, { limit: Infinity }, { offset: Number.MAX_SAFE_INTEGER + 1 },
        { fiscalYearEndMonth: 0 }, { fiscalYearEndMonth: 13 }, { fiscalYearEndMonth: 1.5 }, { fiscalYearEndMonth: "3" }, { fiscalYearEndMonth: null },
        { conditions: {} }, { conditions: [null] }, { conditions: new Array(1) },
        { conditions: [{ field: "unknown", operator: "eq", value: "x" }] }, { conditions: [{ field: "__proto__", operator: "eq", value: "x" }] },
        { conditions: [{ field: "filerName", operator: "regex", value: "x" }] }, { conditions: [{ field: "filerName", operator: "eq", value: "" }] },
        { conditions: [{ field: "filerName", operator: "contains", value: "" }] }, { conditions: [{ field: "filerName", operator: "eq", value: 1 }] },
        { conditions: [{ field: "filerName", operator: "eq", value: "x", unknown: true }] }
    ])("設定誤りを空集合でも拒否 %j", options => {
        expect(() => screenCompanyDocuments([], options as unknown as CompanyScreeningOptions)).toThrow();
    });
    it.each([null, {}, new Array(1), [undefined], [{ docID: "A" }], [{ docID: "A", xml: "<x/>", extra: true }], [{ docID: " ", xml: "<x/>" }]])("不正入力を拒否 %j", input => {
        expect(() => screenCompanyDocuments(input as unknown as CompanyDocument[])).toThrow();
    });
    it("不正XMLは行除外で隠さず入力エラー", () => {
        expect(() => screenCompanyDocuments([{ xml: "<broken>", docID: "A" }])).toThrow("XML");
    });
});
