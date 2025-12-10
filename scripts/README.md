# Type Documentation Generator

This script automatically generates type documentation from TypeScript source files.

## How it works

The `generate-type-docs.js` script:

1. Parses TypeScript source files using the TypeScript Compiler API
2. Extracts specified interface definitions
3. Reads JSDoc comments (/** ... */) from each field
4. Generates `src/utils/type-doc-generator.ts` with structured documentation

Currently extracts from `src/edinet-xbrl-object.ts`:
- `KeyMetrics` - 財務・業績の主要指標
- `LargeShareholdingInfo` - 大量保有報告書の情報
- `QualitativeInfo` - 定性的情報（テキスト）

## Usage

The script runs automatically during the build process:

```bash
npm run build
```

Or run it manually:

```bash
npm run generate-type-docs
```

## Adding More Interfaces

To add more interfaces to the documentation, edit `scripts/generate-type-docs.js`:

1. Update the `interfaceConfig` array in the `main()` function
2. Add the source file path and interface names
3. Optionally add a Japanese description in `descriptionMap`

Example:

```javascript
const interfaceConfig = [
    {
        sourceFile: path.join(__dirname, "..", "src", "edinet-xbrl-object.ts"),
        interfaces: ["KeyMetrics", "LargeShareholdingInfo", "QualitativeInfo"]
    },
    {
        sourceFile: path.join(__dirname, "..", "src", "your-file.ts"),
        interfaces: ["YourInterface"]
    }
];
```

## Maintenance

When you update interface definitions in source files:

1. Update the JSDoc comments above each field
2. Run `npm run generate-type-docs` to regenerate the documentation
3. The CLI help (`--help-types`) will automatically show the updated information

## Generated File

- **DO NOT** edit `src/utils/type-doc-generator.ts` manually
- This file is auto-generated and will be overwritten
- Source of truth is the TypeScript source files defined in `interfaceConfig`
