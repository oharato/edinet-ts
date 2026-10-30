import { describe, expect, it } from "vitest";
import { extractFacilityDetails, screenFacilityDetails, DisclosureTableKind, FacilityField as F, type FacilityDetailDocument, type FacilityTableDeclaration } from "../src/index";
import { facilityDocument as document, facilityTable as table } from "./fixtures/facility-details";
const ns = "http://disclosure.edinet-fsa.go.jp/taxonomy/jpcrp/2025-11-01/jpcrp_cor";
const changeDeclaration = (changes: Partial<FacilityTableDeclaration>) => { const d = document(); return { ...d, declarations: [{ ...d.declarations[0], ...changes }] }; };
describe("原表の単位と対象組織を確認した設備明細", () => {
    it.each([9, 11, 12] as const)("確認済み%s列表の直接値と行/セル参照を保持する", kind => {
        const r = extractFacilityDetails(document("A",table(kind)));
        expect(r.rows).toHaveLength(1);
        expect(r.rows[0]).toMatchObject({ tableIndex: 0, rowIndex: 3, asOfDate: "2026-03-31", organization: "reporting-company", rights: "unconfirmed", propertyIdentity: "not-established", organizationVerification: "declared-source-reference-matched",
            values: { totalBookValueJPY: { status: "numeric", raw: "3,300", decimal: "3300000000", unit: "JPY", multiplier: 1000000, safeNumber: 3300000000 },
                buildingsBookValueJPY: { decimal: "1234500000.0" }, landBookValueJPY: { decimal: "2000000000" }, landAreaM2: { decimal: "100.25", unit: "m2", multiplier: 1 } } });
        expect(r.source.source.period!.instant).toBe("2026-06-24");
        expect(r.rows[0].rowKey).toMatch(/^[a-f0-9]{64}$/);
        expect(r.rows[0].companyLabel?.raw).toBe(kind === 12 ? "架空子会社" : undefined);
        expect(r.rows[0].values.totalBookValueJPY).not.toHaveProperty("sumOfComponents");
    });
    it.each(["0", "0.0000001", "9,007,199,254,740,993"])("金額%sの換算を浮動小数の積にしない", raw => {
        const r = extractFacilityDetails(document("A",table(9,["本店","通信",raw,"9","1","2","－",raw,"1"])));
        const v = r.rows[0].values.totalBookValueJPY;
        expect(v.status).toBe("numeric");
        if(v.status==='numeric') expect(v.decimal).toBe(raw==='0'?'0':raw==='0.0000001'?'0.1000000':'9007199254740993000000');
    });
    it.each(["－", "", "100（20）", "100\n200", "1,00", "1e3", "△1", "-1", "１２３"])("非数値%sを0や部分値で補わない", raw => {
        const r = extractFacilityDetails(document("A",table(9,["本店","通信","1","9",raw,"2","－",raw,"1"])));
        expect(r.rows[0].values.totalBookValueJPY).toMatchObject({ status: "unavailable", raw });
        expect(r.rows[0].values.landAreaM2).toMatchObject({ status: "unavailable", raw });
    });
    it("未知見出しや通貨を推測で対応表へ入れない", () => {
        for (const raw of [table().replaceAll('百万円','千円'),table().replace('事業所名','物件'),table().replaceAll('百万円','百万ドル'),table(11).replace('建物及び構築物','建物及び構築物(千円)'),table(11).replace('機械装置及び運搬具','機械装置及び運搬具(百万ドル)')]) {
            const r = extractFacilityDetails(document('A',raw));expect(r.rows).toHaveLength(0);expect(r.diagnostics).toEqual([{tableIndex:0,reason:'unsupported-layout'}]);
        }
    });
    it("数値が結合された複数行へ同じ金額を複製しない", () => {
        const raw = table().replace('<td>3,300</td>','<td rowspan="2">3,300</td>').replace('</tbody>', '<tr><td>支店</td><td>通信</td><td>1</td><td>2</td><td>3</td><td>4</td><td>5</td><td>6</td></tr></tbody>');
        const r = extractFacilityDetails(document('A',raw));expect(r.rows).toHaveLength(2);
        expect(r.rows.map(r=>r.values.totalBookValueJPY)).toEqual(expect.arrayContaining([expect.objectContaining({status:'unavailable',reason:'merged-data-cell'})]));
        expect(r.rows[0].values.totalBookValueJPY.status).toBe('unavailable');expect(r.rows[1].values.totalBookValueJPY.status).toBe('unavailable');
    });
    it.each([{rawSha256:'0'.repeat(64)},{asOfDate:'2026-03-32'},{asOfDate:'2025-03-31'},{asOfDate:'2027-03-31'},{tableIndex:99},{tableIndex:-1},{organization:'unknown' as never}])("原本を確認できない宣言を拒否する %j", change => {
        expect(()=>extractFacilityDetails(changeDeclaration(change))).toThrow();
    });
    it("同じ表の二重宣言を拒否し、未確認の別表は残す", () => {
        const d=document();expect(()=>extractFacilityDetails({...d,declarations:[...d.declarations,...d.declarations]})).toThrow();
        const r=extractFacilityDetails(document('A',table()+table()));expect(r.rows).toHaveLength(1);expect(r.diagnostics).toContainEqual({tableIndex:1,reason:'not-reviewed'});
    });
    it("非対応本文を正常な設備データに変えない", () => {
        const d=document();expect(()=>extractFacilityDetails({...d,accountingStandard:"IFRS" as never})).toThrow("J-GAAP");const r=extractFacilityDetails({...d,xml:d.xml.replace(ns,'urn:extension')});expect(r.source.status).toBe('unsupported');expect(r.rows).toEqual([]);
    });
});
describe("設備明細の同一時点の検索",()=>{
    const query={asOfDate:'2026-03-31'};
    it.each([['gte',3300000000,1],['gt',3300000000,0],['lte',3300000000,1],['lt',3300000000,0],['eq',3300000000,1]] as const)("%sで円単位の厳密条件を比較する",(operator,value,count)=>{
        expect(screenFacilityDetails([document()],{...query,conditions:[{field:F.TotalBookValueJPY,operator,value}]}).matched).toBe(count);
    });
    it("未使用の欠損で除外せず、検索に必要な欠損だけ理由付き除外する",()=>{
        const d=document('A',table(9,['本社','通信','1','2','－','－','－','0','1']));
        expect(screenFacilityDetails([d],{...query,conditions:[{field:F.TotalBookValueJPY,operator:'eq',value:0}]}).matched).toBe(1);
        const result=screenFacilityDetails([d],{...query,conditions:[{field:F.LandAreaM2,operator:'gte',value:0}]});expect(result.matched).toBe(0);expect(result.excluded[0].fields).toEqual([F.LandAreaM2]);
    });
    it("組織・所在地の部分一致・金額順/同値の安定順・ページを扱う",()=>{
        const a=document('A'),b=document('B');b.declarations=[{...b.declarations[0],organization:'domestic-subsidiaries'}];
        const r=screenFacilityDetails([b,a],{...query,contains:'架空',sort:{field:F.TotalBookValueJPY,order:'desc'},offset:1,limit:1});
        expect(r.matched).toBe(2);expect(r.extractions[r.rows[0].sourceIndex].source.source.docID).toBe('B');
        expect(screenFacilityDetails([a,b],{...query,organization:'reporting-company'})).toMatchObject({matched:1,filtered:1});
    });
    it("二重原本・異なる期末・不正条件・過剰入力を拒否する",()=>{
        expect(()=>screenFacilityDetails([document(),document()],query)).toThrow();
        const repeated = document("B"); repeated.xml = repeated.xml.replace(">B</xbrli:identifier>", ">A</xbrli:identifier>");
        expect(()=>screenFacilityDetails([document(),repeated],query)).toThrow("同じ提出者");
        expect(()=>screenFacilityDetails([document()],{asOfDate:'2025-03-31'})).toThrow();
        expect(()=>screenFacilityDetails([document()],{...query,limit:0})).toThrow();
        expect(()=>screenFacilityDetails([document()],{...query,conditions:[{field:F.LandAreaM2,operator:'gte',value:Infinity}]})).toThrow();
        expect(()=>screenFacilityDetails(Array(101).fill(document()),query)).toThrow();
    });
    it("前年度の宣言を当期へ持ち越さない",()=>{
        const previous = document("PREVIOUS", table(), 2025);
        expect(extractFacilityDetails(previous).rows[0].asOfDate).toBe("2025-03-31");
        expect(screenFacilityDetails([previous],{asOfDate:"2025-03-31"}).matched).toBe(1);
        expect(()=>screenFacilityDetails([previous,document()],query)).toThrow();
    });
    it("空の母集団は0件",()=>{expect(screenFacilityDetails([],query)).toMatchObject({matched:0,filtered:0,excluded:[],rows:[]});});
});
describe('原表直前の基準日との一致',()=>{
 it('別表の日付が本文にあっても海外表の誤った基準日を認めない',()=>{
  const d=document('A',table()+'<p>2025年12月31日現在</p>'+table());
  d.declarations=[d.declarations[0],{...d.declarations[0],tableIndex:1}];
  expect(()=>extractFacilityDetails(d)).toThrow('直前の日付');
  d.declarations=[d.declarations[0],{...d.declarations[0],tableIndex:1,asOfDate:'2025-12-31'}];
  expect(extractFacilityDetails(d).rows.map(r=>r.asOfDate)).toEqual(['2026-03-31','2025-12-31']);
 });
 it('直前の一セル表の日付を確認し、他の本文日付で代用しない',()=>{
  const d=document('A','<table><tr><td>2025年12月31日現在</td></tr></table>'+table());
  d.declarations=[{...d.declarations[0],tableIndex:1}];expect(()=>extractFacilityDetails(d)).toThrow('直前の日付');
  d.declarations=[{...d.declarations[0],asOfDate:'2025-12-31'}];expect(extractFacilityDetails(d).rows[0].asOfDate).toBe('2025-12-31');
 });
});
describe('配列indexにある入力を検査する',()=>{
 it('宣言の独自iteratorで不正indexを隠せない',()=>{
  const d=document(),good=d.declarations[0],declarations=[{...good,asOfDate:'invalid'}];
  declarations[Symbol.iterator]=function*(){yield good};
  expect(()=>extractFacilityDetails({...d,declarations})).toThrow();
 });
 it('原本の独自iteratorで不正indexを隠せない',()=>{
  const documents=[null as never];documents[Symbol.iterator]=function*(){yield document()};
  expect(()=>screenFacilityDetails(documents,{asOfDate:'2026-03-31'})).toThrow();
 });
 it('疎な条件を空条件として扱わない',()=>{
  expect(()=>screenFacilityDetails([document()],{asOfDate:'2026-03-31',conditions:new Array(1)})).toThrow();
 });
});
it('検索条件の独自iteratorで不正indexを隠せない',()=>{
 const conditions=[{field:F.LandAreaM2,operator:'invalid' as never,value:0}];conditions[Symbol.iterator]=function*(){};
 expect(()=>screenFacilityDetails([document()],{asOfDate:'2026-03-31',conditions})).toThrow();
});
it('宣言のlengthと各indexを一度だけ読み、iteratorを呼ばない',()=>{
 const d=document();let lengths=0,indices=0;const declarations=new Proxy([...d.declarations],{get(target,key,receiver){if(key==='length')lengths++;if(key==='0')indices++;if(key===Symbol.iterator)throw Error('iterator must not be read');return Reflect.get(target,key,receiver)}});
 expect(extractFacilityDetails({...d,declarations}).rows).toHaveLength(1);expect(lengths).toBe(1);expect(indices).toBe(1);
});
it.each([NaN,Infinity,-1,0.5,201])('不正な宣言length %sを拒否する',count=>{
 const d=document(),declarations=new Proxy([...d.declarations],{get(target,key,receiver){return key==='length'?count:Reflect.get(target,key,receiver)}});
 expect(()=>extractFacilityDetails({...d,declarations})).toThrow();
});
it('200表宣言を受け付け、201表は拒否する',()=>{
 const raw=Array.from({length:200},()=>table()).join(''),d=document('A',raw);d.declarations=Array.from({length:200},(_,tableIndex)=>({...d.declarations[0],tableIndex}));expect(extractFacilityDetails(d).rows).toHaveLength(200);expect(()=>extractFacilityDetails({...d,declarations:[...d.declarations,{...d.declarations[0],tableIndex:200}]})).toThrow();
});
