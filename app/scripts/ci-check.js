#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────
// CI CHECK — runs as the Netlify build command on EVERY push.
// If anything here fails, the deploy fails and the previous version stays
// live — a broken commit can never reach the reps.
//
// Checks:
//   1. Syntax: every Netlify function + shared lib parses (node --check)
//   2. Syntax: every inline <script> block in index.html parses
//   3. Parity: server-side indicators derive === client parse (tools/derive-parity-test.js)
//   4. CSS: every responsive utility class used in the markup exists in
//      the prebuilt tailwind.css (or the inline gap-fill block) — catches
//      the "empty comp switcher" class of bug
//
// Run locally the same way Netlify does:  node app/scripts/ci-check.js
// ────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const os = require('os');

const root = path.join(__dirname, '..', '..');   // repo root
const pub = path.join(root, 'app', 'public');
const tests = path.join(root, 'app', 'test');
const appJs = fs.readFileSync(path.join(pub, 'app.js'), 'utf8');
let failures = 0;
const ok = (label) => console.log('  ✓ ' + label);
const bad = (label, detail) => { failures++; console.error('  ✗ ' + label + (detail ? '\n    ' + detail : '')); };

// ── 1. Function + lib syntax ────────────────────────────────────────────
console.log('\n[1/5] Netlify functions syntax');
const jsTargets = ['app/public/app.js'];
for (const dir of ['netlify/functions', 'netlify/lib', 'app/scripts', 'app/test']) {
  const full = path.join(root, dir);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full)) {
    if (f.endsWith('.js')) jsTargets.push(path.join(dir, f));
  }
}
for (const rel of jsTargets) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, rel)], { encoding: 'utf8' });
  if (r.status === 0) ok(rel);
  else bad(rel, (r.stderr || '').split('\n').slice(0, 3).join(' '));
}

