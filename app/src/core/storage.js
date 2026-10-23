// ──────────────────────────────────────────────────────────────────────────
// Demo state persistence — keep sales/competitions alive across page reloads
// so you can log a sale → audit → stage → process without losing your work
// every time the code updates. Passing ?demo&reset clears storage.
// ──────────────────────────────────────────────────────────────────────────
const DEMO_STORAGE_KEY = 'ridd-demo-data-v1';
// Indicator CSV state is persisted to its OWN localStorage key so it
// survives a refresh in production (not just demo mode). The whole point
// of uploading a CSV every week is to compare to last week's snapshot —
// dropping it on refresh defeats the feature.
const INDICATORS_STORAGE_KEY          = 'ridd-indicators-v1';            // legacy combined key (read-only fallback)
const INDICATORS_SETTINGS_STORAGE_KEY = 'ridd-indicators-settings-v1';   // small config — teams, exclusions, prefs
const INDICATORS_DATA_STORAGE_KEY     = 'ridd-indicators-data-v1';       // bulk — raw CSV rows, raw sales, snapshots

// Small-payload settings: teams, rep tags, view prefs. Save separately from
// the bulk CSV so a quota failure on the big payload doesn't take team-list
// edits down with it.
const INDICATOR_SETTINGS_FIELDS = [
  '_indicatorRepChart',
  '_indicatorRepTeam',        // legacy flat map — kept so old saves still migrate
  '_indicatorRepTeamByYear',  // per-year team assignments (source of truth)
  // NOTE: _teamYear is intentionally NOT persisted — the app always boots on
  // the current calendar year so a stale saved year can't silently change
  // team grouping app-wide. It's still remembered within a session.
  '_indicatorRepTier',
  '_indicatorRepTierYear',    // year each tier tag was made — powers rookie auto-promotion
  '_indicatorRepTypeBySig',   // rep name-signature → "Sold By Type" from the Customer Report
  '_reportingCancelReasonsSeen', // distinct cancel reasons seen in the reporting CSV (persisted universe)
  '_reportingSourcesSeen',       // distinct lead sources seen in the reporting CSV (persisted universe)
  'indicatorDeletedCustIds',     // customer IDs DELETED in FieldRoutes (orphans in the RevHawk mirror) — excluded app-wide
  '_compPillOrder',              // admin drag-sorted order of the Competitions pills (ids, incl. mystery_box)
  '_compFavoriteMystery',        // ★ default-comp flag for the virtual Mystery Boxes pill
  '_compExtras',                 // per-comp synced extras for VIRTUAL pills (★ default flag, Kobe window, …) — anything not backed by a config row
  // ('_indicatorFilterPresets' retired from the SHARED settings — presets
  // are PER USER now, stored on-device per account. Per Isaac.)
  '_indHiddenMetrics',           // hidden Indicators rows, keyed by Type (all/d2d/office/techs) — per Isaac
  '_indHiddenLbCols',            // hidden Rep Leaderboard columns, keyed by Type — per Isaac
  '_indicatorTeams',
  '_indicatorTeamTypes',      // { team: 'd2d' | 'office' | 'techs' } — which rep type a team belongs to (Manage Teams toggle)
  '_indicatorExcludedTeams',
  '_indicatorRankExclude',    // { branch:[...], teams:[...] } — kept on the board but out of Power Ranking
  '_indicatorCompetitions',
  '_indicatorActiveCompId',
  '_indicatorRemovedDefaults', // built-in comps the admin deleted — don't re-seed them
  '_indicatorTeamColors',
  '_indicatorTrendScope',
  '_indicatorRepActive',
  '_indicatorRepOffice',
  '_indicatorRepIncludeRor',
  '_indicatorRepIncludeOneTime',   // leaderboard cancel filter: count one-time service cancels
  '_indicatorRepIncludeRenewals',  // leaderboard cancel filter: count renewal cancels
  '_repFiltersV2',                 // one-time migration stamp: include-everything defaults
  '_indicatorDismissedDupes',
  '_indicatorRepAlias',
  'indicatorMyExclServiceTerms',   // services dropped from BOTH sides of MY% (default: Sentricon)
  'indicatorExclTeams',            // teams left out of Indicators entirely (Configurations → Indicators)
  'indicatorExclServices',         // services left out of Indicators entirely (null = built-in list)
  // indicatorsGroupBy + indicatorsRangePreset intentionally NOT persisted — the
  // tab always opens on Branch / All reps / This Year; the toggles change them
  // for the current session only, and a refresh returns to the defaults.
  'indicatorsCustomStart',
  'indicatorsCustomEnd',
  '_indicatorChartDrill',
  'indicatorsUploadedAt',
  'indicatorsFileName',
  '_indicatorRawHeaders',
  // Scorecards tab — template config + per-agent/period scorecard data
  // + the currently-selected period. Small payload, lives in settings
  // (not bulk data) so it can't be hit by the indicator CSV quota.
  '_scorecardTemplate',
  '_scorecardTemplates',   // per-department templates (inside_sales / loyalty)
  '_scorecardData',
  '_scorecardAudits',   // call-audit cache (cloud table call_audits is the record)
  '_scorecardMeetings', // 1:1 meeting log cache (cloud table scorecard_meetings is the record)
  '_scorecardPeriod',
];

