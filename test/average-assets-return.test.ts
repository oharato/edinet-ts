import { describe, it, expect } from "vitest";
import { calculateAverageAssetsReturn, screenAverageAssetsReturn, AverageAssetsReturnMetricId as M, type AverageAssetsReturnInput } from "../src/index";
import { instance, fact } from "./fixtures/metric-boundaries";
function input(profit = "20", opening = "100", closing = "300", code = "1001"): AverageAssetsReturnInput {
    const common = { secCode: code, docID: `SYNTHETIC${code}`, scope: "Consolidated" as const, accountingStandard: "J-GAAP" as const, currency: "JPY" as const };
    const c = (id: string, dates: string) => `<xbrli:context id="${id}"><xbrli:entity><xbrli:identifier scheme="synthetic">${code}</xbrli:identifier></xbrli:entity><xbrli:period>${dates}</xbrli:period></xbrli:context>`;
    const contexts = c("income", '<xbrli:startDate>2024-04-01</xbrli:startDate><xbrli:endDate>2025-03-31</xbrli:endDate>') + c("opening", '<xbrli:instant>2024-03-31</xbrli:instant>') + c("closing", '<xbrli:instant>2025-03-31</xbrli:instant>');
    const xml = instance(["ProfitLossAttributableToOwnersOfParent", "OperatingIncome", "OrdinaryIncome"].map(tag => fact(profit, "", `jppfs_cor:${tag}`, "income")).join("") + fact(opening, "", "jppfs_cor:Assets", "opening") + fact(closing, "", "jppfs_cor:Assets", "closing"), contexts);
    return { income: { xml, metadata: { ...common, period: { startDate: "2024-04-01", endDate: "2025-03-31" }, periodType: "annual" } },
        opening: { xml, metadata: { ...common, period: { instant: "2024-03-31" } } }, closing: { xml, metadata: { ...common, period: { instant: "2025-03-31" } } } };
}
describe("期首/期末平均総資産による算式別利益率", () => {
    it.each(Object.values(M))("%sは平均残高と正確な分数、3出典を保持", metric => {
        expect(calculateAverageAssetsReturn(input(), metric)).toMatchObject({ metricId: metric, status: "calculated", value: 0.1, exact: { numerator: "1", denominator: "10" }, opening: { selection: { raw: "100" } }, closing: { selection: { raw: "300" } } });
    });
    it("損失/ゼロ利益を保持し、負資産とゼロ平均を別の理由にする", () => {
        expect(calculateAverageAssetsReturn(input("-20"), M.NetIncome)).toMatchObject({ value: -0.1 });
        expect(calculateAverageAssetsReturn(input("0"), M.NetIncome)).toMatchObject({ value: 0 });
        expect(calculateAverageAssetsReturn(input("20", "-100"), M.NetIncome).reason).toBe("negative-assets");
        expect(calculateAverageAssetsReturn(input("20", "0", "0"), M.NetIncome).reason).toBe("zero-average-assets");
    });
    it.each(["date", "missing", "entity", "scope", "company", "standard", "quarter", "short", "unsafe"])("%sを期末のみの値で補完しない", kind => {
        const data: any = input();
        if (kind === "date") data.opening.metadata.period.instant = "2024-04-01";
        if (kind === "missing") data.opening.xml = data.opening.xml.replaceAll("jppfs_cor:Assets", "jppfs_cor:Other");
        if (kind === "entity") data.opening.xml = data.opening.xml.replaceAll('scheme="synthetic">1001', 'scheme="synthetic">OTHER');
        if (kind === "scope") data.opening.metadata.scope = "NonConsolidated";
        if (kind === "company") data.closing.metadata.secCode = "1002";
        if (kind === "standard") data.opening.metadata.accountingStandard = "IFRS";
        if (kind === "quarter") data.income.metadata.periodType = "quarterly";
        if (kind === "short") data.income.metadata.period.startDate = "2024-10-01";
        if (kind === "unsafe") data.opening = input("20", "9007199254740993").opening;
        expect(calculateAverageAssetsReturn(data, M.NetIncome).status).toBe("unavailable");
    });
    it("検索・並べ替え・ページと欠損除外を厳密分数で処理", () => {
        const data = [input("20", "100", "300", "1001"), input("30", "100", "300", "1002"), input("20", "0", "0", "1003")];
        expect(screenAverageAssetsReturn(data, M.NetIncome, { conditions: [{ operator: "gte", value: 0.1 }], order: "desc", limit: 1 })).toMatchObject({ total: 2, excludedRows: 1, rows: [{ income: { metadata: { secCode: "10020" } } }] });
    });
    it("企業/期間重複と不正条件を空集合でも拒否", () => {
        expect(() => screenAverageAssetsReturn([input(), input()], M.NetIncome)).toThrow();
        expect(() => screenAverageAssetsReturn([], "bad" as any)).toThrow();
        expect(() => screenAverageAssetsReturn([], M.NetIncome, { limit: -1 })).toThrow();
        expect(() => screenAverageAssetsReturn([], M.NetIncome, { conditions: [{ operator: "eq", value: NaN }] })).toThrow();
    });
});

describe('完全一致する直接factだけを圧縮して平均資産利益率へ渡す',()=>{
 it.each(Object.values(M))('%sは重複を合算せず原値と全証跡を保持する',metric=>{
  const data=input(),raw=data.income.xml,facts=raw.match(/<jppfs_cor:[^>]+>[\s\S]*?<\/jppfs_cor:[^>]+>/g)!;
  for(const p of [data.income,data.opening,data.closing])p.xml=raw.replace('</xbrli:xbrl>',facts.join('')+'</xbrli:xbrl>');
  const r=calculateAverageAssetsReturn(data,metric);expect(r).toMatchObject({status:'calculated',exact:{numerator:'1',denominator:'10'}});
  for(const key of ['income','opening','closing'] as const)expect(r[key].selection.evidence.filter(e=>e.reason==='selected')).toHaveLength(2);
 });
 it.each(['value','precision','context'])('%sが異なる候補を同値として圧縮しない',kind=>{
  const data=input(),raw=data.income.xml,original=fact('20','','jppfs_cor:ProfitLossAttributableToOwnersOfParent','income');
  let addition=kind==='value'?original.replace('>20<','>21<'):kind==='precision'?original.replace('decimals="INF"','decimals="0"'):'';
  if(kind==='context'){const c=raw.match(/<xbrli:context id="income">[\s\S]*?<\/xbrli:context>/)![0];addition=c.replace('2025-03-31','2025-03-30');}
  data.income.xml=raw.replace('</xbrli:xbrl>',addition+'</xbrli:xbrl>');expect(calculateAverageAssetsReturn(data,M.NetIncome)).toMatchObject({status:'unavailable',reason:'unavailable-input'});
 });
 it('USD候補をJPYへ足さず不採用根拠を残す',()=>{
  const data=input(),other=fact('20','','jppfs_cor:ProfitLossAttributableToOwnersOfParent','income').replace('unitRef="money"','unitRef="usd"');
  data.income.xml=data.income.xml.replace('</xbrli:xbrl>','<xbrli:unit id="usd"><xbrli:measure>iso4217:USD</xbrli:measure></xbrli:unit>'+other+'</xbrli:xbrl>');
  const r=calculateAverageAssetsReturn(data,M.NetIncome);expect(r).toMatchObject({status:'unavailable',reason:'unavailable-input'});expect(r.income.selection.evidence.some(e=>e.reason==='unsupported-unit')).toBe(true);
 });
});
