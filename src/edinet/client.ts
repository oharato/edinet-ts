import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pipeline } from "node:stream/promises";
import JSZip from "jszip";

export interface EdinetDocumentSummary {
  docId: string;
  edinetCode: string;
  secCode?: string;
  filerName: string;
  docTypeCode: string;
  docDescription: string;
  submitDateTime: string;
  periodEnd?: string;
}

export interface EdinetClientOptions {
  apiKey?: string;
  cacheDir?: string;
}

export class EdinetClient {
  private apiKey?: string;
  private cacheDir: string;
  private baseUrl = "https://api.edinet-fsa.go.jp/api/v2";

  constructor(options: EdinetClientOptions = {}) {
    this.apiKey = options.apiKey || process.env.EDINET_API_KEY;
    this.cacheDir = options.cacheDir || resolve(process.cwd(), "data/edinet-cache");

    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true });
    }
  }

  /**
   * 指定した提出日の書類一覧を取得します。
   * @param date YYYY-MM-DD 形式の日付
   */
  public async getDocumentList(date: string): Promise<EdinetDocumentSummary[]> {
    const url = new URL(`${this.baseUrl}/documents.json`);
    url.searchParams.set("date", date);
    url.searchParams.set("type", "2");
    if (this.apiKey) {
      url.searchParams.set("Subscription-Key", this.apiKey);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Failed to fetch EDINET document list: ${response.status} ${response.statusText}`,
      );
    }

    const json = (await response.json()) as { results?: any[] };
    const results = json.results || [];

    return results.map((item) => ({
      docId: item.docID,
      edinetCode: item.edinetCode,
      secCode: item.secCode,
      filerName: item.filerName,
      docTypeCode: item.docTypeCode,
      docDescription: item.docDescription,
      submitDateTime: item.submitDateTime,
      periodEnd: item.periodEnd,
    }));
  }

  /**
   * 指定した日付範囲内の書類をdocTypeで絞り込んで取得します。
   */
  public async getReportsInRange(
    startDate: string,
    endDate: string,
    docTypes: string[] = ["120"],
    onProgress?: (date: string, count: number) => void,
  ): Promise<EdinetDocumentSummary[]> {
    const dates: string[] = [];
    let current = new Date(startDate);
    const end = new Date(endDate);

    while (current <= end) {
      dates.push(current.toISOString().slice(0, 10));
      current.setDate(current.getDate() + 1);
    }

    const allReports: EdinetDocumentSummary[] = [];

    for (const date of dates) {
      try {
        const docs = await this.getDocumentList(date);
        const reports = docs.filter((d) => docTypes.includes(d.docTypeCode));
        allReports.push(...reports);
        if (onProgress) {
          onProgress(date, reports.length);
        }
        // レート制限への配慮
        await new Promise((r) => setTimeout(r, 200));
      } catch (e) {
        // 土日祝日など書類がない日はスキップまたは空配列
      }
    }

    return allReports;
  }

  /**
   * 指定した日付範囲内の有価証券報告書（docTypeCode: "120"）の一覧を取得します。
   */
  public async getAnnualReportsInRange(
    startDate: string,
    endDate: string,
    onProgress?: (date: string, count: number) => void,
  ): Promise<EdinetDocumentSummary[]> {
    return this.getReportsInRange(startDate, endDate, ["120"], onProgress);
  }

  /**
   * 指定した書類IDのXBRLファイル（ZIPを展開したXMLテキスト）を取得します。
   * キャッシュがあればローカルから返します。
   */
  public async getXbrlContent(docId: string): Promise<string> {
    const cachePath = join(this.cacheDir, `${docId}.xbrl`);
    if (existsSync(cachePath)) {
      const { readFileSync } = await import("node:fs");
      return readFileSync(cachePath, "utf8");
    }

    // EDINET API から ZIP をダウンロード
    const url = new URL(`${this.baseUrl}/documents/${docId}`);
    url.searchParams.set("type", "1"); // 1: 提出本文書及び監査報告書 (ZIP)
    if (this.apiKey) {
      url.searchParams.set("Subscription-Key", this.apiKey);
    }

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(
        `Failed to download document ${docId}: ${response.status} ${response.statusText}`,
      );
    }

    const arrayBuffer = await response.arrayBuffer();
    const zip = await JSZip.loadAsync(arrayBuffer);

    // PublicDoc/ 配下の .xbrl ファイルを探す
    let xbrlFile: JSZip.JSZipObject | null = null;
    zip.forEach((relativePath, file) => {
      if (relativePath.includes("PublicDoc/") && relativePath.endsWith(".xbrl")) {
        xbrlFile = file;
      }
    });

    if (!xbrlFile) {
      // プレフィックスのない .xbrl ファイルを探す
      zip.forEach((relativePath, file) => {
        if (relativePath.endsWith(".xbrl")) {
          xbrlFile = file;
        }
      });
    }

    if (!xbrlFile) {
      throw new Error(`No XBRL file found in ZIP for document ${docId}`);
    }

    const xbrlContent = await (xbrlFile as JSZip.JSZipObject).async("text");

    // キャッシュ保存
    const { writeFileSync } = await import("node:fs");
    writeFileSync(cachePath, xbrlContent, "utf8");

    return xbrlContent;
  }
}
