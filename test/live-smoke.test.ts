import { describe, expect, it } from "vitest";
import { checkLargeShareholdingSamples } from "../scripts/live-smoke";
import type { EdinetDocument } from "../src/edinet-xbrl-downloader";

function doc(partial: Partial<EdinetDocument> & { docID: string }): EdinetDocument {
    return {
        secCode: null,
        docDescription: null,
        docTypeCode: null,
        docInfoEditStatus: 0,
        ...partial,
    };
}

// 実APIサンプルの形（2025-05-19の変更報告書 docID S100VRDA など）に合わせた合成データ。
describe("live smokeの種別コード検証", () => {
    it("350の初回・変更、360の訂正、340の別途買付け訂正を正しく数える", () => {
        const summary = checkLargeShareholdingSamples([
            doc({ docID: "S100A", docTypeCode: "350", docDescription: "大量保有報告書", formCode: "010000" }),
            doc({ docID: "S100B", docTypeCode: "350", docDescription: "変更報告書", formCode: "010002" }),
            doc({ docID: "S100C", docTypeCode: "350", docDescription: "変更報告書（特例対象株券等）", formCode: "030002" }),
            doc({ docID: "S100D", docTypeCode: "350", docDescription: "大量保有報告書（特例対象株券等）", formCode: "030000" }),
            doc({ docID: "S100E", docTypeCode: "360", docDescription: "訂正報告書", formCode: "090001" }),
            doc({ docID: "S100F", docTypeCode: "340", docDescription: "訂正別途買付け禁止の特例を受けるための申出書" }),
            doc({ docID: "S100G", docTypeCode: "120", docDescription: "有価証券報告書" }),
        ]);
        expect(summary.total).toBe(7);
        expect(summary.largeShareholding).toBe(4);
        expect(summary.changeReports).toBe(2);
        expect(summary.corrections).toBe(1);
        expect(summary.separatePurchaseCorrections).toBe(1);
        expect(summary.problems).toEqual([]);
    });
    it("350の変更報告書で様式コードが末尾002でなければ問題として報告する", () => {
        const summary = checkLargeShareholdingSamples([
            doc({ docID: "S100X", docTypeCode: "350", docDescription: "変更報告書", formCode: "010000" }),
        ]);
        expect(summary.problems).toHaveLength(1);
        expect(summary.problems[0]).toContain("S100X");
    });
    it("340に大量保有の書類名が来たら問題として報告する", () => {
        const summary = checkLargeShareholdingSamples([
            doc({ docID: "S100Y", docTypeCode: "340", docDescription: "大量保有報告書" }),
        ]);
        expect(summary.problems).toHaveLength(1);
    });
});
