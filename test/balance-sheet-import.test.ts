import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "../src/db/node-sqlite";
import { BalanceSheetSqliteStore, importBalanceSheets, planBalanceSheetImport, BalanceSheetImportStatus,
    createBalanceSheetSnapshot, screenBalanceSheetSnapshots, type BalanceSheetImportSource } from "../src/index";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
function source(code = "1001", instant = "2025-03-31", scope: "Consolidated" | "NonConsolidated" = "Consolidated") {
    const context = `<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period>${scope === "NonConsolidated" ? `<xbrli:scenario>${standalone}</xbrli:scenario>` : ""}</xbrli:context>`;
    const xml = instance([fact("120", "", "jppfs_cor:CurrentAssets"), fact("40", "", "jppfs_cor:CurrentLiabilities"), fact("80", "", "jppfs_cor:Liabilities")].join(""), context);
    const bytes = new TextEncoder().encode(xml);
    const item: BalanceSheetImportSource = { metadata: { secCode: code, docID: `SYNTHETIC-${code}`, instant, scope, accountingStandard: "J-GAAP", currency: "JPY" },
        provenance: { sourceSha256: createHash("sha256").update(bytes).digest("hex"), extractorVersion: "v1", mappingVersion: "1", sourceCommit: "a".repeat(40) } };
    return { item, bytes, xml };
}
function withDb(run: (store: BalanceSheetSqliteStore, path: string) => void) {
    const dir = mkdtempSync(join(tmpdir(), "bs-import-")), path = join(dir, "financial.sqlite"), store = new BalanceSheetSqliteStore(path);
    try { run(store, path); } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
}
function sql(path: string, text: string) { const db = new Database(path); try { db.exec(text); } finally { db.close(); } }
const json = (v: unknown) => JSON.parse(JSON.stringify(v));

