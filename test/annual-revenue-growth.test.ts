import { describe,it,expect } from "vitest";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";import {join,resolve} from "node:path";import {spawnSync} from "node:child_process";
import {calculateAnnualRevenueGrowth,screenAnnualRevenueGrowth,type AnnualRevenueDocument,type AnnualRevenuePair} from "../src/index";
import {instance,fact,standalone} from "./fixtures/metric-boundaries";
function document(value:string,start="2024-04-01",end="2025-03-31",code="1001",opts:{nil?:boolean;absent?:boolean;entity?:string;scope?:"Consolidated"|"NonConsolidated";unit?:string;extra?:string}={}):AnnualRevenueDocument{
 const scope=opts.scope??"Consolidated",context=`<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${opts.entity??code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period>${scope==="NonConsolidated"?`<xbrli:scenario>${standalone}</xbrli:scenario>`:""}</xbrli:context>`;
 const xml=instance((opts.absent?"":fact(opts.nil?"":value,opts.nil?'xsi:nil="true"':"","jppfs_cor:NetSales"))+(opts.extra??""),context,`<xbrli:unit id="money"><xbrli:measure>${opts.unit??"iso4217:JPY"}</xbrli:measure></xbrli:unit>`);
 return {xml,metadata:{secCode:code,docID:`SYNTHETIC${code}-${end}`,scope,accountingStandard:"J-GAAP",currency:"JPY",periodType:"annual",period:{startDate:start,endDate:end}}};
}
const pair=(previous="100",current="120",code="1001"):AnnualRevenuePair=>({previous:document(previous,"2023-04-01","2024-03-31",code),current:document(current,"2024-04-01","2025-03-31",code)});

