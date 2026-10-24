import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { Database } from "../src/db/node-sqlite";
import { BalanceSheetSqliteStore } from "../src/index";
import { runLocalBalanceSheetImport, LOCAL_IMPORT_LIMITS, type LocalBalanceSheetImportOptions } from "../src/local-balance-sheet-import";
import { instance, fact } from "./fixtures/metric-boundaries";
const cli = resolve("src/cli.ts"), loader = resolve("node_modules/tsx/dist/loader.mjs");
function fixture(run: (dir: string, options: LocalBalanceSheetImportOptions, entries: any[]) => void) {
    const dir = fs.mkdtempSync(join(tmpdir(), "edinet-local-import-"));
    const xml = instance(fact("120", "", "jppfs_cor:CurrentAssets") + fact("40", "", "jppfs_cor:CurrentLiabilities") + fact("80", "", "jppfs_cor:Liabilities"),
        '<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>');
    const entries = [{ file: "source.xbrl", secCode: "1001", docID: "SYNTHETIC1", instant: "2025-03-31", scope: "Consolidated", accountingStandard: "J-GAAP" }];
    const options = { manifest: join(dir,"manifest.json"), db: join(dir,"financial.sqlite"), extractorVersion: "v1" };
    fs.writeFileSync(join(dir,"source.xbrl"),xml);fs.writeFileSync(options.manifest,JSON.stringify(entries));
    try { run(dir,options,entries); } finally { fs.rmSync(dir,{recursive:true,force:true}); }
}
const hash=(path:string)=>createHash("sha256").update(fs.readFileSync(path)).digest("hex");
const launch=(options:LocalBalanceSheetImportOptions, flags:string[]=[],cwd="/tmp")=>spawnSync(process.execPath,["--import",loader,cli,"import-bs","--manifest",options.manifest,"--db",options.db,"--extractor-version",options.extractorVersion,...flags],{cwd,encoding:"utf8"});

