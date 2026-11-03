import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { BalanceSheetSqliteStore, createBalanceSheetSnapshot, compareBalanceSheetVersions, BalanceSheetDiffStatus,
    BalanceSheetValueComparison, type BalanceSheetStoreInput } from "../src/index";
import { Database } from "../src/db/node-sqlite";
import { runLocalBalanceSheetDiff } from "../src/local-balance-sheet-import";
import { instance, fact, standalone } from "./fixtures/metric-boundaries";
const sharedHash = createHash("sha256").update("synthetic-original-with-old-and-new-extraction-fixtures").digest("hex");
const keys = ["jppfs_cor:CurrentAssets", "jppfs_cor:CurrentLiabilities", "jppfs_cor:Liabilities"];
function row(values = ["120", "40", "80"], version = "v1", opts: { scope?: "Consolidated" | "NonConsolidated"; instant?: string; code?: string; doc?: string; entity?: string; contextId?: string; extra?: string; decimals?: string; missingUnit?: boolean } = {}): BalanceSheetStoreInput {
    const scope = opts.scope ?? "Consolidated", instant = opts.instant ?? "2025-03-31", contextId = opts.contextId ?? "current";
    const context = `<xbrli:context id="${contextId}"><xbrli:entity><xbrli:identifier scheme="synthetic">${opts.entity ?? "A"}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period>${scope === "NonConsolidated" ? `<xbrli:scenario>${standalone}</xbrli:scenario>` : ""}</xbrli:context>`;
    const facts = values.map((value, i) => value === "absent" ? "" : fact(value === "nil" ? "" : value,
        value === "nil" ? 'xsi:nil="true"' : "", keys[i]).replace('contextRef="current"', `contextRef="${contextId}"`).replace('decimals="INF"', `decimals="${opts.decimals ?? "INF"}"`).replace('unitRef="money"', i === 0 && opts.missingUnit ? 'unitRef="missing-unit"' : 'unitRef="money"')).join("");
    return { snapshot: createBalanceSheetSnapshot(instance(facts + (opts.extra ?? ""), context), { secCode: opts.code ?? "1001", docID: opts.doc ?? "SYNTHETIC1", instant, scope, accountingStandard: "J-GAAP", currency: "JPY" }),
        provenance: { sourceSha256: sharedHash, extractorVersion: version, mappingVersion: "1", sourceCommit: "a".repeat(40) } };
}
function fixture(run: (store: BalanceSheetSqliteStore, path: string, dir: string) => void) {
    const dir = fs.mkdtempSync(join(tmpdir(), "bs-version-diff-")), path = join(dir, "financial.sqlite"), store = new BalanceSheetSqliteStore(path);
    try { run(store, path, dir); } finally { store.close(); fs.rmSync(dir, { recursive: true, force: true }); }
}
function diff(store: BalanceSheetSqliteStore, a: BalanceSheetStoreInput, b: BalanceSheetStoreInput) { const saved = store.putMany([a,b]); return compareBalanceSheetVersions(store,saved.ids[0],saved.ids[1]); }
const hash=(file:string)=>createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const cli=resolve("src/cli.ts"),loader=resolve("node_modules/tsx/dist/loader.mjs");
const launch=(db:string,before:string,after:string,flags:string[]=[])=>spawnSync(process.execPath,["--import",loader,cli,"diff-bs","--db",db,"--before",before,"--after",after,...flags],{cwd:"/tmp",encoding:"utf8"});