describe("連続12暦月の売上高前年比",()=>{
 it.each([
  {a:"100",b:"120",n:"1",d:"5",v:0.2},{a:"0.2",b:"0.3",n:"1",d:"2",v:0.5},
  {a:"120",b:"100",n:"-1",d:"6",v:-1/6},{a:"100",b:"0",n:"-1",d:"1",v:-1},
  {a:"100",b:"-20",n:"-6",d:"5",v:-1.2},{a:"100",b:"100",n:"0",d:"1",v:0},
 ])("$a→$bを差額先行丸めなしに計算",({a,b,n,d,v})=>{
  const result=calculateAnnualRevenueGrowth(pair(a,b));expect(result).toMatchObject({status:"calculated",unit:"ratio",value:v,exact:{numerator:n,denominator:d}});
  expect(result.previous.selection.raw).toBe(a);expect(result.current.selection.raw).toBe(b);expect(result.previous.selection.source?.period).toEqual({startDate:"2023-04-01",endDate:"2024-03-31"});expect(result.previous.inputXmlSha256).toMatch(/^[a-f0-9]{64}$/);expect(result.previous).not.toHaveProperty("xml");
 });
 it.each(["0","-0","-100","9007199254740993"])("前年%sを0/負数/unsafe理由に分ける",value=>{
  const result=calculateAnnualRevenueGrowth(pair(value,"120"));expect(result).toMatchObject({status:"unavailable",reason:value==="-100"?"negative-base":value==="9007199254740993"?"unsafe-input":"zero-base"});expect(result.value).toBeUndefined();
 });
 it("当年unsafeと結果overflowを理由付き不可",()=>{
  expect(calculateAnnualRevenueGrowth(pair("100","9007199254740993")).reason).toBe("unsafe-input");
  expect(calculateAnnualRevenueGrowth(pair("0.0000000000000001","9007199254740991")).reason).toBe("unsafe-result");
 });
 it.each(["nil","absent","ambiguous","USD"])("%sは元選択の理由を保持し計算しない",kind=>{
  const input=pair();input.previous=document("100","2023-04-01","2024-03-31","1001",{nil:kind==="nil",absent:kind==="absent",unit:kind==="USD"?"iso4217:USD":undefined,extra:kind==="ambiguous"?fact("100","","jppfs_cor:NetSales"):undefined});
  const result=calculateAnnualRevenueGrowth(input);expect(result.reason).toBe("unavailable-input");expect(result.previous.selection.status).toBe(kind==="ambiguous"?"ambiguous":kind==="USD"?"unsupported":"missing");
 });
 it("同じ原本/書類IDの前年列と当期列は正常、単体も明示可能",()=>{
  const a=document("100","2023-04-01","2024-03-31","1001",{scope:"NonConsolidated"}),b=document("120","2024-04-01","2025-03-31","1001",{scope:"NonConsolidated"});b.metadata.docID=a.metadata.docID;
  expect(calculateAnnualRevenueGrowth({previous:a,current:b}).status).toBe("calculated");
 });
 it.each([
  ["2022-01-01","2022-12-31","2023-01-01","2023-12-31"],
  ["2023-03-01","2024-02-29","2024-03-01","2025-02-28"],
  ["2024-03-01","2025-02-28","2025-03-01","2026-02-28"],
 ])("月初/月末の12暦月と閏年を扱う",(a,b,c,d)=>{
  expect(calculateAnnualRevenueGrowth({previous:document("100",a,b),current:document("120",c,d)}).status).toBe("calculated");
 });
 it.each(["annual-short","not-month-start","week-year","gap","reverse","overlap","ytd","quarterly","entity","scope","company","standard"])("%sを推測して合わせない",kind=>{
  const p:any=pair();
  if(kind==="annual-short")p.previous=document("100","2023-10-01","2024-03-31");
  if(kind==="not-month-start")p.previous=document("100","2023-04-02","2024-04-01");
  if(kind==="week-year")p.previous=document("100","2023-04-03","2024-03-31");
  if(kind==="gap")p.current=document("120","2025-04-01","2026-03-31");
  if(kind==="reverse"){const tmp=p.current;p.current=p.previous;p.previous=tmp;}
  if(kind==="overlap")p.current=document("120","2024-01-01","2024-12-31");
  if(kind==="ytd"||kind==="quarterly")p.previous.metadata.periodType=kind;
  if(kind==="entity")p.current=document("120","2024-04-01","2025-03-31","1001",{entity:"B"});
  if(kind==="scope")p.current=document("120","2024-04-01","2025-03-31","1001",{scope:"NonConsolidated"});
  if(kind==="company")p.current=document("120","2024-04-01","2025-03-31","1002");
  if(kind==="standard")p.current.metadata.accountingStandard="IFRS";
  const got=calculateAnnualRevenueGrowth(p);expect(got.status).toBe("unavailable");
  expect(got.reason).toBe(["annual-short","not-month-start","week-year"].includes(kind)?"unsupported-annual-period":["gap","reverse","overlap"].includes(kind)?"non-consecutive-periods":["ytd","quarterly"].includes(kind)?"not-annual":kind==="entity"?"incompatible-entity":kind==="standard"?"unsupported-standard":"incompatible-metadata");
 });
 it("不正日付・通貨・XML・未知メタデータを設定エラーにする",()=>{
  for(const kind of ["date","currency","xml","extra"]){const p:any=pair();if(kind==="date")p.current.metadata.period.endDate="2025-02-30";if(kind==="currency")p.current.metadata.currency="USD";if(kind==="xml")p.current.xml="<broken>";if(kind==="extra")p.current.metadata.extra=1;expect(()=>calculateAnnualRevenueGrowth(p)).toThrow();}
 });
});

