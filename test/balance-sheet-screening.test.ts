import { describe, expect, it } from "vitest";
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { EdinetXbrlParser } from "../src/edinet-xbrl-parser";
import { BALANCE_SHEET_REGISTRY } from "../src/balance-sheet-registry";
import { createBalanceSheetSnapshot, screenBalanceSheetSnapshots, BalanceSheetSnapshot, BalanceSheetSnapshotMetadata } from "../src/balance-sheet-screening";
import { fact, instance, standalone } from "./fixtures/metric-boundaries";
const instant = "2025-03-31";
const meta: BalanceSheetSnapshotMetadata = { secCode: "1001", docID: "SYNTHETIC1", instant, scope: "Consolidated", accountingStandard: "J-GAAP", currency: "JPY" };
const context = (entity = "A", members = "") => `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${entity}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period>${members ? `<xbrli:scenario>${members}</xbrli:scenario>` : ""}</xbrli:context>`;
const keys = Object.values(BALANCE_SHEET_REGISTRY).map(d => d.candidates[0].key);
const xml = (values = ["120", "40", "80"], entity = "A", members = "", units?: string) => instance(values.map((v, i) => v === "absent" ? "" : v === "nil" ? fact("", 'xsi:nil="true"', keys[i]) : fact(v, "", keys[i])).join(""), context(entity, members), units);
const snapshot = (secCode = "1001", values?: string[], entity = secCode) => createBalanceSheetSnapshot(xml(values, entity), { ...meta, secCode, docID: `DOC${secCode}` });
const query = { conditions: [{ metric: "currentAssets" as const, operator: "gte" as const, value: 0 }] };
const run = (input: BalanceSheetSnapshot[], opts: any = {}) => screenBalanceSheetSnapshots(input, opts);
const clone = <T>(x: T): T => structuredClone(x);

