import{describe,it,expect}from"vitest";
import{mkdtempSync,writeFileSync,readFileSync,rmSync}from"node:fs";
import{tmpdir}from"node:os";
import{join,resolve}from"node:path";
import{spawnSync}from"node:child_process";
import{createFinancialDetailSnapshot,FinancialDetailMetricId}from"../src/index";
import{instance,fact}from"./fixtures/metric-boundaries";
const meta={secCode:"1001",docID:"SYNTHETIC1",scope:"Consolidated" as const,accountingStandard:"J-GAAP" as const,currency:"JPY" as const,period:{instant:"2025-03-31"}};
const ctx='<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period></xbrli:context>';
const xml=instance(fact("120","","jppfs_cor:NoncurrentAssets")+fact("30","","jppfs_cor:NoncurrentLiabilities")+fact("-0","","jppfs_cor:CashAndDeposits"),ctx);
function fixture(action:(dir:string,run:(args?:string[])=>ReturnType<typeof spawnSync>)=>void){const dir=mkdtempSync(join(tmpdir(),"detail-json-"));try{writeFileSync(join(dir,"rows.json"),JSON.stringify([createFinancialDetailSnapshot(xml,meta)]));const run=(args:string[]=[])=>spawnSync(process.execPath,["--import",resolve("node_modules/tsx/dist/loader.mjs"),resolve("src/cli.ts"),"screen-details-json","--file",join(dir,"rows.json"),...args],{cwd:"/tmp",encoding:"utf8"});action(dir,run);}finally{rmSync(dir,{recursive:true,force:true});}}
describe("screen-details-json CLI",()=>{
 it("JSON往復の原値と出典を検索し入力を変えない",()=>fixture((dir,run)=>{const before=readFileSync(join(dir,"rows.json"));const result=run(["--sort-by","cashAndDeposits","--conditions",JSON.stringify([{metric:"cashAndDeposits",operator:"eq",value:0}])]);expect(result.status,String(result.stderr)).toBe(0);const json=JSON.parse(String(result.stdout));expect(json.total).toBe(1);expect(json.rows[0].selections.cashAndDeposits.raw).toBe("-0");expect(json.rows[0].selections.cashAndDeposits.source.key).toBe("jppfs_cor:CashAndDeposits");expect(readFileSync(join(dir,"rows.json"))).toEqual(before);}));
 it("記録済みsubsetを明示し、未記録をタグ不在と推測しない",()=>fixture((dir,run)=>{writeFileSync(join(dir,"rows.json"),JSON.stringify([createFinancialDetailSnapshot(xml,meta,[FinancialDetailMetricId.CashAndDeposits])]));expect(run().status).toBe(1);const result=run(["--metrics","cashAndDeposits"]);expect(result.status,String(result.stderr)).toBe(0);expect(JSON.parse(String(result.stdout)).total).toBe(1);}));
 it("偽数値・不正設定・JSON/UTF8・件数超過を終了1にする",()=>fixture((dir,run)=>{const row=createFinancialDetailSnapshot(xml,meta);row.selections.cashAndDeposits!.safeNumber=999;writeFileSync(join(dir,"rows.json"),JSON.stringify([row]));expect(run().status).toBe(1);writeFileSync(join(dir,"rows.json"),JSON.stringify([]));expect(run(["--metrics",""]).status).toBe(1);expect(run(["--offset","-1"]).status).toBe(1);writeFileSync(join(dir,"rows.json"),"{}");expect(run().status).toBe(1);writeFileSync(join(dir,"rows.json"),JSON.stringify(Array(101).fill({})));const limit=run();expect(limit.status).toBe(1);expect(String(limit.stderr)).toContain("100");writeFileSync(join(dir,"rows.json"),Buffer.from([0xff]));expect(run().status).toBe(1);}));
});
