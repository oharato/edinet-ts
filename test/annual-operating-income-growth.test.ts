import { describe,it,expect } from "vitest";
import { createHash } from "node:crypto";
import {calculateAnnualOperatingIncomeGrowth,screenAnnualOperatingIncomeGrowth,type AnnualOperatingIncomeDocument,type AnnualOperatingIncomePair} from "../src/index";
import { calculateAnnualRevenueGrowth, screenAnnualRevenueGrowth } from "../src/index";
import {instance,fact,standalone} from "./fixtures/metric-boundaries";
function document(value:string,start="2024-04-01",end="2025-03-31",code="1001",opts:{nil?:boolean;absent?:boolean;entity?:string;scope?:"Consolidated"|"NonConsolidated";unit?:string;extra?:string}={}):AnnualOperatingIncomeDocument{
 const scope=opts.scope??"Consolidated",context=`<xbrli:context id="current"><xbrli:entity><xbrli:identifier scheme="synthetic">${opts.entity??code}</xbrli:identifier></xbrli:entity><xbrli:period><xbrli:startDate>${start}</xbrli:startDate><xbrli:endDate>${end}</xbrli:endDate></xbrli:period>${scope==="NonConsolidated"?`<xbrli:scenario>${standalone}</xbrli:scenario>`:""}</xbrli:context>`;
 const xml=instance((opts.absent?"":fact(opts.nil?"":value,opts.nil?'xsi:nil="true"':"","jppfs_cor:OperatingIncome"))+(opts.extra??""),context,`<xbrli:unit id="money"><xbrli:measure>${opts.unit??"iso4217:JPY"}</xbrli:measure></xbrli:unit>`);
 return {xml,metadata:{secCode:code,docID:`SYNTHETIC${code}-${end}`,scope,accountingStandard:"J-GAAP",currency:"JPY",periodType:"annual",period:{startDate:start,endDate:end}}};
}
const pair=(previous="100",current="120",code="1001"):AnnualOperatingIncomePair=>({previous:document(previous,"2023-04-01","2024-03-31",code),current:document(current,"2024-04-01","2025-03-31",code)});