describe("ローカル原本一覧からの差分CLI",()=>{
    it("dry-runはmissing DBも親ディレクトリも作らず、全原本の実hashを返す",()=>fixture((dir,options)=>{
        const before=fs.readdirSync(dir).sort(), changed={...options,db:join(dir,"absent","new.sqlite"),dryRun:true};
        const result=runLocalBalanceSheetImport(changed);expect(result.plan.counts.new).toBe(1);
        expect(result.plan.items[0].provenance.sourceSha256).toBe(hash(join(dir,"source.xbrl")));
        expect(fs.readdirSync(dir).sort()).toEqual(before);expect(fs.existsSync(join(dir,"absent"))).toBe(false);
    }));
    it("CLIでrelative file基準、create→repeat→version change、JSONと検索用ID",()=>fixture((dir,options)=>{
        const first=launch(options,["--create","--pretty"]);expect(first.status,first.stderr).toBe(0);expect(first.stderr).toBe("");
        const saved=JSON.parse(first.stdout);expect(saved).toMatchObject({mode:"import",processed:1,inserted:1,unchanged:0});
        const repeat=launch(options);expect(repeat.status,repeat.stderr).toBe(0);expect(JSON.parse(repeat.stdout)).toMatchObject({processed:0,inserted:0,unchanged:1,snapshotIds:saved.snapshotIds});
        const changed=launch({...options,extractorVersion:"v2"});expect(changed.status,changed.stderr).toBe(0);expect(JSON.parse(changed.stdout).plan.counts.changed).toBe(1);
        const reader=new BalanceSheetSqliteStore(options.db,{readOnly:true});try{expect(reader.inventory().entries).toHaveLength(2);}finally{reader.close();}
    }));
    it("既存DBへのdry-runはDB/原本/manifestとdirectory内容を変えない",()=>fixture((dir,options)=>{
        runLocalBalanceSheetImport({...options,create:true});const before=[hash(options.db),hash(options.manifest),hash(join(dir,"source.xbrl"))],names=fs.readdirSync(dir).sort();
        const preview=launch(options,["--dry-run"]);expect(preview.status,preview.stderr).toBe(0);expect(JSON.parse(preview.stdout).plan.counts.unchanged).toBe(1);
        expect([hash(options.db),hash(options.manifest),hash(join(dir,"source.xbrl"))]).toEqual(before);expect(fs.readdirSync(dir).sort()).toEqual(names);
    }));
    it("cold WAL DBでもdry-runは元DBにSQLite接続せず、副ファイルを作らない",()=>fixture((dir,options)=>{
        runLocalBalanceSheetImport({...options,create:true});const db=new Database(options.db);db.exec("PRAGMA journal_mode=WAL;");db.close();
        expect(fs.existsSync(options.db+"-wal")).toBe(false);const before=hash(options.db),names=fs.readdirSync(dir).sort();
        expect(runLocalBalanceSheetImport({...options,dryRun:true}).plan.counts.unchanged).toBe(1);
        expect(hash(options.db)).toBe(before);expect(fs.readdirSync(dir).sort()).toEqual(names);
    }));
    it("ファイルを書換えたらhashを再計算して衝突、dry-runもapplyもnonzeroで元DB保持",()=>fixture((dir,options)=>{
        runLocalBalanceSheetImport({...options,create:true});const before=hash(options.db);fs.appendFileSync(join(dir,"source.xbrl"),"\n");
        for(const flags of [["--dry-run"],[]]){const result=launch(options,flags);expect(result.status).toBe(1);expect(JSON.parse(result.stdout).plan.counts.conflict).toBe(1);}
        expect(hash(options.db)).toBe(before);
    }));
    it("新規batch自体の原本衝突はDBを作る前に停止",()=>fixture((dir,options,entries)=>{
        fs.writeFileSync(join(dir,"other.xbrl"),fs.readFileSync(join(dir,"source.xbrl"),"utf8")+"\n");
        fs.writeFileSync(options.manifest,JSON.stringify([...entries,{...entries[0],file:"other.xbrl",instant:"2024-03-31"}]));
        const result=runLocalBalanceSheetImport({...options,create:true});expect(result.plan.counts.conflict).toBe(2);expect(fs.existsSync(options.db)).toBe(false);
    }));
    it("--createなしのmissing DBと既存ファイルへの--createを拒否",()=>fixture((_dir,options)=>{
        expect(()=>runLocalBalanceSheetImport(options)).toThrow(/--create/);expect(fs.existsSync(options.db)).toBe(false);
        runLocalBalanceSheetImport({...options,create:true});const before=hash(options.db);
        expect(()=>runLocalBalanceSheetImport({...options,create:true})).toThrow(/上書き/);expect(hash(options.db)).toBe(before);
    }));
    it.each(["empty","foreign","wal-foreign"])("%s既存DBは初期化も副ファイル作成もしない",kind=>fixture((dir,options)=>{
        if(kind==="empty")fs.writeFileSync(options.db,"");else{const db=new Database(options.db);db.exec("CREATE TABLE unrelated(value TEXT);");if(kind==="wal-foreign")db.exec("PRAGMA journal_mode=WAL;");db.close();}
        const before=hash(options.db),names=fs.readdirSync(dir).sort();
        for(const dryRun of [true,false])expect(()=>runLocalBalanceSheetImport({...options,dryRun})).toThrow();
        expect(hash(options.db)).toBe(before);expect(fs.readdirSync(dir).sort()).toEqual(names);
    }));
    it.each(["source","manifest","hardlink","symlink"])("DBと%sの衝突を拒否",kind=>fixture((dir,options)=>{
        let target=join(dir,"source.xbrl");if(kind==="manifest")target=options.manifest;
        if(kind==="hardlink"){fs.linkSync(target,options.db);target=options.db;}
        if(kind==="symlink"){fs.symlinkSync(target,options.db);target=options.db;}
        const before=hash(target);expect(()=>runLocalBalanceSheetImport({...options,db:target})).toThrow();expect(hash(target)).toBe(before);
    }));
    it.each(["-journal","-wal","-shm"])("%s副ファイルが原本でも上書きしない",suffix=>fixture((dir,options,entries)=>{
        const original=fs.readFileSync(join(dir,"source.xbrl"));fs.writeFileSync(options.db+suffix,original);entries[0].file="financial.sqlite"+suffix;fs.writeFileSync(options.manifest,JSON.stringify(entries));
        expect(()=>runLocalBalanceSheetImport({...options,create:true})).toThrow(/副ファイル/);expect(fs.readFileSync(options.db+suffix)).toEqual(original);expect(fs.existsSync(options.db)).toBe(false);
    }));
    it.each(["metadata","version","missing-source","directory","malformed-json","extra","duplicate"])("%s不正入力ではDBを作成しない",kind=>fixture((dir,options,entries)=>{
        if(kind==="metadata")entries[0].instant="2025-02-30";
        if(kind==="version")options.extractorVersion=" ";
        if(kind==="missing-source")entries[0].file="absent.xbrl";
        if(kind==="directory")entries[0].file=".";
        if(kind==="extra")(entries[0] as any).sourceSha256="a".repeat(64);
        if(kind==="duplicate")entries.push({...entries[0]});
        fs.writeFileSync(options.manifest,kind==="malformed-json"?"{":JSON.stringify(entries));
        const result=launch(options,["--create"]);expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr.length).toBeGreaterThan(0);expect(fs.existsSync(options.db)).toBe(false);
    }));
    it("不正XMLはdry-runで構文検査済みとはせず、apply時は保存0件",()=>fixture((dir,options)=>{
        fs.writeFileSync(join(dir,"source.xbrl"),"<broken>");expect(runLocalBalanceSheetImport({...options,dryRun:true}).plan.counts.new).toBe(1);
        expect(()=>runLocalBalanceSheetImport({...options,create:true})).toThrow(/XML/);
        const reader=new BalanceSheetSqliteStore(options.db,{readOnly:true});try{expect(reader.inventory().entries).toHaveLength(0);}finally{reader.close();}
    }));
    it.each(["manifest","source","db","count"])("%sの小規模上限で元ファイルを変えない",kind=>fixture((dir,options,entries)=>{
        let target=options.manifest,size=LOCAL_IMPORT_LIMITS.manifestBytes+1;
        if(kind==="source"){target=join(dir,"source.xbrl");size=LOCAL_IMPORT_LIMITS.sourceBytes+1;}
        if(kind==="db"){target=options.db;size=LOCAL_IMPORT_LIMITS.dbBytes+1;}
        if(kind==="count")fs.writeFileSync(options.manifest,JSON.stringify(Array.from({length:101},(_,i)=>({...entries[0],secCode:String(1000+i),docID:`SYNTHETIC${i}`}))));
        else{const fd=fs.openSync(target,"w");fs.ftruncateSync(fd,size);fs.closeSync(fd);}
        const originalSize=fs.statSync(target).size;expect(()=>runLocalBalanceSheetImport({...options,dryRun:true})).toThrow();expect(fs.statSync(target).size).toBe(originalSize);
    }));
    it("原本合計byte上限を越えるとDBを作らない",()=>fixture((dir,options,entries)=>{
        const list=Array.from({length:5},(_,i)=>({...entries[0],file:`large-${i}.xbrl`,secCode:String(1000+i),docID:`SYNTHETIC${i}`}));
        list.forEach((entry,i)=>{const fd=fs.openSync(join(dir,entry.file),"w");fs.ftruncateSync(fd,i===4?1:LOCAL_IMPORT_LIMITS.sourceBytes);fs.closeSync(fd);});
        fs.writeFileSync(options.manifest,JSON.stringify(list));expect(()=>runLocalBalanceSheetImport({...options,create:true})).toThrow(/byte上限/);expect(fs.existsSync(options.db)).toBe(false);
    }));
    it("ソースcommitと対応表版を指定でき、unknown flagと必須flag不足を拒否",()=>fixture((_dir,options)=>{
        const result=launch(options,["--dry-run","--mapping-version","test-map","--source-commit","b".repeat(40)]);expect(result.status,result.stderr).toBe(0);
        expect(JSON.parse(result.stdout).plan.items[0].provenance).toMatchObject({mappingVersion:"test-map",sourceCommit:"b".repeat(40)});
        expect(launch(options,["--unknown"]).status).toBe(1);
        const missing=spawnSync(process.execPath,["--import",loader,cli,"import-bs","--manifest",options.manifest,"--db",options.db],{encoding:"utf8"});expect(missing.status).toBe(1);
    }));
});
