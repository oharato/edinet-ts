import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Edinet } from "../src/edinet";
import { EdinetRepository } from "../src/db/edinet-repository";
import { EdinetDocumentType } from "../src/edinet-document-type";
import type { EdinetDocument } from "../src/edinet-xbrl-downloader";

// Edinet facadeの横断検索（findDocumentsByFiler / findDocumentsByType）の仕様を固定するテスト。
// 実APIは使わず、fetchを合成応答に差し替えて、一時DBとの連携を確認します。
// 仕様: 検索前に対象期間のうちDBに無い日だけ一覧APIで補い、結果はDBへ保存する。
// 補完取得に失敗した日は警告だけで、DBにある範囲の結果を返す。
const directories: string[] = [];
const facades: Edinet[] = [];
const fetchedDates: string[] = [];

function isoDaysAgo(days: number): string {
    const date = new Date();
    date.setDate(date.getDate() - days);
    return date.toISOString().split("T")[0];
}

function doc(docID: string, extra: Partial<EdinetDocument> = {}): EdinetDocument {
    return {
        docID, secCode: "99990", filerName: "合成提出者", docTypeCode: "120",
        docDescription: "合成報告書", docInfoEditStatus: 0, periodEnd: "2026-03-31", ...extra,
    };
}

function apiDoc(docID: string, extra: Record<string, unknown> = {}): Record<string, unknown> {
    return {
        docID, secCode: "99990", filerName: "API提出者", docTypeCode: "240",
        docDescription: "公開買付届出書", docInfoEditStatus: "0", periodEnd: "2026-03-31", ...extra,
    };
}

function listResponse(results: Record<string, unknown>[]): Response {
    return new Response(JSON.stringify({
        metadata: { status: "200", resultset: { count: results.length } }, results
    }));
}

/** apiResultsByDate にある日だけ書類を返し、それ以外は空の一覧を返すfetch差し替え。 */
function mockFetch(apiResultsByDate: Map<string, Record<string, unknown>[]>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
        const url = String(input);
        const date = /date=(\d{4}-\d{2}-\d{2})/.exec(url)?.[1] ?? "";
        fetchedDates.push(date);
        return listResponse(apiResultsByDate.get(date) ?? []);
    });
}

function seededFacade(entries: { doc: EdinetDocument; submitDate: string }[], config: Record<string, unknown> = {}): Edinet {
    const dir = mkdtempSync(join(tmpdir(), "edinet-facade-"));
    directories.push(dir);
    const dbPath = join(dir, "metadata.db");
    const repo = new EdinetRepository(dbPath);
    for (const entry of entries) repo.insertDocument(entry.doc, entry.submitDate);
    repo.close();
    const facade = new Edinet({ dbPath, apiKey: "synthetic-key", enableRateLimit: false, ...config });
    facades.push(facade);
    return facade;
}

beforeEach(() => {
    fetchedDates.length = 0;
});

