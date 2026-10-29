import { describe, it, expect } from "vitest";
import { parseEdinetCodeList, queryCompanyMaster } from "../src/index";
const header = 'ＥＤＩＮＥＴコード,提出者種別,上場区分,決算日,提出者名,提出者業種,証券コード,提出者法人番号';
const csv = (date = '2026年10月27日現在', name = '合成株式会社', code = '123A0') => `ダウンロード実行日,${date},件数,2件\r\n${header}\r\nE00001,内国法人・組合,上場,3月末日,${name},情報・通信業,${code},1234567890123\r\nE00002,外国法人・組合,,12月31日,別会社,,,\r\n`;
const origin = { observedAt: '2026-10-28T00:00:00+09:00', sourceUrl: 'https://example.test/codes.zip' };
const query = { asOf: '2026-10-27', knownAt: '2026-10-28T00:00:00+09:00' };
describe("公式EDINETコードリストの観測マスター", () => {
    it("英字/4桁コード、法人番号、業種、上場不明、月末を保持", () => {
        const snapshot = parseEdinetCodeList(csv(undefined, undefined, '123A'), origin);
        expect(snapshot).toMatchObject({ asOf: '2026-10-27', records: [{ entityId: 'edinet:E00001', securityCode: '123A0', fiscalYearEndMonth: 3 }, { entityId: 'edinet:E00002', listingStatus: 'unknown', fiscalYearEndMonth: 12 }] });
        expect(snapshot.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
        expect(queryCompanyMaster([snapshot], { ...query, securityCode: '123A' })).toMatchObject({ total: 1 });
    });
    it("引用符内のカンマ・改行・二重引用符を落とさない", () => {
        const snapshot = parseEdinetCodeList(csv(undefined, '"合成,株式会社\n""新社名"""'), origin);
        expect(snapshot.records[0].name).toBe('合成,株式会社\n"新社名"');
    });
    it("現在の業種/社名を過去へ適用せず、観測済み時点を分離", () => {
        const old = parseEdinetCodeList(csv('2026年9月30日現在', '旧社名'), { ...origin, observedAt: '2026-10-01T00:00:00+09:00' });
        const now = parseEdinetCodeList(csv(), origin);
        expect(queryCompanyMaster([old, now], { ...query, asOf: '2026-09-01' })).toMatchObject({ status: 'unavailable', reason: 'no-observation' });
        expect(queryCompanyMaster([old, now], { ...query, knownAt: '2026-10-27T12:00:00+09:00' }).rows[0].name).toBe('旧社名');
        expect(queryCompanyMaster([old, now], query).rows[0].name).toBe('合成株式会社');
        expect(old.records[0].entityId).toBe(now.records[0].entityId);
    });
    it("業種・上場・決算月・名前を組み合わせ、入力を変更しない", () => {
        const snapshot = parseEdinetCodeList(csv(), origin), before = JSON.stringify(snapshot);
        const result = queryCompanyMaster([snapshot], { ...query, industry: '情報・通信業', listingStatus: 'listed', fiscalYearEndMonth: 3, nameContains: '合成' });
        expect(result.total).toBe(1); result.rows[0].name = 'changed'; expect(JSON.stringify(snapshot)).toBe(before);
    });
    it.each(['duplicate-code', 'unknown-listing', 'invalid-code', 'invalid-number', 'wrong-count', 'bad-quote', 'missing-column', 'wrong-width'])("%sは設定エラー", kind => {
        let source = csv();
        if (kind === 'duplicate-code') source = source.replace('E00002', 'E00001');
        if (kind === 'unknown-listing') source = source.replace(',上場,', ',不明語,');
        if (kind === 'invalid-code') source = source.replace('123A0', '123A00');
        if (kind === 'invalid-number') source = source.replace('1234567890123', '123');
        if (kind === 'wrong-count') source = source.replace('2件', '3件');
        if (kind === 'bad-quote') source = source.replace('合成株式会社', '合成"株式会社');
        if (kind === 'missing-column') source = source.replace('提出者業種', '別の列');
        if (kind === 'wrong-width') source = source.replace('合成株式会社,', '合成株式会社,,');
        expect(() => parseEdinetCodeList(source, origin)).toThrow();
    });
    it("未来観測・認証URL・同時点競合を受理しない", () => {
        expect(() => parseEdinetCodeList(csv(), { ...origin, observedAt: '2025-01-01T00:00:00Z' })).toThrow();
        expect(() => parseEdinetCodeList(csv(), { ...origin, sourceUrl: 'https://example.test/?secret=synthetic' })).toThrow();
        const a = parseEdinetCodeList(csv(), origin), b = parseEdinetCodeList(csv(undefined, '別名'), origin);
        expect(() => queryCompanyMaster([a, b], query)).toThrow();
    });
});
it('CSV/保存観測とknownAtの存在しない暦日を拒否する',()=>{
 const s={asOf:'2026-02-27',observedAt:'2026-02-28T00:00:00Z',sourceUrl:'https://example.com/master.csv',sourceSha256:'a'.repeat(64),records:[]};
 expect(()=>queryCompanyMaster([{...s,observedAt:'2026-02-30T00:00:00Z'}],{asOf:'2026-02-28',knownAt:'2026-03-03T00:00:00Z'})).toThrow();
 expect(()=>queryCompanyMaster([s],{asOf:'2026-02-28',knownAt:'2026-02-30T00:00:00Z'})).toThrow();
 expect(()=>parseEdinetCodeList(csv('2026年2月27日現在'),{...origin,observedAt:'2026-02-30T00:00:00Z'})).toThrow();
 expect(queryCompanyMaster([s],{asOf:'2026-02-28',knownAt:'2026-02-28T12:00Z'}).status).toBe('available');
});
