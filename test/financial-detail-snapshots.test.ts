import { describe, it, expect } from "vitest";
import { normalizeFinancialDetailSnapshot, screenFinancialDetailSnapshots, createFinancialDetailSnapshot,
    screenFinancialDetailDocuments, FINANCIAL_DETAIL_REGISTRY, DEFAULT_FINANCIAL_DETAIL_METRICS,
    type FinancialDetailMetricId, type FinancialDetailMetadata, type FinancialDetailScreeningOptions } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const ids = Object.keys(FINANCIAL_DETAIL_REGISTRY) as FinancialDetailMetricId[];
const json = (value: unknown) => JSON.parse(JSON.stringify(value));
const meta = (kind: "instant" | "duration" = "instant", code = "1001", scope: "Consolidated" | "NonConsolidated" = "Consolidated"): FinancialDetailMetadata => ({ secCode: code, docID: `SYNTHETIC${code}`, scope, accountingStandard: "J-GAAP", currency: "JPY",
    ...(kind === "instant" ? { period: { instant: "2025-03-31" } } : { period: { startDate: "2024-04-01", endDate: "2025-03-31" }, periodType: "annual" }) });
function xml(value = "120", options: { scope?: "Consolidated" | "NonConsolidated"; absent?: FinancialDetailMetricId[]; nil?: FinancialDetailMetricId; extra?: string; unit?: string; namespace?: string; malformed?: string } = {}) {
    const c = (id: string, dates: string) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period>${dates}</xbrli:period>${options.scope === "NonConsolidated" ? `<xbrli:scenario>${standalone}</xbrli:scenario>` : ""}</xbrli:context>`;
    const contexts = c("instant", '<xbrli:instant>2025-03-31</xbrli:instant>') + c("duration", '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>');
    const facts = ids.filter(id => !options.absent?.includes(id)).map(id => fact(id === options.nil ? "" : value, id === options.nil ? 'xsi:nil="true"' : "", FINANCIAL_DETAIL_REGISTRY[id].candidates[0].key, FINANCIAL_DETAIL_REGISTRY[id].periodType)).join("");
    let input = instance(facts + (options.extra ?? ""), contexts, `<xbrli:unit id="money"><xbrli:measure>${options.unit ?? "iso4217:JPY"}</xbrli:measure></xbrli:unit>`);
    if (options.namespace) input = input.replace('http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor', options.namespace);
    return options.malformed ? options.malformed : input;
}
const snapshot = (value = "120", metadata = meta(), metricIds?: readonly FinancialDetailMetricId[], options: Parameters<typeof xml>[1] = {}) => createFinancialDetailSnapshot(xml(value, options), metadata, metricIds);

describe("保存財務snapshotの正当なXML出力JSONを受理", () => {
    it.each(ids)("全15科目の%sをJSON往復し、出典とrawを保持", id => {
        const row = snapshot("120.00", meta(FINANCIAL_DETAIL_REGISTRY[id].periodType), [id]);
        expect(json(normalizeFinancialDetailSnapshot(json(row)))).toEqual(json(row));
        expect(json(normalizeFinancialDetailSnapshot(row))).toEqual(json(row));
    });
    it.each(["Consolidated", "NonConsolidated"] as const)("%sのinstant/durationを保持", scope => {
        for (const kind of ["instant", "duration"] as const) {
            const row = snapshot("120", meta(kind, "1001", scope), undefined, { scope });
            expect(json(normalizeFinancialDetailSnapshot(json(row)))).toEqual(json(row));
        }
    });
    it.each(["0", "-10", "-0", "+0.000", "0.3", "9007199254740993"])("raw%sとsafeNumber境界を維持", value => {
        const row = snapshot(value), parsed = json(row), got = normalizeFinancialDetailSnapshot(parsed);
        expect(got.selections.cashAndDeposits!.raw).toBe(value);
        expect(got.selections.cashAndDeposits!.safeNumber).toBe(value === "9007199254740993" ? undefined : Number(value));
        expect(Object.is(got.selections.cashAndDeposits!.safeNumber, -0)).toBe(value === "-0");
        expect(json(parsed)).toEqual(json(row));
    });
    it.each(["IFRS", "US-GAAP"] as const)("%sの非対応状態は証跡なしのまま受理", standard => {
        const row = snapshot("120", { ...meta(), accountingStandard: standard });
        expect(normalizeFinancialDetailSnapshot(json(row)).selections.cashAndDeposits).toMatchObject({ status: "unsupported", reason: "unsupported-standard", evidence: [] });
    });
    it.each(["nil", "absent", "unit", "unknown-namespace", "multiple-facts", "duplicate-context", "unknown-context", "dimensions", "invalid-decimal", "invalid-decimals", "unknown-entity", "invalid-context"])("%sの正当な非採用出力を受理", kind => {
        let input = xml();
        if (kind === "nil") input = xml("120", { nil: "cashAndDeposits" });
        if (kind === "absent") input = xml("120", { absent: ["cashAndDeposits"] });
        if (kind === "unit") input = xml("120", { unit: "iso4217:USD" });
        if (kind === "unknown-namespace") input = xml("120", { namespace: "https://example.test/not-official" });
        if (kind === "multiple-facts") input = xml("120", { extra: fact("120", "", "jppfs_cor:CashAndDeposits", "instant") });
        if (kind === "duplicate-context") input = input.replace('<xbrli:context id="instant">', '<xbrli:context id="instant"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context><xbrli:context id="instant">');
        if (kind === "unknown-context") input = input.replaceAll('contextRef="instant"', 'contextRef="missing"');
        if (kind === "dimensions") input = input.replace('<xbrli:instant>2025-03-31</xbrli:instant></xbrli:period>', '<xbrli:instant>2025-03-31</xbrli:instant></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="extension:RegionAxis">extension:RegionMember</xbrldi:explicitMember></xbrli:scenario>');
        if (kind === "invalid-decimal") input = xml("not-a-number");
        if (kind === "invalid-decimals") input = input.replaceAll('decimals="INF"', 'decimals="bad"');
        if (kind === "unknown-entity") input = input.replaceAll('scheme="synthetic"', 'other="missing-scheme"');
        if (kind === "invalid-context") input = input.replaceAll('<xbrli:period>', '<xbrli:period><unexpected/>');
        const row = createFinancialDetailSnapshot(input, meta());
        expect(json(normalizeFinancialDetailSnapshot(json(row)))).toEqual(json(row));
    });
    it("未知context/単位不明と採用値が併存する正当出力を受理", () => {
        for (const variant of ["unknown-context", "unknown-unit"]) {
            let input = xml();
            if (variant === "unknown-context") input = input.replace('<jppfs_cor:CashAndDeposits contextRef="instant"', '<jppfs_cor:CashAndDeposits contextRef="missing"');
            else input = input.replace('<jppfs_cor:CashAndDeposits contextRef="instant" unitRef="money"', '<jppfs_cor:CashAndDeposits contextRef="instant" unitRef="missing-unit"');
            const row = createFinancialDetailSnapshot(input, meta());
            expect(row.selections.noncurrentAssets!.status).toBe("selected");
            expect(row.selections.cashAndDeposits!.status).toBe("unsupported");
            expect(json(normalizeFinancialDetailSnapshot(json(row)))).toEqual(json(row));
        }
    });
    it.each(["empty-subset", "mixed-subset", "extra-root", "extra-metadata"])("snapshot%sを推定せず拒否", kind => {
        const row: any = json(snapshot());
        if (kind === "empty-subset") row.selections = {};
        if (kind === "mixed-subset") row.selections.costOfSales = json(snapshot("120", meta("duration"))).selections.costOfSales;
        if (kind === "extra-root") row.version = "inferred";
        if (kind === "extra-metadata") row.metadata.market = "prime";
        expect(() => normalizeFinancialDetailSnapshot(row)).toThrow();
    });
    it("empty scenarioの正当な連結出力、別期間context-mismatchも受理", () => {
        const input = xml().replaceAll('</xbrli:period>', '</xbrli:period><xbrli:scenario/>');
        const row = createFinancialDetailSnapshot(input, meta());
        expect(row.selections.cashAndDeposits!.status).toBe("selected");
        expect(json(normalizeFinancialDetailSnapshot(json(row)))).toEqual(json(row));
        const prior = createFinancialDetailSnapshot(xml(), { ...meta(), period: { instant: "2024-03-31" } });
        expect(json(normalizeFinancialDetailSnapshot(json(prior)))).toEqual(json(prior));
    });
    it("返値と入力は別物、getterを評価せず、null prototypeとfreezeを保持して読める", () => {
        const row = snapshot(), original = json(row), got = normalizeFinancialDetailSnapshot(row);
        got.selections.cashAndDeposits!.evidence[0].raw = "changed";
        expect(json(row)).toEqual(original);
        let calls = 0; const evil: any = { ...row };
        Object.defineProperty(evil, "selections", { get() { calls++; return row.selections; }, enumerable: true });
        expect(() => normalizeFinancialDetailSnapshot(evil)).toThrow(); expect(calls).toBe(0);
        const nullPrototype = Object.assign(Object.create(null), json(row));
        expect(json(normalizeFinancialDetailSnapshot(Object.freeze(nullPrototype)))).toEqual(original);
    });
});

describe("保存された採用札/証跡の偽装を拒否", () => {
    const cases = ["raw", "safe-value", "safe-null", "safe-missing", "safe-negative-zero", "reason", "metricId", "key", "namespace", "uri", "unit", "unitRef", "contextRef", "period", "scope", "entity", "nil", "decimals", "source-missing", "evidence-missing", "duplicate", "conflicting-candidate", "raw-dimensions", "dimensions", "unknown-field", "hidden-field", "symbol", "cycle", "bigint", "nan", "array-hole", "array-extra", "proxy"];
    it.each(cases)("%sを条件で隠さず拒否", kind => {
        const row: any = json(snapshot()), selected = row.selections.cashAndDeposits;
        if (kind === "raw") selected.raw = "121";
        if (kind === "safe-value") selected.safeNumber = 121;
        if (kind === "safe-null") selected.safeNumber = null;
        if (kind === "safe-missing") delete selected.safeNumber;
        if (kind === "safe-negative-zero") { selected.raw = "0"; selected.safeNumber = -0; selected.source.raw = "0"; selected.evidence[0].raw = "0"; }
        if (kind === "reason") selected.reason = "selected-raw-only";
        if (kind === "metricId") selected.metricId = "noncurrentAssets";
        if (kind === "key") selected.source.key = "jppfs_cor:Assets";
        if (kind === "namespace") selected.source.namespace = "extension";
        if (kind === "uri") selected.source.namespaceURI = "https://example.test/fake";
        if (kind === "unit") selected.source.unit = "iso4217:USD";
        if (kind === "unitRef") selected.source.unitRef = "";
        if (kind === "contextRef") selected.source.contextRef = "different";
        if (kind === "period") selected.source.period.instant = "2024-03-31";
        if (kind === "scope") selected.source.scope = "NonConsolidated";
        if (kind === "entity") selected.source.entity.identifier = "OTHER";
        if (kind === "nil") selected.source.nil = true;
        if (kind === "decimals") selected.source.decimals = "bad";
        if (kind === "source-missing") delete selected.source;
        if (kind === "evidence-missing") selected.evidence = [];
        if (kind === "duplicate") selected.evidence.push(structuredClone(selected.evidence[0]));
        if (kind === "conflicting-candidate") { const other = structuredClone(selected.evidence[0]); other.raw = "121"; selected.evidence.push(other); }
        if (kind === "raw-dimensions") selected.source.rawDimensions = { scenario: { "xbrldi:explicitMember": { "@_dimension": "extension:RegionAxis", "#text": "extension:RegionMember" } } };
        if (kind === "dimensions") selected.source.dimensions = ["RegionMember"];
        if (kind === "unknown-field") selected.extra = 1;
        if (kind === "hidden-field") Object.defineProperty(selected, "hidden", { value: 1 });
        if (kind === "symbol") selected[Symbol("hidden")] = 1;
        if (kind === "cycle") selected.loop = selected;
        if (kind === "bigint") selected.safeNumber = 120n;
        if (kind === "nan") selected.safeNumber = NaN;
        if (kind === "array-hole") selected.evidence = Array(1);
        if (kind === "array-extra") selected.evidence.extra = 1;
        if (kind === "proxy") row.selections = new Proxy(row.selections, {});
        expect(() => normalizeFinancialDetailSnapshot(row)).toThrow();
        expect(() => screenFinancialDetailSnapshots([row], { metricIds: ["noncurrentAssets"], conditions: [{ metric: "noncurrentAssets", operator: "gt", value: 999999 }] })).toThrow();
    });
    it.each(["function", "date", "infinity", "toJSON"])("非JSONの%sを評価/変換せず拒否", kind => {
        const row: any = snapshot();
        if (kind === "function") row.selections.cashAndDeposits.extra = () => 1;
        if (kind === "date") row.metadata.period.instant = new Date("2025-03-31");
        if (kind === "infinity") row.selections.cashAndDeposits.safeNumber = Infinity;
        let called = false;
        if (kind === "toJSON") row.toJSON = () => { called = true; return {}; };
        expect(() => normalizeFinancialDetailSnapshot(row)).toThrow(); expect(called).toBe(false);
    });
    it.each(["raw", "safeNumber", "source"])("非採用へ%sを偽追加しない", field => {
        const row: any = json(snapshot("120", meta(), undefined, { nil: "cashAndDeposits" }));
        row.selections.cashAndDeposits[field] = field === "raw" ? "0" : field === "safeNumber" ? 0 : {};
        expect(() => normalizeFinancialDetailSnapshot(row)).toThrow();
    });
    it.each(["nil", "tag-absent", "multiple-facts", "context-mismatch", "unsupported-unit"])("偽の非採用理由%sを拒否", reason => {
        const row: any = json(snapshot("120", meta(), undefined, { absent: ["cashAndDeposits"] }));
        row.selections.cashAndDeposits.reason = reason; row.selections.cashAndDeposits.status = reason === "multiple-facts" ? "ambiguous" : reason === "unsupported-unit" ? "unsupported" : "missing";
        if (reason === "tag-absent") row.selections.cashAndDeposits.evidence = [json(snapshot()).selections.cashAndDeposits.evidence[0]];
        expect(() => normalizeFinancialDetailSnapshot(row)).toThrow();
    });
    it("原値不在は整合する場合だけ受理し、safeNumberで補わない", () => {
        const row: any = json(snapshot()); const value = row.selections.cashAndDeposits;
        value.status = "unsupported"; value.reason = "raw-unavailable"; delete value.raw; delete value.safeNumber; delete value.source;
        delete value.evidence[0].raw; value.evidence[0].reason = "raw-unavailable";
        expect(normalizeFinancialDetailSnapshot(row).selections.cashAndDeposits!.status).toBe("unsupported");
        value.evidence[0].raw = "120"; expect(() => normalizeFinancialDetailSnapshot(row)).toThrow();
    });
    it("同contextRefの別entity/期間、同unitRefの別単位を混ぜない", () => {
        for (const field of ["entity", "period", "unit"] as const) {
            const row: any = json(snapshot()); const target = row.selections.cashAndDeposits;
            if (field === "entity") for (const item of [target.source, ...target.evidence]) item.entity.identifier = "B";
            if (field === "period") for (const item of [target.source, ...target.evidence]) item.period.instant = "2024-03-31";
            if (field === "unit") { target.status = "unsupported"; target.reason = "unsupported-unit"; delete target.raw; delete target.safeNumber; delete target.source; target.evidence[0].unit = "iso4217:USD"; target.evidence[0].reason = "unsupported-unit"; }
            expect(() => normalizeFinancialDetailSnapshot(row)).toThrow();
        }
    });
});

describe("保存JSON検索と既存XML検索の結果同等性", () => {
    const operators = ["gte", "lte", "gt", "lt", "eq"] as const;
    it.each(ids.flatMap(id => operators.map(operator => ({ id, operator }))))("$id $operatorの閾値を一致", ({ id, operator }) => {
        const kind = FINANCIAL_DETAIL_REGISTRY[id].periodType;
        const documents = ["50", "100", "200"].map((value, index) => ({ xml: xml(value), metadata: meta(kind, `100${index + 1}`) }));
        const options: FinancialDetailScreeningOptions = { metricIds: [id], conditions: [{ metric: id, operator, value: 100 }] };
        const saved = documents.map(document => json(createFinancialDetailSnapshot(document.xml, document.metadata, [id])));
        expect(json(screenFinancialDetailSnapshots(saved, options))).toEqual(json(screenFinancialDetailDocuments(documents, options)));
    });
    it.each(ids.flatMap(id => ["asc", "desc"].map(order => ({ id, order: order as "asc" | "desc" }))))("$id $orderの順序/ページ/件数を一致", ({ id, order }) => {
        const kind = FINANCIAL_DETAIL_REGISTRY[id].periodType;
        const documents = ["100", "100", "200"].map((value, index) => ({ xml: xml(value), metadata: meta(kind, `100${index + 1}`) }));
        const options: FinancialDetailScreeningOptions = { metricIds: [id], sortBy: id, order, offset: 1, limit: 1 };
        const saved = documents.map(document => json(createFinancialDetailSnapshot(document.xml, document.metadata, [id])));
        expect(json(screenFinancialDetailSnapshots(saved, options))).toEqual(json(screenFinancialDetailDocuments(documents, options)));
    });
    it("default5、未使用欠損、unsafe、0、負数、空ページを一致", () => {
        for (const kind of ["instant", "duration"] as const) {
            const documents = [
                { xml: xml("0", { absent: [kind === "instant" ? "noncurrentLiabilities" : "costOfSales"] }), metadata: meta(kind, "1001") },
                { xml: xml("-10"), metadata: meta(kind, "1002") },
                { xml: xml("9007199254740993"), metadata: meta(kind, "1003") },
                { xml: xml("120", { nil: kind === "instant" ? "cashAndDeposits" : "sellingGeneralAndAdministrativeExpenses" }), metadata: meta(kind, "1004") }
            ];
            const saved = documents.map(document => json(createFinancialDetailSnapshot(document.xml, document.metadata)));
            for (const options of [{}, { sortBy: kind === "instant" ? "cashAndDeposits" : "sellingGeneralAndAdministrativeExpenses" }, { limit: 0 }, { offset: 100 }]) {
                expect(json(screenFinancialDetailSnapshots(saved, options as FinancialDetailScreeningOptions))).toEqual(json(screenFinancialDetailDocuments(documents, options as FinancialDetailScreeningOptions)));
            }
        }
    });
    it("CF3/借入7の明示subset、返却projectionと未保存の設定エラーを維持", () => {
        for (const kind of ["instant", "duration"] as const) {
            const wanted = ids.filter(id => FINANCIAL_DETAIL_REGISTRY[id].periodType === kind), row = snapshot("120", meta(kind), wanted);
            const projected = [wanted.at(-1)!], options = { metricIds: projected, sortBy: projected[0] };
            expect(Object.keys(screenFinancialDetailSnapshots([json(row)], options).rows[0].selections)).toEqual(projected);
            const partial = snapshot("120", meta(kind), projected);
            expect(() => screenFinancialDetailSnapshots([json(partial)])).toThrow(/保存されていません/);
            expect(screenFinancialDetailSnapshots([json(partial)], options).total).toBe(1);
        }
    });
    it.each(["scope", "period", "standard", "currency", "company", "document", "periodType"])("%s混在/重複をフィルタ前に拒否", field => {
        const first = snapshot("120", meta("duration", "1001")), second: any = json(snapshot("120", meta("duration", "1002")));
        if (field === "scope") second.metadata.scope = "NonConsolidated";
        if (field === "period") second.metadata.period.startDate = "2024-05-01";
        if (field === "standard") second.metadata.accountingStandard = "IFRS";
        if (field === "currency") second.metadata.currency = "USD";
        if (field === "company") second.metadata.secCode = "10010";
        if (field === "document") second.metadata.docID = first.metadata.docID;
        if (field === "periodType") second.metadata.periodType = "ytd";
        expect(() => screenFinancialDetailSnapshots([first, second], { conditions: [{ metric: "costOfSales", operator: "gt", value: 999 }] })).toThrow();
    });
    it.each(["null", "unknown", "metricIds-empty", "metricIds-mixed", "condition", "nan", "infinity", "negative-page", "fraction-page", "extra-condition", "array-hole"])("options%sを拒否、空入力はXMLと同等", kind => {
        let options: any = {};
        if (kind === "null") options = null;
        if (kind === "unknown") options.extra = 1;
        if (kind === "metricIds-empty") options.metricIds = [];
        if (kind === "metricIds-mixed") options.metricIds = ["cashAndDeposits", "costOfSales"];
        if (kind === "condition") options.conditions = [{ metric: "unknown", operator: "gte", value: 0 }];
        if (kind === "nan") options.conditions = [{ metric: "cashAndDeposits", operator: "gte", value: NaN }];
        if (kind === "infinity") options.conditions = [{ metric: "cashAndDeposits", operator: "gte", value: Infinity }];
        if (kind === "negative-page") options.offset = -1;
        if (kind === "fraction-page") options.limit = 0.5;
        if (kind === "extra-condition") options.conditions = [{ metric: "cashAndDeposits", operator: "gte", value: 0, extra: 1 }];
        if (kind === "array-hole") options.conditions = Array(1);
        expect(() => screenFinancialDetailSnapshots([], options)).toThrow();
        expect(screenFinancialDetailSnapshots([])).toEqual(screenFinancialDetailDocuments([]));
    });
});
