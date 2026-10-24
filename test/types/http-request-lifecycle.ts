import { Edinet, EdinetXbrlDownloader, EdinetRequestError, EdinetRequestErrorCode, EdinetDocumentType, type EdinetRequestOptions } from "../../src/index";
const client = new EdinetXbrlDownloader({ requestTimeoutMs: 30_000, maxRetries: 2 });
const request: EdinetRequestOptions = { signal: new AbortController().signal };
void client.search("2026-01-01", undefined, request);
void client.searchPeriod("2026-01-01", "2026-01-02", undefined, request);
void client.download("SYNTHETIC1", undefined, request);
void client.fetchXbrl("SYNTHETIC1", request);
void client.findLatest("0000", EdinetDocumentType.AnnualCards, 2, request);
void client.downloadByTicker("0000", undefined, "2026-01-01", EdinetDocumentType.AnnualCards, request);
function history(facade: Edinet) { return facade.getFinancialHistory("0000", 5, EdinetDocumentType.AnnualCards, request); }
function errorCode(error: unknown): string | undefined {
    if (error instanceof EdinetRequestError && error.code === EdinetRequestErrorCode.Timeout) return error.code;
}
void history; void errorCode;
// @ts-expect-error signal以外のキャンセル指定は受け付けない
void client.fetchXbrl("SYNTHETIC1", { cancel: true });
// @ts-expect-error 時間制限は数値
new EdinetXbrlDownloader({ requestTimeoutMs: "30000" });
// @ts-expect-error 未定義の分類を作らない
new EdinetRequestError("unknown");