describe("同一原本の財務再解析差分",()=>{
    it("解析版/対応表/commitだけの変更は財務unchanged、来歴を別軸で返す",()=>fixture(store=>{
        const a=row(),b=row(undefined,"v2");b.provenance.mappingVersion="2";b.provenance.sourceCommit="b".repeat(40);
        const result=diff(store,a,b);expect(result.status).toBe(BalanceSheetDiffStatus.Unchanged);
        expect(result.provenanceChanges).toEqual(["extractorVersion","mappingVersion","sourceCommit"]);
        expect(result.metrics.currentAssets.valueComparison).toBe(BalanceSheetValueComparison.Equal);expect(result.metrics.currentAssets.changes.source).toBe(false);
        expect(result.currentRatio.valueComparison).toBe("equal");expect(result.summary).toContain("来歴情報には変化");
    }));
    it("同じIDを比較でき、返却データの変更はDBへ戻らない",()=>fixture(store=>{
        const saved=store.putMany([row()]);const result=compareBalanceSheetVersions(store,saved.ids[0],saved.ids[0]);expect(result.status).toBe("unchanged");
        result.metrics.currentAssets.before.evidence[0].raw="mutated";expect(store.get(saved.ids[0])!.snapshot.selections.currentAssets.raw).toBe("120");
    }));
    it("数値変更と採用元変更を区別（rawをsource identityへ混ぜない）",()=>fixture(store=>{
        const result=diff(store,row(),row(["121","40","80"],"v2"));expect(result.status).toBe("changed");
        expect(result.metrics.currentAssets).toMatchObject({valueComparison:"changed",changes:{raw:true,source:false,status:false,reason:false}});
        expect(result.currentRatio.valueComparison).toBe("changed");expect(result.metrics.currentAssets.before.raw).toBe("120");expect(result.metrics.currentAssets.after.raw).toBe("121");
    }));
    it.each([["00120.000","120"],["+120.0","120."],[".500","0.5"],["-0","+0.000"],["-000.50","-.5"],["900719925474099300.000","0900719925474099300"]])("十進表記%s→%sは数値等値・元表記変更",(a,b)=>fixture(store=>{
        const result=diff(store,row([a,"40","80"]),row([b,"40","80"],"v2"));expect(result.metrics.currentAssets.valueComparison).toBe("equal");
        expect(result.metrics.currentAssets.changes.raw).toBe(true);expect(result.metrics.currentAssets.changes.source).toBe(false);expect(result.metrics.currentAssets.summary).toContain("表記に変化");
    }));
    it("numberで丸まる巨大整数同士もrawで正確に変化を検出、比率はunsafe維持",()=>fixture(store=>{
        const result=diff(store,row(["9007199254740992","1","80"]),row(["9007199254740993","1","80"],"v2"));
        expect(result.metrics.currentAssets.valueComparison).toBe("changed");expect(result.currentRatio).toMatchObject({valueComparison:"unavailable",before:{reason:"unsafe-input"},after:{reason:"unsafe-input"}});
    }));
    it("出典だけ違う場合は数値等値とsource変化、contextを保持",()=>fixture(store=>{
        const result=diff(store,row(),row(undefined,"v2",{contextId:"reparsed"}));expect(result.metrics.currentAssets).toMatchObject({valueComparison:"equal",changes:{raw:false,source:true}});
        expect(result.metrics.currentAssets.after.source?.contextRef).toBe("reparsed");expect(result.currentRatio.valueComparison).toBe("equal");expect(result.status).toBe("changed");
    }));
    it("報告精度decimalsだけの変更は出典変化として残す",()=>fixture(store=>{
        const result=diff(store,row(),row(undefined,"v2",{decimals:"-6"}));expect(result.metrics.currentAssets.valueComparison).toBe("equal");expect(result.metrics.currentAssets.changes.source).toBe(true);
    }));
    it("候補順だけの変更は変化にせず、候補追加は記録変化として返す",()=>fixture(store=>{
        const extra=fact("120","","extension:CurrentAssets");const a=row(undefined,"v1",{extra}),b=structuredClone(a);b.provenance.extractorVersion="v2";
        b.snapshot.selections.currentAssets.evidence=[...b.snapshot.selections.currentAssets.evidence].reverse();
        expect(diff(store,a,b).status).toBe("unchanged");
        const c=row(undefined,"v3");const result=diff(store,a,c);expect(result.metrics.currentAssets.valueComparison).toBe("equal");expect(result.metrics.currentAssets.changes.source).toBe(false);expect(result.metrics.currentAssets.changes.evidence).toBe(true);
    }));
    it.each([["nil","0"],["absent","0"],["0","absent"]])("%s→%sは欠損≠0、数値比較unavailable",(a,b)=>fixture(store=>{
        const result=diff(store,row([a,"40","80"]),row([b,"40","80"],"v2"));expect(result.metrics.currentAssets.valueComparison).toBe("unavailable");expect(result.metrics.currentAssets.changes.status).toBe(true);expect(result.status).toBe("changed");
    }));
    it("曖昧候補から採用へ変わっても旧値を推測しない",()=>fixture(store=>{
        const result=diff(store,row(undefined,"v1",{extra:fact("121","",keys[0])}),row(undefined,"v2"));
        expect(result.metrics.currentAssets.before.status).toBe("ambiguous");expect(result.metrics.currentAssets.valueComparison).toBe("unavailable");expect(result.currentRatio.before.reason).toBe("ambiguous-input");
    }));
    it("unsupportedから採用へ変わった理由と候補を保持",()=>fixture(store=>{
        const a=row(undefined,"v1",{missingUnit:true});
        const result=diff(store,a,row(undefined,"v2"));expect(result.metrics.currentAssets.before.status).toBe("unsupported");expect(result.metrics.currentAssets.changes.reason).toBe(true);expect(result.metrics.currentAssets.valueComparison).toBe("unavailable");
    }));
    it("分母0・負値を比率0や等値で埋めない",()=>fixture(store=>{
        const result=diff(store,row(["120","0","80"]),row(["-120","40","80"],"v2"));expect(result.currentRatio).toMatchObject({valueComparison:"unavailable",before:{reason:"zero-denominator"},after:{reason:"negative-input"},reasonChanged:true});
    }));
    it("両方の比率が計算不能でも等値とはせず、理由の不変は示す",()=>fixture(store=>{
        const result=diff(store,row(["120","0","80"]),row(["120","0","80"],"v2"));expect(result.currentRatio.valueComparison).toBe("unavailable");expect(result.currentRatio.reasonChanged).toBe(false);expect(result.status).toBe("unchanged");
    }));
    it("比率の入力値が違っても1/3と2/6は厳密等値",()=>fixture(store=>{
        const result=diff(store,row(["1","3","80"]),row(["2","6","80"],"v2"));expect(result.currentRatio.valueComparison).toBe("equal");expect(result.metrics.currentAssets.valueComparison).toBe("changed");
    }));
    it("表示numberが同じ比率も分数で変化を検出",()=>fixture(store=>{
        const result=diff(store,row(["9007199254740990","9007199254740989","80"]),row(["9007199254740991","9007199254740990","80"],"v2"));
        expect(result.currentRatio.before.value).toBe(result.currentRatio.after.value);expect(result.currentRatio.valueComparison).toBe("changed");
    }));
});

