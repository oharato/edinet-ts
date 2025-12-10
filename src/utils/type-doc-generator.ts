/**
 * Type documentation generator
 * Generates markdown documentation from TypeScript interfaces
 */

export interface FieldInfo {
    key: string;
    japaneseLabel: string;
    type: string;
}

export interface TypeDocumentation {
    typeName: string;
    description: string;
    fields: FieldInfo[];
}

/**
 * KeyMetrics interface documentation
 * Based on src/edinet-xbrl-object.ts
 */
export const KEY_METRICS_DOC: TypeDocumentation = {
    typeName: "KeyMetrics",
    description: "財務・業績の主要指標",
    fields: [
        { key: "netSales", japaneseLabel: "売上高", type: "number | undefined" },
        { key: "operatingIncome", japaneseLabel: "営業利益", type: "number | undefined" },
        { key: "ordinaryIncome", japaneseLabel: "経常利益", type: "number | undefined" },
        { key: "netIncome", japaneseLabel: "当期純利益 (親会社株主に帰属する当期純利益)", type: "number | undefined" },
        { key: "netAssets", japaneseLabel: "純資産", type: "number | undefined" },
        { key: "totalAssets", japaneseLabel: "総資産", type: "number | undefined" },
        { key: "operatingCashFlow", japaneseLabel: "営業活動によるキャッシュ・フロー", type: "number | undefined" },
        { key: "investingCashFlow", japaneseLabel: "投資活動によるキャッシュ・フロー", type: "number | undefined" },
        { key: "financingCashFlow", japaneseLabel: "財務活動によるキャッシュ・フロー", type: "number | undefined" },
        { key: "cashAndEquivalents", japaneseLabel: "現金及び現金同等物の期末残高", type: "number | undefined" },
        { key: "earningsPerShare", japaneseLabel: "EPS (1株当たり当期純利益)", type: "number | undefined" },
        { key: "bookValuePerShare", japaneseLabel: "BPS (1株当たり純資産)", type: "number | undefined" },
        { key: "equityToTotalAssetsRatio", japaneseLabel: "自己資本比率", type: "number | undefined" },
        { key: "rateOfReturnOnEquity", japaneseLabel: "ROE (自己資本利益率)", type: "number | undefined" },
        { key: "priceEarningsRatio", japaneseLabel: "PER (株価収益率)", type: "number | undefined" },
        { key: "payoutRatio", japaneseLabel: "配当性向", type: "number | undefined" },
        { key: "numberOfIssuedShares", japaneseLabel: "発行済株式総数", type: "number | undefined" },
        { key: "dividendPaidPerShare", japaneseLabel: "1株当たり配当額", type: "number | undefined" }
    ]
};

/**
 * LargeShareholdingInfo interface documentation
 * Based on src/edinet-xbrl-object.ts
 */
export const LARGE_SHAREHOLDING_INFO_DOC: TypeDocumentation = {
    typeName: "LargeShareholdingInfo",
    description: "大量保有報告書の情報",
    fields: [
        { key: "filerName", japaneseLabel: "提出者名 (氏名又は名称)", type: "string | undefined" },
        { key: "issuerName", japaneseLabel: "発行者名 (氏名又は名称)", type: "string | undefined" },
        { key: "holdingRatio", japaneseLabel: "保有割合 (%)", type: "number | undefined" },
        { key: "prevHoldingRatio", japaneseLabel: "直前報告書における保有割合 (%)", type: "number | undefined" },
        { key: "jointHoldersCount", japaneseLabel: "共同保有者の数", type: "number | undefined" }
    ]
};

/**
 * Common metadata fields included in get command response
 */
export const COMMON_METADATA_DOC: TypeDocumentation = {
    typeName: "共通メタデータ",
    description: "全ての書類に含まれるメタデータ",
    fields: [
        { key: "docID", japaneseLabel: "書類管理ID", type: "string" },
        { key: "filerName", japaneseLabel: "提出者名", type: "string" },
        { key: "edinetCode", japaneseLabel: "提出者のEDINETコード", type: "string" },
        { key: "docDescription", japaneseLabel: "書類名/件名", type: "string" },
        { key: "submitDate", japaneseLabel: "提出日", type: "string" }
    ]
};

/**
 * Document type to response structure mapping
 */
export interface DocumentTypeResponse {
    documentType: string;
    japaneseLabel: string;
    description: string;
    responseIncludes: TypeDocumentation[];
}

export const DOCUMENT_TYPE_RESPONSES: DocumentTypeResponse[] = [
    {
        documentType: "Annual (有価証券報告書)",
        japaneseLabel: "有価証券報告書",
        description: "年次の有価証券報告書。財務情報を含みます。",
        responseIncludes: [COMMON_METADATA_DOC, KEY_METRICS_DOC]
    },
    {
        documentType: "Quarterly (四半期報告書)",
        japaneseLabel: "四半期報告書",
        description: "四半期ごとの報告書。財務情報を含みます。",
        responseIncludes: [COMMON_METADATA_DOC, KEY_METRICS_DOC]
    },
    {
        documentType: "SemiAnnual (半期報告書)",
        japaneseLabel: "半期報告書",
        description: "半期ごとの報告書。財務情報を含みます。",
        responseIncludes: [COMMON_METADATA_DOC, KEY_METRICS_DOC]
    },
    {
        documentType: "LargeShareholding (大量保有報告書)",
        japaneseLabel: "大量保有報告書",
        description: "大量保有報告書、変更報告書、訂正報告書。保有情報を含みます。",
        responseIncludes: [COMMON_METADATA_DOC, LARGE_SHAREHOLDING_INFO_DOC]
    }
];

/**
 * Generate markdown documentation for a type
 */
export function generateTypeMarkdown(doc: TypeDocumentation): string {
    let md = `### ${doc.typeName}\n\n`;
    md += `${doc.description}\n\n`;
    md += `| キー | 日本語名 | 型 |\n`;
    md += `| --- | --- | --- |\n`;
    
    for (const field of doc.fields) {
        md += `| \`${field.key}\` | ${field.japaneseLabel} | \`${field.type}\` |\n`;
    }
    
    return md;
}

/**
 * Generate markdown documentation for document type responses
 */
export function generateDocumentTypeMarkdown(docTypeResponse: DocumentTypeResponse): string {
    let md = `\n## ${docTypeResponse.documentType}\n\n`;
    md += `${docTypeResponse.description}\n\n`;
    
    for (const typeDoc of docTypeResponse.responseIncludes) {
        md += generateTypeMarkdown(typeDoc);
        md += `\n`;
    }
    
    return md;
}

/**
 * Generate full help documentation
 */
export function generateFullHelpMarkdown(): string {
    let md = `# getコマンドのレスポンス形式\n\n`;
    md += `このコマンドは、書類の種別 (--type) に応じて異なるJSONを返します。\n`;
    md += `以下に各書類種別で返されるJSONのキー、日本語名、型を示します。\n`;
    
    for (const docType of DOCUMENT_TYPE_RESPONSES) {
        md += generateDocumentTypeMarkdown(docType);
    }
    
    return md;
}