afterEach(() => {
    vi.restoreAllMocks();
    for (const facade of facades.splice(0)) {
        try { facade.close(); } catch { /* close済みでも続行 */ }
    }
    for (const dir of directories.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("Edinet facadeの横断検索（ローカルDB）", () => {
    it("findDocumentsByFilerは提出者名の部分一致で返し、一致しなければ空", async () => {
        mockFetch(new Map());
        const facade = seededFacade([
            { doc: doc("F1", { filerName: "バークシャー・ハサウェイ・インク" }), submitDate: isoDaysAgo(1) },
            { doc: doc("F2", { filerName: "合成提出者株式会社" }), submitDate: isoDaysAgo(1) },
            { doc: doc("F3", { filerName: "バークシャー子会社", periodEnd: "2026-06-30" }), submitDate: isoDaysAgo(2) },
        ]);
        const hits = await facade.findDocumentsByFiler("バークシャー");
        // 並びはperiod_end降順（F3が新しい）
        expect(hits.map(row => row.docID)).toEqual(["F3", "F1"]);
        expect(hits[0]).toMatchObject({ filerName: "バークシャー子会社", docTypeCode: "120" });
        expect(await facade.findDocumentsByFiler("存在しない提出者")).toEqual([]);
    });
    it("findDocumentsByTypeは種別と直近日数で絞る", async () => {
        mockFetch(new Map());
        const facade = seededFacade([
            { doc: doc("T1", { docTypeCode: "240", docDescription: "公開買付届出書" }), submitDate: isoDaysAgo(1) },
            { doc: doc("T2", { docTypeCode: "240", docDescription: "公開買付届出書" }), submitDate: isoDaysAgo(400) },
            { doc: doc("T3", { docTypeCode: "120" }), submitDate: isoDaysAgo(1) },
        ]);
        const recent = await facade.findDocumentsByType(EdinetDocumentType.TenderOfferStatement, 30);
        expect(recent.map(row => row.docID)).toEqual(["T1"]);
        const wide = await facade.findDocumentsByType("240", 500);
        expect(wide.map(row => row.docID).sort()).toEqual(["T1", "T2"]);
        const annual = await facade.findDocumentsByType(EdinetDocumentType.AnnualCards, 30);
        expect(annual.map(row => row.docID)).toEqual(["T3"]);
    });
    it("DBが空でAPIにも無ければ空を返す", async () => {
        mockFetch(new Map());
        const facade = seededFacade([]);
        expect(await facade.findDocumentsByFiler("バークシャー")).toEqual([]);
        expect(await facade.findDocumentsByType(EdinetDocumentType.TenderOfferStatement, 30)).toEqual([]);
        expect(fetchedDates.length).toBeGreaterThan(0);
    });
});

describe("Edinet facadeの横断検索（DBキャッシュ補完）", () => {
    it("DBに無い日だけAPIで補い、補った日は次回再取得しない", async () => {
        const targetDate = isoDaysAgo(1);
        mockFetch(new Map([[targetDate, [apiDoc("A1")]]]));
        const facade = seededFacade([]);
        const hits = await facade.findDocumentsByType(EdinetDocumentType.TenderOfferStatement, 2);
        expect(hits.map(row => row.docID)).toEqual(["A1"]);
        // 対象は今日・昨日・一昨日の3日分
        expect([...fetchedDates].sort()).toEqual([isoDaysAgo(0), isoDaysAgo(1), isoDaysAgo(2)].sort());
        fetchedDates.length = 0;
        const again = await facade.findDocumentsByType(EdinetDocumentType.TenderOfferStatement, 2);
        expect(again.map(row => row.docID)).toEqual(["A1"]);
        // 書類があった日は再取得しない（0件の日は取得済みを記録できないため再取得する）
        expect(fetchedDates).not.toContain(targetDate);
        expect(fetchedDates).toContain(isoDaysAgo(0));
    });
    it("対象期間の全日がDBにあればAPIを叩かない", async () => {
        mockFetch(new Map());
        const facade = seededFacade([
            { doc: doc("S0", { docTypeCode: "240" }), submitDate: isoDaysAgo(0) },
            { doc: doc("S1", { docTypeCode: "240" }), submitDate: isoDaysAgo(1) },
            { doc: doc("S2", { docTypeCode: "240" }), submitDate: isoDaysAgo(2) },
        ]);
        const hits = await facade.findDocumentsByType(EdinetDocumentType.TenderOfferStatement, 2);
        expect(hits.map(row => row.docID).sort()).toEqual(["S0", "S1", "S2"]);
        expect(fetchedDates).toEqual([]);
    });
    it("findDocumentsByFilerもDBに無い日を補ってから検索する", async () => {
        mockFetch(new Map([[isoDaysAgo(1), [apiDoc("B1", { filerName: "APIファンド" })]]]));
        const facade = seededFacade([]);
        const hits = await facade.findDocumentsByFiler("APIファンド", 2);
        expect(hits.map(row => row.docID)).toEqual(["B1"]);
    });
    it("補完取得に失敗してもDBにある範囲の結果を返す", async () => {
        vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
            new Response("server error", { status: 500 }));
        const facade = seededFacade(
            [{ doc: doc("D1", { docTypeCode: "240" }), submitDate: isoDaysAgo(1) }],
            { maxRetries: 0 }
        );
        const hits = await facade.findDocumentsByType(EdinetDocumentType.TenderOfferStatement, 2);
        expect(hits.map(row => row.docID)).toEqual(["D1"]);
    });
});