describe("比較できる対象と読み取り時点",()=>{
    it.each(["code","doc","instant","scope","entity","hash","unknown-entity"])("%sが揃わない場合は比較不可を説明",kind=>fixture(store=>{
        const a=row(),b=row(undefined,"v2",{...(kind==="code"?{code:"1002"}:{}),...(kind==="doc"?{doc:"SYNTHETIC2"}:{}),...(kind==="instant"?{instant:"2024-03-31"}:{}),...(kind==="scope"?{scope:"NonConsolidated" as const}:{}),...(kind==="entity"?{entity:"B"}:{})});
        if(kind==="hash")b.provenance.sourceSha256="b".repeat(64);
        if(kind==="unknown-entity")Object.assign(b,row(["absent","absent","absent"],"v2"));
        const result=diff(store,a,b);expect(result.status).toBe("incomparable");expect(result.issues.length).toBeGreaterThan(0);expect(result.metrics.currentAssets.valueComparison).toBe("not-comparable");expect(result.currentRatio.valueComparison).toBe("not-comparable");
    }));
    it.each(["currency","accountingStandard"])("%sの未対応宣言は保存の検証段階で拒否",field=>fixture(store=>{
        const a=row();(a.snapshot as any)[field]=field==="currency"?"USD":"IFRS";
        expect(()=>store.putMany([a])).toThrow();expect(store.inventory().entries).toHaveLength(0);
    }));
    it("両方全欠損はentityを推測せず比較不可、状態自体は返す",()=>fixture(store=>{
        const result=diff(store,row(["absent","absent","absent"]),row(["absent","absent","absent"],"v2"));expect(result.status).toBe("incomparable");expect(result.issues[0].reason).toBe("unknown-entity");expect(result.metrics.currentAssets.before.status).toBe("missing");
    }));
    it("不正/未知IDは拒否してtransactionを片付け、同ID2回と空getManyは有効",()=>fixture(store=>{
        const id=store.putMany([row()]).ids[0];expect(()=>compareBalanceSheetVersions(store,id,"bad")).toThrow(/ID/);expect(()=>compareBalanceSheetVersions(store,id,"0".repeat(64))).toThrow(/ありません/);
        expect(store.getMany([])).toEqual([]);expect(store.getMany([id,id])).toHaveLength(2);expect(()=>store.getMany(Array(1))).toThrow();expect(store.inventory().entries).toHaveLength(1);
    }));
    it("getManyは同じread snapshotを使い、途中の他接続追加を混ぜない",()=>fixture((store,path)=>{
        const a=row(),b=row(undefined,"v2");const aId=store.putMany([a]).ids[0];const memory=new BalanceSheetSqliteStore(":memory:");const bId=memory.putMany([b]).ids[0];memory.close();
        const native=new Database(path);native.exec("PRAGMA journal_mode=WAL;");native.close();const writer=new BalanceSheetSqliteStore(path);const original=store.get.bind(store);
        vi.spyOn(store,"get").mockImplementationOnce(id=>{const result=original(id);writer.putMany([b]);return result;});
        try{expect(()=>store.getMany([aId,bId])).toThrow(/ありません/);expect(store.inventory().entries).toHaveLength(2);}finally{writer.close();}
    }));
    it("保存破損は比較結果へ混ぜない",()=>fixture((store,path)=>{
        const ids=store.putMany([row(),row(undefined,"v2")]).ids;const native=new Database(path);const stmt=native.prepare("UPDATE financial_snapshots SET projection_json='{}' WHERE id=?");stmt.run(ids[1]);stmt.close();native.close();
        expect(()=>compareBalanceSheetVersions(store,ids[0],ids[1])).toThrow(/ハッシュ/);
    }));
});

