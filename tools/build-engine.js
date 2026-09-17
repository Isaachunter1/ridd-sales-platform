#!/usr/bin/env node
// tools/build-engine.js — engine/src/*.js → engine/dist/ridd-engine.js (UMD).
//
// The SAME files are concatenated into app.js (tools/bundle.js), where they
// read the app's global `state`. Here they are wrapped in createEngine(),
// which builds an equivalent `state` from explicit inputs — the sales rows
// and the indicator_config row — so a server can run the identical code.
// Runs in the Netlify build (netlify.toml) after bundle + CI; the dist lands
// on the site at /engine/dist/ridd-engine.js and /engine/latest.json.
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'engine', 'src');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'engine', 'package.json'), 'utf8'));
const files = fs.readdirSync(srcDir).filter(f => f.endsWith('.js')).sort();
const code = files.map(f => '// ═══ ' + f + ' ═══\n' + fs.readFileSync(path.join(srcDir, f), 'utf8')).join('\n');

const out = `/*! RIDD Indicators Engine v${pkg.version} — built ${new Date().toISOString()} from engine/src (${files.join(', ')}). Same code the RIDD Sales Platform runs. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RiddEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';
const ENGINE_VERSION = ${JSON.stringify(pkg.version)};

// ── inputs → the app's \`state\` shape ────────────────────────────────────
// sales:  the snapshot rows (indicators/latest.json.gz → rawSales) or the
//         same columns from market_feed.indicator_sales.
// config: the indicator_config row (select * from indicator_config where id = 1).
function buildState(inputs) {
  const cfg = (inputs && inputs.config) || {};
  const comps = (cfg.competitions && typeof cfg.competitions === 'object') ? cfg.competitions : {};
  const state = {
    _indicatorRawSales: Array.isArray(inputs && inputs.sales) ? inputs.sales : [],
    _indManualMode: false,
    _indicatorExcludedTeams: Array.isArray(cfg.team_excluded) ? cfg.team_excluded : [],
    _indicatorCompetitions: Array.isArray(comps.list) ? comps.list : null,
    _indicatorActiveCompId: comps.active || null,
    _indicatorRemovedDefaults: Array.isArray(comps.removed) ? comps.removed : [],
    _indicatorRankExclude: (comps.rankExclude && typeof comps.rankExclude === 'object') ? comps.rankExclude : {},
    _indicatorRepAlias: (comps.repAlias && typeof comps.repAlias === 'object') ? comps.repAlias : {},
    _compExtras: (comps.extras && typeof comps.extras === 'object') ? comps.extras : {},
    _indicatorRepTierYear: (comps.tierYears && typeof comps.tierYears === 'object') ? comps.tierYears : {},
    _indicatorRepTier: (cfg.rep_tiers && typeof cfg.rep_tiers === 'object') ? cfg.rep_tiers : {},
    _indicatorRepActive: (cfg.rep_active && typeof cfg.rep_active === 'object') ? cfg.rep_active : {},
    _indicatorRepOffice: (cfg.rep_offices && typeof cfg.rep_offices === 'object') ? cfg.rep_offices : {},
    _indicatorRepTeamByYear: {},
    _indicatorRepTypeBySig: {},
    _teamYear: (inputs && inputs.teamYear) || String(new Date().getFullYear()),
  };
  const rt = (cfg.rep_teams && typeof cfg.rep_teams === 'object' && !Array.isArray(cfg.rep_teams)) ? cfg.rep_teams : {};
  const keys = Object.keys(rt);
  const byYear = keys.length === 0 || keys.every(k => /^\\d{4}$/.test(k) && rt[k] && typeof rt[k] === 'object');
  state._indicatorRepTeamByYear = byYear ? rt : { [state._teamYear]: rt };
  state._indicatorRepTeam = state._indicatorRepTeamByYear[state._teamYear] || {};
  if (inputs && inputs.activeCompId) state._indicatorActiveCompId = inputs.activeCompId;
  return state;
}

function createEngine(inputs) {
  const state = buildState(inputs || {});
${code}
  // ── engine-side housekeeping the app does at load time ──
  // 1. rep-type map from the per-sale repType column (same as
  //    _applyIndicatorsPayloadHousekeeping in the app).
  {
    const m = {};
    for (const s of state._indicatorRawSales) {
      const t = (s && s.repType || '').trim();
      if (!t || !s.rep) continue;
      const k = _repTypeNameSig(getCanonicalRepName(s.rep));
      if (k && !m[k]) m[k] = t;
    }
    state._indicatorRepTypeBySig = m;
  }
  // 2. rep-keyed config maps normalised to clean spellings (same as
  //    _normalizeRepKeyedMaps in the app).
  for (const field of ['_indicatorRepTeam', '_indicatorRepTier', '_indicatorRepActive', '_indicatorRepOffice', '_indicatorRepAlias']) {
    const m = state[field];
    if (!m || typeof m !== 'object' || Array.isArray(m)) continue;
    for (const k of Object.keys(m)) { const ck = _cleanRepName(k); if (ck !== k) { if (!(ck in m)) m[ck] = m[k]; delete m[k]; } }
    if (field === '_indicatorRepAlias') for (const k of Object.keys(m)) { if (typeof m[k] === 'string') m[k] = _cleanRepName(m[k]); }
  }
  const sales = state._indicatorRawSales;
  const compById = (id) => getIndicatorCompetitions().find(c => c.id === id) || null;
  return {
    version: ENGINE_VERSION,
    state,
    competitions: () => getIndicatorCompetitions(),
    activeCompetition: () => getActiveComp(),
    comps: {
      // Each takes the sales rows (defaults to the engine's) and an optional
      // competition config object (defaults to the active comp / that comp's row).
      nrla:            (rows, comp) => nrlaCompute(rows || sales, comp || compById('nrla') || getActiveComp()),
      springCleaning:  (rows, branches, comp) => { const prev = state._indicatorActiveCompId; if (comp) state._indicatorActiveCompId = comp.id; try { return springCleaningCompute(rows || sales, branches || null); } finally { state._indicatorActiveCompId = prev; } },
      topGun:          (rows, proSet) => topGunCompute(rows || sales, proSet || new Set()),
      kobeWeek:        (rows, from, to, baseYear) => kobeWeekCompute(rows || sales, from || KOBE_FROM, to || KOBE_TO, baseYear),
      lastManStanding: (rows, comp) => lastManStandingCompute(rows || sales, comp),
    },
    helpers: {
      canonicalRepName: getCanonicalRepName, cleanRepName: _cleanRepName, repTier: getRepTier,
      pendingServiced: frPendingServiced, deptOf: _indicatorDeptOf, dateSoldToIso, parseDay: _parseIndicatorDay,
      springCleaningStatus, lmsServicedStatus, topGunBucket, nrlaConfig, nrlaRoundWindows,
    },
  };
}
return { version: ENGINE_VERSION, createEngine };
});
`;
fs.mkdirSync(path.join(root, 'engine', 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'engine', 'dist', 'ridd-engine.js'), out);
fs.writeFileSync(path.join(root, 'engine', 'latest.json'), JSON.stringify({ version: pkg.version, file: '/engine/dist/ridd-engine.js', builtAt: new Date().toISOString(), sources: files }));
console.log('[engine] v' + pkg.version + ' → engine/dist/ridd-engine.js (' + (out.length / 1024).toFixed(0) + 'KB)');