describe("原本と版に基づく財務差分取り込み", () => {
    it("new→保存→再open後unchanged、原本は再読取しない", () => withDb((store, path) => {
        const a = source(), b = source("1002"); const read = vi.fn(s => s.metadata.secCode === "10010" ? a.bytes : b.bytes);
        expect(planBalanceSheetImport(store, [a.item, b.item]).counts).toEqual({ new: 2, changed: 0, unchanged: 0, conflict: 0 });
        const first = importBalanceSheets(store, [a.item, b.item], read);
        expect(first).toMatchObject({ inserted: 2, processed: 2, unchanged: 0 }); expect(read).toHaveBeenCalledTimes(2);
        store.close(); const reopened = new BalanceSheetSqliteStore(path);
        try {
            const again = importBalanceSheets(reopened, [a.item, b.item], () => { throw new Error("読まない"); });
            expect(again).toMatchObject({ inserted: 0, processed: 0, unchanged: 2, snapshotIds: first.snapshotIds });
            const cohort = { ...a.item.metadata, ...a.item.provenance }; const { secCode: _c, docID: _d, sourceCommit: _s, sourceSha256: _h, ...range } = cohort;
            const options = { sortBy: "currentRatio" as const, order: "desc" as const, limit: 1, offset: 1 };
            expect(json(reopened.search(range, options))).toEqual(json(screenBalanceSheetSnapshots([a,b].map(x => createBalanceSheetSnapshot(x.xml, x.item.metadata)), options)));
        } finally { reopened.close(); }
    }));
    it.each(["extractorVersion", "mappingVersion", "sourceCommit"] as const)("%sだけの変更は再解析して旧版を残す", key => withDb(store => {
        const a = source(); const first = importBalanceSheets(store, [a.item], () => a.bytes);
        const updated = structuredClone(a.item); updated.provenance[key] = key === "sourceCommit" ? "b".repeat(40) : "v2";
        expect(planBalanceSheetImport(store, [updated]).items[0]).toMatchObject({ status: BalanceSheetImportStatus.Changed, previousIds: first.snapshotIds });
        const read = vi.fn(() => a.bytes), result = importBalanceSheets(store, [updated], read);
        expect(read).toHaveBeenCalledTimes(1); expect(result.inserted).toBe(1); expect(result.snapshotIds).not.toEqual(first.snapshotIds);
        expect(store.inventory().entries).toHaveLength(2); expect(store.get(first.snapshotIds[0])!.provenance).toEqual(a.item.provenance);
        expect(importBalanceSheets(store, [updated], () => { throw Error("不要"); }).processed).toBe(0);
    }));
    it("既存分は読まず、新規と版変更だけ処理する", () => withDb(store => {
        const a = source(), b = source("1002"), c = source("1003"); importBalanceSheets(store, [a.item,b.item], s => s.metadata.secCode === "10010" ? a.bytes : b.bytes);
        b.item.provenance.extractorVersion = "v2"; const read = vi.fn(s => s.metadata.secCode === "10020" ? b.bytes : c.bytes);
        const result = importBalanceSheets(store, [a.item,b.item,c.item], read);
        expect(result.plan.counts).toEqual({ new: 1, changed: 1, unchanged: 1, conflict: 0 });
        expect(result).toMatchObject({ processed: 2, inserted: 2, unchanged: 1 }); expect(read.mock.calls.map(c => c[0].metadata.secCode)).toEqual(["10020","10030"]);
    }));
    it.each(["hash", "company"])("同docIDの%s変更は黙って取り込まない", kind => withDb(store => {
        const a = source(); importBalanceSheets(store, [a.item], () => a.bytes); const changed = structuredClone(a.item);
        if (kind === "hash") changed.provenance.sourceSha256 = "b".repeat(64); else changed.metadata.secCode = "1002";
        expect(planBalanceSheetImport(store, [changed]).items[0].status).toBe("conflict");
        const read = vi.fn(); expect(() => importBalanceSheets(store, [changed], read)).toThrow(/衝突/); expect(read).not.toHaveBeenCalled(); expect(store.inventory().entries).toHaveLength(1);
    }));
    it("同じ原本から別期末・単体範囲を追加できる（欠損も保存し0にしない）", () => withDb(store => {
        const a = source(); importBalanceSheets(store, [a.item], () => a.bytes);
        const prior = structuredClone(a.item), single = structuredClone(a.item); prior.metadata.instant = "2024-03-31"; single.metadata.scope = "NonConsolidated";
        expect(planBalanceSheetImport(store, [prior,single]).counts.new).toBe(2);
        const result = importBalanceSheets(store, [prior,single], () => a.bytes);
        expect(store.inventory().entries).toHaveLength(3);
        expect(store.get(result.snapshotIds[0])!.snapshot.selections.currentAssets.status).toBe("missing");
    }));
    it("空batchと空DBのinventoryは再open後も安定", () => withDb((store,path) => {
        const before = store.inventory(); expect(importBalanceSheets(store, [], () => { throw Error("不要"); })).toMatchObject({ inserted: 0, processed: 0, snapshotIds: [] });
        store.close(); const reopened = new BalanceSheetSqliteStore(path); try { expect(reopened.inventory()).toEqual(before); } finally { reopened.close(); }
    }));
    it("同batchの重複slot・異なる原本は読取前に拒否", () => withDb(store => {
        const a = source(), b = structuredClone(a.item); expect(() => planBalanceSheetImport(store,[a.item,a.item])).toThrow(/重複/);
        b.metadata.instant = "2024-03-31"; b.provenance.sourceSha256 = "b".repeat(64);
        expect(planBalanceSheetImport(store,[a.item,b]).counts.conflict).toBe(2);
        expect(() => importBalanceSheets(store,[a.item,b],()=>a.bytes)).toThrow(/衝突/); expect(store.inventory().entries).toHaveLength(0);
    }));
});

