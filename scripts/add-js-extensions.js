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
    
    // Handle dynamic imports import("./path") separately for clarity
    content = content.replace(/import\s*\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g, (match, importPath) => {
        if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
            return match;
        }
        modified = true;
        return match.replace(importPath, importPath + '.js');
    });
    
    // Handle regular import/export statements with from clause
    content = content.replace(/from\s+['"](\.\.?\/[^'"]+)['"]/g, (match, importPath) => {
        if (importPath.endsWith('.js') || importPath.endsWith('.json')) {
            return match;
        }
        modified = true;
        return match.replace(importPath, importPath + '.js');
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

// Create package.json in dist to mark it as ESM
const distPackageJson = {
    type: 'module'
};

fs.writeFileSync(
    path.join(distDir, 'package.json'),
    JSON.stringify(distPackageJson, null, 2) + '\n',
    'utf8'
);

console.log('✓ Created dist/package.json with "type": "module"');