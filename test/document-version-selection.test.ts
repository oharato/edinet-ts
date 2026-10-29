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

it("形式宣言は訂正書類自身の観測を参照し、将来の宣言を混ぜない", () => {
 const root=observation("A",undefined,undefined,{xbrlFlag:"1"});
 const correction=observation("B","A","2025-06-25 11:00",{xbrlFlag:0,pdfFlag:"1"});
 root.observedAt="2025-06-25T12:30:00+09:00";
 const future=structuredClone(correction);future.observationId="B-future";future.observedAt="2025-06-26T12:00:00+09:00";future.document.xbrlFlag="1";
 const result=selectDocumentVersions([root,correction,future],cutoff);
 expect(result.selected[0]).toMatchObject({formatAvailability:{observationId:"B",observedAt:"2025-06-25T03:00:00.000Z",formats:{xbrl:{state:"not-provided",code:"0"}}}});
});
it("同時刻の形式宣言の矛盾を選択しない",()=>{
 const a=observation("A",undefined,undefined,{xbrlFlag:"0"}),b=structuredClone(a);b.observationId="copy";b.document.xbrlFlag="1";
 expect(selectDocumentVersions([a,b],cutoff).decisions[0]).toMatchObject({status:"unresolved",reason:"conflicting-observations"});
 b.document.xbrlFlag=0;expect(selectDocumentVersions([a,b],cutoff).decisions[0].status).toBe("selected");
});

describe('日次更新で種類や属性が消えた観測',()=>{
 const missing=(before:DocumentVersionObservation,withdrawalStatus='0'):DocumentVersionObservation=>({observationId:before.document.docID+'-removed',observedAt:cutoff,document:{docID:before.document.docID,parentDocID:null,docTypeCode:null,edinetCode:null,secCode:null,submitDateTime:null,periodStart:null,periodEnd:null,withdrawalStatus,docInfoEditStatus:'0',disclosureStatus:'0'}});
 it('種類の消えた取下観測を捨てて以前の元書類を復活させない',()=>{
  const before=observation('A'),after=missing(before,'2');const result=selectDocumentVersions([before,after],cutoff);
  expect(result.selected).toEqual([]);expect(result.decisions).toEqual([expect.objectContaining({rootDocID:'A',status:'unavailable',reason:'withdrawn',observationIds:expect.arrayContaining(['A','A-removed'])})]);expect(result.ignored).toEqual([]);
 });
 it.each([null,undefined,'999'])('最新の書類種別%sを解釈できなければ、過去の分類で採用しない',type=>{
  const before=observation('A'),after=missing(before);after.document.docTypeCode=type;
  expect(selectDocumentVersions([before,after],cutoff)).toMatchObject({selected:[],decisions:[{status:'unresolved',reason:'document-type-unavailable'}]});
 });
 it('訂正の親も消えたときは、過去の参照根拠を残して元書類へのfallbackを止める',()=>{
  const root=observation('A'),correction=observation('B','A','2025-06-25 11:00'),after=missing(correction);
  const result=selectDocumentVersions([root,correction,after],cutoff);expect(result.selected).toEqual([]);
  expect(result.decisions.find(d=>d.rootDocID==='A')).toMatchObject({reason:'unresolved-correction',observationIds:expect.arrayContaining(['B','B-removed'])});
 });
 it('属性が消えた訂正の取下げは、有効な元書類の採用を妨げない',()=>{
  const root=observation('A'),correction=observation('B','A','2025-06-25 11:00');
  const result=selectDocumentVersions([root,correction,missing(correction,'2')],cutoff);expect(result.selected[0].rootDocID).toBe('A');expect(result.selected[0].observedAt).toBe(new Date(cutoff).toISOString());expect(result.decisions.find(d=>d.rootDocID==='A')?.observationIds).toContain('B-removed');expect(selectDocumentVersions([root,correction,missing(correction,'2')],'2025-06-25T12:30:00+09:00').selected[0].observation.document.docID).toBe('B');
 });
 it('種類の消えた将来観測をcutoff以前へ持ち込まず、未知のdocIDを財務と推定しない',()=>{
  const root=observation('A'),after=missing(root);after.observedAt='2025-06-26T00:00:00Z';
  expect(selectDocumentVersions([root,after],cutoff).selected[0].rootDocID).toBe('A');
  expect(selectDocumentVersions([missing(observation('UNKNOWN'))],cutoff)).toMatchObject({selected:[],decisions:[],ignored:[{reason:'unsupported-document-type'}]});
 });
 it('同時刻に種類のある観測とない観測が衝突したら、入力順に関係なく採用を止める',()=>{
  const root=observation('A');root.observedAt=cutoff;const after=missing(root);
  const a=selectDocumentVersions([root,after],cutoff),b=selectDocumentVersions([after,root],cutoff);expect(a).toEqual(b);expect(a).toMatchObject({selected:[],decisions:[{reason:'conflicting-observations'}]});
 });
});

it('多数の旧訂正参照による失効根拠の出力膨張を上限で止める',()=>{
 const roots=Array.from({length:20},(_,i)=>observation('ROOT'+i));
 const history=Array.from({length:5000},(_,i)=>{const o=observation('B','ROOT'+i%20,'2025-06-25 11:00');o.observationId='history-'+i;return o});
 const removed:DocumentVersionObservation={observationId:'removed',observedAt:cutoff,document:{docID:'B',docTypeCode:null,withdrawalStatus:'0',docInfoEditStatus:'0',disclosureStatus:'0'}};
 expect(()=>selectDocumentVersions([...roots,...history,removed],cutoff)).toThrow('100000');
});
