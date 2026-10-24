import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { verifyOfflineFinancialFlow } from "../scripts/verify-offline-financial-flow";
import { instance, fact } from "./fixtures/metric-boundaries";
function fixture(run:(dir:string,paths:any,data:any)=>void, missing=false) {
    const dir=fs.mkdtempSync(join(tmpdir(),"offline-flow-input-"));
    const paths={config:join(dir,"config.json"),manifest:join(dir,"manifest.json"),expectations:join(dir,"expected.json"),queries:join(dir,"queries.json")};
    const manifest:any[]=[],expectations:any[]=[],queries:any[]=[];
    for(const code of ["1001","1002"]){
        const contexts=["2025-03-31","2026-03-31"].map((instant,i)=>`<xbrli:context id="p${i}"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>${instant}</xbrli:instant></xbrli:period></xbrli:context>`).join("");
        let facts="";
        for(const [i,instant] of ["2025-03-31","2026-03-31"].entries()){
            const unavailable=missing&&code==="1002"&&i===1;
            const values=code==="1001"?(i===0?["90","30","60"]:["120","40","80"]):(i===0?["100","50","90"]:["200","100","160"]);
            if(!unavailable)for(const [j,key] of ["jppfs_cor:CurrentAssets","jppfs_cor:CurrentLiabilities","jppfs_cor:Liabilities"].entries())facts+=fact(values[j],"",key,`p${i}`);
            const metadata={secCode:code,docID:`SYNTHETIC${code}`,instant,scope:"Consolidated",accountingStandard:"J-GAAP",currency:"JPY"};
            manifest.push({file:`${code}.xbrl`,...metadata});
            expectations.push({metadata,metrics:Object.fromEntries(["currentAssets","currentLiabilities","totalLiabilities"].map((id,j)=>[id,unavailable?{status:"missing",reason:"context-mismatch"}:{status:"selected",raw:values[j]}])),
                currentRatio:unavailable?{status:"unavailable",reason:"missing-input"}:{status:"calculated",exact:{denominator:"1",numerator:code==="1001"?"3":"2"}},
                expectedDiff:unavailable?"incomparable":"unchanged",origin:{column:"synthetic"}});
        }
        fs.writeFileSync(join(dir,`${code}.xbrl`),instance(facts,contexts)+"<!-- PRIVATE_ORIGINAL_MARKER -->");
    }
    for(const instant of ["2025-03-31","2026-03-31"]){
        const cohort={instant,scope:"Consolidated",accountingStandard:"J-GAAP",currency:"JPY"};
        const both=missing&&instant==="2026-03-31"?["10010"]:["10010","10020"];
        queries.push({cohort,options:{sortBy:"currentAssets",order:"asc"},expectedCodes:both});
        queries.push({cohort,options:{sortBy:"currentRatio",order:"desc"},expectedCodes:both});
        queries.push({cohort,options:{conditions:[{metric:"currentRatio",operator:"gte",value:3}]},expectedCodes:["10010"]});
    }
    const config={manifest:"manifest.json",expectations:"expected.json",queries:"queries.json"};
    const data={manifest,expectations,queries,config};
    const save=()=>{for(const [key,value] of Object.entries(data))fs.writeFileSync(paths[key],JSON.stringify(value));};save();
    try{run(dir,paths,{...data,save});}finally{fs.rmSync(dir,{recursive:true,force:true});}
}
const hashes=(dir:string)=>Object.fromEntries(fs.readdirSync(dir).sort().map(name=>[name,createHash("sha256").update(fs.readFileSync(join(dir,name))).digest("hex")]));
const runner=resolve("scripts/verify-offline-financial-flow.ts"),loader=resolve("node_modules/tsx/dist/loader.mjs");
const launch=(path:string)=>spawnSync(process.execPath,["--import",loader,runner,"--config",path,"--source-cli"],{cwd:"/tmp",encoding:"utf8",timeout:120000});

