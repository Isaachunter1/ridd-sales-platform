#!/usr/bin/env node
// app/scripts/bundle.js — stitch app/src/**/*.js (in app/src/bundle.order.js order) into app/public/app.js.
//
// app.js is GENERATED. Edit the files under app/src/, never app.js. The pieces
// are concatenated in bundle.order.js order with no separators, so the bundle is
// exactly what one big file would be: every function is module-scoped and
// hoisted across the whole bundle, same as before the split.
//
// Runs first in the Netlify build (see netlify.toml) and locally via
// `npm run bundle` (or `npm run check`, which bundles then runs CI).
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..');   // repo root
const pub = path.join(root, 'app', 'public');
const srcDir = path.join(root, 'app', 'src');
// packages/engine/src/*.js = the Indicators ENGINE (competition scorers + the
// helpers they share). It is bundled FIRST into app.js and also built on
// its own into packages/engine/dist/ridd-engine.js (app/scripts/build-engine.js) for
// Cam's server — one source, two builds, identical numbers by construction.
const engDir = path.join(root, 'packages', 'engine', 'src');
const engFiles = fs.existsSync(engDir) ? fs.readdirSync(engDir).filter(f => f.endsWith('.js')).sort().map(f => path.join(engDir, f)) : [];
// The order is EXPLICIT (src/bundle.order.js) — not sort-by-filename. Every
// src .js file must be listed exactly once; a stray or missing file fails
// the bundle so nothing silently drops out of (or sneaks into) app.js.
const files = require(path.join(srcDir, 'bundle.order.js'));
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => d.isDirectory() ? walk(path.join(dir, d.name)) : [path.join(dir, d.name)]);
const onDisk = new Set(walk(srcDir).filter(p => p.endsWith('.js')).map(p => path.relative(srcDir, p).split(path.sep).join('/')).filter(p => p !== 'bundle.order.js'));
const listed = new Set(files);
const missing = [...onDisk].filter(f => !listed.has(f)), stale = files.filter(f => !onDisk.has(f));
const dupes = files.filter((f, i) => files.indexOf(f) !== i);
if (missing.length || stale.length || dupes.length) {
  if (missing.length) console.error('[bundle] in app/src/ but not in bundle.order.js: ' + missing.join(', '));
  if (stale.length) console.error('[bundle] in bundle.order.js but not in app/src/: ' + stale.join(', '));
  if (dupes.length) console.error('[bundle] listed twice in bundle.order.js: ' + dupes.join(', '));
  process.exit(1);
}
if (!files.length) { console.error('[bundle] no app/src files listed'); process.exit(1); }
const out = [...engFiles.map(p => fs.readFileSync(p, 'utf8') + '\n'), ...files.map(f => fs.readFileSync(path.join(srcDir, ...f.split('/')), 'utf8'))].join('');
fs.writeFileSync(path.join(pub, 'app.js'), out);
// The app's own stylesheet rides along: app/src/styles/app.css → app/public/app.css
// (index.html links app.css; the source of truth is under src/).
fs.copyFileSync(path.join(srcDir, 'styles', 'app.css'), path.join(pub, 'app.css'));
console.log('[bundle] ' + engFiles.length + ' engine + ' + files.length + ' src files → app/public/app.js (' + (out.length / 1024 / 1024).toFixed(2) + 'MB)');
