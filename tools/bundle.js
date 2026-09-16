#!/usr/bin/env node
// tools/bundle.js — stitch src/*.js (sorted by name) into app.js.
//
// app.js is GENERATED. Edit the files under src/, never app.js. The pieces
// are concatenated in filename order with no separators, so the bundle is
// exactly what one big file would be: every function is module-scoped and
// hoisted across the whole bundle, same as before the split.
//
// Runs first in the Netlify build (see netlify.toml) and locally via
// `npm run bundle` (or `npm run check`, which bundles then runs CI).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
if (!files.length) { console.error('[bundle] no src/*.js files'); process.exit(1); }
const out = files.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8')).join('');
fs.writeFileSync(path.join(root, 'app.js'), out);
console.log('[bundle] ' + files.length + ' files → app.js (' + (out.length / 1024 / 1024).toFixed(2) + 'MB)');
