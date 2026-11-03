import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { createIfrsBalanceSheetSnapshot, screenIfrsBalanceSheetDocuments, IfrsBalanceSheetMetricId,
    IFRS_BALANCE_SHEET_SCREENING_MAX_DOCUMENTS, IFRS_BALANCE_SHEET_SCREENING_MAX_CONDITIONS,
    type IfrsBalanceSheetMetadata, type IfrsBalanceSheetDocument, type IfrsBalanceSheetScreeningOptions } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const mappings = [[IfrsBalanceSheetMetricId.CurrentAssets, "CurrentAssetsIFRS"], [IfrsBalanceSheetMetricId.CurrentLiabilities, "TotalCurrentLiabilitiesIFRS"],
    [IfrsBalanceSheetMetricId.TotalLiabilities, "LiabilitiesIFRS"]] as const;
const ids = mappings.map(([id]) => id), instant = "2026-03-31";
const metadata = (code = "1001"): IfrsBalanceSheetMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`, instant, scope: "Consolidated", accountingStandard: "IFRS", currency: "JPY" });
const context = (code: string, options: { scope?: string; instant?: string } = {}) => `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${options.instant ?? instant}</xbrli:instant></xbrli:period>${options.scope === "NonConsolidated" ? `<xbrli:scenario>${standalone}</xbrli:scenario>` : ""}</xbrli:context>`;
interface XmlOptions { absent?: IfrsBalanceSheetMetricId; nil?: IfrsBalanceSheetMetricId; duplicate?: IfrsBalanceSheetMetricId; unit?: string; entity?: string; scope?: string; instant?: string; namespace?: string; extra?: string; }
function xml(raw = "120.5000", code = "1001", options: XmlOptions = {}) {
    const f = (id: IfrsBalanceSheetMetricId, tag: string) => fact(options.nil === id ? "" : raw, options.nil === id ? 'xsi:nil="true"' : "", `jpigp_cor:${tag}`);
    const facts = mappings.filter(([id]) => id !== options.absent).map(([id, tag]) => f(id, tag) + (options.duplicate === id ? f(id, tag).replace(`>${raw}<`, `>${raw}0<`) : "")).join("") + (options.extra ?? "");
    return instance(facts, context(options.entity ?? code, options), `<xbrli:unit id="money"><xbrli:measure>${options.unit ?? "iso4217:JPY"}</xbrli:measure></xbrli:unit>`)
        .replace('<xbrli:xbrl ', `<xbrli:xbrl xmlns:jpigp_cor="${options.namespace ?? "http://disclosure.edinet-fsa.go.jp/taxonomy/jpigp/2025-11-01/jpigp_cor"}" `);
}
const doc = (code = "1001", raw = "120.5000", options: XmlOptions = {}): IfrsBalanceSheetDocument => ({ xml: xml(raw, code, options), metadata: metadata(code) });
const codes = (result: ReturnType<typeof screenIfrsBalanceSheetDocuments>) => result.rows.map(row => row.metadata.secCode);

describe("IFRS専用snapshot", () => {
    it("専用metadata・原値・採用理由・候補・出典と同じ入力のhashを返す", () => {
        const input = "\uFEFF" + xml(), m = metadata(), before = JSON.stringify(m), result = createIfrsBalanceSheetSnapshot(input, m);
        expect(result.metadata).toEqual({ ...m, secCode: "10010" });
        expect(Object.keys(result.selections)).toEqual(ids);
        expect(result.inputXmlSha256).toBe(createHash("sha256").update(input).digest("hex"));
        for (const [id, tag] of mappings) {
            expect(result.selections[id]).toMatchObject({ status: "selected", raw: "120.5000", safeNumber: 120.5,
                source: { key: `jpigp_cor:${tag}`, contextRef: "current", entity: { identifier: "1001", scheme: "synthetic" }, period: { instant }, scope: "Consolidated", unit: "iso4217:JPY" } });
            expect(result.selections[id].evidence).toHaveLength(1);
        }
        result.metadata.docID = "changed"; result.selections.currentAssets.source!.entity!.identifier = "changed";
        expect(JSON.stringify(m)).toBe(before);
    });
    it.each(["0", "-0", "-10.25", "9007199254740993"])("原記載%sを変換で失わない", raw => {
        const result = createIfrsBalanceSheetSnapshot(xml(raw), metadata());
        for (const id of ids) {
            expect(result.selections[id].raw).toBe(raw);
            expect(result.selections[id].safeNumber).toBe(raw === "9007199254740993" ? undefined : Number(raw));
        }
        if (raw === "-0") expect(Object.is(result.selections.currentAssets.safeNumber, -0)).toBe(true);
        expect(JSON.parse(JSON.stringify(result)).selections.currentAssets.raw).toBe(raw);
    });
    it("既存parserのDOCTYPE/構文guardへ委ねる", () => {
        expect(() => createIfrsBalanceSheetSnapshot('<!DOCTYPE x [<!ENTITY a "x">]><x/>', metadata())).toThrow();
        expect(() => createIfrsBalanceSheetSnapshot("<broken>", metadata())).toThrow();
    });
    it.each([
        { accountingStandard: "J-GAAP" }, { currency: "USD" }, { instant: "2026-02-30" }, { instant: "bad" },
        { secCode: "bad" }, { docID: "" }, { docID: "doc\n" }, { period: { instant } }, { unknown: true }
    ])("不正metadataを設定エラーにする %j", override => {
        expect(() => createIfrsBalanceSheetSnapshot(xml(), { ...metadata(), ...override } as any)).toThrow();
    });
    it.each(mappings)("%sをJ-GAAPや合算/別タグで代用しない", (id, tag) => {
        const extra = [fact("200", "", `jppfs_cor:${tag.replace("IFRS", "")}`), fact("300", "", "jpigp_cor:EquityAndLiabilitiesIFRS"), fact("50", "", "jpigp_cor:NonCurrentAssetsIFRS")].join("");
        expect(createIfrsBalanceSheetSnapshot(xml("120", "1001", { absent: id, extra }), metadata()).selections[id]).toMatchObject({ status: "missing", reason: "tag-absent" });
    });
});

