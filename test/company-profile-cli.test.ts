import {describe,it,expect} from "vitest";
import {mkdtempSync,writeFileSync,readFileSync,rmSync,symlinkSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {instance} from "./fixtures/metric-boundaries";
const ctx='<xbrli:context id="filing"><xbrli:entity><xbrli:identifier scheme="synthetic">A</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:instant>2025-06-20</xbrli:instant></xbrli:period></xbrli:context>';
const fields={FilerNameInJapaneseDEI:"合成会社",EDINETCodeDEI:"E00001",SecurityCodeDEI:"123A0",AccountingStandardsDEI:"Japan GAAP",CurrentFiscalYearStartDateDEI:"2024-04-01",CurrentFiscalYearEndDateDEI:"2025-03-31"};
const xml=instance(Object.entries(fields).map(([key,raw])=>`<jpdei_cor:${key} contextRef="filing">${raw}</jpdei_cor:${key}>`).join(""),ctx,"").replace('<xbrli:xbrl ','<xbrli:xbrl xmlns:jpdei_cor="http://disclosure.edinet-fsa.go.jp/taxonomy/jpdei/2013-08-31/jpdei_cor" ');
function fixture(action:(dir:string,run:(args?:string[])=>ReturnType<typeof spawnSync>)=>void){const dir=mkdtempSync(join(tmpdir(),"company-profile-"));try{writeFileSync(join(dir,"source.xbrl"),xml);const run=(args=["--file",join(dir,"source.xbrl"),"--doc-id","SYNTHETIC1"])=>spawnSync(process.execPath,["--import",resolve("node_modules/tsx/dist/loader.mjs"),resolve("src/cli.ts"),"company-profile",...args],{cwd:"/tmp",encoding:"utf8"});action(dir,run);}finally{rmSync(dir,{recursive:true,force:true});}}
describe("company-profile CLI",()=>{
 it("明示原本のみを読みJSONと入力hashを返し原本を変えない",()=>fixture((dir,run)=>{const result=run();expect(result.status,String(result.stderr)).toBe(0);const profile=JSON.parse(String(result.stdout));expect(profile.docID).toBe("SYNTHETIC1");expect(profile.sourceXmlHash).toBe(createHash("sha256").update(xml).digest("hex"));expect(profile.consistency.status).toBe("consistent");expect(readFileSync(join(dir,"source.xbrl"),"utf8")).toBe(xml);}));
 it("BOM付きUTF-8も指紋計算からBOMを落とさない",()=>fixture((dir,run)=>{const bytes=Buffer.concat([Buffer.from([0xef,0xbb,0xbf]),Buffer.from(xml)]);writeFileSync(join(dir,"source.xbrl"),bytes);const result=run();expect(result.status,String(result.stderr)).toBe(0);expect(JSON.parse(String(result.stdout)).sourceXmlHash).toBe(createHash("sha256").update(bytes).digest("hex"));expect(readFileSync(join(dir,"source.xbrl"))).toEqual(bytes);}));
 it("入力不足・不正XML・不正書類ID・directoryを拒否し通常fileへのlinkは読める",()=>fixture((dir,run)=>{expect(run([]).status).toBe(1);expect(run(["--file",join(dir,"source.xbrl"),"--doc-id",""]).status).toBe(1);writeFileSync(join(dir,"broken.xbrl"),"<broken>");expect(run(["--file",join(dir,"broken.xbrl"),"--doc-id","SYNTHETIC1"]).status).toBe(1);symlinkSync(join(dir,"source.xbrl"),join(dir,"link.xbrl"));expect(run(["--file",join(dir,"link.xbrl"),"--doc-id","SYNTHETIC1"]).status).toBe(0);expect(run(["--file",dir,"--doc-id","SYNTHETIC1"]).status).toBe(1);}));
});
