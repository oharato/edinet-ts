#!/usr/bin/env node
/**
 * Post-build script to add .js extensions to all relative imports/exports
 * This is required for proper ESM resolution in Node.js
 */

const fs = require('fs');
const path = require('path');

/**
 * Recursively find all .js and .d.ts files in a directory
 */
function findJsFiles(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    
    files.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isDirectory()) {
            findJsFiles(filePath, fileList);
        } else if (file.endsWith('.js') || file.endsWith('.d.ts')) {
            fileList.push(filePath);
        }
    });
    
    return fileList;
}

/**
 * Add .js extension to relative imports/exports in a file
 */
function addJsExtensions(filePath) {
    let content = fs.readFileSync(filePath, 'utf8');
    let modified = false;
    
    // Pattern to match import/export statements with relative paths without extensions
    // Matches: from "./path" or from "./path/file"
    // Doesn't match: from "./path.js" or from "package-name"
    const patterns = [
        // export * from "./path" or export { } from "./path"
        /from\s+['"](\.\.?\/[^'"]+)(['"])/g,
        // import ... from "./path"
        /import\s+.*\s+from\s+['"](\.\.?\/[^'"]+)(['"])/g,
        // import("./path") - dynamic imports in type declarations
        /import\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g,
    ];
    
    patterns.forEach(pattern => {
        content = content.replace(pattern, (match, importPath, quote) => {
            // Skip if already has .js or .json extension
            if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
                return match;
            }
            
            modified = true;
            
            // For dynamic imports import("./path"), quote is not captured separately
            if (match.startsWith('import(')) {
                return match.replace(importPath, importPath + '.js');
            }
            
            return match.replace(importPath + quote, importPath + '.js' + quote);
        });
    });
    
    if (modified) {
        fs.writeFileSync(filePath, content, 'utf8');
        console.log(`✓ Updated: ${path.relative(process.cwd(), filePath)}`);
    }
}

// Main execution
const distDir = path.join(__dirname, '..', 'dist');

if (!fs.existsSync(distDir)) {
    console.error('Error: dist directory not found. Run tsc first.');
    process.exit(1);
}

console.log('Adding .js extensions to imports/exports...\n');

const files = findJsFiles(distDir);
files.forEach(addJsExtensions);

console.log(`\n✓ Processed ${files.length} files`);