describe("明示IFRS企業集合の条件と順序", () => {
    const operators = [{ operator: "gte", codes: ["10010", "10020"] }, { operator: "gt", codes: ["10010"] }, { operator: "lte", codes: ["10020", "10030"] },
        { operator: "lt", codes: ["10030"] }, { operator: "eq", codes: ["10020"] }] as const;
    const data = () => [doc("1001", "200"), doc("1003", "50"), doc("1002", "100")];
    it.each(ids.flatMap(id => operators.map(condition => ({ id, ...condition }))))("$id $operatorの境界", ({ id, operator, codes: expected }) => {
        const result = screenIfrsBalanceSheetDocuments(data(), { conditions: [{ metric: id, operator, value: 100 }], sortBy: id });
        expect(codes(result)).toEqual(expected); expect(result.total + result.filteredRows).toBe(3); expect(result.excludedRows).toBe(0);
    });
    it.each(ids)("%sで両順序/ページ/AND/同値順", id => {
        for (const order of ["asc", "desc"] as const) {
            const all = screenIfrsBalanceSheetDocuments(data(), { sortBy: id, order });
            expect(codes(all)).toEqual(order === "asc" ? ["10030", "10020", "10010"] : ["10010", "10020", "10030"]);
            const page = screenIfrsBalanceSheetDocuments(data(), { sortBy: id, order, offset: 1, limit: 1 });
            expect(codes(page)).toEqual(["10020"]); expect(page.total).toBe(3);
        }
        expect(codes(screenIfrsBalanceSheetDocuments([doc("1002", "100"), doc("1001", "100")], { sortBy: id }))).toEqual(["10010", "10020"]);
        expect(screenIfrsBalanceSheetDocuments(data(), { conditions: [{ metric: id, operator: "gte", value: 50 }, { metric: id, operator: "lte", value: 100 }] }).total).toBe(2);
    });
    it("sort無しはコード昇順、ページ前件数とlimit0を維持", () => {
        expect(codes(screenIfrsBalanceSheetDocuments(data()))).toEqual(["10010", "10020", "10030"]);
        expect(screenIfrsBalanceSheetDocuments(data(), { limit: 0 })).toMatchObject({ rows: [], total: 3, excludedRows: 0, filteredRows: 0 });
        expect(screenIfrsBalanceSheetDocuments([], { offset: 1 })).toMatchObject({ rows: [], total: 0 });
    });
    it("0・負数も検索でき、number丸めでunsafeを採用しない", () => {
        const result = screenIfrsBalanceSheetDocuments([doc("1001", "-1"), doc("1002", "0"), doc("1003", "0.1"), doc("1004", "9007199254740993")], {
            conditions: [{ metric: "currentAssets", operator: "lte", value: 0 }], sortBy: "currentAssets", order: "asc" });
        expect(codes(result)).toEqual(["10010", "10020"]);
        expect(result).toMatchObject({ total: 2, excludedRows: 1, filteredRows: 1, reasonCounts: { "unsafe-number": 3 } });
    });
    it("不要項目欠損は残し、必要項目欠損/曖昧/unsupported/unsafeを区別", () => {
        const inputs = [doc("1001", "10", { absent: "totalLiabilities" }), doc("1002", "10", { nil: "currentAssets" }), doc("1003", "10", { extra: fact("11", "", "jpigp_cor:CurrentAssetsIFRS") }),
            doc("1004", "10", { unit: "iso4217:USD" }), doc("1005", "9007199254740993")];
        const result = screenIfrsBalanceSheetDocuments(inputs, { sortBy: "currentAssets" });
        expect(codes(result)).toEqual(["10010"]); expect(result.excludedRows).toBe(4);
        expect(result.rows[0].selections.totalLiabilities.status).toBe("missing");
        expect(result.diagnostics.find(d => d.secCode === "10010")).toMatchObject({ metric: "totalLiabilities", required: false });
        expect(result.diagnostics.find(d => d.secCode === "10020" && d.metric === "currentAssets")).toMatchObject({ reason: "missing", selectionReason: "nil", required: true });
        expect(result.diagnostics.find(d => d.secCode === "10030")).toMatchObject({ reason: "ambiguous", selectionReason: "multiple-facts" });
        expect(result.diagnostics.find(d => d.secCode === "10040")).toMatchObject({ reason: "unsupported", selectionReason: "unsupported-unit" });
        expect(result.reasonCounts["unsafe-number"]).toBe(3);
        expect(screenIfrsBalanceSheetDocuments([inputs[0]])).toMatchObject({ total: 0, excludedRows: 1 });
    });
    it.each(["namespace", "period", "standalone"])("XML内の%s不一致を推測しない", kind => {
        const input = doc("1001", "10", kind === "namespace" ? { namespace: "urn:unknown" } : kind === "period" ? { instant: "2025-03-31" } : { scope: "NonConsolidated" });
        const result = screenIfrsBalanceSheetDocuments([input]);
        expect(result.total).toBe(0); expect(result.excludedRows).toBe(1); expect(result.diagnostics).toHaveLength(3);
    });
    it.each(["company", "doc", "entity", "period", "scope", "standard", "currency"])("%s混在を条件やlimit0で隠さない", kind => {
        const a = doc("1001", "0"), b: any = doc("1002", "0", kind === "entity" ? { entity: "1001" } : {});
        if (kind === "company") b.metadata.secCode = "10010";
        if (kind === "doc") b.metadata.docID = a.metadata.docID;
        if (kind === "period") b.metadata.instant = "2025-03-31";
        if (kind === "scope") b.metadata.scope = "NonConsolidated";
        if (kind === "standard") b.metadata.accountingStandard = "J-GAAP";
        if (kind === "currency") b.metadata.currency = "USD";
        expect(() => screenIfrsBalanceSheetDocuments([a, b], { conditions: [{ metric: "currentAssets", operator: "gt", value: 100 }], limit: 0 })).toThrow();
    });
    it("非採用候補のentityも条件前に照合する", () => {
        const a = doc("1001", "10", { entity: "shared", namespace: "urn:unsupported" }), b = doc("1002", "10", { entity: "shared" });
        expect(() => screenIfrsBalanceSheetDocuments([a, b], { limit: 0 })).toThrow("entity");
    });
});

