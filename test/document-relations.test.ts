import { describe, expect, it } from "vitest";
import { analyzeDocumentRelations, DocumentWithdrawalStatus, DocumentInfoEditStatus, DocumentDisclosureStatus, DocumentParentResolution,
    DOCUMENT_RELATIONS_MAX_OBSERVATIONS, DOCUMENT_RELATIONS_MAX_PARENT_REFERENCES,
    type DocumentRelationDocument, type DocumentRelationObservation } from "../src/index";

const observation = (observationId: string, docID: string, parentDocID: string | null = null,
    extra: Partial<DocumentRelationDocument> = {}): DocumentRelationObservation => ({ observationId, document: { docID, parentDocID, ...extra } });

describe("明示観測の親書類関係", () => {
    it("親子・兄弟・多段の明示参照だけを返す", () => {
        const result = analyzeDocumentRelations([observation("child2", "C", "A"), observation("root", "A"), observation("grandchild", "D", "B"), observation("child1", "B", "A")]);
        expect(result.groups).toEqual([{ docID: "A", observationIds: ["root"] }, { docID: "B", observationIds: ["child1"] }, { docID: "C", observationIds: ["child2"] }, { docID: "D", observationIds: ["grandchild"] }]);
        expect(result.relations).toEqual([
            { observationId: "child1", docID: "B", parentDocID: "A", parentObservationIds: ["root"], resolution: DocumentParentResolution.SingleObservation },
            { observationId: "child2", docID: "C", parentDocID: "A", parentObservationIds: ["root"], resolution: "single-observation" },
            { observationId: "grandchild", docID: "D", parentDocID: "B", parentObservationIds: ["child1"], resolution: "single-observation" }
        ]);
        expect(result.summary).toEqual({ observations: 4, documents: 4, relations: 3, diagnostics: 0 });
    });
    it("親の項目欠落と明示nullを区別し、どちらも親を補完しない", () => {
        const missing: DocumentRelationObservation = { observationId: "missing", document: { docID: "M" } };
        const result = analyzeDocumentRelations([missing, observation("null", "N")]);
        expect(result.relations).toEqual([]);
        expect(Object.hasOwn(result.observations[0].document, "parentDocID")).toBe(false);
        expect(result.observations[1].document.parentDocID).toBeNull();
        expect(result.diagnostics).toMatchObject([{ code: "parent-unrecorded", observationIds: ["missing"] }]);
    });
    it("親未収録を不存在ではなく入力集合の不足として説明", () => {
        const result = analyzeDocumentRelations([observation("child", "C", "NOT-SUPPLIED")]);
        expect(result.relations[0]).toMatchObject({ resolution: "not-in-input", parentObservationIds: [] });
        expect(result.groups).toHaveLength(1);
        expect(result.diagnostics[0]).toMatchObject({ code: "parent-not-in-input", docIDs: ["C", "NOT-SUPPLIED"] });
        expect(result.diagnostics[0].message).toContain("不存在を意味しません");
    });
    it("同一docIDの修正済み/修正通知を観測ごと残して最新選択しない", () => {
        const inputs: DocumentRelationObservation[] = [
            { ...observation("old-list", "A", null, { docInfoEditStatus: "2", submitDateTime: "2025-06-20 10:00", docTypeCode: "120" }), listDate: "2025-06-20" },
            { ...observation("edit-notice", "A", "P", { docInfoEditStatus: 1, submitDateTime: "2025-06-20 11:00", docTypeCode: "120" }), listDate: "2025-06-21" },
            observation("parent", "P")
        ];
        const result = analyzeDocumentRelations(inputs);
        expect(result.observations).toHaveLength(3); expect(result.groups.find(group => group.docID === "A")!.observationIds).toEqual(["edit-notice", "old-list"]);
        expect(result.diagnostics.find(diagnostic => diagnostic.code === "observation-values-differ")!.fields).toEqual(["parentDocID", "docInfoEditStatus", "submitDateTime"]);
        expect(result.observations.find(item => item.observationId === "edit-notice")!.document.docInfoEditStatus).toBe(1);
        expect(result.observations.find(item => item.observationId === "edit-notice")!.statuses.docInfoEditStatus).toMatchObject({ presence: "known", code: "1" });
    });
    it("同値の重複観測も削除せず複数観測として残す", () => {
        const result = analyzeDocumentRelations([observation("a2", "A"), observation("a1", "A"), observation("child", "C", "A")]);
        expect(result.relations[0]).toMatchObject({ resolution: "multiple-observations", parentObservationIds: ["a1", "a2"] });
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toEqual(["multiple-observations"]);
        expect(result.observations).toHaveLength(3);
    });
    it("親参照が観測間で異なっても一方を破棄しない", () => {
        const result = analyzeDocumentRelations([observation("a1", "A", "P1"), observation("a2", "A", "P2"), observation("p1", "P1"), observation("p2", "P2")]);
        expect(result.relations.map(relation => relation.parentDocID)).toEqual(["P1", "P2"]);
        expect(result.diagnostics.find(diagnostic => diagnostic.code === "observation-values-differ")!.fields).toEqual(["parentDocID"]);
    });
    it("取下げた親から子の状態や財務値を推測しない", () => {
        const result = analyzeDocumentRelations([observation("parent", "P", null, { withdrawalStatus: DocumentWithdrawalStatus.Withdrawn }),
            observation("child", "C", "P", { withdrawalStatus: DocumentWithdrawalStatus.Other, docInfoEditStatus: DocumentInfoEditStatus.Other, disclosureStatus: DocumentDisclosureStatus.Other })]);
        expect(result.observations.find(item => item.document.docID === "C")!.statuses.withdrawalStatus).toMatchObject({ code: "0" });
        expect(result.relations[0].resolution).toBe("single-observation");
        expect(Object.keys(result)).toEqual(["observations", "groups", "relations", "diagnostics", "summary"]);
    });
    it("別会社・別種別の親参照を不整合と決めつけず010も書き換えない", () => {
        const result = analyzeDocumentRelations([observation("parent", "P", null, { edinetCode: "E00001", docTypeCode: "010" }),
            observation("child", "C", "P", { edinetCode: "E00002", docTypeCode: "270" })]);
        expect(result.diagnostics).toEqual([]); expect(result.observations.find(item => item.document.docID === "P")!.document.docTypeCode).toBe("010");
    });
    it("自己参照と複数観測由来の循環候補を分ける", () => {
        const result = analyzeDocumentRelations([
            { ...observation("a-old", "A", "B"), listDate: "2024-06-01" }, { ...observation("a-new", "A"), listDate: "2025-06-01" },
            { ...observation("b", "B", "A"), listDate: "2025-06-01" }, observation("self", "S", "S")
        ]);
        expect(result.relations.find(relation => relation.docID === "S")!.resolution).toBe("self-reference");
        const cycle = result.diagnostics.find(diagnostic => diagnostic.code === "cycle-candidate")!;
        expect(cycle).toMatchObject({ docIDs: ["A", "B"], observationIds: ["a-old", "b"] });
        expect(cycle.message).toContain("断定しません");
        expect(result.diagnostics.filter(diagnostic => diagnostic.code === "self-reference")).toHaveLength(1);
    });
    it("独立した循環候補は混同しない", () => {
        const result = analyzeDocumentRelations([observation("a", "A", "B"), observation("b", "B", "A"), observation("c", "C", "D"), observation("d", "D", "C"), observation("tail", "T", "A")]);
        expect(result.diagnostics.filter(diagnostic => diagnostic.code === "cycle-candidate").map(diagnostic => diagnostic.docIDs)).toEqual([["A", "B"], ["C", "D"]]);
    });
    it("一万観測の深い関係を再帰stackを使わず調べる", () => {
        const input = Array.from({ length: DOCUMENT_RELATIONS_MAX_OBSERVATIONS }, (_, i) => observation(`o${i}`, `D${i}`, i ? `D${i - 1}` : null));
        const result = analyzeDocumentRelations(input);
        expect(result.summary).toMatchObject({ observations: 10000, documents: 10000, relations: 9999, diagnostics: 0 });
    });
    it("参照先観測ID合計の上限ちょうどを許し、膨張は明示拒否", () => {
        const parents = Array.from({ length: 200 }, (_, i) => observation(`p${i}`, "P"));
        const children = Array.from({ length: 500 }, (_, i) => observation(`c${i}`, `C${i}`, "P"));
        const result = analyzeDocumentRelations([...parents, ...children]);
        expect(result.relations.reduce((sum, relation) => sum + relation.parentObservationIds.length, 0)).toBe(DOCUMENT_RELATIONS_MAX_PARENT_REFERENCES);
        expect(() => analyzeDocumentRelations([...parents, ...children, observation("extra", "X", "P")])).toThrow("100000");
    });
});