describe("diff-bs CLIのJSON/終了コードと元DB保護",()=>{
    it("既存2版をJSON比較し元DB/ディレクトリ不変（cold WAL含む）",()=>fixture((store,path,dir)=>{
        const ids=store.putMany([row(),row(undefined,"v2",{contextId:"new-context"})]).ids;store.close();const native=new Database(path);native.exec("PRAGMA journal_mode=WAL;");native.close();
        const before=hash(path),names=fs.readdirSync(dir).sort();const result=launch(path,ids[0],ids[1],["--pretty"]);
        expect(result.status,result.stderr).toBe(0);expect(result.stderr).toBe("");expect(JSON.parse(result.stdout).metrics.currentAssets.changes.source).toBe(true);
        expect(hash(path)).toBe(before);expect(fs.readdirSync(dir).sort()).toEqual(names);
    }));
    it("比較不可は説明JSONとexit1、unknown IDはstderrとexit1",()=>fixture((store,path)=>{
        const ids=store.putMany([row(),row(undefined,"v2",{doc:"SYNTHETIC2"})]).ids;store.close();const before=hash(path);
        const incomparable=launch(path,ids[0],ids[1]);expect(incomparable.status).toBe(1);expect(JSON.parse(incomparable.stdout).status).toBe("incomparable");
        const missing=launch(path,ids[0],"0".repeat(64));expect(missing.status).toBe(1);expect(missing.stdout).toBe("");expect(missing.stderr).toContain("ありません");expect(hash(path)).toBe(before);
    }));
    it.each(["missing","empty","foreign","sidecar","symlink"])("%s DBを変更/作成しない",kind=>fixture((store,path,dir)=>{
        store.close();let target=path;
        if(kind==="missing")target=join(dir,"missing.sqlite");
        if(kind==="empty"){target=join(dir,"empty.sqlite");fs.writeFileSync(target,"");}
        if(kind==="foreign"){target=join(dir,"foreign.sqlite");const native=new Database(target);native.exec("CREATE TABLE foreign_data(x TEXT);");native.close();}
        if(kind==="sidecar")fs.writeFileSync(path+"-journal","synthetic-preserved");
        if(kind==="symlink"){target=join(dir,"link.sqlite");fs.symlinkSync(path,target);}
        const before=fs.existsSync(target)?hash(target):undefined,names=fs.readdirSync(dir).sort();expect(()=>runLocalBalanceSheetDiff({db:target,before:"0".repeat(64),after:"1".repeat(64)})).toThrow();
        expect(fs.existsSync(target)?hash(target):undefined).toBe(before);expect(fs.readdirSync(dir).sort()).toEqual(names);
    }));
    it("必須flag不足・未知flagを拒否",()=>fixture((store,path)=>{
        const id=store.putMany([row()]).ids[0];expect(launch(path,id,id,["--unknown"]).status).toBe(1);
        expect(spawnSync(process.execPath,["--import",loader,cli,"diff-bs","--db",path,"--before",id],{encoding:"utf8"}).status).toBe(1);
    }));
});
