import { createHash } from "node:crypto";
import { loadZipArchive } from "../../../core/archive/read-document-zip";
import {
  parseEdinetCodeList,
  type CompanyMasterSnapshot,
} from "../../../domain/companies/company-master";
/** 公式固定URLを1回取得。認証不要、元ZIP/CSVのhashを保持し、DBやファイルは変更しません。 */
export async function fetchEdinetCompanyMaster(
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<CompanyMasterSnapshot> {
  const timeout = options.timeoutMs ?? 30000;
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 2147483647)
    throw new Error("取得期限が不正です");
  const sourceUrl = "https://disclosure2dl.edinet-fsa.go.jp/searchdocument/codelist/Edinetcode.zip";
  const signal = options.signal
    ? AbortSignal.any([options.signal, AbortSignal.timeout(timeout)])
    : AbortSignal.timeout(timeout);
  const response = await fetch(sourceUrl, { signal, redirect: "error" });
  if (!response.ok || !response.body) throw new Error("公式コードリストを取得できませんでした");
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 8 * 1024 * 1024) throw new Error("コードリストZIPの受信上限を超えました");
      chunks.push(value);
    }
  } catch (error) {
    try {
      void reader.cancel().catch(() => {});
    } catch {
      /* 元エラーを保持 */
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = Buffer.concat(chunks),
    archive = await loadZipArchive(bytes, {
      compressedBytes: 8 * 1024 * 1024,
      entryBytes: 32 * 1024 * 1024,
      totalBytes: 32 * 1024 * 1024,
      entries: 10,
    });
  const candidates = archive.entries.filter((entry) => !entry.dir && entry.name.endsWith(".csv"));
  if (candidates.length !== 1 || candidates[0].uncompressedSize > 32 * 1024 * 1024)
    throw new Error("公式コードリストCSVが一意でないか大きすぎます");
  const csv = await archive.readEntry(candidates[0].name);
  signal.throwIfAborted();
  return {
    ...parseEdinetCodeList(new TextDecoder("shift_jis", { fatal: true }).decode(csv), {
      sourceUrl,
      observedAt: new Date().toISOString(),
    }),
    archiveSha256: createHash("sha256").update(bytes).digest("hex"),
    originalCsvSha256: createHash("sha256").update(csv).digest("hex"),
  };
}
