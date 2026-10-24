import { describe, it, expect } from "vitest";
import { EdinetXbrlParser, EdinetXbrlObject, type ContextDimensionTraceMap } from "../src/index";
import { ContextParser } from "../src/edinet-context";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const XI = "http://www.xbrl.org/2003/instance", XD = "http://xbrl.org/2006/xbrldi";
const context = (content = "", id = "c", attrs = "", entityContent = "") => `<xbrli:context id="${id}" ${attrs}><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier>${entityContent}</xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period>${content}</xbrli:context>`;
const explicit = (axis = "a:Axis", member = "m:Member", attrs = "") => `<xbrldi:explicitMember dimension="${axis}" ${attrs}>${member}</xbrldi:explicitMember>`;
const scenario = (content = explicit(), attrs = 'xmlns:a="urn:axes" xmlns:m="urn:members"') => `<xbrli:scenario ${attrs}>${content}</xbrli:scenario>`;
const object = (contexts = context(scenario()), facts = "") => new EdinetXbrlParser().parse(instance(facts, contexts), "SYNTHETIC1");
const trace = (contexts = context(scenario())) => object(contexts).traceContextDimensions("c");
const first = (contexts = context(scenario())) => trace(contexts).candidates[0].dimensions[0];

describe("QNameの解決証跡", () => {
    it("軸/memberの宣言URI・宣言位置・原文字列を記録しDTS検証とは区別", () => {
        const result = trace(); expect(result).toMatchObject({ contextId: "c", status: "resolved", dtsValidation: "not-performed", diagnostics: [] });
        const entry = result.candidates[0].dimensions[0];
        expect(entry).toMatchObject({ kind: "explicit", location: "scenario", axis: { raw: "a:Axis", normalized: "a:Axis", prefix: "a", localName: "Axis", namespaceURI: "urn:axes", status: "resolved", binding: { prefix: "a", parsedUri: "urn:axes", state: "bound" } },
            member: { raw: "m:Member", namespaceURI: "urn:members" }, diagnostics: [] });
        if (entry.kind === "explicit") expect(entry.axis.binding?.declaredAt).toContain("xbrli:scenario");
    });
    it("root/context/entity/segment/個別memberの宣言を順に適用", () => {
        const segment = `<xbrli:segment xmlns:a="urn:segment">${explicit("a:Axis", "m:Member", 'xmlns:m="urn:local-member"')}</xbrli:segment>`;
        const entry = first(context("", "c", 'xmlns:a="urn:context"', segment));
        expect(entry).toMatchObject({ location: "segment", axis: { namespaceURI: "urn:segment" }, member: { namespaceURI: "urn:local-member" } });
    });
    it("同じURIのaliasと同じprefixの局所再束縛を区別", () => {
        const content = explicit("a:Axis", "a:Member", 'xmlns:a="urn:one"') + explicit("a:Axis", "a:Member", 'xmlns:a="urn:two"');
        const result = trace(context(scenario(content)));
        expect(result.status).toBe("resolved");
        expect(result.candidates[0].dimensions.map(entry => entry.kind === "explicit" && entry.axis.namespaceURI)).toEqual(["urn:one", "urn:two"]);
        const alias = trace(context(scenario(explicit("b:Axis", "z:Member"), 'xmlns:b="urn:axes" xmlns:z="urn:members"')));
        expect(alias.status).toBe("resolved");
    });
    it("未prefixのQName値へdefault namespaceを適用、属性名のnamespaceとは混同しない", () => {
        const entry = first(context(scenario(explicit("Axis", "Member", 'xmlns="urn:default"'))));
        expect(entry).toMatchObject({ axis: { namespaceURI: "urn:default", prefix: "" }, member: { namespaceURI: "urn:default", prefix: "" } });
        const noDefault = first(context(scenario(explicit("Axis", "Member"))));
        expect(noDefault).toMatchObject({ axis: { namespaceURI: "" }, member: { namespaceURI: "" } });
    });
    it("default namespaceの解除を親のbindingへ戻さない", () => {
        const entry = first(context(scenario(explicit("Axis", "Member", 'xmlns=""'), 'xmlns="urn:parent"')));
        expect(entry).toMatchObject({ axis: { namespaceURI: "", binding: { parsedUri: "" } }, member: { namespaceURI: "" } });
    });
    it("xml組込prefixとUnicode NCNameを扱う", () => {
        expect(first(context(scenario(explicit("a:会社", "xml:lang"))))).toMatchObject({ axis: { localName: "会社", namespaceURI: "urn:axes" }, member: { namespaceURI: "http://www.w3.org/XML/1998/namespace" } });
    });
    it("QName前後のXML空白だけ正規化し、元のparser文字列も残す", () => {
        const entry = first(context(scenario(explicit(" a:Axis ", "m:Member"))));
        expect(entry).toMatchObject({ axis: { normalized: "a:Axis", namespaceURI: "urn:axes" } });
    });
    it.each(["a:", ":Axis", "a:b:c", "1Axis", "a:1Axis", "a:A B", "a:A\u00a0xis"])("不正QName %sを捨てず記録", axis => {
        const result = trace(context(scenario(explicit(axis)))); expect(result.status).toBe("unsupported");
        expect(result.candidates[0].dimensions[0]).toMatchObject({ kind: "explicit", axis: { raw: axis, status: "unresolved", reason: "invalid-qname" } });
    });
    it("未宣言axis/member prefixを文脈文字列から補完しない", () => {
        const result = trace(context(scenario(explicit("missing:Axis", "missing:Member")))); expect(result.status).toBe("unsupported");
        expect(result.candidates[0].dimensions[0]).toMatchObject({ axis: { reason: "undeclared-prefix" }, member: { reason: "undeclared-prefix" } });
    });
    it("prefixを空に再束縛した場合も親のURIを流用しない", () => {
        expect(first(context(scenario(explicit("a:Axis", "m:Member", 'xmlns:a=""'))))).toMatchObject({ axis: { status: "unresolved", reason: "undeclared-prefix" } });
    });
    it("不正なreserved bindingは既定へ補完しない", () => {
        const result = trace(context(scenario(explicit("xml:Axis", "m:Member", 'xmlns:xml="urn:wrong"'))));
        expect(result.status).toBe("unsupported"); expect(result.candidates[0].dimensions[0]).toMatchObject({ axis: { reason: "unsupported-namespace-binding" } });
    });
    it("parserが復元できないQName数値参照はdecode推測しない", () => {
        const result = trace(context(scenario(explicit("a:Ax&#105;s", "m:Member"))));
        expect(result.status).toBe("unsupported"); expect(result.candidates[0].dimensions[0]).toMatchObject({ axis: { raw: "a:Ax&#105;s", reason: "unsupported-qname-serialization" } });
        const cdata = trace(context(scenario('<xbrldi:explicitMember dimension="a:Axis"><![CDATA[m:Mem&#98;er]]></xbrldi:explicitMember>')));
        expect(cdata.status).toBe("unsupported");
    });
    it("既存parserがtrimしたNBSPは復元不能で、元QNameの字面は検証したと主張しない", () => {
        const result = trace(context(scenario(explicit("a:Axis\u00a0", "m:Member"))));
        expect(result).toMatchObject({ status: "resolved", originalLexicalValidation: "not-performed", dtsValidation: "not-performed" });
        expect(result.candidates[0].dimensions[0]).toMatchObject({ axis: { raw: "a:Axis", normalized: "a:Axis" } });
    });
    it("復元できないURIの数値参照様文字列をnamespaceと断定しない", () => {
        const result = trace(context(scenario(explicit(), 'xmlns:a="urn:ax&#105;s" xmlns:m="urn:members"')));
        expect(result.status).toBe("unsupported"); expect(result.candidates[0].dimensions[0]).toMatchObject({ axis: { reason: "unsupported-namespace-binding", binding: { parsedUri: "urn:ax&#105;s" } } });
    });
});

