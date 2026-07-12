#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────
// DEPLOY BUILD — content-hash the app bundle for immutable caching.
//
// app.js (the 2.1MB application code, extracted from index.html) is copied
// to app-<hash8>.immutable.js and index.html's reference is rewritten to
// point at it. netlify.toml serves /*.immutable.js with a 1-year immutable
// cache header, so repeat visits skip both the download AND the JS parse
// (browsers only bytecode-cache EXTERNAL scripts — the old inline block
// re-parsed 2MB on every single open).
//
// Runs on Netlify after tools/ci-check.js. The repo keeps plain app.js +
// a plain src="app.js" reference, so local dev needs no build at all.
// ────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'app.js'));
const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 8);
const hashedName = `app-${hash}.immutable.js`;

fs.writeFileSync(path.join(root, hashedName), src);

const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const before = html;
html = html.replace('<script type="module" src="app.js"></script>',
                    `<script type="module" src="${hashedName}"></script>`);
if (html === before) {
  console.error('[build] FATAL: app.js script tag not found in index.html — reference not rewritten');
  process.exit(1);
}
fs.writeFileSync(htmlPath, html);
// version.json — long-lived PWA sessions poll this to learn a new deploy
// shipped, then self-reload onto the fresh bundle (see the client's
// version watcher). no-cache headers in netlify.toml keep it honest.
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ hash: hashedName, builtAt: new Date().toISOString() }));
console.log(`[build] app.js → ${hashedName} (${(src.length / 1024 / 1024).toFixed(2)}MB), index.html rewritten, version.json stamped`);