describe("書類一覧の状態と入力snapshot", () => {
    it.each(["0", "1", "2", 0, 1, 2])("文字列/数値区分%jを解釈しrawは保持", value => {
        const result = analyzeDocumentRelations([observation("obs", "D", null, { withdrawalStatus: value, docInfoEditStatus: value, disclosureStatus: value })]);
        for (const field of ["withdrawalStatus", "docInfoEditStatus", "disclosureStatus"] as const) {
            expect(result.observations[0].document[field]).toBe(value);
            expect(result.observations[0].statuses[field]).toMatchObject({ presence: "known", code: String(value) });
        }
    });
    it("不開示解除3を専用区分として解釈", () => {
        const result = analyzeDocumentRelations([observation("obs", "D", null, { disclosureStatus: 3 })]);
        expect(result.observations[0].statuses.disclosureStatus).toMatchObject({ presence: "known", code: DocumentDisclosureStatus.DisclosureRestoredNotice });
        expect(Object.isFrozen(DocumentWithdrawalStatus)).toBe(true); expect(Object.isFrozen(DocumentInfoEditStatus)).toBe(true); expect(Object.isFrozen(DocumentDisclosureStatus)).toBe(true);
    });
    it("区分の未記録・null・0を区別", () => {
        const result = analyzeDocumentRelations([observation("missing", "M"), observation("null", "N", null, { withdrawalStatus: null, docInfoEditStatus: null, disclosureStatus: null }), observation("zero", "Z", null, { withdrawalStatus: 0 })]);
        expect(result.observations.map(item => item.statuses.withdrawalStatus.presence)).toEqual(["missing", "null", "known"]);
        expect(Object.hasOwn(result.observations[0].document, "withdrawalStatus")).toBe(false);
        expect(result.observations[1].document.withdrawalStatus).toBeNull();
    });
    it("取下げ等のnullable metadataを保持し、失われた会社情報を補完しない", () => {
        const result = analyzeDocumentRelations([observation("withdrawn", "D", null, { withdrawalStatus: "2", edinetCode: null, secCode: null, docTypeCode: null, submitDateTime: null, opeDateTime: null })]);
        expect(result.observations[0].document).toMatchObject({ edinetCode: null, secCode: null, docTypeCode: null, submitDateTime: null, opeDateTime: null });
    });
    it("必要なgetterだけを一回読み、未知fieldは評価も返却もしない", () => {
        const count: Record<string, number> = {}, source: any = {}, doc: any = {};
        const once = (object: any, key: string, value: unknown) => Object.defineProperty(object, key, { enumerable: true, get() { count[key] = (count[key] ?? 0) + 1; if (count[key] > 1) throw new Error("read twice"); return value; } });
        once(doc, "docID", "D"); once(doc, "parentDocID", "P"); once(doc, "docInfoEditStatus", 1);
        Object.defineProperty(doc, "unrelated", { enumerable: true, get() { throw new Error("unknown field must not be read"); } });
        once(source, "observationId", "obs"); once(source, "listDate", "2024-02-29"); once(source, "document", doc);
        const result = analyzeDocumentRelations([source]);
        expect(Object.values(count).every(value => value === 1)).toBe(true); expect(Object.hasOwn(result.observations[0].document, "unrelated")).toBe(false);
        expect(result.relations[0]).toMatchObject({ docID: "D", parentDocID: "P" });
    });
    it("prototypeの任意metadata getterを読まない", () => {
        const doc = Object.create({ get parentDocID() { throw new Error("inherited metadata"); } }); doc.docID = "D";
        const result = analyzeDocumentRelations([{ observationId: "obs", document: doc }]);
        expect(result.relations).toEqual([]); expect(Object.hasOwn(result.observations[0].document, "parentDocID")).toBe(false);
    });
    it("入力不変・返却値から独立・入力順によらない結果", () => {
        const input = [observation("b", "B", "A"), observation("a", "A"), observation("a2", "A")], before = JSON.stringify(input);
        const result = analyzeDocumentRelations(input);
        expect(analyzeDocumentRelations([...input].reverse())).toEqual(result); expect(JSON.stringify(input)).toBe(before);
        result.observations[0].document.parentDocID = "changed"; result.groups[0].observationIds.push("changed");
        expect(JSON.stringify(input)).toBe(before); expect(analyzeDocumentRelations(input).groups[0].observationIds).toEqual(["a", "a2"]);
    });
    it("空集合とサマリー件数", () => {
        expect(analyzeDocumentRelations([])).toEqual({ observations: [], groups: [], relations: [], diagnostics: [], summary: { observations: 0, documents: 0, relations: 0, diagnostics: 0 } });
    });
    it.each(["", "00", "4", 4, true, {}, [], NaN, Infinity, " 0"])("未知/不正区分%jを0に変換しない", value => {
        for (const field of ["withdrawalStatus", "docInfoEditStatus", "disclosureStatus"]) expect(() => analyzeDocumentRelations([observation("obs", "D", null, { [field]: value } as any)])).toThrow();
    });
    it("取下/情報修正に3は使わない", () => {
        for (const field of ["withdrawalStatus", "docInfoEditStatus"]) expect(() => analyzeDocumentRelations([observation("obs", "D", null, { [field]: "3" })])).toThrow();
    });
    it.each([
        { input: null }, { input: {} }, { input: new Array(1) }, { input: [null] }, { input: [{ observationId: "x" }] },
        { input: [{ observationId: "", document: { docID: "D" } }] }, { input: [{ observationId: "x\n", document: { docID: "D" } }] },
        { input: [{ observationId: "x", document: { docID: "" } }] }, { input: [{ observationId: "x", document: { docID: "D", parentDocID: "" } }] },
        { input: [{ observationId: "x", document: [], listDate: "2025-01-01" }] }, { input: [{ observationId: "x", document: { docID: "D" }, listDate: "2025-02-30" }] },
        { input: [{ observationId: "x", document: { docID: "D", secCode: 1234 } }] }, { input: [{ observationId: "x", document: { docID: "D" }, unknown: true }] }
    ])("不正shapeを拒否 %j", ({ input }) => expect(() => analyzeDocumentRelations(input as any)).toThrow());
    it("同じ観測IDは同値でも拒否、同じdocIDとは別扱い", () => {
        expect(() => analyzeDocumentRelations([observation("same", "D"), observation("same", "D")])).toThrow("observationId");
    });
    it("上限超過を途中成功にしない", () => {
        expect(() => analyzeDocumentRelations(Array.from({ length: DOCUMENT_RELATIONS_MAX_OBSERVATIONS + 1 }, (_, i) => observation(`o${i}`, `D${i}`)))).toThrow("10000");
    });
    it("独自iteratorを実行せず固定した配列長とindexだけを読む", () => {
        const input = [observation("only", "D")]; let iterations = 0, reads = 0;
        Object.defineProperty(input, Symbol.iterator, { value: function* () { iterations++; for (let i = 0; i < 10001; i++) yield observation(`o${i}`, `D${i}`); } });
        Object.defineProperty(input, "0", { get() { reads++; return observation("only", "D"); }, enumerable: true });
        const result = analyzeDocumentRelations(input);
        expect(result.summary.observations).toBe(1); expect(iterations).toBe(0); expect(reads).toBe(1);
    });
});