// Bulk-payload fields: large arrays uploaded via CSV. These can fail quota.
const INDICATOR_DATA_FIELDS = [
  'indicatorsData',
  '_indicatorRawSales',
  '_indicatorSnapshots',
];

const INDICATOR_PERSIST_FIELDS = [...INDICATOR_SETTINGS_FIELDS, ...INDICATOR_DATA_FIELDS];

// Track quota warnings so the toast doesn't fire on every keystroke.
let _indicatorDataSaveWarned = false;

// Compressed fallback store for the bulk indicator data. The raw-sales array
// outgrew the ~5MB localStorage quota as plain JSON; gzip + base64 is ~8×
// smaller and keeps raw sales (teams mode, dept toggle, exact-day ranges,
// header colors) alive across refreshes.
const INDICATORS_DATA_GZ_KEY = 'ridd-indicators-data-gz-v1';

// ── IndexedDB bulk store ─────────────────────────────────────────────────
// localStorage caps at ~5MB for the whole origin, which an all-time CSV
// blows through even gzipped. IndexedDB has no practical limit, so the full
// bulk payload (raw rows already stripped) is mirrored there on every save
// and restored on load. localStorage remains a fast-paint fallback.
function _indIdbOpen() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB unavailable'));
    const rq = indexedDB.open('ridd-indicators', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function _indIdbSet(key, val) {
  const db = await _indIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => { db.close(); res(); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}
async function _indIdbGet(key) {
  const db = await _indIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const rq = tx.objectStore('kv').get(key);
    rq.onsuccess = () => { db.close(); res(rq.result); };
    rq.onerror = () => { db.close(); rej(rq.error); };
  });
}

let _indSaveSeq = 0;
async function _storeIndicatorDataCompressed(json) {
  const seq = ++_indSaveSeq;
  try {
    if (typeof CompressionStream === 'undefined') return;
    const blob = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; const STEP = 0x8000;
    for (let i = 0; i < buf.length; i += STEP) bin += String.fromCharCode.apply(null, buf.subarray(i, i + STEP));
    const b64 = btoa(bin);
    if (seq !== _indSaveSeq) return; // a newer save superseded this one
    localStorage.setItem(INDICATORS_DATA_GZ_KEY, b64);
    _indicatorDataSaveWarned = false;
  } catch (e) {
    console.warn('[ridd] compressed indicator save failed', e);
    // A gz copy we can no longer overwrite is worse than none: it would keep
    // resurrecting the LAST dataset that fit, shadowing the (unlimited)
    // IndexedDB copy on every boot. Drop it — IDB + cloud carry the data.
    try { localStorage.removeItem(INDICATORS_DATA_GZ_KEY); } catch { /* ignore */ }
  }
}

