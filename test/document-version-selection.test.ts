import { describe, it, expect } from "vitest";
import { selectDocumentVersions, type DocumentVersionObservation } from "../src/index";
function observation(id: string, parent?: string, time = "2025-06-25 10:00", extra: Record<string, unknown> = {}): DocumentVersionObservation {
    return { observationId: id, observedAt: "2025-06-25T12:00:00+09:00", document: { docID: id, parentDocID: parent ?? null,
        docTypeCode: parent ? "130" : "120", edinetCode: "E00001", secCode: "10010", submitDateTime: time,
        periodStart: "2024-04-01", periodEnd: "2025-03-31", withdrawalStatus: "0", disclosureStatus: "0", docInfoEditStatus: "0", ...extra } };
}
const cutoff = "2025-06-25T13:00:00+09:00";
describe("観測済みの訂正系列をcutoffで選択", () => {
    it("親子の宣言と提出順で訂正を選び、財務値を勝手に合成しない", () => {
        const result = selectDocumentVersions([observation("A"), observation("B", "A", "2025-06-25 11:00")], cutoff);
        expect(result).toMatchObject({ decisions: [{ status: "selected", selectedDocID: "B", chainDocIDs: ["A", "B"] }], financialValuesMerged: false, reconstructedUnobservedHistory: false });
    });
    it("観測IDの並びと入力順が違っても時刻・期間を取り違えない", () => {
        const root = observation("A"), correction = observation("B", "A", "2025-06-25 11:00");
        root.observationId = "metadata-2"; correction.observationId = "metadata-10";
        const future = observation("C"); future.observationId = "metadata-1"; future.observedAt = "2025-06-26T12:00:00+09:00";
        const a = selectDocumentVersions([root, correction, future], cutoff), b = selectDocumentVersions([future, correction, root], cutoff);
        expect(a).toEqual(b); expect(a.decisions[0]).toMatchObject({ selectedDocID: "B", chainDocIDs: ["A", "B"] });
        expect(a.ignored).toEqual([{ observationId: "metadata-1", reason: "after-cutoff" }]);
    });
    it("訂正側の期間未記載は、宣言された親の期間と根拠IDを残して扱う", () => {
        const a = observation("A"), b = observation("B", "A", "2025-06-25 11:00");
        b.document.periodStart = null; b.document.periodEnd = null;
        expect(selectDocumentVersions([a, b], cutoff).decisions[0]).toMatchObject({ selectedDocID: "B", targetPeriod: { startDate: "2024-04-01", endDate: "2025-03-31", sourceDocID: "A" } });
    });
    it("解決不能な訂正を捨てて古い元書類を選ばない", () => {
        const a = observation("A"), b = observation("B", "A", "2025-06-25 11:00");
        b.document.periodEnd = "2024-03-31";
        const result = selectDocumentVersions([a, b], cutoff);
        expect(result.decisions.find(d => d.rootDocID === "A")).toMatchObject({ status: "unresolved", reason: "unresolved-correction" });
        expect(result.decisions.some(d => d.status === "selected")).toBe(false);
    });
    it("未観測の過去・将来提出・将来観測を復元しない", () => {
        const current = observation("A");
        expect(selectDocumentVersions([current], "2025-06-24T23:59:59+09:00")).toMatchObject({ decisions: [], ignored: [{ reason: "after-cutoff" }] });
        const later = observation("B", "A", "2025-06-25 14:00");
        expect(selectDocumentVersions([current, later], cutoff).decisions[0].selectedDocID).toBe("A");
        const future = observation("B", "A", "2025-06-25 11:00"); future.observedAt = "2025-06-26T12:00:00+09:00";
        expect(selectDocumentVersions([current, future], cutoff).decisions[0].selectedDocID).toBe("A");
    });
    it("最新の取下げ・不開示観測で元を選び直さない", () => {
        for (const [field, value, reason] of [["withdrawalStatus", "2", "withdrawn"], ["disclosureStatus", "2", "non-disclosed"]]) {
            const before = observation("A"), after = observation("A", undefined, "2025-06-25 10:00", { [field]: value });
            after.observationId = "A-after"; after.observedAt = cutoff;
            expect(selectDocumentVersions([before, after], cutoff).decisions[0]).toMatchObject({ status: "unavailable", reason });
        }
    });
    it("取下げられた訂正は、現に有効な元書類を残す", () => {
        expect(selectDocumentVersions([observation("A"), observation("B", "A", "2025-06-25 11:00", { withdrawalStatus: "2" })], cutoff).decisions[0]).toMatchObject({ selectedDocID: "A" });
    });
    it.each(["parent-missing", "cycle", "company-mismatch", "period-mismatch", "wrong-parent-type", "non-chronological-chain"])("%sを自動解決した扱いにしない", reason => {
        const a = observation("A"), b = observation("B", "A", "2025-06-25 11:00");
        if (reason === "parent-missing") b.document.parentDocID = "MISSING";
        if (reason === "cycle") { a.document.docTypeCode = "130"; a.document.parentDocID = "B"; b.document.submitDateTime = a.document.submitDateTime; }
        if (reason === "company-mismatch") b.document.edinetCode = "E00002";
        if (reason === "period-mismatch") b.document.periodEnd = "2024-03-31";
        if (reason === "wrong-parent-type") a.document.docTypeCode = "140";
        if (reason === "non-chronological-chain") b.document.submitDateTime = "2025-06-25 09:00";
        expect(selectDocumentVersions([a, b], cutoff).decisions).toContainEqual(expect.objectContaining({ status: "unresolved", reason }));
    });
    it("枝分かれした複数訂正を提出時刻だけで捨てない", () => {
        const result = selectDocumentVersions([observation("A"), observation("B", "A", "2025-06-25 11:00"), observation("C", "A", "2025-06-25 11:30")], cutoff);
        expect(result.decisions[0]).toMatchObject({ status: "unresolved", reason: "multiple-correction-leaves" });
    });
    it("同時点の同一観測は保持し、異値観測は曖昧にする", () => {
        const a = observation("A"), copy = structuredClone(a); copy.observationId = "A-copy"; copy.document.docInfoEditStatus = 0;
        expect(selectDocumentVersions([a, copy], cutoff).decisions[0]).toMatchObject({ status: "selected", observationIds: ["A", "A-copy"] });
        copy.document.withdrawalStatus = "2";
        expect(selectDocumentVersions([a, copy], cutoff).decisions[0]).toMatchObject({ status: "unresolved", reason: "conflicting-observations" });
    });
    it("欠けた状態・時刻は正常と仮定しない", () => {
        const a = observation("A"); delete a.document.disclosureStatus;
        expect(selectDocumentVersions([a], cutoff).decisions[0].reason).toBe("unknown-status");
        const b = observation("B"); b.document.submitDateTime = "2025-02-30 12:00";
        expect(selectDocumentVersions([b], cutoff).decisions[0].reason).toBe("submit-time-unavailable");
        expect(() => selectDocumentVersions([], "2025-06-25 13:00")).toThrow();
    });
    it.each([["140", "150"], ["160", "170"]])("%s/%sの訂正も別系列で扱う", (root, amended) => {
        const a = observation("A", undefined, undefined, { docTypeCode: root }), b = observation("B", "A", "2025-06-25 11:00", { docTypeCode: amended });
        expect(selectDocumentVersions([a, b], cutoff).decisions[0].selectedDocID).toBe("B");
    });
});