describe("BS3科目の別横断検索", () => {
    it("XML/object双方からstrict選択したsnapshotを作る", () => {
        const a = createBalanceSheetSnapshot(xml(), meta);
        const b = createBalanceSheetSnapshot(new EdinetXbrlParser().parse(xml(), meta.docID), meta);
        expect(a).toEqual(b);
        expect(a.secCode).toBe("10010");
        expect(a.selections.currentAssets).toMatchObject({ status: "selected", raw: "120", safeNumber: 120 });
        expect(() => createBalanceSheetSnapshot(new EdinetXbrlParser().parse(xml(), "OTHER"), meta)).toThrow(/docID/);
    });
    it("別企業のentityを許容しAND条件と順序/totalを返す", () => {
        const rows = [snapshot("1002", ["130", "20", "90"], "B"), snapshot("1001", undefined, "A"), snapshot("1003", ["50", "10", "20"], "C")];
        const result = run(rows, { conditions: [{ metric: "currentAssets", operator: "gte", value: 100 }, { metric: "currentLiabilities", operator: "lt", value: 30 }], sortBy: "totalLiabilities" });
        expect(result.rows.map(r => r.secCode)).toEqual(["10020"]);
        expect(result).toMatchObject({ total: 1, excludedRows: 0, filteredRows: 2 });
        expect(rows[0].secCode).toBe("10020");
    });
    it.each([ ["gte", 120, 1], ["lte", 120, 1], ["gt", 120, 0], ["lt", 120, 0], ["eq", 120, 1], ["gt", -1, 1] ])("operator %s", (operator, value, count) => {
        expect(run([snapshot()], { conditions: [{ metric: "currentAssets", operator, value }] }).total).toBe(count);
    });
    it("0・負数・小数の条件を保持する", () => {
        expect(run([snapshot("1001", ["0", "-1", "0.0000001"])], { conditions: [{ metric: "currentAssets", operator: "eq", value: 0 }, { metric: "totalLiabilities", operator: "eq", value: 1e-7 }] }).total).toBe(1);
    });
    it("asc/desc・同値順序・offset/limit=0を固定する", () => {
        const input = [snapshot("1003", ["5", "4", "3"]), snapshot("1002"), snapshot("1001")];
        expect(run(input, { sortBy: "currentAssets", order: "desc" }).rows.map(r => r.secCode)).toEqual(["10010", "10020", "10030"]);
        expect(run(input, { sortBy: "currentAssets", order: "asc", offset: 1, limit: 1 }).rows.map(r => r.secCode)).toEqual(["10010"]);
        expect(run(input, { limit: 0 })).toMatchObject({ total: 3, rows: [] });
        expect(run(input, { offset: 3 })).toMatchObject({ total: 3, rows: [] });
        expect(run([])).toMatchObject({ total: 0, rows: [], excludedRows: 0 });
    });
    it("入力を変更せず結果とも切り離す", () => {
        const row = snapshot(); const before = clone(row); const result = run([row]);
        result.rows[0].selections.currentAssets.evidence[0].reason = "nil";
        expect(row).toEqual(before);
    });
    it("必要指標の欠損・曖昧・巨大整数を診断し除外する", () => {
        const missing = snapshot("1001", ["absent", "40", "80"]);
        const unsafe = snapshot("1002", ["9007199254740993", "40", "80"]);
        const ambiguous = createBalanceSheetSnapshot(instance(fact("1", "", keys[0]) + fact("2", "", keys[0]), context()), { ...meta, secCode: "1003" });
        const result = run([missing, unsafe, ambiguous], query);
        expect(result).toMatchObject({ total: 0, excludedRows: 3, reasonCounts: { missing: 3, ambiguous: 1, "unsafe-number": 1, unsupported: 0 } });
        expect(result.diagnostics.find(d => d.reason === "unsafe-number")).toMatchObject({ required: true, selectionReason: "selected-raw-only" });
    });
    it("不要指標の欠損は記録するが行を落とさず、sort欠損は除外する", () => {
        const row = snapshot("1001", ["120", "nil", "80"]);
        expect(run([row], query)).toMatchObject({ total: 1, excludedRows: 0, diagnostics: [{ metric: "currentLiabilities", required: false, reason: "missing" }] });
        expect(run([row], { ...query, sortBy: "currentLiabilities" })).toMatchObject({ total: 0, excludedRows: 1 });
        expect(run([row])).toMatchObject({ total: 0, excludedRows: 1 });
    });
    it("原本USD factはunsupportedとして除外し、USD metaは拒否する", () => {
        const row = createBalanceSheetSnapshot(xml(undefined, "A", "", '<xbrli:unit id="money"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>'), meta);
        expect(run([row], query)).toMatchObject({ excludedRows: 1, reasonCounts: { unsupported: 3 } });
        expect(() => run([{ ...row, currency: "USD" } as any])).toThrow(/メタデータ/);
    });
    it.each(["IFRS", "US-GAAP"])("%s metaは入力エラーとする", standard => expect(() => createBalanceSheetSnapshot(xml(), { ...meta, accountingStandard: standard } as any)).toThrow(/メタデータ/));
    it.each(["instant", "scope", "accountingStandard"])("%s混在は条件で0件になる前に拒否する", property => {
        const a = snapshot("1001"); let b = snapshot("1002");
        if (property === "instant") { b.instant = "2024-03-31"; for (const r of Object.values(b.selections)) if (r.status === "selected") { r.source.period!.instant = b.instant; } }
        if (property === "scope") b = createBalanceSheetSnapshot(xml(undefined, "B", standalone), { ...meta, secCode: "1002", docID: "OTHER", scope: "NonConsolidated" });
        if (property === "accountingStandard") { const c = ({ ...snapshot("1002"), accountingStandard: "IFRS" } as any); expect(() => run([a, c], { conditions: [{ metric: "currentAssets", operator: "gt", value: 999 }] })).toThrow(/メタデータ/); return; }
        expect(() => run([a, b], { conditions: [{ metric: "currentAssets", operator: "gt", value: 999 }] })).toThrow(/混在/);
    });
    it("4/5桁正規化後に同じ企業の複数原本を拒否する", () => expect(() => run([snapshot("1001"), snapshot("10010")])).toThrow(/複数snapshot/));
    it("別企業ラベルでも同一docIDを拒否する", () => { const a = snapshot("1001"), b = snapshot("1002"); b.docID = a.docID; expect(() => run([a, b])).toThrow(/docID/); });
    it("同一snapshotの複数指標間entity混在を拒否する", () => {
        const row = snapshot(); const r = row.selections.currentLiabilities;
        if (r.status === "selected") r.source.entity!.identifier = "OTHER";
        expect(() => run([row])).toThrow(/entity/);
    });
    it("残存競合evidenceを持つ偽selectedを拒否する", () => {
        const row = createBalanceSheetSnapshot(instance(fact("120", "", keys[0]) + fact("999", "", keys[0]), context()), meta);
        const evidence = row.selections.currentAssets.evidence;
        row.selections.currentAssets = { metricId: "currentAssets", status: "selected", raw: "120", safeNumber: 120, reason: "selected", source: evidence[0], evidence };
        expect(() => run([row], query)).toThrow(/競合/);
    });
    it("別periodの不正context証跡を除外して偽selectedへ昇格できない", () => {
        const invalid = '<xbrli:context id="invalid"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>2023-04-01</xbrli:startDate><xbrli:endDate>2024-03-31</xbrli:endDate><xbrli:instant>2024-03-31</xbrli:instant></xbrli:period></xbrli:context>';
        const row = createBalanceSheetSnapshot(instance(fact("120", "", keys[0]) + fact("999", "", keys[0], "invalid"), context() + invalid), meta);
        expect(row.selections.currentAssets.status).toBe("ambiguous");
        const evidence = row.selections.currentAssets.evidence;
        row.selections.currentAssets = { metricId: "currentAssets", status: "selected", raw: "120", safeNumber: 120, reason: "selected", source: evidence[0], evidence };
        expect(() => run([row], query)).toThrow(/context/);
    });
    it("rawDimensions明細と空dimensionsの矛盾を拒否する", () => {
        const row = snapshot(); const r = row.selections.currentAssets;
        if (r.status === "selected") r.source.rawDimensions = { scenario: { "xbrldi:explicitMember": { "@_dimension": "extension:Axis", "#text": "extension:SegmentMember" } } };
        expect(() => run([row], query)).toThrow(/次元/);
    });
    it.each(["missing", "unsupported"])("採用可能evidenceを残す偽%sを拒否する", status => {
        const row = snapshot(); const r: any = row.selections.currentAssets;
        row.selections.currentAssets = { metricId: "currentAssets", status, reason: status === "missing" ? "tag-absent" : "unsupported-unit", evidence: r.evidence } as any;
        expect(() => run([row], query)).toThrow(/矛盾/);
    });
    it("単体axis/memberの正当なprefix aliasを許容する", () => {
        const input = xml(undefined, "A", standalone.replaceAll("jppfs_cor:", "axis:" )).replace('<xbrli:xbrl ', '<xbrli:xbrl xmlns:axis="http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor" ');
        const row = createBalanceSheetSnapshot(input, { ...meta, scope: "NonConsolidated" });
        expect(run([row]).total).toBe(1);
    });
    it.each([
        ["safeNumber", (r: any) => r.safeNumber = 1], ["raw", (r: any) => r.raw = "999"],
        ["source.key", (r: any) => r.source.key = "jppfs_cor:Assets"], ["unit", (r: any) => r.source.unit = "iso4217:USD"],
        ["instant", (r: any) => r.source.period.instant = "2024-03-31"], ["scope", (r: any) => r.source.scope = "NonConsolidated"],
        ["entity", (r: any) => delete r.source.entity], ["namespace", (r: any) => r.source.namespaceURI = "https://example.test/fake"],
        ["nil", (r: any) => r.source.nil = true], ["dimensions", (r: any) => r.source.dimensions = ["SegmentMember"]],
        ["decimals", (r: any) => r.source.decimals = "NaN"], ["status", (r: any) => r.status = "forged"],
        ["metricId", (r: any) => r.metricId = "totalAssets"], ["evidence", (r: any) => r.evidence = []],
        ["selected-only", (r: any) => { delete r.raw; delete r.source; }]
    ])("selectedの偽装/不整合を拒否: %s", (_name, mutate) => {
        const row = snapshot(); (mutate as (r: any) => void)(row.selections.currentAssets);
        expect(() => run([row], { conditions: [{ metric: "totalLiabilities", operator: "gte", value: 0 }] })).toThrow();
    });
    it.each([null, { conditions: null }, { conditions: [{ metric: "netSales", operator: "gte", value: 0 }] }, { conditions: [{ metric: "currentAssets", operator: "no", value: 0 }] }, { conditions: [{ metric: "currentAssets", operator: "gte", value: Number.MAX_SAFE_INTEGER + 1 }] }, { sortBy: "netSales" }, { order: "random" }, { offset: -1 }, { limit: 1.5 }])("不正な入力条件を拒否する", opts => {
        expect(() => run([snapshot()], opts)).toThrow();
    });
    it("保存2企業を同一時点へ推測せず、個別rawと検索返値を突合する", () => {
        const inputs = [ ["CJ_2371_kakakucom.xbrl", "1001"], ["S100TMMG/XBRL/PublicDoc/jpcrp030000-asr-001_E02367-000_2024-03-31_01_2024-06-28.xbrl", "1002"] ];
        const snapshots = inputs.map(([file, secCode]) => {
            const object = new EdinetXbrlParser().parse(readFileSync(new URL(`./test_data/${file}`, import.meta.url), "utf8"));
            const ctx = object.findContexts({ type: "Instant", scope: "Consolidated" }).find(c => c.id === "CurrentYearInstant")!;
            const row = createBalanceSheetSnapshot(object, { ...meta, secCode, instant: ctx.period.instant!, docID: `DOC${secCode}` });
            const result = run([row], { conditions: [{ metric: "currentAssets", operator: "gte", value: 0 }] });
            expect(result.total).toBe(1);
            for (const d of Object.values(BALANCE_SHEET_REGISTRY)) {
                expect(result.rows[0].selections[d.id].raw).toBe(object.getDataByContextRef(d.candidates[0].key, ctx.id)!.rawValue);
            }
            return row;
        });
        expect(() => run(snapshots)).toThrow(/混在/);
    });
});

