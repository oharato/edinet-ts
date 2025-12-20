import { describe, it, expect, beforeAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

describe("ESM Import Resolution", () => {
    const DIST_DIR = path.resolve(__dirname, "../dist");

    beforeAll(() => {
        // Ensure dist directory exists by running build if needed
        if (!fs.existsSync(DIST_DIR)) {
            console.log("Building project for ESM tests...");
            execSync("npm run build", { cwd: path.resolve(__dirname, "..") });
        }
    });

    /**
     * Recursively find all .js and .d.ts files in dist directory
     */
    function findDistFiles(dir: string, ext: string): string[] {
        const files: string[] = [];
        const items = fs.readdirSync(dir);

        for (const item of items) {
            const fullPath = path.join(dir, item);
            const stat = fs.statSync(fullPath);

            if (stat.isDirectory()) {
                files.push(...findDistFiles(fullPath, ext));
            } else if (item.endsWith(ext)) {
                files.push(fullPath);
            }
        }

        return files;
    }

    /**
     * Extract all relative import/export paths from a file
     */
    function extractRelativeImports(filePath: string): string[] {
        const content = fs.readFileSync(filePath, "utf-8");
        const imports: string[] = [];

        // Match import/export statements with relative paths
        const patterns = [
            /from\s+['"](\..+?)['"]/g,
            /import\s*\(\s*['"](\..+?)['"]\s*\)/g, // dynamic imports
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(content)) !== null) {
                imports.push(match[1]);
            }
        }

        return imports;
    }

    it("should add .js extensions to all relative imports in .js files", () => {
        const jsFiles = findDistFiles(DIST_DIR, ".js");
        expect(jsFiles.length).toBeGreaterThan(0);

        const filesWithMissingExtensions: { file: string; imports: string[] }[] = [];

        for (const file of jsFiles) {
            const imports = extractRelativeImports(file);
            const missingExtensions = imports.filter(
                (imp) => !imp.endsWith(".js") && !imp.endsWith(".json")
            );

            if (missingExtensions.length > 0) {
                filesWithMissingExtensions.push({
                    file: path.relative(DIST_DIR, file),
                    imports: missingExtensions,
                });
            }
        }

        // Assert no files have missing extensions
        if (filesWithMissingExtensions.length > 0) {
            const errorMessage = filesWithMissingExtensions
                .map(
                    ({ file, imports }) =>
                        `${file}:\n  ${imports.join("\n  ")}`
                )
                .join("\n\n");
            throw new Error(
                `Found relative imports without .js extension:\n\n${errorMessage}`
            );
        }

        expect(filesWithMissingExtensions).toHaveLength(0);
    });

    it("should add .js extensions to all relative imports in .d.ts files", () => {
        const dtsFiles = findDistFiles(DIST_DIR, ".d.ts");
        expect(dtsFiles.length).toBeGreaterThan(0);

        const filesWithMissingExtensions: { file: string; imports: string[] }[] = [];

        for (const file of dtsFiles) {
            const imports = extractRelativeImports(file);
            const missingExtensions = imports.filter(
                (imp) => !imp.endsWith(".js") && !imp.endsWith(".json")
            );

            if (missingExtensions.length > 0) {
                filesWithMissingExtensions.push({
                    file: path.relative(DIST_DIR, file),
                    imports: missingExtensions,
                });
            }
        }

        // Assert no files have missing extensions
        if (filesWithMissingExtensions.length > 0) {
            const errorMessage = filesWithMissingExtensions
                .map(
                    ({ file, imports }) =>
                        `${file}:\n  ${imports.join("\n  ")}`
                )
                .join("\n\n");
            throw new Error(
                `Found relative imports without .js extension in .d.ts files:\n\n${errorMessage}`
            );
        }

        expect(filesWithMissingExtensions).toHaveLength(0);
    });

    it("should have .js extension in dist/index.js exports", () => {
        const indexPath = path.join(DIST_DIR, "index.js");
        expect(fs.existsSync(indexPath)).toBe(true);

        const content = fs.readFileSync(indexPath, "utf-8");
        const exports = extractRelativeImports(indexPath);

        expect(exports.length).toBeGreaterThan(0);
        
        // All exports should have .js extension
        for (const exp of exports) {
            expect(exp).toMatch(/\.js$/);
        }

        // Check specific exports mentioned in the issue
        expect(content).toContain('from "./db/edinet-repository.js"');
        expect(content).toContain('from "./edinet-xbrl-parser.js"');
    });

    it("should be able to import from the built package in ESM context", async () => {
        // This test validates that the package can be imported successfully
        // by dynamically importing the built index.js
        const indexPath = path.join(DIST_DIR, "index.js");
        
        // Convert to file:// URL for ESM import
        const fileUrl = `file://${indexPath}`;
        
        try {
            const module = await import(fileUrl);
            
            // Verify key exports are available
            expect(module.EdinetXbrlParser).toBeDefined();
            expect(module.EdinetRepository).toBeDefined();
            expect(module.EdinetXbrlDownloader).toBeDefined();
            expect(module.Edinet).toBeDefined();
            
            // Verify they are constructors/classes
            expect(typeof module.EdinetXbrlParser).toBe("function");
            expect(typeof module.EdinetRepository).toBe("function");
        } catch (error) {
            throw new Error(
                `Failed to import built package: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    });
});