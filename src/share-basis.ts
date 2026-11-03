import { createHash } from "node:crypto";
import type { EdinetXbrlObject } from "./edinet-xbrl-object";
import type { AnnualCoreDocument } from "./annual-growth-core";
export type ShareBasisProofKey = "jpcrp_cor:BusinessResultsOfGroupTextBlock" | "jpcrp_cor:BusinessResultsOfReportingCompanyTextBlock";
/** 基準の意味と配当状態は呼出元が注記を確認した宣言。本文の自動解釈はしません。 */
export type ShareBasis = { state: "unknown" } | { state: "confirmed"; shareClass: "ordinary"; basisDate: string;
    proof: { key: ShareBasisProofKey; contextRef: string; rawSha256: string };
    dividendStatus?: "paid" | "proposed" | "unknown" };
export interface PerShareAnnualDocument extends AnnualCoreDocument { shareBasis: ShareBasis; }
export type ShareBasisAssessment = { status: "reference-matched"; shareClass: "ordinary"; basisDate: string; declaration: "source-reviewed-by-caller";
    proof: { key: ShareBasisProofKey; contextRef: string; rawSha256: string }; dividendStatus?: "paid" | "proposed" | "unknown" } |
    { status: "unavailable"; reason: "unverified-share-basis" | "invalid-share-basis-evidence" };
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === "object" && !Array.isArray(v);
const date = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v;
/** 呼出元の宣言を固定。根拠本文自体を結果へ複製しません。 */
export function captureShareBasis(value: unknown): ShareBasis | undefined {
    if (!record(value) || Object.keys(value).some(k => !["state", "shareClass", "basisDate", "proof", "dividendStatus"].includes(k))) return;
    const { state, shareClass, basisDate, proof: rawProof, dividendStatus } = value;
    if (state === "unknown") return { state };
    if (state !== "confirmed" || shareClass !== "ordinary" || !date(basisDate) || !record(rawProof) || Object.keys(rawProof).some(k => !["key", "contextRef", "rawSha256"].includes(k))) return;
    const proof = { key: rawProof.key, contextRef: rawProof.contextRef, rawSha256: rawProof.rawSha256 };
    if (!["jpcrp_cor:BusinessResultsOfGroupTextBlock", "jpcrp_cor:BusinessResultsOfReportingCompanyTextBlock"].includes(proof.key) || typeof proof.contextRef !== "string" || !proof.contextRef.trim() ||
        typeof proof.rawSha256 !== "string" || !/^[a-f0-9]{64}$/.test(proof.rawSha256) || dividendStatus !== undefined && !["paid", "proposed", "unknown"].includes(dividendStatus)) return;
    return { state, shareClass, basisDate, proof, ...(dividendStatus === undefined ? {} : { dividendStatus }) };
}
/** 原本内の注記参照とhashを検査。注記の意味・完全性や宣言の正しさの認証ではありません。 */
export function assessShareBasis(object: EdinetXbrlObject, basis: ShareBasis | undefined, entity: { scheme: string; identifier: string } | undefined): ShareBasisAssessment {
    if (!basis || basis.state !== "confirmed") return { status: "unavailable", reason: "unverified-share-basis" };
    const unavailable: ShareBasisAssessment = { status: "unavailable", reason: "invalid-share-basis-evidence" };
    const candidates = object.getDataList(basis.proof.key).filter(f => f.contextRef === basis.proof.contextRef);
    if (candidates.length !== 1) return unavailable;
    const fact = candidates[0], nsDate = /^http:\/\/disclosure\.edinet-fsa\.go\.jp\/taxonomy\/jpcrp\/(\d{4}-\d{2}-\d{2})\/jpcrp_cor$/.exec(fact.namespaceURI ?? "")?.[1];
    if (!date(nsDate) || fact.nil || typeof fact.rawValue !== "string" || createHash("sha256").update(fact.rawValue).digest("hex") !== basis.proof.rawSha256 || object.traceContextDimensions(fact.contextRef).status !== "resolved") return unavailable;
    const context = [...object.findContexts({ type: "Instant", scope: "Consolidated" }), ...object.findContexts({ type: "Instant", scope: "NonConsolidated" })].find(c => c.id === fact.contextRef);
    if (!context || !context.namespaceVerified || !context.periodValid || !date(context.period.instant) || context.period.instant < basis.basisDate ||
        !entity || context.entity?.scheme !== entity.scheme || context.entity.identifier !== entity.identifier) return unavailable;
    return { status: "reference-matched", shareClass: basis.shareClass, basisDate: basis.basisDate, declaration: "source-reviewed-by-caller", proof: basis.proof,
        ...(basis.dividendStatus === undefined ? {} : { dividendStatus: basis.dividendStatus }) };
}
