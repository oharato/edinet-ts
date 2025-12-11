#!/usr/bin/env node
/**
 * TypeScriptソースファイルから型ドキュメントを自動生成
 * ts-morphを使用してインターフェース定義とJSDocコメントを抽出
 */

const { Project } = require("ts-morph");
const path = require("path");
const fs = require("fs");

/**
 * インターフェース宣言からフィールド情報を抽出
 */
function extractInterfaceInfo(interfaceDecl) {
    const fields = [];

    // インターフェースの説明を抽出
    const interfaceJsDocs = interfaceDecl.getJsDocs();
    let description = interfaceDecl.getName();
    if (interfaceJsDocs.length > 0) {
        description = interfaceJsDocs[0].getDescription().trim();
        // 改行を整理
        description = description
            .split('\n')
            .map(line => line.trim())
            .filter(line => line.length > 0)
            .join(' ');
    }

    interfaceDecl.getProperties().forEach(prop => {
        const key = prop.getName();
        const typeNode = prop.getTypeNode();
        // 型ノードのテキストを取得、または型オブジェクトのテキストにフォールバック
        let type = typeNode ? typeNode.getText() : prop.getType().getText();

        // オプショナルかどうかを確認
        const isOptional = prop.hasQuestionToken();
        if (isOptional) {
            type += " (optional)";
        }

        // JSDocの説明を取得
        const jsDocs = prop.getJsDocs();
        let japaneseLabel = "";
        if (jsDocs.length > 0) {
            japaneseLabel = jsDocs[0].getDescription().trim();

            // 説明文の改行を整理
            japaneseLabel = japaneseLabel
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .join(' ');
        }

        fields.push({ key, japaneseLabel, type });
    });

    return {
        name: interfaceDecl.getName(),
        description,
        fields
    };
}

/**
 * インターフェースから書類種別定義を抽出
 */
function extractDocumentTypeInfo(interfaceDecl) {
    const jsDocs = interfaceDecl.getJsDocs();
    if (jsDocs.length === 0) return null;

    const description = jsDocs[0].getDescription().trim().split('\n').join(' ');

    const tags = jsDocs[0].getTags();
    let documentType = "";
    let japaneseLabel = "";

    for (const tag of tags) {
        const tagName = tag.getTagName();
        const tagText = tag.getCommentText ? tag.getCommentText() : ""; // 異なるts-morphバージョンまたはフォールバックの処理

        if (tagName === "documentType") {
            documentType = tagText ? tagText.trim() : "";
        } else if (tagName === "japaneseLabel") {
            japaneseLabel = tagText ? tagText.trim() : "";
        }
    }

    if (!documentType || !japaneseLabel) {
        return null;
    }

    const responseIncludes = [];
    interfaceDecl.getProperties().forEach(prop => {
        const typeName = prop.getTypeNode() ? prop.getTypeNode().getText() : prop.getType().getText();
        // 型名をDOC定数に直接マッピング
        // 命名規則を前提とする: TypeName -> TYPE_NAME_DOC
        const docConstant = typeName.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '') + "_DOC";
        responseIncludes.push(docConstant);
    });

    return {
        documentType,
        japaneseLabel,
        description,
        responseIncludes
    };
}

/**
 * 型ドキュメント用のTypeScriptコードを生成（データ定義のみ）
 */
function generateTypeDocCode(project, outputFilePath, interfaces, docTypes) {
    // strict: true は既存の場合クリーンアップするか新規作成することを意味する
    // スクラッチから生成するため、メモリ上に新しいソースファイルを作成
    // 既存ファイルを変更する場合は addSourceFileAtPath を使用
    // 上書きする場合は作成すればよい
    const sourceFile = project.createSourceFile(outputFilePath, "", { overwrite: true });

    sourceFile.addStatements([
        "/**",
        " * 自動生成された型ドキュメント定義",
        " * ts-morphを使用して生成",
        " * このファイルを手動で編集しないでください - 'npm run generate-type-docs' を実行して再生成してください",
        " */"
    ]);

    // 1. インターフェース定義
    sourceFile.addInterfaces([
        {
            name: "FieldInfo",
            isExported: true,
            properties: [
                { name: "key", type: "string" },
                { name: "japaneseLabel", type: "string" },
                { name: "type", type: "string" }
            ]
        },
        {
            name: "TypeDocumentation",
            isExported: true,
            properties: [
                { name: "typeName", type: "string" },
                { name: "description", type: "string" },
                { name: "fields", type: "FieldInfo[]" }
            ]
        }
    ]);

    // 2. 各インターフェースの定数を生成
    for (const iface of interfaces) {
        const constName = iface.name.replace(/([A-Z])/g, '_$1').toUpperCase().replace(/^_/, '') + "_DOC";

        // イニシャライザ用のオブジェクトリテラルテキストを構築
        // 文字列のエスケープを安全に処理するためにJSON.stringifyを使用
        const fieldsArrayText = "[\n" + iface.fields.map(field => {
            return `        { key: ${JSON.stringify(field.key)}, japaneseLabel: ${JSON.stringify(field.japaneseLabel)}, type: ${JSON.stringify(field.type)} }`;
        }).join(",\n") + "\n    ]";

        sourceFile.addVariableStatement({
            isExported: true,
            declarationKind: "const", // Using string "const" for VariableDeclarationKind.Const
            declarations: [{
                name: constName,
                type: "TypeDocumentation",
                initializer: `{\n    typeName: ${JSON.stringify(iface.name)},\n    description: ${JSON.stringify(iface.description)},\n    fields: ${fieldsArrayText}\n}`
            }]
        });
    }

    // 3. 書類種別レスポンスインターフェースを追加
    sourceFile.addInterface({
        name: "DocumentTypeResponse",
        isExported: true,
        properties: [
            { name: "documentType", type: "string" },
            { name: "japaneseLabel", type: "string" },
            { name: "description", type: "string" },
            { name: "responseIncludes", type: "TypeDocumentation[]" }
        ]
    });

    // 4. DOCUMENT_TYPE_RESPONSES定数を生成
    const docTypesArrayText = "[\n" + docTypes.map(dt => {
        const responseIncludesText = "[" + dt.responseIncludes.join(", ") + "]";
        return `    {\n        documentType: ${JSON.stringify(dt.documentType)},\n        japaneseLabel: ${JSON.stringify(dt.japaneseLabel)},\n        description: ${JSON.stringify(dt.description)},\n        responseIncludes: ${responseIncludesText}\n    }`;
    }).join(",\n") + "\n]";

    sourceFile.addVariableStatement({
        isExported: true,
        declarationKind: "const",
        declarations: [{
            name: "DOCUMENT_TYPE_RESPONSES",
            type: "DocumentTypeResponse[]",
            initializer: docTypesArrayText
        }]
    });

    return sourceFile;
}