describe("explicit/typed/unknownと重複", () => {
    it("typedのaxis/内容要素を局所scopeで解決し、値は不解釈", () => {
        const member = '<xbrldi:typedMember dimension="a:Axis"><v:Value xmlns:v="urn:typed"><v:Child xmlns:v="urn:child">m:QNameOrText</v:Child></v:Value></xbrldi:typedMember>';
        const result = trace(context(scenario(member))), entry = result.candidates[0].dimensions[0];
        expect(result.status).toBe("unsupported");
        expect(entry).toMatchObject({ kind: "typed", axis: { namespaceURI: "urn:axes" }, typedElements: [{ name: { namespaceURI: "urn:typed", localName: "Value" }, children: [{ name: { namespaceURI: "urn:child", localName: "Child" } }] }], diagnostics: [{ code: "typed-uninterpreted" }] });
        if (entry.kind === "typed") expect(JSON.stringify(entry.parsedContent)).toContain("m:QNameOrText");
        expect(entry).not.toHaveProperty("member");
    });
    it("typed内のcontextや本文は提出contextとして収集しない", () => {
        const nested = context(scenario(), "nested");
        const obj = object(context(scenario(`<xbrldi:typedMember dimension="a:Axis"><extension:Typed>${nested}</extension:Typed></xbrldi:typedMember>`)), `<extension:Fact contextRef="c">${context(scenario(), "in-fact")}</extension:Fact>`);
        expect(obj.traceContextDimensions("nested").status).toBe("missing"); expect(obj.traceContextDimensions("in-fact").status).toBe("missing");
        expect(obj.traceContextDimensions("c").candidates).toHaveLength(1);
    });
    it("unknown要素・偽xbrldi・余分な子要素・非要素内容を残す", () => {
        const unknown = trace(context(scenario('<extension:Other><extension:Child>keep</extension:Child></extension:Other>')));
        expect(unknown.status).toBe("unsupported"); expect(unknown.candidates[0].dimensions[0]).toMatchObject({ kind: "unknown", parsedContent: { "extension:Child": "keep" } });
        const spoof = trace(context(scenario(explicit("a:Axis", "m:Member", 'xmlns:xbrldi="urn:fake"'))));
        expect(spoof.candidates[0].dimensions[0].kind).toBe("unknown");
        const extra = trace(context(scenario('<xbrldi:explicitMember dimension="a:Axis"><extension:Child>m:Member</extension:Child></xbrldi:explicitMember>')));
        expect(extra.status).toBe("unsupported"); expect(JSON.stringify(extra)).toContain("extension:Child");
        expect(trace(context(scenario('not-an-element'))).status).toBe("unsupported");
    });
    it("偽namespaceのcontainerや未知context子を無次元として成功させない", () => {
        const fake = trace(context('<xbrli:scenario xmlns:xbrli="urn:fake">' + explicit() + '</xbrli:scenario>'));
        expect(fake.status).toBe("unsupported"); expect(fake.candidates[0].diagnostics).toContainEqual(expect.objectContaining({ code: "unknown-dimension-content", parsedContent: expect.anything() }));
        const unknown = trace(context('<extension:Other>keep</extension:Other>'));
        expect(unknown.status).toBe("unsupported"); expect(JSON.stringify(unknown)).toContain("keep");
        const repeated = trace(context(scenario() + '<xbrli:scenario/>'));
        expect(repeated.candidates[0].diagnostics).toContainEqual({ code: "invalid-dimension-shape" });
    });
    it.each(['<xbrldi:explicitMember>m:Member</xbrldi:explicitMember>', '<xbrldi:explicitMember dimension="a:Axis"/>', '<xbrldi:typedMember dimension="a:Axis"/>', '<xbrldi:typedMember dimension="a:Axis"><extension:A/><extension:B/></xbrldi:typedMember>'])("不完全なdimensionを欠落扱いにしない: %s", member => {
        const result = trace(context(scenario(member))); expect(result.status).toBe("unsupported"); expect(result.candidates[0].dimensions).toHaveLength(1);
    });
    it("同じexpanded axisをaliasやlocationを跨いでも検出", () => {
        const segment = `<xbrli:segment xmlns:b="urn:axes" xmlns:m="urn:members">${explicit("b:Axis", "m:Other")}</xbrli:segment>`;
        const result = trace(context(scenario(), "c", "", segment));
        expect(result.status).toBe("unsupported"); expect(result.candidates[0].dimensions).toHaveLength(2);
        expect(result.candidates[0].diagnostics).toContainEqual({ code: "duplicate-axis", dimensionIndex: 1 });
    });
    it("同値duplicate contextも上書きせずambiguous", () => {
        const result = trace(context(scenario()) + context(scenario()));
        expect(result).toMatchObject({ status: "ambiguous", diagnostics: [{ code: "duplicate-context" }] }); expect(result.candidates).toHaveLength(2);
    });
    it("namespaceは解決できても未知のURI/axisのDTS所属は断定しない", () => {
        const result = trace(context(scenario(explicit("a:Anything", "m:Anything"))));
        expect(result.status).toBe("resolved"); expect(result.dtsValidation).toBe("not-performed");
    });
});

