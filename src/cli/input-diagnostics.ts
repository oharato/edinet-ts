import { readRegularFile } from "../platform/pipeline/import-local-balance-sheets";

/** Only messages composed by the CLI may be shown; parser errors may contain input values. */
export class CliInputError extends Error {}
export function readCliJSON(file: string, label: string, maxBytes: number): unknown {
  let bytes: Uint8Array;
  try {
    bytes = readRegularFile(file, maxBytes).bytes;
  } catch (error) {
    throw new CliInputError(
      `${label}：${(error as NodeJS.ErrnoException).code === "ENOENT" ? "ファイルが見つかりません" : cliInputMessage(error, "通常ファイル・容量・読取権限を確認してください")}`,
    );
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new CliInputError(`${label}：JSON構文またはUTF-8が不正です`);
  }
}
export function cliInputMessage(error: unknown, fallback: string): string {
  if (error instanceof CliInputError) return error.message;
  const knownMessages = [
    "入力ファイルがbyte上限を超えています",
    "原本XMLがUTF-8 byte上限（64MiB）を超えています",
    "整形式の原本XMLが必要です（DOCTYPE非対応）",
  ];
  return error instanceof Error
    ? (knownMessages.find((message) => message === error.message) ?? fallback)
    : fallback;
}
