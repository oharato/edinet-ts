import{describe,it,expect}from"vitest";
import{mkdtempSync,writeFileSync,readFileSync,rmSync}from"node:fs";
import{tmpdir}from"node:os";
import{join,resolve}from"node:path";
import{spawnSync}from"node:child_process";
import{instance,fact,standalone}from"./fixtures/metric-boundaries";
const ctx=`<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-03-31</xbrli:instant></xbrli:period><xbrli:scenario>${standalone}</xbrli:scenario></xbrli:context>`;
const xml=instance(fact("1200000","","jpcrp_cor:AverageAnnualSalaryInformationAboutReportingCompanyInformationAboutEmployees"),ctx);
const metadata={secCode:"1001",docID:"SYNTHETIC1",scope:"NonConsolidated",accountingStandard:"J-GAAP",currency:"JPY",period:{instant:"2025-03-31"}};
function fixture(action:(dir:string,run:(args?:string[])=>ReturnType<typeof spawnSync>)=>void){const dir=mkdtempSync(join(tmpdir(),"workforce-cli-"));try{writeFileSync(join(dir,"source.xbrl"),xml);writeFileSync(join(dir,"files.json"),JSON.stringify([{file:"source.xbrl",metadata}]));const run=(args:string[]=[])=>spawnSync(process.execPath,["--import",resolve("node_modules/tsx/dist/loader.mjs"),resolve("src/cli.ts"),"screen-workforce","--manifest",join(dir,"files.json"),...args],{cwd:"/tmp",encoding:"utf8"});action(dir,run);}finally{rmSync(dir,{recursive:true,force:true});}}
describe("screen-workforce CLI",()=>{
 it("相対原本を読み給与の条件と順序とページをJSONで返す",()=>fixture((dir,run)=>{const result=run(["--conditions",JSON.stringify([{metric:"averageAnnualSalary",operator:"gte",value:1200000}]),"--sort-by","averageAnnualSalary","--order","asc","--limit","1"]);expect(result.status,String(result.stderr)).toBe(0);const json=JSON.parse(String(result.stdout));expect(json.total).toBe(1);expect(json.rows[0].selections.averageAnnualSalary.raw).toBe("1200000");expect(readFileSync(join(dir,"source.xbrl"),"utf8")).toBe(xml);expect(run(["--offset","1"]).status).toBe(0);}));
 it("連結を単体へ切り替えず除外理由を返す",()=>fixture((dir,run)=>{writeFileSync(join(dir,"files.json"),JSON.stringify([{file:"source.xbrl",metadata:{...metadata,scope:"Consolidated"}}]));const result=run();expect(result.status,String(result.stderr)).toBe(0);const json=JSON.parse(String(result.stdout));expect(json.total).toBe(0);expect(json.excludedRows).toBe(1);expect(json.diagnostics[0].selectionReason).toBe("unsupported-semantics");}));
 it("不正条件・ID・ページ・UTF8を終了1にする",()=>fixture((dir,run)=>{expect(run(["--conditions","{}"]).status).toBe(1);expect(run(["--sort-by","netSales"]).status).toBe(1);expect(run(["--offset","-1"]).status).toBe(1);writeFileSync(join(dir,"source.xbrl"),Buffer.from([0xff]));expect(run().status).toBe(1);}));
});
