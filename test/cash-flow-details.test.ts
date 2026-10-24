import {describe,it,expect} from "vitest";
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {FinancialDetailMetricId as M,FINANCIAL_DETAIL_REGISTRY as R,DEFAULT_FINANCIAL_DETAIL_METRICS,
 createFinancialDetailSnapshot as snapshot,screenFinancialDetailDocuments as screen,type FinancialDetailMetadata} from "../src/index";
import {instance,context,fact,standalone} from "./fixtures/metric-boundaries";
const cf=[M.DepreciationOperatingCashFlow,M.PropertyPlantEquipmentPurchaseCashFlow,M.PropertyPlantEquipmentAndIntangiblesPurchaseCashFlow];
const meta=(code="1001"):FinancialDetailMetadata=>({secCode:code,docID:`SYNTHETIC${code}`,scope:"Consolidated",accountingStandard:"J-GAAP",currency:"JPY",period:{startDate:"2024-04-01",endDate:"2025-03-31"},periodType:"annual"});
const f=(id:typeof cf[number],value="-120",attrs="")=>fact(value,attrs,R[id].candidates[0].key);
const xml=(value="-120")=>instance(cf.map(id=>f(id,value)).join("")+fact("30","","jppfs_cor:CostOfSales")+fact("40","","jppfs_cor:SellingGeneralAndAdministrativeExpenses"));
const doc=(code:string,value:string)=>({xml:xml(value),metadata:meta(code)});
describe("CF直接3項目は明示選択のみ",()=>{
 it.each(cf)("%sの符号・出典・期間を保持",id=>{
  const value=snapshot(xml(),meta(),[id]).selections[id]!;
  expect(value).toMatchObject({status:"selected",raw:"-120",safeNumber:-120,source:{key:R[id].candidates[0].key,unit:"iso4217:JPY",period:meta().period}});
 });
 it("既定5項目/期間別2項目を増やさない",()=>{
  expect(DEFAULT_FINANCIAL_DETAIL_METRICS).toHaveLength(5);expect(Object.isFrozen(DEFAULT_FINANCIAL_DETAIL_METRICS)).toBe(true);
  expect(Object.keys(snapshot(xml(),meta()).selections)).toEqual([M.CostOfSales,M.SellingGeneralAndAdministrativeExpenses]);
  expect(screen([doc("1001","-120")]).rows).toHaveLength(1);
  expect(Object.keys(screen([doc("1001","-120")]).rows[0].selections)).toHaveLength(2);
 });
 it("設備単独と無形資産合計を別々に返し代用/合算しない",()=>{
  const input=instance(f(cf[1],"-20")+f(cf[2],"-30"));
  expect(snapshot(input,meta(),cf).selections[cf[1]]?.raw).toBe("-20");expect(snapshot(input,meta(),cf).selections[cf[2]]?.raw).toBe("-30");
  expect(snapshot(instance(f(cf[1])),meta(),[cf[2]]).selections[cf[2]]?.status).toBe("missing");
  expect(snapshot(instance(f(cf[2])),meta(),[cf[1]]).selections[cf[1]]?.status).toBe("missing");
 });
 it("販管費や減価償却累計額でCF調整額を代用しない",()=>{
  const input=instance(fact("20","","jppfs_cor:DepreciationSGA")+fact("30","","jppfs_cor:AccumulatedDepreciation"));
  expect(snapshot(input,meta(),[cf[0]]).selections[cf[0]]?.status).toBe("missing");
 });
 it.each(["0","-0","1.25","9007199254740993"])("raw%sを保持",raw=>{
  const value=snapshot(instance(f(cf[0],raw)),meta(),[cf[0]]).selections[cf[0]]!;
  expect(value.status).toBe("selected");expect(value.raw).toBe(raw);expect(value.safeNumber).toBe(raw==="9007199254740993"?undefined:Number(raw));
 });
 it.each(cf)("%sのnil/重複を0や先頭にしない",id=>{
  expect(snapshot(instance(f(id,"",'xsi:nil="true"')),meta(),[id]).selections[id]?.status).toBe("missing");
  expect(snapshot(instance(f(id)+f(id)),meta(),[id]).selections[id]?.status).toBe("ambiguous");
 });
 it("通貨/namespace/次元/期間の不一致を拒否採用",()=>{
  const inputs=[xml().replace("iso4217:JPY","iso4217:USD"),xml().replace("http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor","https://example.test/fake"),instance(f(cf[0]),context("current",standalone)),instance(f(cf[0]),context("current","",{startDate:"2023-04-01",endDate:"2024-03-31"}))];
  for(const input of inputs)expect(snapshot(input,meta(),[cf[0]]).selections[cf[0]]?.status).not.toBe("selected");
 });
 it.each([[],[cf[0],cf[0]],["__proto__"],[undefined],new Array(1),[M.CashAndDeposits,cf[0]]].map(ids=>({ids})))("不正projection$idsを拒否",({ids})=>{
  expect(()=>snapshot(xml(),meta(),ids as any)).toThrow();expect(()=>screen([], {metricIds:ids as any})).toThrow();
 });
 it("CF条件とsortは明示projection内を要求",()=>{
  expect(()=>screen([doc("1001","-10")],{sortBy:cf[0]})).toThrow();
  expect(()=>screen([doc("1001","-10")],{metricIds:[cf[0]],sortBy:cf[1]})).toThrow();
  expect(()=>screen([doc("1001","-10")],{conditions:[{metric:cf[0],operator:"gte",value:0}]})).toThrow();
 });
 it("明示期間型とデータを一致させる",()=>expect(()=>snapshot(xml(),{...meta(),period:{instant:"2025-03-31"},periodType:undefined} as any,cf)).toThrow());
 it.each(["gte","lte","gt","lt","eq"] as const)("%sと両順・ページを直接値で比較",operator=>{
  const docs=[doc("1001","-20"),doc("1002","0"),doc("1003","10")],cmp=(n:number)=>operator==="gte"?n>=0:operator==="lte"?n<=0:operator==="gt"?n>0:operator==="lt"?n<0:n===0;
  for(const order of ["asc","desc"] as const){const all=screen(docs,{metricIds:cf,conditions:[{metric:cf[0],operator,value:0}],sortBy:cf[0],order});
   const expected=docs.filter(d=>cmp(Number(snapshot(d.xml,d.metadata,cf).selections[cf[0]]!.raw))).map(d=>`${d.metadata.secCode}0`);if(order==="desc")expected.reverse();
   expect(all.rows.map(r=>r.metadata.secCode)).toEqual(expected);expect(all.total).toBe(expected.length);
   expect(screen(docs,{metricIds:cf,conditions:[{metric:cf[0],operator,value:0}],sortBy:cf[0],order,offset:1,limit:1}).rows).toEqual(all.rows.slice(1,2));}
 });
 it("未使用欠損は除外せず必要欠損/巨大整数は除外し診断",()=>{
  const docs=[{xml:instance(f(cf[0],"0")),metadata:meta("1001")},{xml:instance(f(cf[0],"9007199254740993")),metadata:meta("1002")},{xml:instance(),metadata:meta("1003")}];
  const result=screen(docs,{metricIds:cf,sortBy:cf[0]});expect(result.total).toBe(1);expect(result.excludedRows).toBe(2);expect(result.reasonCounts).toEqual({missing:7,unsupported:0,ambiguous:0,"unsafe-number":1});
  expect(result.diagnostics.every(d=>cf.includes(d.metric))).toBe(true);expect(result.diagnostics.filter(d=>d.required)).toHaveLength(2);
 });
 it("CLI --metrics、相対原本、終了コード、原本不変",()=>{
  const dir=mkdtempSync(join(tmpdir(),"edinet-cf-"));try{const source=xml();writeFileSync(join(dir,"source.xbrl"),source);writeFileSync(join(dir,"files.json"),JSON.stringify([{file:"source.xbrl",metadata:meta()}]));
   const args=["--import",resolve("node_modules/tsx/dist/loader.mjs"),resolve("src/cli.ts"),"screen-details","--manifest",join(dir,"files.json")];
   const run=(more:string[])=>spawnSync(process.execPath,[...args,...more],{cwd:"/tmp",encoding:"utf8"});
   const result=run(["--metrics",cf.join(","),"--sort-by",cf[0]]);expect(result.status,result.stderr).toBe(0);expect(Object.keys(JSON.parse(result.stdout).rows[0].selections)).toEqual(cf);
   expect(run(["--sort-by",cf[0]]).status).toBe(1);expect(run(["--metrics",""]).status).toBe(1);expect(run(["--metrics",`${cf[0]},${cf[0]}`]).status).toBe(1);expect(readFileSync(join(dir,"source.xbrl"),"utf8")).toBe(source);
  }finally{rmSync(dir,{recursive:true,force:true});}
 });
});
