#!/usr/bin/env node
// The existing independent Python verifier remains the canonical source.
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=path.join(root,'scripts/roadmap/verify-financial-values.py');
for(const directory of ['src/assets','dist/assets']){fs.mkdirSync(path.join(root,directory),{recursive:true});fs.copyFileSync(source,path.join(root,directory,'verify-financial-values.py'))}
