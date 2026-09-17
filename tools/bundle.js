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
// engine/src/*.js = the Indicators ENGINE (competition scorers + the
// helpers they share). It is bundled FIRST into app.js and also built on
// its own into engine/dist/ridd-engine.js (tools/build-engine.js) for
// Cam's server — one source, two builds, identical numbers by construction.
const engDir = path.join(root, 'engine', 'src');
const engFiles = fs.existsSync(engDir) ? fs.readdirSync(engDir).filter(f => f.endsWith('.js')).sort().map(f => path.join(engDir, f)) : [];
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
if (!files.length) { console.error('[bundle] no src/*.js files'); process.exit(1); }
const out = [...engFiles.map(p => fs.readFileSync(p, 'utf8') + '\n'), ...files.map(f => fs.readFileSync(path.join(srcDir, f), 'utf8'))].join('');
fs.writeFileSync(path.join(root, 'app.js'), out);
console.log('[bundle] ' + engFiles.length + ' engine + ' + files.length + ' src files → app.js (' + (out.length / 1024 / 1024).toFixed(2) + 'MB)');