describe("連続12暦月の営業利益前年比",()=>{
 it.each([
  {a:"100",b:"120",n:"1",d:"5",v:0.2},{a:"0.2",b:"0.3",n:"1",d:"2",v:0.5},
  {a:"120",b:"100",n:"-1",d:"6",v:-1/6},{a:"100",b:"0",n:"-1",d:"1",v:-1},
  {a:"100",b:"-20",n:"-6",d:"5",v:-1.2},{a:"100",b:"100",n:"0",d:"1",v:0},
 ])("$a→$bを差額先行丸めなしに計算",({a,b,n,d,v})=>{
  const result=calculateAnnualOperatingIncomeGrowth(pair(a,b));expect(result).toMatchObject({status:"calculated",unit:"ratio",value:v,exact:{numerator:n,denominator:d}});
  expect(result.previous.selection.raw).toBe(a);expect(result.current.selection.raw).toBe(b);expect(result.previous.selection.source?.period).toEqual({startDate:"2023-04-01",endDate:"2024-03-31"});expect(result.previous.inputXmlSha256).toMatch(/^[a-f0-9]{64}$/);expect(result.previous).not.toHaveProperty("xml");
 });
 it.each(["0","-0","-100","9007199254740993"])("前年%sを0/負数/unsafe理由に分ける",value=>{
  const result=calculateAnnualOperatingIncomeGrowth(pair(value,"120"));expect(result).toMatchObject({status:"unavailable",reason:value==="-100"?"negative-base":value==="9007199254740993"?"unsafe-input":"zero-base"});expect(result.value).toBeUndefined();
 });
 it("当年unsafeと結果overflowを理由付き不可",()=>{
  expect(calculateAnnualOperatingIncomeGrowth(pair("100","9007199254740993")).reason).toBe("unsafe-input");
  expect(calculateAnnualOperatingIncomeGrowth(pair("0.0000000000000001","9007199254740991")).reason).toBe("unsafe-result");
 });
 it.each(["nil","absent","ambiguous","USD"])("%sは元選択の理由を保持し計算しない",kind=>{
  const input=pair();input.previous=document("100","2023-04-01","2024-03-31","1001",{nil:kind==="nil",absent:kind==="absent",unit:kind==="USD"?"iso4217:USD":undefined,extra:kind==="ambiguous"?fact("100","","jppfs_cor:OperatingIncome"):undefined});
  const result=calculateAnnualOperatingIncomeGrowth(input);expect(result.reason).toBe("unavailable-input");expect(result.previous.selection.status).toBe(kind==="ambiguous"?"ambiguous":kind==="USD"?"unsupported":"missing");
 });
 it("同じ原本/書類IDの前年列と当期列は正常、単体も明示可能",()=>{
  const a=document("100","2023-04-01","2024-03-31","1001",{scope:"NonConsolidated"}),b=document("120","2024-04-01","2025-03-31","1001",{scope:"NonConsolidated"});b.metadata.docID=a.metadata.docID;
  expect(calculateAnnualOperatingIncomeGrowth({previous:a,current:b}).status).toBe("calculated");
 });
 it.each([
  ["2022-01-01","2022-12-31","2023-01-01","2023-12-31"],
  ["2023-03-01","2024-02-29","2024-03-01","2025-02-28"],
  ["2024-03-01","2025-02-28","2025-03-01","2026-02-28"],
 ])("月初/月末の12暦月と閏年を扱う",(a,b,c,d)=>{
  expect(calculateAnnualOperatingIncomeGrowth({previous:document("100",a,b),current:document("120",c,d)}).status).toBe("calculated");
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
  const got=calculateAnnualOperatingIncomeGrowth(p);expect(got.status).toBe("unavailable");
  expect(got.reason).toBe(["annual-short","not-month-start","week-year"].includes(kind)?"unsupported-annual-period":["gap","reverse","overlap"].includes(kind)?"non-consecutive-periods":["ytd","quarterly"].includes(kind)?"not-annual":kind==="entity"?"incompatible-entity":kind==="standard"?"unsupported-standard":"incompatible-metadata");
 });
 it("不正日付・通貨・XML・未知メタデータを設定エラーにする",()=>{
  for(const kind of ["date","currency","xml","extra"]){const p:any=pair();if(kind==="date")p.current.metadata.period.endDate="2025-02-30";if(kind==="currency")p.current.metadata.currency="USD";if(kind==="xml")p.current.xml="<broken>";if(kind==="extra")p.current.metadata.extra=1;expect(()=>calculateAnnualOperatingIncomeGrowth(p)).toThrow();}
 });
});

