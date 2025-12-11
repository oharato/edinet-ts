
import { TypeDocumentation, DocumentTypeResponse, DOCUMENT_TYPE_RESPONSES } from "./type-doc-defs";

/**
 * 型ドキュメント定義（TypeDocumentation）からMarkdownを生成する
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
 * 書類種別レスポンス（DocumentTypeResponse）からMarkdownを生成する
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
 * 完全なヘルプMarkdownを生成する
 */
export function generateFullHelpMarkdown(): string {
    let md = `# getコマンドのレスポンス形式\n\n`;
    md += `このコマンドは、書類の種別 (--type) に応じて異なるJSONを返します。\n`;
    md += `以下に各書類種別で返されるJSONのキー、日本語名、型を示します。\n\n`;
    md += `## 書類種別の指定方法\n\n`;
    md += `--type オプションには、以下のいずれかの形式で指定できます:\n`;
    md += `- エイリアス名 (例: annual, quarterly, largeshareholding)\n`;
    md += `- 書類種別コード (例: 120, 140, 340)\n\n`;

    for (const docType of DOCUMENT_TYPE_RESPONSES) {
        md += generateDocumentTypeMarkdown(docType);
    }

    return md;
}