// メイン実行処理
function main() {
    // 設定: どのファイルからどのインターフェースを抽出するか定義
    const interfaceConfig = [
        {
            sourceFile: path.join(__dirname, "..", "src", "edinet-xbrl-object.ts"),
            interfaces: ["CommonMetadata", "KeyMetrics", "LargeShareholdingInfo", "QualitativeInfo"]
        },
        {
            sourceFile: path.join(__dirname, "..", "src", "types", "jppfs_cor_taxonomy.ts"),
            interfaces: ["JppfsCorTaxonomy"]
        },
        {
            sourceFile: path.join(__dirname, "..", "src", "types", "jpcrp_cor_taxonomy.ts"),
            interfaces: ["JpcrpCorTaxonomy"]
        }
    ];

    const documentTypeConfig = [
        {
            sourceFile: path.join(__dirname, "..", "src", "edinet-xbrl-object.ts"),
            interfaces: [
                "AnnualResponse",
                "QuarterlyResponse",
                "SemiAnnualResponse",
                "ExtraordinaryResponse",
                "LargeShareholdingResponse",
                "SecuritiesRegistrationResponse",
                "InternalControlResponse",
                "TenderOfferResponse"
            ]
        }
    ];

    const project = new Project();
    const allInterfaces = [];
    const allDocTypes = [];

    // 通常のインターフェースを処理
    for (const config of interfaceConfig) {
        // まだ追加されていない場合のみ追加
        let sourceFile = project.getSourceFile(config.sourceFile);
        if (!sourceFile) {
            sourceFile = project.addSourceFileAtPath(config.sourceFile);
        }

        for (const interfaceName of config.interfaces) {
            try {
                const interfaceDecl = sourceFile.getInterfaceOrThrow(interfaceName);
                const info = extractInterfaceInfo(interfaceDecl);

                allInterfaces.push(info);
                console.log(`  ✓ Parsed Interface ${interfaceName}: ${info.fields.length} fields`);
            } catch (error) {
                console.error(`\nError: Failed to parse interface '${interfaceName}' from ${config.sourceFile}`);
                console.error(error.message);
                process.exit(1);
            }
        }
    }

    // 書類種別レスポンスインターフェースを処理
    for (const config of documentTypeConfig) {
        // まだ追加されていない場合のみ追加
        let sourceFile = project.getSourceFile(config.sourceFile);
        if (!sourceFile) {
            sourceFile = project.addSourceFileAtPath(config.sourceFile);
        }

        for (const interfaceName of config.interfaces) {
            try {
                const interfaceDecl = sourceFile.getInterfaceOrThrow(interfaceName);
                const docInfo = extractDocumentTypeInfo(interfaceDecl);

                if (docInfo) {
                    allDocTypes.push(docInfo);
                    console.log(`  ✓ Parsed DocumentType ${interfaceName}: ${docInfo.documentType}`);
                } else {
                    console.warn(`  ! Skipped DocumentType ${interfaceName}: Missing JSDoc tags`);
                }
            } catch (error) {
                console.error(`\nError: Failed to parse interface '${interfaceName}' from ${config.sourceFile}`);
                console.error(error.message);
                process.exit(1);
            }
        }
    }

    // コード生成
    const outputFilePath = path.join(__dirname, "..", "src", "utils", "type-doc-defs.ts");
    const sourceFile = generateTypeDocCode(project, outputFilePath, allInterfaces, allDocTypes);

    // 出力を書き込み
    sourceFile.saveSync();

    console.log(`\n✓ Generated type documentation: ${outputFilePath}`);
    console.log(`  Total interfaces: ${allInterfaces.length}`);
    console.log(`  Total document types: ${allDocTypes.length}`);
}

main();