describe("複数社の前年比の厳密条件/順序",()=>{
 const data=()=>[pair("100","120","1001"),pair("100","150","1002"),pair("100","80","1003"),pair("0","100","1004")];
 it.each([{operator:"gte",codes:["10020","10010"]},{operator:"gt",codes:["10020"]},{operator:"lte",codes:["10010","10030"]},{operator:"lt",codes:["10030"]},{operator:"eq",codes:["10010"]}] as const)("$operator 0.2で比較",({operator,codes})=>{
  const result=screenAnnualOperatingIncomeGrowth(data(),{conditions:[{metric:"operatingIncomeGrowth",operator,value:0.2}]});expect(result.rows.map(r=>r.current.metadata.secCode)).toEqual(codes);expect(result.excludedRows).toBe(1);expect(result.reasonCounts["zero-base"]).toBe(1);
 });
 it("両順・ページ・AND・同値tie・0件page",()=>{
  const result=screenAnnualOperatingIncomeGrowth(data(),{conditions:[{metric:"operatingIncomeGrowth",operator:"gte",value:-0.2},{metric:"operatingIncomeGrowth",operator:"lte",value:0.5}],order:"asc",offset:1,limit:1});expect(result.total).toBe(3);expect(result.rows[0].current.metadata.secCode).toBe("10010");
  expect(screenAnnualOperatingIncomeGrowth(data(),{limit:0}).rows).toEqual([]);expect(screenAnnualOperatingIncomeGrowth([pair("100","120","1002"),pair("100","120","1001")]).rows.map(r=>r.current.metadata.secCode)).toEqual(["10010","10020"]);
 });
 it("同じ表示numberでも違う分数の順序とeq閾値を保持",()=>{
  const tiny="0."+"0".repeat(323)+"5";
  const input=[pair("9007199254740991","0","1001"),pair("9007199254740991",tiny,"1002")];
  const sorted=screenAnnualOperatingIncomeGrowth(input);expect(sorted.rows[0].value).toBe(-1);expect(sorted.rows[1].value).toBe(-1);expect(sorted.rows.map(r=>r.current.metadata.secCode)).toEqual(["10020","10010"]);
  expect(screenAnnualOperatingIncomeGrowth(input,{conditions:[{metric:"operatingIncomeGrowth",operator:"eq",value:-1}]}).rows.map(r=>r.current.metadata.secCode)).toEqual(["10010"]);
 });
 it("先行検査のmetadataを後続XML getterで変更させない",()=>{
  const a:any=pair("100","120","1001"),b:any=pair("100","150","1002");const original=a.previous.xml;
  Object.defineProperty(a.previous,"xml",{get(){b.current.metadata.period.startDate="2024-05-01";return original;},enumerable:true});
  const result=screenAnnualOperatingIncomeGrowth([a,b]);expect(result.rows).toHaveLength(2);expect(result.rows[0].current.metadata.period.startDate).toBe("2024-04-01");
 });
 it.each(["start","classification","scope","standard","company-duplicate","doc-duplicate"])("%sの混在/重複を条件で隠さない",kind=>{
  const a:any=pair("0","120","1001"),b:any=pair("100","150","1002");
  if(kind==="start")b.previous.metadata.period.startDate="2023-05-01";
  if(kind==="classification")b.previous.metadata.periodType="ytd";
  if(kind==="scope")b.current.metadata.scope="NonConsolidated";
  if(kind==="standard")b.current.metadata.accountingStandard="IFRS";
  if(kind==="company-duplicate")b.current.metadata.secCode="10010";
  if(kind==="doc-duplicate")b.current.metadata.docID=a.current.metadata.docID;
  expect(()=>screenAnnualOperatingIncomeGrowth([a,b],{conditions:[{metric:"operatingIncomeGrowth",operator:"gt",value:999}]})).toThrow();
 });
 it("不正条件/ページ/空集合を扱う",()=>{
  expect(screenAnnualOperatingIncomeGrowth([])).toMatchObject({rows:[],total:0,excludedRows:0});
  for(const options of [{conditions:[{metric:"other",operator:"eq",value:0}]},{conditions:[{metric:"operatingIncomeGrowth",operator:"eq",value:NaN}]},{offset:-1},{order:"wrong"}])expect(()=>screenAnnualOperatingIncomeGrowth(data(),options as any)).toThrow();
 });
});


