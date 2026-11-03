import { describe, it, expect } from "vitest";
import { extractSubsidiaryHumanCapitalMetrics as extract, screenSubsidiaryHumanCapitalMetrics as screen, SubsidiaryHumanCapitalMetricId as M,
    EdinetXbrlParser, type SubsidiaryHumanCapitalAnnotation } from "../src/index";
import { subsidiaryDocument, tags, numeric, proof } from "./fixtures/subsidiary-metrics";
const run = (doc = subsidiaryDocument(), metrics = Object.values(M)) => extract(doc.xml, doc.metadata, metrics, doc.annotations);
const annotation = (doc = subsidiaryDocument(), metric = M.MaleChildcareLeaveAllRatio, method = "ordinance-item2" as const): SubsidiaryHumanCapitalAnnotation => ({ kind: "childcare-method", rowKey: run(doc).rows[0].label.rowKey!, metric, method, proof });
describe("子会社人的資本表の行と比率", () => {
    it("単体財務scopeへ変換せず、専用タグ・行・全QName trace・unitを保持", () => {
        const result = run(); expect(result.summary).toMatchObject({ labels: 1, selectedLabels: 1, candidateFacts: 7, comparableValues: 4, reportedValues: 3, unavailableValues: 0 });
        expect(result.rows[0].selections.femaleManagerRatio).toMatchObject({ status: "selected", safeNumber: 0.1, raw: "0.1", source: { dimensions: ["Row1Member"], unit: "xbrli:pure" } });
        const source = result.rows[0].selections.femaleManagerRatio!.source!;
        expect(result.traces[source.traceRef].trace.candidates[0].dimensions[0]).toMatchObject({ kind: "explicit", axis: { localName: "SequentialNumbersAxis" }, member: { localName: "Row1Member" } });
        expect(result.rows[0].label.consolidationDeclaration).toBe("not-declared"); expect(result.inputXmlSha256).toMatch(/^[a-f0-9]{64}$/);
    });
    it("育休率の報告値を保持し、算出方法の根拠がある場合だけ比較可能にする", () => {
        const doc = subsidiaryDocument(); expect(run(doc).rows[0].selections[M.MaleChildcareLeaveAllRatio]).toMatchObject({ status: "reported", reason: "definition-unconfirmed", raw: "1.2", safeNumber: 1.2 });
        doc.annotations = [annotation(doc)]; expect(run(doc).rows[0].selections[M.MaleChildcareLeaveAllRatio]).toMatchObject({ status: "selected", safeNumber: 1.2, declaration: { method: "ordinance-item2", verification: "source-reference-matched" } });
        expect(screen([doc], M.MaleChildcareLeaveAllRatio, { childcareMethod: "ordinance-item2", conditions: [{ operator: "gt", value: 1 }] }).total).toBe(1);
        expect(screen([doc], M.MaleChildcareLeaveAllRatio, { childcareMethod: "womens-act" })).toMatchObject({ total: 0, excludedRows: 1, diagnostics: expect.arrayContaining([expect.objectContaining({ reason: "different-childcare-method" })]) });
        expect(() => screen([], M.MaleChildcareLeaveAllRatio)).toThrow();
    });
    it("nilの理由を推測せず、注記で確認した非該当/未開示を別に保持", () => {
        const doc = subsidiaryDocument("DOC-A", [{ name: "合成", values: { [M.GenderWageNonRegularRatio]: null } }]), rowKey = run(doc).rows[0].label.rowKey!;
        expect(run(doc).rows[0].selections[M.GenderWageNonRegularRatio]).toMatchObject({ status: "missing", reason: "nil", disclosure: { state: "unknown" } });
        for (const state of ["not-applicable", "not-disclosed"] as const) { doc.annotations = [{ kind: "unavailable", rowKey, metric: M.GenderWageNonRegularRatio, state, proof }]; expect(run(doc).rows[0].selections[M.GenderWageNonRegularRatio]).toMatchObject({ disclosure: { state, verification: "source-reference-matched" } }); }
        const actual = subsidiaryDocument(); actual.annotations = [{ kind: "unavailable", rowKey, metric: M.GenderWageNonRegularRatio, state: "not-applicable", proof }]; expect(() => run(actual)).toThrow();
    });
    it("同名の別行を統合せず、別表や提出会社のRow1値を代用しない", () => {
        const doc = subsidiaryDocument("DOC-A", [{ name: "同名", values: { [M.FemaleManagerRatio]: "0.1" } }, { name: "同名", values: { [M.FemaleManagerRatio]: "0.3" } }]);
        expect(run(doc).rows).toHaveLength(2); expect(new Set(run(doc).rows.map(r => r.label.rowKey)).size).toBe(2);
        doc.xml = doc.xml.replaceAll(tags[M.FemaleManagerRatio], "RatioOfFemaleEmployeesInManagerialPositionsMetricsOfReportingCompany");
        expect(run(doc).rows.every(r => r.selections.femaleManagerRatio?.reason === "tag-absent")).toBe(true);
    });
    it.each([["negative", "-0.1"], ["dash", "−"], ["percent", "12%"], ["unsafe", "9007199254740993"], ["zero", "0"]])("%sの原値を正しく区別", (kind, value) => {
        const doc = subsidiaryDocument("DOC-A", [{ name: "合成", values: { [M.FemaleManagerRatio]: value } }]), result = run(doc).rows[0].selections.femaleManagerRatio!;
        if (kind === "zero") expect(result).toMatchObject({ status: "selected", safeNumber: 0 });
        else if (kind === "unsafe") { expect(result).toMatchObject({ status: "selected", raw: value, safeNumber: undefined }); expect(screen([doc], M.FemaleManagerRatio).excludedRows).toBe(1); }
        else expect(result.status).toBe("unsupported");
    });
    it("同じ実体・時点・完全QName行の別context IDを結び付け、prefix別名もURIで確認", () => {
        const doc = subsidiaryDocument(), context = /<xbrli:context id="row1">[\s\S]*?<\/xbrli:context>/.exec(doc.xml)![0];
        doc.xml = doc.xml.replace('</xbrli:xbrl>', context.replace('id="row1"', 'id="numbers"') + '</xbrli:xbrl>').replaceAll('contextRef="row1" unitRef=', 'contextRef="numbers" unitRef=');
        doc.xml = doc.xml.replace(`<jpcrp_cor:${tags[M.FemaleManagerRatio]} `, `<alias:${tags[M.FemaleManagerRatio]} xmlns:alias="http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor" `).replace(`</jpcrp_cor:${tags[M.FemaleManagerRatio]}>`, `</alias:${tags[M.FemaleManagerRatio]}>`);
        expect(run(doc)).toMatchObject({ summary: { comparableValues: 4, orphanFacts: 0 } });
        expect(run(doc).rows[0].selections.femaleManagerRatio?.source?.contextRef).toBe("numbers");
    });
    it("完全一致の重複だけを採用し、精度/原値の違いとnil混在を曖昧にする", () => {
        for (const kind of ["same", "precision", "value", "nil"] as const) {
            const extra = numeric(tags[M.FemaleManagerRatio], kind === "nil" ? null : kind === "value" ? "0.2" : "0.1").replace('decimals="INF"', kind === "precision" ? 'decimals="0"' : 'decimals="INF"');
            const r = run(subsidiaryDocument("DOC-A", undefined, extra)).rows[0].selections.femaleManagerRatio!;
            expect(r).toMatchObject(kind === "same" ? { status: "selected", reason: "selected-identical-duplicates" } : { status: "ambiguous", reason: "multiple-facts" });
        }
    });
    it("ラベル不明・period違い・重複contextは数値だけで行を作らない", () => {
        const doc = subsidiaryDocument(); doc.xml = doc.xml.replaceAll('ConsolidatedSubsidiariesMetricsOfConsolidatedSubsidiaries', 'OtherLabel');
        expect(run(doc)).toMatchObject({ rows: [], summary: { orphanFacts: 7 } });
        const period = subsidiaryDocument(); period.metadata.instant = "2025-03-31"; expect(run(period).summary.comparableValues).toBe(0);
        const duplicate = subsidiaryDocument(); const context = /<xbrli:context id="row1">[\s\S]*?<\/xbrli:context>/.exec(duplicate.xml)![0]; duplicate.xml = duplicate.xml.replace('</xbrli:xbrl>', context + '</xbrli:xbrl>');
        expect(run(duplicate).summary.comparableValues).toBe(0);
    });
    it.each(["hash", "unknown-row", "duplicate", "unknown-metric", "wrong-method", "numeric-note"])("%sの注記宣言を受理しない", kind => {
        const doc = subsidiaryDocument(), a: any = annotation(doc);
        if (kind === "hash") a.proof = { ...proof, rawSha256: "a".repeat(64) };
        if (kind === "unknown-row") a.rowKey = "a".repeat(64);
        if (kind === "unknown-metric") a.metric = "other";
        if (kind === "wrong-method") a.method = "other";
        if (kind === "numeric-note") doc.xml = doc.xml.replace(`<${proof.key} contextRef="filing">`, `<${proof.key} contextRef="filing" unitRef="ratio">`);
        doc.annotations = kind === "duplicate" ? [a, a] : [a]; expect(() => run(doc)).toThrow();
    });
    it("対象以外の有効な宣言も検査し、getterは一度だけ固定", () => {
        const doc = subsidiaryDocument(); let reads = 0; const a = annotation(doc); Object.defineProperty(a, "method", { enumerable: true, get() { reads++; return "ordinance-item2"; } }); doc.annotations = [a];
        expect(screen([doc], M.FemaleManagerRatio).total).toBe(1); expect(reads).toBe(1);
    });
    it("Object入口のdocIDを照合し、元のXMLや宣言を変更しない", () => {
        const doc = subsidiaryDocument(), before = JSON.stringify(doc), parsed = new EdinetXbrlParser().parse(doc.xml, "OTHER");
        expect(() => parsed.selectSubsidiaryHumanCapitalMetrics(doc.metadata, [M.FemaleManagerRatio])).toThrow(); run(doc); expect(JSON.stringify(doc)).toBe(before);
    });
});
describe("子会社表の同じ定義による検索", () => {
    it.each(["gt", "gte", "lt", "lte", "eq"] as const)("%sとラベル文字列、順序、ページ、除外を適用", operator => {
        const doc = subsidiaryDocument("DOC-A", [{ name: "合成A", values: { [M.FemaleManagerRatio]: "0.1" } }, { name: "合成B", values: { [M.FemaleManagerRatio]: "0.2" } }, { name: "合成C", values: { [M.FemaleManagerRatio]: null } }]);
        const result = screen([doc], M.FemaleManagerRatio, { conditions: [{ operator, value: 0.1 }], labelContains: "合成", order: "asc" });
        const compare = (n: number) => operator === "gt" ? n > .1 : operator === "gte" ? n >= .1 : operator === "lt" ? n < .1 : operator === "lte" ? n <= .1 : n === .1;
        expect(result.total).toBe([.1,.2].filter(compare).length); expect(result.excludedRows).toBe(1);
        expect(screen([doc], M.FemaleManagerRatio, { order: "desc", offset: 1, limit: 1 }).rows[0].label.parsedLabel).toBe("合成A");
    });
    it("空集合の不正設定と条件で隠れる二重提出者/期末混在を拒否", () => {
        expect(() => screen([], M.FemaleManagerRatio, { conditions: [{ operator: "eq", value: NaN }] })).toThrow();
        expect(() => screen([subsidiaryDocument(), subsidiaryDocument()], M.FemaleManagerRatio, { conditions: [{ operator: "gt", value: 999 }] })).toThrow();
        const second = subsidiaryDocument("DOC-B"); second.metadata.instant = "2025-03-31"; expect(() => screen([subsidiaryDocument(), second], M.FemaleManagerRatio)).toThrow();
    });
});