describe("既存APIとの分離", () => {
    it("構造要素のalias/default namespaceもtraceだけに反映", () => {
        for (const root of [
            `<i:xbrl xmlns:i="${XI}" xmlns:d="${XD}" xmlns:a="urn:axes" xmlns:m="urn:members"><i:context id="c"><i:scenario><d:explicitMember dimension="a:Axis">m:Member</d:explicitMember></i:scenario></i:context></i:xbrl>`,
            `<xbrl xmlns="${XI}" xmlns:d="${XD}" xmlns:a="urn:axes" xmlns:m="urn:members"><context id="c"><scenario><d:explicitMember dimension="a:Axis">m:Member</d:explicitMember></scenario></context></xbrl>`
        ]) {
            const obj = new EdinetXbrlParser().parse(root);
            expect(obj.traceContextDimensions("c").status).toBe("resolved");
            expect(obj.findContexts({ type: "Instant", scope: "Consolidated" })).toEqual([]);
        }
    });
    it("default memberを追加せず、次元無しは空配列", () => {
        expect(trace(context())).toMatchObject({ status: "resolved", candidates: [{ dimensions: [] }] });
    });
    it("手組みobjectのrawDimensionsからtraceを補完しない", () => {
        const obj = new EdinetXbrlObject("old");
        obj.addContext({ id: "c", scope: "Consolidated", period: { instant: "2025-03-31" }, dimensions: ["Member"], rawDimensions: { scenario: { "xbrldi:explicitMember": { "@_dimension": "a:Axis", "#text": "m:Member" } } } });
        expect(obj.traceContextDimensions("c")).toMatchObject({ status: "missing", candidates: [], diagnostics: [{ code: "trace-unavailable" }] });
    });
    it("旧constructor呼出しとJSONObject形を維持しprivate mapを列挙しない", () => {
        const old = new EdinetXbrlObject("same"), supplied = new EdinetXbrlObject("same", new Map());
        expect(JSON.stringify(old)).toBe(JSON.stringify(supplied)); expect(Object.keys(old)).toEqual(["_dataMap", "contextMap", "duplicateContextIds", "unitMap", "_docID"]);
        expect(new EdinetXbrlObject().getCommonMetadata().docID).toBe("");
    });
    it("constructorの初期mapと返却値をdeepcopy", () => {
        const candidate = structuredClone(trace().candidates[0]), initial: ContextDimensionTraceMap = new Map([["c", [candidate]]]);
        const obj = new EdinetXbrlObject("old", initial);
        (candidate.dimensions[0].parsedContent as any)["@_dimension"] = "changed"; (initial as Map<string, unknown>).clear();
        const first = obj.traceContextDimensions("c"); expect(JSON.stringify(first)).not.toContain("changed");
        (first.candidates as any[]).push(candidate); (first.candidates[0].dimensions[0].parsedContent as any)["#text"] = "mutated";
        expect(obj.traceContextDimensions("c").candidates).toHaveLength(1); expect(JSON.stringify(obj.traceContextDimensions("c"))).not.toContain("mutated");
    });
    it("後から旧addContextで同IDを追加した場合もtraceを確定しない", () => {
        const obj = object();
        obj.addContext({ id: "c", scope: "Consolidated", period: { instant: "2025-03-31" }, dimensions: [] });
        expect(obj.traceContextDimensions("c")).toMatchObject({ status: "ambiguous", diagnostics: [{ code: "duplicate-context" }] });
    });
    it("clearは新mapも消し、未知/不正IDを明示する", () => {
        const obj = object(); expect(obj.traceContextDimensions("missing").status).toBe("missing");
        for (const id of ["", " ", null, 1]) expect(() => obj.traceContextDimensions(id as any)).toThrow();
        obj.clear(); expect(obj.traceContextDimensions("c").status).toBe("missing");
    });
    it("ContextParserの既存JSON形・unsupportedと金融採用を変更しない", () => {
        const raw = { "@_id": "c", "xbrli:period": { "xbrli:instant": "2025-03-31" }, "xbrli:scenario": { "xbrldi:explicitMember": { "@_dimension": "a:Axis", "#text": "m:Member" } } };
        const original = ContextParser.parse(raw, { xbrli: XI, xbrldi: XD, a: "urn:axes", m: "urn:members" });
        const before = JSON.stringify(original), obj = object(context(scenario()), fact("100", "", "jppfs_cor:CurrentAssets", "c"));
        expect(obj.selectBalanceSheetMetric("currentAssets", { scope: "Consolidated", accountingStandard: "J-GAAP", period: { instant: "2025-03-31" } })).toMatchObject({ status: "unsupported", reason: "unsupported-context" });
        expect(obj.traceContextDimensions("c").status).toBe("resolved");
        expect(JSON.stringify(ContextParser.parse(raw, { xbrli: XI, xbrldi: XD, a: "urn:axes", m: "urn:members" }))).toBe(before);
        expect(original?.unsupportedDimensions).toBe(true);
        expect(obj.findContexts({ type: "Instant", scope: "Consolidated" })).toEqual([]);
        const noExtra = object(context(scenario(standalone, "")), fact("100", "", "jppfs_cor:CurrentAssets", "c"));
        expect(noExtra.selectBalanceSheetMetric("currentAssets", { scope: "NonConsolidated", accountingStandard: "J-GAAP", period: { instant: "2025-03-31" } }).status).toBe("selected");
    });
});