describe("原本とmetadataを一度だけ取得する",()=>{
 it("options/条件のgetterを一度だけ読み固定した条件・順序・ページで検索する",()=>{
  const reads:Record<string,number>={},condition:any={},options:any={};
  const once=(object:any,key:string,first:any,later:any)=>Object.defineProperty(object,key,{enumerable:true,get(){reads[key]=(reads[key]??0)+1;return reads[key]===1?first:later;}});
  once(condition,"metric","operatingIncomeGrowth","other");once(condition,"operator","gte","lt");once(condition,"value",0,999);
  once(options,"conditions",[condition],[]);once(options,"order","asc","desc");once(options,"offset",0,99);once(options,"limit",1,0);
  const result=screenAnnualOperatingIncomeGrowth([pair("100","150","1002"),pair("100","120","1001"),pair("100","80","1003")],options);
  expect(result.total).toBe(2);expect(result.filteredRows).toBe(1);expect(result.rows.map(r=>r.current.metadata.secCode)).toEqual(["10010"]);
  expect(Object.values(reads).every(n=>n===1)).toBe(true);
 });
 it("原本getterが利用者の条件を書き換えても検査済みの条件を維持",()=>{
  const p=pair(),original=p.previous.xml,condition={metric:"operatingIncomeGrowth" as const,operator:"gte" as const,value:0};
  Object.defineProperty(p.previous,"xml",{enumerable:true,get(){condition.value=999;return original;}});
  expect(screenAnnualOperatingIncomeGrowth([p],{conditions:[condition]}).total).toBe(1);
 });
 it.each(["calculate","screen","sales-calculate","sales-screen"])("%sでXML getterの1回目を解析とhashへ共用",kind=>{
  const p=pair();if(kind.startsWith("sales-")){p.previous.xml=p.previous.xml.replaceAll("OperatingIncome","NetSales");p.current.xml=p.current.xml.replaceAll("OperatingIncome","NetSales");}
  const original=p.previous.xml;let reads=0;
  Object.defineProperty(p.previous,"xml",{enumerable:true,get(){reads++;return reads===1?original:original.replace(">100<",">999<");}});
  const result=kind==="calculate"?calculateAnnualOperatingIncomeGrowth(p):kind==="screen"?screenAnnualOperatingIncomeGrowth([p]).rows[0]:kind==="sales-calculate"?calculateAnnualRevenueGrowth(p):screenAnnualRevenueGrowth([p]).rows[0];
  expect(reads).toBe(1);expect(result.previous.selection.raw).toBe("100");expect(result.previous.inputXmlSha256).toBe(createHash("sha256").update(original).digest("hex"));
 });
 it("pair/document/metadata/periodのgetterを再評価しない",()=>{
  const p=pair(),a=p.previous,b=p.current,meta=a.metadata,period=meta.period;const count:Record<string,number>={};
  const once=(object:any,key:string,value:any,second:any)=>Object.defineProperty(object,key,{enumerable:true,get(){count[key]=(count[key]??0)+1;return count[key]===1?value:second;}});
  once(period,"startDate","2023-04-01","2023-05-01");once(meta,"period",period,{startDate:"2022-04-01",endDate:"2023-03-31"});
  once(meta,"secCode","1001","9999");once(a,"metadata",meta,b.metadata);
  const dynamic:any={};once(dynamic,"previous",a,b);once(dynamic,"current",b,a);
  const result=screenAnnualOperatingIncomeGrowth([dynamic]);expect(result.rows).toHaveLength(1);expect(Object.values(count).every(n=>n===1)).toBe(true);
  expect(result.rows[0].previous.metadata.period.startDate).toBe("2023-04-01");expect(result.rows[0].previous.metadata.secCode).toBe("10010");
 });
 it("現在-0を0として計算し原値は保持する",()=>{
  const result=calculateAnnualOperatingIncomeGrowth(pair("100","-0"));expect(result).toMatchObject({status:"calculated",value:-1,exact:{numerator:"-1",denominator:"1"}});expect(result.current.selection.raw).toBe("-0");
 });
 it("企業拡張・同名偽namespace・売上や経常利益を直接営業利益の代用にしない",()=>{
  for(const kind of ["extension","namespace","other-tag"]){const p=pair();
   if(kind==="extension")p.previous.xml=p.previous.xml.replaceAll("jppfs_cor:OperatingIncome","extension:OperatingIncome");
   if(kind==="namespace")p.previous.xml=p.previous.xml.replace("http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor","urn:fake");
   if(kind==="other-tag")p.previous.xml=p.previous.xml.replaceAll("jppfs_cor:OperatingIncome","jppfs_cor:OrdinaryIncome");
   const result=calculateAnnualOperatingIncomeGrowth(p);expect(result).toMatchObject({status:"unavailable",reason:"unavailable-input"});expect(result.previous.selection.status).not.toBe("selected");
  }
 });
});
