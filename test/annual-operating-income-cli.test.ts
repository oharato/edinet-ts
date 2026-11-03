import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { instance, fact } from "./fixtures/metric-boundaries";
function fixture(action:(dir:string,run:(args?:string[],command?:string)=>ReturnType<typeof spawnSync>,rows:any[])=>void){
 const dir=mkdtempSync(join(tmpdir(),"operating-growth-cli-"));try{
  const rows=[{code:"1001",prior:"100",now:"120"},{code:"1002",prior:"200",now:"220"}].map(({code,prior,now})=>{
   const point=(year:number,value:string)=>{const period={startDate:`${year-1}-04-01`,endDate:`${year}-03-31`};const xml=instance(fact(value,"","jppfs_cor:OperatingIncome")+fact(value,"","jppfs_cor:NetSales"),`<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${period.startDate}</xbrli:startDate><xbrli:endDate>${period.endDate}</xbrli:endDate></xbrli:period></xbrli:context>`);const file=`${code}-${year}.xbrl`;writeFileSync(join(dir,file),xml);return{file,metadata:{secCode:code,docID:`SYNTHETIC-${code}-${year}`,scope:"Consolidated",accountingStandard:"J-GAAP",currency:"JPY",periodType:"annual",period}};};return{previous:point(2024,prior),current:point(2025,now)};
  });writeFileSync(join(dir,"pairs.json"),JSON.stringify(rows));
  const run=(args:string[]=[],command="screen-operating-income-growth")=>{
   const result=spawnSync(process.execPath,["--import",resolve("node_modules/tsx/dist/loader.mjs"),resolve("src/cli.ts"),command,"--manifest",join(dir,"pairs.json"),...args],{cwd:"/tmp",encoding:"utf8"});
   expect(result.error).toBeUndefined();
   return result;
  };action(dir,run,rows);
 }finally{rmSync(dir,{recursive:true,force:true});}
}
describe("営業利益前年比CLI",()=>{
 it("合成2社を率の条件で絞り込み、元fileを変更しない",()=>fixture((dir,run,rows)=>{
  const file=join(dir,rows[0].current.file),before=readFileSync(file);const r=run(["--conditions",JSON.stringify([{metric:"operatingIncomeGrowth",operator:"gte",value:0.2}]),"--pretty"]);
  expect(r.status,String(r.stderr)).toBe(0);const out=JSON.parse(String(r.stdout));expect(out.total).toBe(1);expect(out.rows[0].metricId).toBe("operatingIncomeGrowth");expect(out.rows[0].current.metadata.secCode).toBe("10010");expect(out.rows[0].exact).toEqual({numerator:"1",denominator:"5"});expect(readFileSync(file)).toEqual(before);
 }));
 it("順序・ページと既存売上CLIの互換を保つ",()=>fixture((_dir,run)=>{
  const r=run(["--order","asc","--offset","1","--limit","1"]);expect(r.status,String(r.stderr)).toBe(0);const out=JSON.parse(String(r.stdout));expect(out.total).toBe(2);expect(out.rows).toHaveLength(1);expect(out.rows[0].current.metadata.secCode).toBe("10010");
  const sales=run(["--conditions",JSON.stringify([{metric:"netSalesGrowth",operator:"eq",value:0.2}])],"screen-sales-growth");expect(sales.status,String(sales.stderr)).toBe(0);const old=JSON.parse(String(sales.stdout));expect(old.rows[0].metricId).toBe("netSalesGrowth");expect(old.total).toBe(1);
 }));
 it("欠損や前期0を率0に置かず理由で除外する",()=>fixture((dir,run,rows)=>{
  const prior=join(dir,rows[0].previous.file);writeFileSync(prior,readFileSync(prior,"utf8").replace(/>100</g,">0<"));const current=join(dir,rows[1].current.file);writeFileSync(current,readFileSync(current,"utf8").replace(/<jppfs_cor:OperatingIncome[^>]*>[^<]*<\/jppfs_cor:OperatingIncome>/g,""));
  const r=run();expect(r.status,String(r.stderr)).toBe(0);const out=JSON.parse(String(r.stdout));expect(out.total).toBe(0);expect(out.excludedRows).toBe(2);expect(out.reasonCounts["zero-base"]).toBe(1);expect(out.reasonCounts["unavailable-input"]).toBe(1);
 }));
 it.each([
  ["--conditions",JSON.stringify([{metric:"netSalesGrowth",operator:"gte",value:0}])],
  ["--offset","-1"],
  ["--order","unknown"],
 ])("不正設定 %s %s を終了1にする",(...args)=>fixture((_dir,run)=>{
  expect(run(args).status).toBe(1);
 }));
 it("件数/UTF8境界を終了1にする",()=>fixture((dir,run,rows)=>{
  writeFileSync(join(dir,"pairs.json"),JSON.stringify(Array(101).fill(rows[0])));const oversized=run();expect(oversized.status).toBe(1);expect(String(oversized.stderr)).toContain("100");writeFileSync(join(dir,"pairs.json"),Buffer.from([0xff]));expect(run().status).toBe(1);
 }));
});
