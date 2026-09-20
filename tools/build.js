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
// Runs on Netlify after tools/bundle.js (src/*.js → app.js) and
// tools/ci-check.js. Locally: `npm run bundle` regenerates app.js.
// ────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const src = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
const hash = crypto.createHash('sha256').update(src).digest('hex').slice(0, 8);
const hashedName = `app-${hash}.immutable.js`;

// Minify for the deploy (AUDIT P1-3): roughly halves the gzipped bundle.
// Conservative on purpose — top-level names are NOT mangled (the bundle is
// one module scope whose functions call each other by name and the CI
// golden tests extract them by name from app.js), only locals inside
// functions are. A source map ships beside it so client-error stacks and
// DevTools still point at src/*.js lines. app.js itself stays readable.
const out = (async () => {
  let code = src, map = null;
  try {
    const { minify } = require('terser');
    const r = await minify({ [hashedName]: src }, {
      module: true,
      compress: { defaults: true, passes: 1, toplevel: false, unsafe: false, keep_fnames: true, keep_classnames: true },
      mangle: { toplevel: false, keep_fnames: true, keep_classnames: true },
      format: { comments: false },
      sourceMap: { filename: hashedName, url: hashedName + '.map' },
    });
    if (r && r.code) { code = r.code; map = r.map || null; }
    else console.warn('[build] terser returned nothing — shipping unminified');
  } catch (e) {
    console.warn('[build] minify skipped (' + ((e && e.message) || e) + ') — shipping unminified');
  }
  fs.writeFileSync(path.join(root, hashedName), code);
  if (map) fs.writeFileSync(path.join(root, hashedName + '.map'), map);
  return code.length;
})();
out.then((bytes) => {

const htmlPath = path.join(root, 'index.html');
let html = fs.readFileSync(htmlPath, 'utf8');
const before = html;
// Idempotent: match the pristine src="app.js" tag OR a hashed reference a
// previous local build left behind (committing a locally-built index.html
// once took the Netlify build down — the exact-string replace found nothing).
html = html.replace(/<script type="module" src="app(?:-[0-9a-f]{8}\.immutable)?\.js"><\/script>/,
                    `<script type="module" src="${hashedName}"></script>`);
if (html === before && !html.includes(`src="${hashedName}"`)) {
  console.error('[build] FATAL: app.js script tag not found in index.html — reference not rewritten');
  process.exit(1);
}
fs.writeFileSync(htmlPath, html);
// version.json — long-lived PWA sessions poll this to learn a new deploy
// shipped, then self-reload onto the fresh bundle (see the client's
// version watcher). no-cache headers in netlify.toml keep it honest.
fs.writeFileSync(path.join(root, 'version.json'), JSON.stringify({ hash: hashedName, builtAt: new Date().toISOString() }));
console.log(`[build] app.js → ${hashedName} (${(src.length / 1024 / 1024).toFixed(2)}MB source → ${(bytes / 1024 / 1024).toFixed(2)}MB shipped), index.html rewritten, version.json stamped`);
}).catch((e) => { console.error('[build] FATAL', e); process.exit(1); });
