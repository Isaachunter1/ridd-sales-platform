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
// Run locally the same way Netlify does:  node tools/ci-check.js
// ────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');
const os = require('os');

const root = path.join(__dirname, '..');
let failures = 0;
const ok = (label) => console.log('  ✓ ' + label);
const bad = (label, detail) => { failures++; console.error('  ✗ ' + label + (detail ? '\n    ' + detail : '')); };

// ── 1. Function + lib syntax ────────────────────────────────────────────
console.log('\n[1/4] Netlify functions syntax');
const jsTargets = [];
for (const dir of ['netlify/functions', 'netlify/lib', 'tools']) {
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
console.log('\n[2/4] index.html inline <script> blocks');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const blocks = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
blocks.forEach((b, i) => {
  const tmp = path.join(os.tmpdir(), 'ridd-ci-block-' + i + '.js');
  fs.writeFileSync(tmp, b);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status === 0) ok('script block ' + i + ' (' + b.length.toLocaleString() + ' chars)');
  else bad('script block ' + i, (r.stderr || '').split('\n').slice(0, 4).join(' '));
});

// ── 3. Derive parity ────────────────────────────────────────────────────
console.log('\n[3/4] Server/client derive parity');
const parity = spawnSync(process.execPath, [path.join(__dirname, 'derive-parity-test.js')], { encoding: 'utf8' });
if (parity.status === 0) ok('parity test passed');
else bad('parity test FAILED', (parity.stdout + parity.stderr).split('\n').filter(l => l.includes('✗')).join(' | ') || 'see output');

// ── 4. Responsive + arbitrary-value utility coverage ────────────────────
// Prebuilt Tailwind = any class not in the sheet silently does nothing.
// Covers responsive prefixes (sm:/md:/lg:/xl:) AND arbitrary values like
// text-[20px] / w-[280px] — both bit us in production.
console.log('\n[4/4] Tailwind utility coverage (responsive + arbitrary values)');
const css = fs.readFileSync(path.join(root, 'tailwind.css'), 'utf8');
const used = new Set();
for (const pat of [/class:\s*'([^']*)'/g, /class:\s*"([^"]*)"/g, /class="([^"]*)"/g]) {
  for (const m of html.matchAll(pat)) {
    for (const tok of m[1].split(/\s+/)) {
      if (/^(sm|md|lg|xl):/.test(tok) || /\[[^\]]+\]/.test(tok)) used.add(tok);
    }
  }
}
const missing = [];
for (const tok of [...used].sort()) {
  // build the literal selector as it appears in CSS: sm:flex → .sm\:flex
  const selector = '.' + tok.replace(/([:[\].])/g, '\\$1');
  if (!css.includes(selector + '{') && !css.includes(selector + ',') && !css.includes(selector + ' ') &&
      !html.includes(selector + ' {') && !html.includes(selector + '{')) {
    missing.push(tok);
  }
}
if (missing.length === 0) ok(used.size + ' responsive utilities all defined');
else bad('missing utilities (add to the gap-fill <style> block or rebuild tailwind.css)', missing.join(', '));

// ── verdict ─────────────────────────────────────────────────────────────
if (failures) {
  console.error('\nCI: FAIL — ' + failures + ' problem(s). Deploy blocked; previous version stays live.');
  process.exit(1);
}
console.log('\nCI: PASS — safe to deploy');
