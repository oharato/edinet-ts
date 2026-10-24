import { describe,it,expect } from "vitest";
import { mkdtempSync,writeFileSync,readFileSync,rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join,resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { EdinetXbrlParser,FinancialDetailMetricId,FINANCIAL_DETAIL_REGISTRY,createFinancialDetailSnapshot,screenFinancialDetailDocuments,
    type FinancialDetailDocument,type FinancialDetailMetadata } from "../src/index";
import { instance,fact,standalone } from "./fixtures/metric-boundaries";
const idList=Object.values(FinancialDetailMetricId);
const metadata=(kind:"instant"|"duration"="instant",code="1001"):FinancialDetailMetadata=>({secCode:code,docID:`SYNTHETIC${code}`,scope:"Consolidated",accountingStandard:"J-GAAP",currency:"JPY",
    ...(kind==="instant"?{period:{instant:"2025-03-31"}}:{period:{startDate:"2024-04-01",endDate:"2025-03-31"},periodType:"annual"})});
function xml(value="120",opts:{absent?:string[];nil?:string;unit?:string;entity?:string;scope?:string;extra?:string;namespace?:string;durationOnly?:boolean;instantOnly?:boolean}={}){
    const entity=opts.entity??"A";
    const c=(id:string,period:string)=>`<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">${entity}</xbrli:identifier></xbrli:entity><xbrli:period>${period}</xbrli:period>${opts.scope==="NonConsolidated"?`<xbrli:scenario>${standalone}</xbrli:scenario>`:""}</xbrli:context>`;
    const contexts=c("instant",'<xbrli:instant>2025-03-31</xbrli:instant>')+c("duration",'<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>');
    const facts=idList.filter(id=>!opts.absent?.includes(id)).map(id=>{const def=FINANCIAL_DETAIL_REGISTRY[id],context=opts.durationOnly?"duration":opts.instantOnly?"instant":def.periodType;
        return fact(opts.nil===id?"":value,opts.nil===id?'xsi:nil="true"':"",def.candidates[0].key,context);}).join("");
    let out=instance(facts+(opts.extra??""),contexts,`<xbrli:unit id="money"><xbrli:measure>${opts.unit??"iso4217:JPY"}</xbrli:measure></xbrli:unit>`);
    if(opts.namespace)out=out.replace('http://disclosure.edinet-fsa.go.jp/taxonomy/jppfs/2024-11-01/jppfs_cor',opts.namespace);
    return out;
}
const doc=(code:string,value:string,kind:"instant"|"duration"="instant"):FinancialDetailDocument=>({xml:xml(value),metadata:metadata(kind,code)});

describe("JGAAP直接財務5項目",()=>{
    it.each(idList)("%sを正しい期間・元タグ・原値で選択",id=>{
        const definition=FINANCIAL_DETAIL_REGISTRY[id],meta=metadata(definition.periodType);
        const object=new EdinetXbrlParser().parse(xml(),meta.docID),selected=object.selectFinancialDetail(id,{scope:meta.scope,accountingStandard:meta.accountingStandard,period:meta.period});
        expect(selected).toMatchObject({status:"selected",raw:"120",safeNumber:120,source:{key:definition.candidates[0].key,unit:"iso4217:JPY",scope:"Consolidated",period:meta.period}});
        expect(Object.isFrozen(definition)).toBe(true);expect(Object.isFrozen(definition.candidates)).toBe(true);
    });
    it("現預金を現金同等物・固定資産を総資産や繰延資産で代用しない",()=>{
        const input=xml("120",{absent:["cashAndDeposits","noncurrentAssets"],extra:fact("70","","jppfs_cor:CashAndCashEquivalents","instant")+fact("500","","jppfs_cor:Assets","instant")+fact("5","","jppfs_cor:DeferredAssets","instant")});
        const result=createFinancialDetailSnapshot(input,metadata());expect(result.selections.cashAndDeposits?.status).toBe("missing");expect(result.selections.noncurrentAssets?.status).toBe("missing");
    });
    it("売上原価/販管費を業種固有の部門費用や営業費用で合算補完しない",()=>{
        const input=xml("120",{absent:["costOfSales","sellingGeneralAndAdministrativeExpenses"],extra:fact("30","","jppfs_cor:OperatingExpenses","duration")+fact("20","","jppfs_cor:CostOfSalesOfCompletedConstructionContracts","duration")});
        const result=createFinancialDetailSnapshot(input,metadata("duration"));expect(result.selections.costOfSales?.status).toBe("missing");expect(result.selections.sellingGeneralAndAdministrativeExpenses?.status).toBe("missing");
    });
    it.each(["0","-10","9007199254740993"])("raw%sと安全数値の有無を保持",value=>{
        const result=createFinancialDetailSnapshot(xml(value),metadata()).selections.cashAndDeposits!;expect(result.raw).toBe(value);expect(result.status).toBe("selected");expect(result.safeNumber).toBe(value==="9007199254740993"?undefined:Number(value));
    });
    it("nilを0にしない、対象periodの科目だけ返す",()=>{
        const result=createFinancialDetailSnapshot(xml("0",{nil:"cashAndDeposits"}),metadata());expect(result.selections.cashAndDeposits).toMatchObject({status:"missing",reason:"nil"});
        expect(Object.keys(result.selections)).toHaveLength(3);expect(result.selections.costOfSales).toBeUndefined();expect(Object.keys(createFinancialDetailSnapshot(xml(),metadata("duration")).selections)).toHaveLength(2);
    });
    it.each(["IFRS","US-GAAP"] as const)("%sでjppfs単体を自動採用しない",standard=>{
        const result=createFinancialDetailSnapshot(xml(),{...metadata(),accountingStandard:standard});expect(result.selections.cashAndDeposits).toMatchObject({status:"unsupported",reason:"unsupported-standard"});
    });
    it.each(["iso4217:USD","xbrli:shares"])("単位%sを推測変換しない",unit=>{
        expect(createFinancialDetailSnapshot(xml("120",{unit}),metadata()).selections.cashAndDeposits).toMatchObject({status:"unsupported",reason:"unsupported-unit"});
    });
    it("未知namespace、同値重複、明細次元を混ぜない",()=>{
        expect(createFinancialDetailSnapshot(xml("120",{namespace:"https://example.test/fake"}),metadata()).selections.cashAndDeposits?.status).toBe("unsupported");
        expect(createFinancialDetailSnapshot(xml("120",{extra:fact("120","","jppfs_cor:CashAndDeposits","instant")}),metadata()).selections.cashAndDeposits).toMatchObject({status:"ambiguous",reason:"multiple-facts"});
        const segment=xml().replace('<xbrli:context id="instant">','<xbrli:context id="instant">').replace('<xbrli:instant>2025-03-31</xbrli:instant></xbrli:period>','<xbrli:instant>2025-03-31</xbrli:instant></xbrli:period><xbrli:scenario><xbrldi:explicitMember dimension="extension:RegionAxis">extension:RegionMember</xbrldi:explicitMember></xbrli:scenario>');
        expect(createFinancialDetailSnapshot(segment,metadata()).selections.cashAndDeposits?.status).not.toBe("selected");
    });
    it("連結→単体、当期→前期、instant→durationへのfallbackなし",()=>{
        expect(createFinancialDetailSnapshot(xml("120",{scope:"NonConsolidated"}),metadata()).selections.cashAndDeposits?.status).toBe("missing");
        expect(createFinancialDetailSnapshot(xml(),{...metadata(),period:{instant:"2024-03-31"}}).selections.cashAndDeposits?.status).toBe("missing");
        expect(createFinancialDetailSnapshot(xml("120",{durationOnly:true}),metadata()).selections.cashAndDeposits?.status).toBe("missing");
        expect(createFinancialDetailSnapshot(xml("120",{instantOnly:true}),metadata("duration")).selections.costOfSales?.status).toBe("missing");
    });
    it("不正XML/不正日付/分類不足/未知IDを拒否",()=>{
        expect(()=>createFinancialDetailSnapshot("<broken>",metadata())).toThrow();expect(()=>createFinancialDetailSnapshot(xml(),{...metadata(),period:{instant:"2025-02-30"}})).toThrow();
        const duration:any=metadata("duration");delete duration.periodType;expect(()=>createFinancialDetailSnapshot(xml(),duration)).toThrow();
        const object=new EdinetXbrlParser().parse(xml());expect(()=>object.selectFinancialDetail("__proto__" as any,{scope:"Consolidated",accountingStandard:"J-GAAP",period:{instant:"2025-03-31"}})).toThrow();
    });
});

describe("財務明細の同一範囲・複数社検索",()=>{
    const operators=[{operator:"gte",codes:["10020","10030"]},{operator:"gt",codes:["10030"]},{operator:"lte",codes:["10010","10020"]},{operator:"lt",codes:["10010"]},{operator:"eq",codes:["10020"]}] as const;
    it.each(idList.flatMap(id=>operators.map(op=>({id,...op}))))("$id $operatorで絞り込む",({id,operator,codes})=>{
        const kind=FINANCIAL_DETAIL_REGISTRY[id].periodType;const result=screenFinancialDetailDocuments([doc("1003","200",kind),doc("1001","50",kind),doc("1002","100",kind)],{conditions:[{metric:id,operator,value:100}]});
        expect(result.rows.map(r=>r.metadata.secCode)).toEqual(codes);expect(result.total+result.filteredRows).toBe(3);
    });
    it.each(idList.flatMap(id=>["asc","desc"].map(order=>({id,order:order as "asc"|"desc"}))))("$id $orderの並びとページ",({id,order})=>{
        const kind=FINANCIAL_DETAIL_REGISTRY[id].periodType,result=screenFinancialDetailDocuments([doc("1003","200",kind),doc("1001","50",kind),doc("1002","100",kind)],{sortBy:id,order,offset:0,limit:2});
        expect(result.rows.map(r=>r.metadata.secCode)).toEqual(order==="asc"?["10010","10020"]:["10030","10020"]);expect(result.total).toBe(3);
    });
    it("未使用欠損は除外しない、unsafeとrequired欠損の理由と件数を返す",()=>{
        const data=[{xml:xml("100",{absent:["noncurrentLiabilities"]}),metadata:metadata()},doc("1002","9007199254740993"),{xml:xml("100",{nil:"cashAndDeposits"}),metadata:metadata("instant","1003")}];
        const result=screenFinancialDetailDocuments(data,{sortBy:"cashAndDeposits"});expect(result.rows.map(r=>r.metadata.secCode)).toEqual(["10010"]);expect(result.excludedRows).toBe(2);expect(result.diagnostics).toContainEqual(expect.objectContaining({secCode:"10010",metric:"noncurrentLiabilities",required:false}));expect(result.reasonCounts["unsafe-number"]).toBe(3);
    });
    it("AND・負数・0・同値順序・空ページを保持",()=>{
        const data=[doc("1002","0"),doc("1001","0"),doc("1003","-1")];
        const result=screenFinancialDetailDocuments(data,{conditions:[{metric:"cashAndDeposits",operator:"gte",value:0},{metric:"noncurrentAssets",operator:"eq",value:0}],sortBy:"cashAndDeposits"});
        expect(result.rows.map(r=>r.metadata.secCode)).toEqual(["10010","10020"]);expect(result.filteredRows).toBe(1);expect(screenFinancialDetailDocuments(data,{limit:0}).rows).toEqual([]);
    });
    it.each(["start","scope","standard","periodType","company","doc","period","currency"])("%s混在/重複は条件で隠さず拒否",kind=>{
        const data:any=[doc("1001","50","duration"),doc("1002","100","duration")];
        if(kind==="start")data[1].metadata.period.startDate="2024-05-01";
        if(kind==="scope")data[1].metadata.scope="NonConsolidated";
        if(kind==="standard")data[1].metadata.accountingStandard="IFRS";
        if(kind==="periodType")data[1].metadata.periodType="ytd";
        if(kind==="company")data[1].metadata.secCode="10010";
        if(kind==="doc")data[1].metadata.docID=data[0].metadata.docID;
        if(kind==="period")data[1].metadata.period={instant:"2025-03-31"};
        if(kind==="currency")data[1].metadata.currency="USD";
        expect(()=>screenFinancialDetailDocuments(data,{conditions:[{metric:"costOfSales",operator:"gt",value:999}]})).toThrow();
    });
    it("対象と異なる期間型の条件/未知項目/不正値を拒否",()=>{
        expect(()=>screenFinancialDetailDocuments([doc("1001","50")],{sortBy:"costOfSales"})).toThrow();
        for(const options of [{sortBy:"constructor"},{conditions:[{metric:"cashAndDeposits",operator:"gte",value:"50"}]},{offset:-1},{limit:Infinity},{unknown:1}])expect(()=>screenFinancialDetailDocuments([doc("1001","50")],options as any)).toThrow();
    });
});

it("screen-details CLIが相対原本を読みJSON/終了コードを返し原本を変更しない",()=>{
    const dir=mkdtempSync(join(tmpdir(),"financial-details-cli-"));try{
        const source=xml(),manifest=join(dir,"files.json");writeFileSync(join(dir,"source.xbrl"),source);writeFileSync(manifest,JSON.stringify([{file:"source.xbrl",metadata:metadata()}]));
        const args=["--import",resolve("node_modules/tsx/dist/loader.mjs"),resolve("src/cli.ts"),"screen-details","--manifest",manifest];
        const result=spawnSync(process.execPath,[...args,"--sort-by","cashAndDeposits"],{cwd:"/tmp",encoding:"utf8"});expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout).rows[0].selections.cashAndDeposits.raw).toBe("120");
        expect(spawnSync(process.execPath,[...args,"--sort-by","costOfSales"],{cwd:"/tmp",encoding:"utf8"}).status).toBe(1);expect(readFileSync(join(dir,"source.xbrl"),"utf8")).toBe(source);
    }finally{rmSync(dir,{recursive:true,force:true});}
});