describe("複数社の前年比の厳密条件/順序",()=>{
 const data=()=>[pair("100","120","1001"),pair("100","150","1002"),pair("100","80","1003"),pair("0","100","1004")];
 it.each([{operator:"gte",codes:["10020","10010"]},{operator:"gt",codes:["10020"]},{operator:"lte",codes:["10010","10030"]},{operator:"lt",codes:["10030"]},{operator:"eq",codes:["10010"]}] as const)("$operator 0.2で比較",({operator,codes})=>{
  const result=screenAnnualRevenueGrowth(data(),{conditions:[{metric:"netSalesGrowth",operator,value:0.2}]});expect(result.rows.map(r=>r.current.metadata.secCode)).toEqual(codes);expect(result.excludedRows).toBe(1);expect(result.reasonCounts["zero-base"]).toBe(1);
 });
 it("両順・ページ・AND・同値tie・0件page",()=>{
  const result=screenAnnualRevenueGrowth(data(),{conditions:[{metric:"netSalesGrowth",operator:"gte",value:-0.2},{metric:"netSalesGrowth",operator:"lte",value:0.5}],order:"asc",offset:1,limit:1});expect(result.total).toBe(3);expect(result.rows[0].current.metadata.secCode).toBe("10010");
  expect(screenAnnualRevenueGrowth(data(),{limit:0}).rows).toEqual([]);expect(screenAnnualRevenueGrowth([pair("100","120","1002"),pair("100","120","1001")]).rows.map(r=>r.current.metadata.secCode)).toEqual(["10010","10020"]);
 });
 it("同じ表示numberでも違う分数の順序とeq閾値を保持",()=>{
  const tiny="0."+"0".repeat(323)+"5";
  const input=[pair("9007199254740991","0","1001"),pair("9007199254740991",tiny,"1002")];
  const sorted=screenAnnualRevenueGrowth(input);expect(sorted.rows[0].value).toBe(-1);expect(sorted.rows[1].value).toBe(-1);expect(sorted.rows.map(r=>r.current.metadata.secCode)).toEqual(["10020","10010"]);
  expect(screenAnnualRevenueGrowth(input,{conditions:[{metric:"netSalesGrowth",operator:"eq",value:-1}]}).rows.map(r=>r.current.metadata.secCode)).toEqual(["10010"]);
 });
 it("先行検査のmetadataを後続XML getterで変更させない",()=>{
  const a:any=pair("100","120","1001"),b:any=pair("100","150","1002");const original=a.previous.xml;
  Object.defineProperty(a.previous,"xml",{get(){b.current.metadata.period.startDate="2024-05-01";return original;},enumerable:true});
  const result=screenAnnualRevenueGrowth([a,b]);expect(result.rows).toHaveLength(2);expect(result.rows[0].current.metadata.period.startDate).toBe("2024-04-01");
 });
 it.each(["start","classification","scope","standard","company-duplicate","doc-duplicate"])("%sの混在/重複を条件で隠さない",kind=>{
  const a:any=pair("0","120","1001"),b:any=pair("100","150","1002");
  if(kind==="start")b.previous.metadata.period.startDate="2023-05-01";
  if(kind==="classification")b.previous.metadata.periodType="ytd";
  if(kind==="scope")b.current.metadata.scope="NonConsolidated";
  if(kind==="standard")b.current.metadata.accountingStandard="IFRS";
  if(kind==="company-duplicate")b.current.metadata.secCode="10010";
  if(kind==="doc-duplicate")b.current.metadata.docID=a.current.metadata.docID;
  expect(()=>screenAnnualRevenueGrowth([a,b],{conditions:[{metric:"netSalesGrowth",operator:"gt",value:999}]})).toThrow();
 });
 it("不正条件/ページ/空集合を扱う",()=>{
  expect(screenAnnualRevenueGrowth([])).toMatchObject({rows:[],total:0,excludedRows:0});
  for(const options of [{conditions:[{metric:"other",operator:"eq",value:0}]},{conditions:[{metric:"netSalesGrowth",operator:"eq",value:NaN}]},{offset:-1},{order:"wrong"}])expect(()=>screenAnnualRevenueGrowth(data(),options as any)).toThrow();
 });
});

it("screen-sales-growth CLIの明示pair/相対原本/JSON/原本保護",()=>{
 const dir=mkdtempSync(join(tmpdir(),"sales-growth-cli-"));try{
  const p=pair();writeFileSync(join(dir,"prior.xbrl"),p.previous.xml);writeFileSync(join(dir,"current.xbrl"),p.current.xml);writeFileSync(join(dir,"files.json"),JSON.stringify([{previous:{file:"prior.xbrl",metadata:p.previous.metadata},current:{file:"current.xbrl",metadata:p.current.metadata}}]));
  const args=["--import",resolve("node_modules/tsx/dist/loader.mjs"),resolve("src/cli.ts"),"screen-sales-growth","--manifest",join(dir,"files.json")];
  const result=spawnSync(process.execPath,args,{cwd:"/tmp",encoding:"utf8"});expect(result.error).toBeUndefined();expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).rows[0].exact).toEqual({numerator:"1",denominator:"5"});expect(readFileSync(join(dir,"prior.xbrl"),"utf8")).toBe(p.previous.xml);
  expect(spawnSync(process.execPath,[...args,"--conditions",'[{"metric":"wrong","operator":"eq","value":0}]'],{cwd:"/tmp",encoding:"utf8"}).status).toBe(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