describe("失敗・再開・計画後更新・入力変更と既存DB保護", () => {
    it("読取途中の失敗は0件保存、再open後に同じbatchを安全に再実行", () => withDb((store,path) => {
        const a=source(), b=source("1002"), fingerprint=store.inventory().fingerprint;
        expect(() => importBalanceSheets(store,[a.item,b.item],s=>{ if(s.metadata.secCode==="10020")throw Error("読取失敗"); return a.bytes; })).toThrow(/読取失敗/);
        expect(store.inventory().fingerprint).toBe(fingerprint); store.close(); const next=new BalanceSheetSqliteStore(path);
        try { expect(importBalanceSheets(next,[a.item,b.item],s=>s.metadata.secCode==="10010"?a.bytes:b.bytes).inserted).toBe(2); } finally{ next.close(); }
    }));
    it.each(["hash", "utf8", "encoding", "not-bytes"])("%sの不正原本で一部保存しない", kind=>withDb(store=>{
        const a=source(), b=source("1002"); let bad: any = new TextEncoder().encode("wrong");
        if(kind==="utf8")bad=new Uint8Array([255]);
        if(kind==="encoding")bad=new TextEncoder().encode('<?xml version="1.0" encoding="Shift_JIS"?><x/>');
        if(kind==="not-bytes")bad="not bytes";
        if(kind!=="hash" && kind!=="not-bytes")b.item.provenance.sourceSha256=createHash("sha256").update(bad).digest("hex");
        expect(()=>importBalanceSheets(store,[a.item,b.item],s=>s.metadata.secCode==="10010"?a.bytes:bad)).toThrow(); expect(store.inventory().entries).toHaveLength(0);
    }));
    it("XML解析自体の失敗でも先に解析した分を保存しない",()=>withDb(store=>{
        const a=source(),b=source("1002"),bad=new TextEncoder().encode('<xbrli:xbrl><broken>');
        b.item.provenance.sourceSha256=createHash("sha256").update(bad).digest("hex");
        expect(()=>importBalanceSheets(store,[a.item,b.item],s=>s.metadata.secCode==="10010"?a.bytes:bad)).toThrow();
        expect(store.inventory().entries).toHaveLength(0);
    }));
    it("既存APIで保存された同doc異原本も衝突として検出",()=>withDb(store=>{
        const a=source();importBalanceSheets(store,[a.item],()=>a.bytes);
        store.putMany([{snapshot:createBalanceSheetSnapshot(a.xml,a.item.metadata),provenance:{...a.item.provenance,sourceSha256:"b".repeat(64)}}]);
        expect(planBalanceSheetImport(store,[a.item]).counts.conflict).toBe(1);
    }));
    it("manifestだけ同じなら既存分を再hashしない（原本一覧の更新は利用側）",()=>withDb(store=>{
        const a=source();importBalanceSheets(store,[a.item],()=>a.bytes);const read=vi.fn(()=>new TextEncoder().encode("file changed"));
        expect(importBalanceSheets(store,[a.item],read).unchanged).toBe(1);expect(read).not.toHaveBeenCalled();
    }));
    it("SQLが2件目で失敗しても1件目を残さず、解除後再開",()=>withDb((store,path)=>{
        const a=source(),b=source("1002");sql(path,"CREATE TRIGGER fail_second BEFORE INSERT ON financial_snapshots WHEN NEW.sec_code='10020' BEGIN SELECT RAISE(ABORT,'synthetic failure'); END;");
        const read=(s:BalanceSheetImportSource)=>s.metadata.secCode==="10010"?a.bytes:b.bytes;
        expect(()=>importBalanceSheets(store,[a.item,b.item],read)).toThrow(/synthetic failure/);expect(store.inventory().entries).toHaveLength(0);
        sql(path,"DROP TRIGGER fail_second;");expect(importBalanceSheets(store,[a.item,b.item],read).inserted).toBe(2);
    }));
    it("原本読取中の別接続更新は拒否し、他接続の追加は保持",()=>withDb((store,path)=>{
        const a=source(),b=source("1002");const other=new BalanceSheetSqliteStore(path);
        try{
            expect(()=>importBalanceSheets(store,[a.item],()=>{importBalanceSheets(other,[b.item],()=>b.bytes);return a.bytes;})).toThrow(/再計画/);
            expect(store.inventory().entries.map(x=>x.metadata.secCode)).toEqual(["10020"]);
            expect(importBalanceSheets(store,[a.item],()=>a.bytes).inserted).toBe(1);
        }finally{other.close();}
    }));
    it("unchangedだけでも計画後更新の検査を省略しない",()=>withDb((store,path)=>{
        const a=source(),b=source("1002");importBalanceSheets(store,[a.item],()=>a.bytes);const other=new BalanceSheetSqliteStore(path);
        const original=store.inventory.bind(store);vi.spyOn(store,"inventory").mockImplementationOnce(()=>{const inv=original();importBalanceSheets(other,[b.item],()=>b.bytes);return inv;});
        try{expect(()=>importBalanceSheets(store,[a.item],()=>{throw Error("読まない");})).toThrow(/再計画/);expect(original().entries).toHaveLength(2);}finally{other.close();}
    }));
    it("callbackが元配列/metadata/受取引数を変更しても計画した原本と出典を保存",()=>withDb(store=>{
        const a=source(),b=source("1002"),sources=[a.item,b.item];const originalB=structuredClone(b.item);
        const saved=importBalanceSheets(store,sources,s=>{
            const bytes=s.metadata.secCode==="10010"?a.bytes:b.bytes;
            sources.reverse();b.item.provenance.sourceSha256="b".repeat(64);b.item.metadata.docID="MUTATED";s.provenance.extractorVersion="mutated";
            return bytes;
        });
        expect(store.get(saved.snapshotIds[1])!.provenance).toEqual(originalB.provenance);expect(store.get(saved.snapshotIds[1])!.snapshot.docID).toBe(originalB.metadata.docID);
    }));
    it("返したplanを書き換えても次の取込判定には使わない",()=>withDb(store=>{
        const a=source(),plan=planBalanceSheetImport(store,[a.item]);plan.items[0].status="unchanged";plan.items[0].provenance.sourceSha256="b".repeat(64);
        expect(importBalanceSheets(store,[a.item],()=>a.bytes).processed).toBe(1);
    }));
    it("保存済みのJSON破損はunchangedとして隠さない",()=>withDb((store,path)=>{
        const a=source();importBalanceSheets(store,[a.item],()=>a.bytes);sql(path,"UPDATE financial_snapshots SET record_json='{}';");
        expect(()=>planBalanceSheetImport(store,[a.item])).toThrow(/ハッシュ/);
    }));
    it("readOnlyでは差分計画だけ可能、書込を拒否してファイル内容を保つ",()=>withDb((store,path)=>{
        const a=source();importBalanceSheets(store,[a.item],()=>a.bytes);store.close();const before=readFileSync(path),reader=new BalanceSheetSqliteStore(path,{readOnly:true});
        try{expect(planBalanceSheetImport(reader,[a.item]).counts.unchanged).toBe(1);expect(()=>importBalanceSheets(reader,[a.item],()=>a.bytes)).toThrow(/readOnly/);}finally{reader.close();}expect(readFileSync(path)).toEqual(before);
    }));
    it.each(["date","currency","standard","code","version","sparse","accessor","extra"])("%sの不正manifestは原本を読む前に拒否",kind=>withDb(store=>{
        const a=source();let items:any=[a.item];
        if(kind==="date")a.item.metadata.instant="2025-02-30";
        if(kind==="currency")(a.item.metadata as any).currency="USD";
        if(kind==="standard")(a.item.metadata as any).accountingStandard="IFRS";
        if(kind==="code")a.item.metadata.secCode="?";
        if(kind==="version")a.item.provenance.extractorVersion=" ";
        if(kind==="sparse")items=Array(1);
        if(kind==="accessor")Object.defineProperty(a.item.metadata,"instant",{get(){throw Error("getter called");},enumerable:true});
        if(kind==="extra")(a.item.metadata as any).unknown="x";
        const read=vi.fn();expect(()=>importBalanceSheets(store,items,read)).toThrow();expect(read).not.toHaveBeenCalled();expect(store.inventory().entries).toHaveLength(0);
    }));
});
