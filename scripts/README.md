# Type Documentation Generator

This script automatically generates type documentation from TypeScript source files.

## How it works

The `generate-type-docs.js` script:

1. Parses `src/edinet-xbrl-object.ts` using the TypeScript Compiler API
2. Extracts interface definitions for `KeyMetrics` and `LargeShareholdingInfo`
3. Reads JSDoc comments (/** ... */) from each field
4. Generates `src/utils/type-doc-generator.ts` with structured documentation

## Usage

The script runs automatically during the build process:

```bash
npm run build
```

Or run it manually:

```bash
npm run generate-type-docs
```

## Maintenance

When you update interface definitions in `src/edinet-xbrl-object.ts`:

1. Update the JSDoc comments above each field
2. Run `npm run generate-type-docs` to regenerate the documentation
3. The CLI help (`--help-types`) will automatically show the updated information

## Generated File

- **DO NOT** edit `src/utils/type-doc-generator.ts` manually
- This file is auto-generated and will be overwritten
- Source of truth is `src/edinet-xbrl-object.ts`