describe("明示入力だけのオフライン財務end-to-end検証",()=>{
    it("2社2時点でimport→再open検索→同コード版変更→diff、再実行安全性と元入力不変",()=>fixture((dir,paths)=>{
        const before=hashes(dir),result=verifyOfflineFinancialFlow(paths.config,{sourceCli:true});
        expect(result).toMatchObject({passed:true,snapshots:4,companies:2,instants:2,queriesPerOpen:6,queryChecks:18,cliChecks:9,
            selectionCounts:{selected:12,missing:0,unsupported:0,ambiguous:0},ratioCounts:{calculated:4},comparedDiffs:4,incomparableDiffs:0,sameParserReparse:true,performanceMeasured:false,cliMode:"source"});
        expect(result.declaredCoverage).toEqual({columns:{current:0,prior:0,synthetic:4,unknown:0},filingYears:[],externalReferencesVerified:false});
        expect(hashes(dir)).toEqual(before);
    }));
    it("欠損行を0扱いせず、検索除外・diff比較不可を明示集計する",()=>fixture((_dir,paths)=>{
        const result=verifyOfflineFinancialFlow(paths.config,{sourceCli:true});expect(result).toMatchObject({passed:true,selectionCounts:{selected:9,missing:3},ratioCounts:{calculated:3,"missing-input":1},comparedDiffs:3,incomparableDiffs:1});
    },true));
    it("公開runnerの失敗stdout/stderrへ原本・実値・期待値を漏らさない",()=>fixture((dir,paths,data)=>{
        data.expectations[0].metrics.currentAssets.raw="987654321098765";data.save();const before=hashes(dir),result=launch(paths.config);
        expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr).toContain("金額は出力しません");
        for(const secret of ["987654321098765","PRIVATE_ORIGINAL_MARKER",'<xbrli:', '"raw"'])expect(result.stdout+result.stderr).not.toContain(secret);expect(hashes(dir)).toEqual(before);
    }));
    it("不可能理由の違う期待値を検索除外だけで成功にしない",()=>fixture((_dir,paths,data)=>{
        data.expectations.find((entry:any)=>entry.currentRatio.status==="unavailable").currentRatio.reason="zero-denominator";data.save();
        expect(()=>verifyOfflineFinancialFlow(paths.config,{sourceCli:true})).toThrow(/比率除外/);
    },true));
    it.each(["metadata-mismatch","duplicate-expectation","unknown-code","duplicate-query-code","missing-origin","extra-db","bad-metric","missing-file"])("%sの不正入力は成功にしない",kind=>fixture((dir,paths,data)=>{
        if(kind==="metadata-mismatch")data.expectations[0].metadata.docID="DIFFERENT";
        if(kind==="duplicate-expectation")data.expectations[1]=structuredClone(data.expectations[0]);
        if(kind==="unknown-code")data.queries[0].expectedCodes=["99990"];
        if(kind==="duplicate-query-code")data.queries[0].expectedCodes=["10010","10010"];
        if(kind==="missing-origin")delete data.expectations[0].origin;
        if(kind==="extra-db")data.config.db=join(dir,"do-not-create.sqlite");
        if(kind==="bad-metric")data.queries[0].options.sortBy="PRIVATE_ORIGINAL_MARKER";
        if(kind==="missing-file")data.manifest[0].file="missing.xbrl";
        data.save();const before=hashes(dir);expect(()=>verifyOfflineFinancialFlow(paths.config,{sourceCli:true})).toThrow();expect(hashes(dir)).toEqual(before);
    }));
    it("期待コード不一致はメモリとの自己一致だけで成功にしない",()=>fixture((_dir,paths,data)=>{
        data.queries[0].expectedCodes=["10020","10010"];data.save();expect(()=>verifyOfflineFinancialFlow(paths.config,{sourceCli:true})).toThrow(/明示期待値/);
    }));
    it("JSON破損を値や原文を出さず報告",()=>fixture((_dir,paths)=>{
        fs.writeFileSync(paths.expectations,'{"SECRET_EXPECTATION_MARKER":');const result=launch(paths.config);
        expect(result.status).toBe(1);expect(result.stdout).toBe("");expect(result.stderr).not.toContain("SECRET_EXPECTATION_MARKER");
    }));
});