// ── 2. Inline script blocks ─────────────────────────────────────────────
console.log('\n[2/5] index.html inline <script> blocks');
const html = fs.readFileSync(path.join(pub, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
// Scratch files go INSIDE the repo, not os.tmpdir(): `node --check` walks up
// from the file looking for a package.json to decide the module type, and on
// one Windows machine a malformed package.json above %TEMP% failed every block.
const scratch = path.join(root, '.ci-tmp');
fs.mkdirSync(scratch, { recursive: true });
blocks.forEach((b, i) => {
  const tmp = path.join(scratch, 'block-' + i + '.js');
  fs.writeFileSync(tmp, b);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status === 0) ok('script block ' + i + ' (' + b.length.toLocaleString() + ' chars)');
  else bad('script block ' + i, (r.stderr || '').split('\n').slice(0, 4).join(' '));
});

// ── 3. Derive parity ────────────────────────────────────────────────────
console.log('\n[3/5] Server/client derive parity');
const parity = spawnSync(process.execPath, [path.join(tests, 'derive-parity-test.js')], { encoding: 'utf8' });
if (parity.status === 0) ok('parity test passed');
else bad('parity test FAILED', (parity.stdout + parity.stderr).split('\n').filter(l => l.includes('✗')).join(' | ') || 'see output');

// ── 4. Responsive + arbitrary-value utility coverage ────────────────────
// Prebuilt Tailwind = any class not in the sheet silently does nothing.
// Covers responsive prefixes (sm:/md:/lg:/xl:) AND arbitrary values like
// text-[20px] / w-[280px] — both bit us in production.
console.log('\n[4/5] Tailwind utility coverage (responsive + arbitrary values)');
const css = fs.readFileSync(path.join(pub, 'tailwind.css'), 'utf8') + '\n' + fs.readFileSync(path.join(root, 'app', 'src', 'styles', 'app.css'), 'utf8');   // + the gap-fill utilities, which were inline in index.html
const used = new Set();
const classSources = html + '\n' + appJs;   // markup lives in index.html AND app.js now
for (const pat of [/class:\s*'([^']*)'/g, /class:\s*"([^"]*)"/g, /class="([^"]*)"/g]) {
  for (const m of classSources.matchAll(pat)) {
    // EVERY token is checked now (was: only sm:/md:/arbitrary-value ones) —
    // 28 plain utilities were silently dead in production (invisible legend
    // swatches, missing row separators). Definitions may live in
    // tailwind.css, the index.html gap-fill block, OR app.js-injected CSS.
    for (const tok of m[1].split(/\s+/)) {
      if (tok && !/^[0-9]/.test(tok)) used.add(tok);
    }
  }
}
const defSources = css + '\n' + html + '\n' + appJs;
// Marker-only classes: matched from JS (html2canvas ignore, hooks), never
// styled — a CSS definition is not expected.
const MARKER_CLASSES = new Set(['sc-noprint', 'group']);
const missing = [];
for (const tok of [...used].sort()) {
  if (MARKER_CLASSES.has(tok)) continue;
  // build the literal selector as it appears in CSS: sm:flex → .sm\:flex
  // (slash classes like top-1/2 are \/-escaped in the sheet too)
  const selector = '.' + tok.replace(/([:[\].\/])/g, '\\$1');
  // a definition counts if the selector appears followed by {, comma, space,
  // colon (pseudo), or > (child combinator) — covers grouped selectors.
  const reDef = new RegExp(selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?=[\\s{,:>])');
  if (!reDef.test(defSources)) missing.push(tok);
}
if (missing.length === 0) ok(used.size + ' utility classes all defined');
else bad('missing utilities (add to app/src/styles/app.css or rebuild tailwind.css: npm run tailwind)', missing.join(', '));

// ── [5/5] MODULE-goal syntax parse ──────────────────────────────────────
// app.js ships as <script type="module">, and module parsing is STRICTER
// and more eager than `node --check`'s script goal: a duplicate `const`
// inside a function body sailed through check #1 but made every browser
// refuse the whole bundle (Jul 2026 outage — app stuck on the splash).
// Parsing a .mjs copy uses the module goal, exactly like the browser.
console.log('\n[5/5] Module-goal parse (what the browser actually does)');
try {
  const tmp = path.join(scratch, 'app-' + Date.now() + '.mjs');
  fs.writeFileSync(tmp, appJs);
  try {
    require('child_process').execFileSync(process.execPath, ['--check', tmp], { stdio: 'pipe' });
    ok('module parse clean');
  } finally { try { fs.unlinkSync(tmp); } catch { /* tmp cleanup best-effort */ } }
} catch (e) {
  bad('module-goal parse failed (browser would reject the bundle)',
      String((e.stderr || e.message || e)).split('\n').slice(0, 4).join('\n'));
}

// ── [6/6] P/S GATE GOLDEN TESTS ─────────────────────────────────────────
// frPendingServiced is the canonical Pending/Serviced basis for EVERY
// board and pay number. The scenario suite in tools/ps-gate-test.js locks
// in the semantics reconciled to the CRM (Jul 2026); any behavioral drift
// fails the deploy.
console.log('\n[6/8] P/S gate golden tests (app/test/ps-gate-test.js)');
try {
  const out = require('child_process').execFileSync(process.execPath, [path.join(tests, 'ps-gate-test.js')], { stdio: 'pipe' }).toString().trim();
  ok(out.split('\n').pop());
} catch (e) {
  bad('P/S gate scenarios FAILED — the Pending/Serviced basis changed',
      String((e.stdout || '') + (e.stderr || '')).split('\n').slice(0, 8).join('\n'));
}

// ── 7. Attrition golden tests ───────────────────────────────────────────
// The one revenue-attrition definition the leaderboard and player card
// share (cancelled $ ÷ serviced $, RORs + one-time out of both sides).
console.log('\n[7/9] Attrition golden tests (app/test/attrition-test.js)');
try {
  const out = require('child_process').execFileSync(process.execPath, [path.join(tests, 'attrition-test.js')], { stdio: 'pipe' }).toString().trim();
  ok(out.split('\n').pop());
} catch (e) {
  bad('Attrition scenarios FAILED — the attrition definition changed',
      String((e.stdout || '') + (e.stderr || '')).split('\n').slice(0, 8).join('\n'));
}

// ── 8. Commission golden tests ──────────────────────────────────────────
console.log('\n[8/9] Commission golden tests (app/test/commission-test.js)');
try {
  const out = require('child_process').execFileSync(process.execPath, [path.join(tests, 'commission-test.js')], { stdio: 'pipe' }).toString().trim();
  ok(out.split('\n').pop());
} catch (e) {
  bad('Commission scenarios FAILED — the D2D backend pay math changed',
      String((e.stdout || '') + (e.stderr || '')).split('\n').slice(0, 8).join('\n'));
}

// ── 9. Upsell record fixtures ───────────────────────────────────────────
console.log('\n[9/10] Upsell record fixtures (app/test/upsell-test.js)');
try {
  const out = require('child_process').execFileSync(process.execPath, [path.join(tests, 'upsell-test.js')], { stdio: 'pipe' }).toString().trim();
  ok(out.split('\n').pop());
} catch (e) {
  bad('Upsell fixtures FAILED — the ticket → sales-row shape changed',
      String((e.stdout || '') + (e.stderr || '')).split('\n').slice(0, 8).join('\n'));
}

console.log('\n[10/10] Add-on streak fixtures (app/test/addon-test.js)');
try {
  const out = require('child_process').execFileSync(process.execPath, [path.join(tests, 'addon-test.js')], { stdio: 'pipe' }).toString().trim();
  ok(out.split('\n').pop());
} catch (e) {
  bad('Upsell fixtures FAILED — the ticket → sales-row shape changed',
      String((e.stdout || '') + (e.stderr || '')).split('\n').slice(0, 8).join('\n'));
}

console.log('\n[11] Semantic layer fixtures (app/test/semantic-test.js)');
try {
  const out = require('child_process').execFileSync(process.execPath, [path.join(tests, 'semantic-test.js')], { stdio: 'pipe' }).toString().trim();
  ok(out.split('\n').pop());
} catch (e) {
  bad('Semantic layer fixtures FAILED — a metric definition in app/src/core/semantic.js changed',
      String((e.stdout || '') + (e.stderr || '')).split('\n').slice(0, 8).join('\n'));
}

// ── verdict ─────────────────────────────────────────────────────────────
try { fs.rmSync(scratch, { recursive: true, force: true }); } catch { /* scratch cleanup best-effort */ }
if (failures) {
  console.error('\nCI: FAIL — ' + failures + ' problem(s). Deploy blocked; previous version stays live.');
  process.exit(1);
}
console.log('\nCI: PASS — safe to deploy');