describe("入力と設定の一回取得・有限な明示集合", () => {
    it("flat属性のキー列挙を一回に固定する", () => {
        const counts = { metadata: 0, options: 0, condition: 0 };
        const once = <T extends object>(target: T, key: keyof typeof counts): T => new Proxy(target, { ownKeys(value) {
            counts[key]++; if (counts[key] > 1) throw new Error("ownKeys twice"); return Reflect.ownKeys(value);
        } });
        const input = doc(); input.metadata = once(input.metadata, "metadata");
        const condition = once({ metric: "currentAssets" as const, operator: "gte" as const, value: 0 }, "condition");
        const settings = once({ conditions: [condition], limit: 1 }, "options");
        expect(screenIfrsBalanceSheetDocuments([input], settings).total).toBe(1);
        expect(counts).toEqual({ metadata: 1, options: 1, condition: 1 });
    });
    it("metadata/条件/options/XMLを一回取得し、解析とhashを一致させる", () => {
        const original = doc(), reads: Record<string, number> = {}, m: any = {}, input: any = {}, c: any = {}, o: any = {};
        const once = (object: any, key: string, value: unknown) => Object.defineProperty(object, key, { enumerable: true, get() { reads[key] = (reads[key] ?? 0) + 1; if (reads[key] > 1) throw new Error("read twice"); return value; } });
        for (const [key, value] of Object.entries(original.metadata)) once(m, key, value);
        once(input, "metadata", m); once(input, "xml", original.xml);
        once(c, "metric", "currentAssets"); once(c, "operator", "gte"); once(c, "value", 0);
        once(o, "conditions", [c]); once(o, "sortBy", "currentAssets"); once(o, "order", "asc"); once(o, "offset", 0); once(o, "limit", 1);
        const result = screenIfrsBalanceSheetDocuments([input], o);
        expect(result.total).toBe(1); expect(Object.values(reads).every(value => value === 1)).toBe(true);
        expect(result.rows[0].inputXmlSha256).toBe(createHash("sha256").update(original.xml).digest("hex"));
    });
    it("XML getterが他社metadataや元条件を変更しても検査した値を使う", () => {
        const a = doc("1001"), b = doc("1002"), saved = a.xml, condition = { metric: "currentAssets" as const, operator: "gte" as const, value: 0 };
        Object.defineProperty(a, "xml", { enumerable: true, get() { b.metadata.instant = "2024-03-31"; condition.value = 999; return saved; } });
        const result = screenIfrsBalanceSheetDocuments([a, b], { conditions: [condition] });
        expect(result.total).toBe(2); expect(result.rows[1].metadata.instant).toBe(instant);
    });
    it("入力配列・条件の独自iteratorを実行せず各indexを一回読む", () => {
        const input = [doc()], conditions = [{ metric: "currentAssets" as const, operator: "gte" as const, value: 0 }]; let iterated = 0, read = 0;
        for (const values of [input, conditions]) Object.defineProperty(values, Symbol.iterator, { value: function* () { iterated++; throw new Error("custom iterator"); } });
        const original = input[0]; Object.defineProperty(input, "0", { enumerable: true, get() { read++; return original; } });
        expect(screenIfrsBalanceSheetDocuments(input, { conditions }).total).toBe(1); expect(iterated).toBe(0); expect(read).toBe(1);
    });
    it("入力不変、返却metadata/evidenceは入力から独立", () => {
        const inputs = [doc()], before = JSON.stringify(inputs), result = screenIfrsBalanceSheetDocuments(inputs);
        result.rows[0].metadata.docID = "changed"; result.rows[0].selections.currentAssets.source!.entity!.identifier = "changed";
        expect(JSON.stringify(inputs)).toBe(before); expect(screenIfrsBalanceSheetDocuments(inputs).rows[0].metadata.docID).toBe(inputs[0].metadata.docID);
    });
    it.each([
        { unknown: true }, { conditions: null }, { conditions: new Array(1) }, { conditions: [{ metric: "currentRatio", operator: "gte", value: 1 }] },
        { conditions: [{ metric: "currentAssets", operator: "bad", value: 1 }] }, { conditions: [{ metric: "currentAssets", operator: "eq", value: NaN }] },
        { conditions: [{ metric: "currentAssets", operator: "eq", value: Number.MAX_SAFE_INTEGER + 1 }] }, { conditions: [{ metric: "currentAssets", operator: "eq", value: 1, extra: true }] },
        { sortBy: "currentRatio" }, { order: "ASC" }, { offset: -1 }, { limit: 1.5 }, { offset: Number.MAX_SAFE_INTEGER + 1 }
    ])("不正optionsを空集合でも拒否 %j", settings => expect(() => screenIfrsBalanceSheetDocuments([], settings as unknown as IfrsBalanceSheetScreeningOptions)).toThrow());
    it("不正document/疎配列を拒否", () => {
        for (const input of [null, {}, [null], new Array(1), [{ xml: xml() }], [{ ...doc(), extra: true }]]) expect(() => screenIfrsBalanceSheetDocuments(input as any)).toThrow();
    });
    it("原本100件/条件100件を上限とする", () => {
        const full = Array.from({ length: IFRS_BALANCE_SHEET_SCREENING_MAX_DOCUMENTS }, (_, i) => doc(String(1000 + i)));
        const conditions = Array.from({ length: IFRS_BALANCE_SHEET_SCREENING_MAX_CONDITIONS }, () => ({ metric: "currentAssets" as const, operator: "gte" as const, value: 0 }));
        expect(screenIfrsBalanceSheetDocuments(full, { conditions }).total).toBe(100);
        expect(() => screenIfrsBalanceSheetDocuments(Array.from({ length: IFRS_BALANCE_SHEET_SCREENING_MAX_DOCUMENTS + 1 }, () => doc()))).toThrow("100");
        expect(() => screenIfrsBalanceSheetDocuments([], { conditions: Array.from({ length: IFRS_BALANCE_SHEET_SCREENING_MAX_CONDITIONS + 1 }, () => ({ metric: "currentAssets", operator: "gte", value: 0 })) })).toThrow("100");
    });
});