describe("screen-bs CLI", () => {
    const cli = resolve("src/cli.ts");
    const loader = resolve("node_modules/tsx/dist/loader.mjs");
    const launch = (args: string[], cwd: string) => spawnSync(process.execPath, ["--import", loader, cli, "screen-bs", ...args], { cwd, encoding: "utf8" });
    it("manifest相対fileをmanifest基準で読みJSONを返す", () => {
        const dir = mkdtempSync(join(tmpdir(), "bs-screen-"));
        try {
            writeFileSync(join(dir, "one.xbrl"), xml()); writeFileSync(join(dir, "two.xbrl"), xml(["200", "50", "90"], "B"));
            writeFileSync(join(dir, "manifest.json"), JSON.stringify([ { ...(({ currency, ...rest }) => rest)(meta), file: "one.xbrl" }, { ...(({ currency, ...rest }) => rest)(meta), secCode: "1002", docID: "SYNTHETIC2", file: "two.xbrl" } ]));
            const args = ["--manifest", join(dir, "manifest.json"), "--conditions", JSON.stringify(query.conditions), "--sort-by", "currentAssets", "--limit", "1"];
            const result = launch(args, "/tmp");
            expect(result.status).toBe(0); expect(result.stderr).toBe("");
            expect(JSON.parse(result.stdout)).toMatchObject({ total: 2, rows: [{ secCode: "10020" }] });
            const zero = launch([...args, "--limit", "0"], "/tmp"); expect(zero.status).toBe(0); expect(JSON.parse(zero.stdout)).toMatchObject({ total: 2, rows: [] });
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
    it.each(["malformed", "fake-selected", "missing-file", "mixed", "duplicate", "duplicate-doc", "ifrs", "null-condition", "invalid-condition"])("%sはstderr/nonzeroで失敗する", mode => {
        const dir = mkdtempSync(join(tmpdir(), "bs-screen-fail-"));
        try {
            writeFileSync(join(dir, "one.xbrl"), xml());
            const { currency, ...entry } = meta;
            const list: any[] = [{ ...entry, file: "one.xbrl" }];
            if (mode === "fake-selected") list[0].selections = { currentAssets: { status: "selected", safeNumber: 100 } };
            if (mode === "missing-file") list[0].file = "missing.xbrl";
            if (mode === "mixed") list.push({ ...entry, secCode: "1002", instant: "2024-03-31", file: "one.xbrl" });
            if (mode === "duplicate") list.push({ ...entry, file: "one.xbrl" });
            if (mode === "duplicate-doc") list.push({ ...entry, secCode: "1002", file: "one.xbrl" });
            if (mode === "ifrs") list[0].accountingStandard = "IFRS";
            writeFileSync(join(dir, "manifest.json"), mode === "malformed" ? "{" : JSON.stringify(list));
            const result = launch(["--manifest", join(dir, "manifest.json"), ...(mode === "null-condition" ? ["--conditions", "null"] : mode === "invalid-condition" ? ["--conditions", '[{"metric":"netSales","operator":"gte","value":0}]'] : [])], "/tmp");
            expect(result.status).toBe(1); expect(result.stdout).toBe(""); expect(result.stderr.length).toBeGreaterThan(0);
        } finally { rmSync(dir, { recursive: true, force: true }); }
    });
});

it.each(['raw','decimals','unit','namespace','nil','reason','period','single'])('BSの完全一致重複採用で偽造%sを拒否し、旧曖昧JSONは維持する',field=>{
 const input=instance(fact('100','','jppfs_cor:CurrentAssets')+fact('100','','jppfs_cor:CurrentAssets'),context());
 const row=createBalanceSheetSnapshot(input,meta),selected=row.selections.currentAssets;
 expect(selected).toMatchObject({status:'selected',reason:'selected-identical-duplicates'});
 expect(screenBalanceSheetSnapshots([row],{sortBy:'currentAssets'}).total).toBe(1);
 const legacy:any=structuredClone(row);legacy.selections.currentAssets={metricId:'currentAssets',status:'ambiguous',reason:'multiple-facts',evidence:legacy.selections.currentAssets.evidence};
 expect(screenBalanceSheetSnapshots([legacy],{sortBy:'currentAssets'}).excludedRows).toBe(1);
 const forged:any=structuredClone(row),e=forged.selections.currentAssets.evidence[1];
 if(field==='raw')e.raw='101';if(field==='decimals')e.decimals='0';if(field==='unit')e.unit='iso4217:USD';if(field==='namespace')e.namespaceURI='https://example.test/fake';if(field==='nil')e.nil=true;if(field==='reason')e.reason='unsupported-unit';if(field==='period')e.period.instant='2024-03-31';if(field==='single')forged.selections.currentAssets.evidence.pop();
 expect(()=>screenBalanceSheetSnapshots([forged],{sortBy:'currentAssets'})).toThrow();
});
