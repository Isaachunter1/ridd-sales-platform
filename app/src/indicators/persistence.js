// ── Shared indicators dataset (Supabase Storage) ─────────────────────────
// localStorage is per-browser, so one admin's upload was invisible to every
// other admin. Each import now also pushes the dataset (gzipped) to the
// shared `reporting` bucket at a fixed path, and the Indicators tab pulls
// the newest copy for whoever is looking — uploads persist across users.
const INDICATORS_CLOUD_PATH = 'indicators/latest.json.gz';
// DATA MINIMIZATION: admins/auditors pull the full dataset; every other
// role pulls the rep-sanitized copy (customer name/id blanked server-side).
// Storage policy (security_rls.sql) enforces this at the database — the
// full blob 403s for rep sessions even if someone edits this code locally.
function _indicatorsCloudPath() {
  const role = state.profile && state.profile?.role;
  return (isAdminRole(role) || isAuditorRole(role)) ? INDICATORS_CLOUD_PATH : 'indicators/latest-rep.json.gz';
}
async function syncIndicatorsToCloud() {
  if (DEMO || typeof CompressionStream === 'undefined') return;
  try {
    const payload = {
      uploadedAt: state.indicatorsUploadedAt,
      fileName:   state.indicatorsFileName || '',
      indicatorsData: state.indicatorsData || [],
      rawSales: (state._indicatorRawSales || []).map(s => {
        if (!s || !s._rawRow) return s;
        const { _rawRow, ...rest } = s; return rest;
      }),
    };
    const blob = await new Response(new Blob([JSON.stringify(payload)]).stream()
      .pipeThrough(new CompressionStream('gzip'))).blob();
    const { error } = await supabase.storage.from('reporting')
      .upload(INDICATORS_CLOUD_PATH, blob, { contentType: 'application/gzip', upsert: true });
    if (error) {
      console.warn('[ridd] indicators cloud sync failed (run reporting_storage.sql?)', error);
      return { ok: false, msg: error.message || String(error) };
    }
    // Rep-facing copy too (rep-UX audit #5): reps read latest-rep.json.gz —
    // without this, an admin-side publish left reps on older numbers until
    // the background worker's next successful run.
    // Same sanitising as the derive worker (customer names out, numbers in) —
    // this used to push the FULL blob to the rep path until the next worker run.
    try {
      const repBlob = await new Response(new Blob([JSON.stringify(payload, (k, v) => (k === 'customer') ? undefined : v)]).stream()
        .pipeThrough(new CompressionStream('gzip'))).blob();
      await supabase.storage.from('reporting')
        .upload('indicators/latest-rep.json.gz', repBlob, { contentType: 'application/gzip', upsert: true });
    } catch (e2) { console.warn('[ridd] rep blob publish skipped', e2); }
    return { ok: true };
  } catch (e) {
    console.warn('[ridd] indicators cloud sync failed', e);
    return { ok: false, msg: e?.message || String(e) };
  }
}

let _indCloudCheckedAt = 0;
// ── Technician route stats (indicators/tech-stats.json.gz, hourly from
// tech-stats-background): per tech per day — scheduled / completed /
// production / reservices / interior / on-site minutes. Any signed-in user.
let _techStatsCheckedAt = 0;
async function refreshTechStatsFromCloud(force) {
  if (DEMO || !state.profile || typeof DecompressionStream === 'undefined') return;
  if (!force && Date.now() - _techStatsCheckedAt < 300000) return;
  _techStatsCheckedAt = Date.now();
  try {
    const r = await _downloadSnapshotBlob('indicators/tech-stats.json.gz', null, { meta: true }).catch(() => null);
    if (!r || !r.blob) return;
    const text = await new Response(r.blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.rows)) return;
    state.techStats = payload; healthReport('techstats', true);
    if (state.view === 'techs') mountApp();
  } catch (e) { healthReport('techstats', false, e); }
}
async function refreshIndicatorsFromCloud(force) {
  // Open to every signed-in user (was admin-only) — the rep-facing NRLA board
  // reads the same shared dataset. Reads only; config pushes stay admin-gated.
  if (DEMO || !state.profile) return;
  // Manual-data mode pins Indicators to an admin's uploaded CSV (THIS
  // browser only) — the background poll must never overwrite it. Reverting
  // clears the flag first, then calls this with force=true.
  if (state._indManualMode) return;
  if (typeof DecompressionStream === 'undefined') return;
  if (!force && Date.now() - _indCloudCheckedAt < 120000) return; // ≤1 check / 2 min
  _indCloudCheckedAt = Date.now();
  try {
    // Streamed download with stall watchdog + retries (see _downloadSnapshotBlob),
    // and CONDITIONAL: we remember the fingerprint (ETag) of the copy we already
    // have, so when nothing new has landed the server answers 304 with no body.
    // That keeps every open tab's 10-min poll effectively free at any headcount.
    const _cloudPath = _indicatorsCloudPath();
    const TAG_KEY = 'ridd_ind_cloud_tag:' + _cloudPath;
    let prevTag = {};
    try { prevTag = JSON.parse(localStorage.getItem(TAG_KEY) || '{}') || {}; } catch { /* ignore */ }
    let r = await _downloadSnapshotBlob(_cloudPath, null, {
      meta: true,
      ifNoneMatch: prevTag.etag || undefined,
      ifModifiedSince: prevTag.lastModified || undefined,
    }).catch(() => null);
    // REP-BLOB FALLBACK: if the sanitized copy doesn't exist yet (it only
    // publishes on a successful sync run), fall back to the full blob so a
    // fresh device is never data-blind. Storage policy may 403 this for
    // reps once applied — that's fine, the next successful sync creates
    // the rep blob and this path stops firing.
    if ((!r || (!r.blob && !r.notModified)) && _cloudPath !== INDICATORS_CLOUD_PATH) {
      r = await _downloadSnapshotBlob(INDICATORS_CLOUD_PATH, null, { meta: true }).catch(() => null);
    }
    if (r && r.notModified) { state._indPullError = null; healthReport('indicators', true); return; }   // device is reachable + up to date
    if (!r || !r.blob) {
      // 403 / 404 / timeout on THIS DEVICE — the server-age stamp can stay
      // green while this phone shows days-old numbers. Record it so the
      // stamp can say so (cleared on the next successful pull).
      state._indPullError = { at: Date.now(), msg: 'download failed' }; healthReport('indicators', false, 'download failed');
      return; // next poll retries
    }
    const blob = r.blob;
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.indicatorsData)) return;
    const remoteAt = payload.uploadedAt ? new Date(payload.uploadedAt).getTime() : 0;
    const localAt  = state.indicatorsUploadedAt ? new Date(state.indicatorsUploadedAt).getTime() : 0;
    const _saveTag = () => { try { localStorage.setItem(TAG_KEY, JSON.stringify({ etag: r.etag || null, lastModified: r.lastModified || null })); } catch { /* ignore */ } };
    if (!remoteAt) return;
    if (remoteAt === localAt) { _saveTag(); return; }            // same dataset — remember the tag, skip the work
    // THE SERVER IS THE WRITER now — the RevHawk sync job derives and
    // publishes the shared dataset with every snapshot. The only legitimate
    // way for LOCAL to be ahead is a manual CSV import on an admin device
    // (which shares itself up as it saves). Everything else — including
    // RevHawk-stamped data with a stale or clock-skewed stamp — adopts the
    // server copy on ANY difference. The tag is only saved on apply/match
    // so skips keep re-checking.
    if (remoteAt < localAt
        && isAdminRole(state.profile && state.profile?.role)
        && !/^RevHawk sync/i.test(state.indicatorsFileName || '')) return;
    _saveTag();
    // Branch-name heal at the ONE ingest point (branchAlias: seeded with
    // Office 20 → LITTLE ROCK; future renames ship via config, no deploy).
    try {
      (payload.indicatorsData || []).forEach(r2 => { const a = branchAlias(r2.branch); if (a !== r2.branch) r2.branch = a; });
      (payload.rawSales || []).forEach(s2 => { const a = branchAlias(s2.office); if (a !== s2.office) s2.office = a; });
    } catch (e) { /* cosmetic heal only */ }
    state.indicatorsData       = payload.indicatorsData;
    state._indicatorRawSales   = payload.rawSales || [];
    state.indicatorsUploadedAt = payload.uploadedAt;
    state.indicatorsFileName   = payload.fileName || '';
    state.indicatorsWeek = -1;
    reactivateRecentSellers(); // bring back any Inactive rep who sold again
    try { _applyIndicatorsPayloadHousekeeping(payload); } catch (hkErr) { console.warn('[ridd] payload housekeeping failed', hkErr); }
    saveDemoData();
    // Silent by design: this fires on every open/wake as routine hygiene —
    // the Last-sync stamp is the freshness UI, not a popup.
    state._indPullError = null; healthReport('indicators', true);
    console.info('[ridd] indicators refreshed from cloud (' + (payload.fileName || 'CSV') + ')');
    if (typeof scheduleBackgroundRemount === 'function') scheduleBackgroundRemount(); else mountApp();
    setTimeout(() => { try { maybeShowWeeklyRecap(); } catch { /* ignore */ } }, 800);
  } catch (e) {
    state._indPullError = { at: Date.now(), msg: String((e && e.message) || e || 'network') }; healthReport('indicators', false, e);
    console.warn('[ridd] indicators cloud refresh failed', e);
  }
}

// Rep → office auto-sync: each rep's MOST FREQUENT office in the sales, written
// into the shared rep_offices map. Deterministic on purpose (per Isaac, Oct 16 —
// a team rename kept reverting): ties used to fall to whichever office came first
// in the payload, which differs between loads/devices, so two open tabs flipped
// e.g. 2 DETROIT / 2 SALT LAKE back and forth, re-saving the shared config every
// few minutes and making every other device's real edits lose the CAS race.
// Ties now go to the office of the rep's latest sale, then alphabetically, and
// keys use the same cleaned spelling the map is normalized to (a raw "Gross , Noah"
// was being re-added after every load). Returns how many entries changed.
function _autoMergeRepOffices(raw) {
  const clean = (n) => (typeof _cleanRepName === 'function' ? _cleanRepName(n) : String(n || '').trim());
  const toIso = (d) => (typeof dateSoldToIso === 'function' ? (dateSoldToIso(d) || '') : String(d || ''));
  const stats = {};
  for (const s of raw || []) {
    if (!s || !s.rep || !s.office) continue;
    const rep = clean(s.rep); if (!rep) continue;
    const o = ((stats[rep] = stats[rep] || {})[s.office] = stats[rep][s.office] || { n: 0, last: '' });
    o.n++;
    const iso = toIso(s.dateSold); if (iso > o.last) o.last = iso;
  }
  if (!state._indicatorRepOffice) state._indicatorRepOffice = {};
  const m = state._indicatorRepOffice;
  let updated = 0;
  for (const [rep, offices] of Object.entries(stats)) {
    const top = Object.entries(offices).sort((a, b) => (b[1].n - a[1].n) || b[1].last.localeCompare(a[1].last) || a[0].localeCompare(b[0]))[0]?.[0];
    if (top && m[rep] !== top) { m[rep] = top; updated++; }
  }
  if (updated > 0 && typeof _invalidateRepSigIndex === 'function') _invalidateRepSigIndex(m);
  return updated;
}

// Post-apply housekeeping — the things the local PARSE path used to do that
// must now happen when a device APPLIES the server-derived payload instead
// (browsers no longer parse snapshots in the normal flow).
function _applyIndicatorsPayloadHousekeeping(payload) {
  const raw = (payload && payload.rawSales) || [];
  // 1. Rep-type sig map from the additive per-sale repType field. Server
  //    payloads carry it (from the CRM's Sold By Type); this gives every
  //    account — including reps, who never load the Reporting tab — the
  //    authoritative department mapping.
  try {
    const m = {};
    for (const s of raw) {
      const t = (s && s.repType || '').trim();
      if (!t || !s.rep) continue;
      const k = _repTypeNameSig(typeof getCanonicalRepName === 'function' ? getCanonicalRepName(s.rep) : s.rep);
      if (k && !m[k]) m[k] = t;
    }
    if (Object.keys(m).length) {
      state._indicatorRepTypeBySig = Object.assign({}, state._indicatorRepTypeBySig || {}, m);
    }
  } catch (e) { console.warn('[ridd] rep-type map from payload failed', e); }
  // 2. Rep → office auto-sync (admins only — it lands in shared config).
  try {
    if (!isAdminRole(state.profile && state.profile?.role)) return;
    if (_autoMergeRepOffices(raw) > 0 && typeof saveIndicatorState === 'function') saveIndicatorState();
  } catch (e) { console.warn('[ridd] rep-office merge from payload failed', e); }
}

// Refs of the bulk data last persisted, so config-only saves (team/tier
// assignments etc.) can skip re-serializing the whole raw-sales array.
let _lastBulkRawRef = null, _lastBulkDataRef = null, _lastBulkSnapCount = -1;
function saveIndicatorState() {
  // Any settings save may change exclusions/teams — drop the sales caches.
  if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
  // COMPANY-NUMBER rules mirror into the synced extras (their UI already
  // claimed "for every user" — now it's true): deleted-account exclusions +
  // the Rep Leaderboard cancel-count toggles.
  try {
    state._compExtras = state._compExtras || {};
    const _ar = state._compExtras.adminRules = state._compExtras.adminRules || {};
    if (Array.isArray(state.indicatorDeletedCustIds)) _ar.deletedCustIds = state.indicatorDeletedCustIds;
    if (typeof state._indicatorRepIncludeRor === 'boolean') _ar.repIncludeRor = state._indicatorRepIncludeRor;
    if (typeof state._indicatorRepIncludeOneTime === 'boolean') _ar.repIncludeOneTime = state._indicatorRepIncludeOneTime;
    if (typeof state._indicatorRepIncludeRenewals === 'boolean') _ar.repIncludeRenewals = state._indicatorRepIncludeRenewals;
    // Configurations → Indicators exclusions are COMPANY rules (per the Sep 30
    // settings audit — they were device-only before): shared like the rest.
    _ar.indMyExclTerms = Array.isArray(state.indicatorMyExclServiceTerms) ? state.indicatorMyExclServiceTerms : null;
    _ar.indExclServices = Array.isArray(state.indicatorExclServices) ? state.indicatorExclServices : null;
    _ar.indExclTeams = Array.isArray(state.indicatorExclTeams) ? state.indicatorExclTeams : [];
  } catch (e) { /* mirror is best-effort */ }
  // Settings ALWAYS save first, with their own try/catch, so a quota failure
  // on the bulk CSV save can't roll back team/rep edits. Without this split,
  // adding a team while the data payload was over quota silently dropped the
  // team on the next refresh.
  try {
    const settings = { savedAt: new Date().toISOString() };
    for (const k of INDICATOR_SETTINGS_FIELDS) settings[k] = state[k];
    localStorage.setItem(INDICATORS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    // Remember when THIS browser last saved settings — the server-config load
    // uses it to refuse to clobber newer local work with a stale server row.
    state._indicatorSettingsSavedAt = settings.savedAt;
  } catch (err) {
    console.warn('[ridd] failed to save indicator settings', err);
    if (typeof toast === 'function') toast('Could not save team/rep settings — localStorage may be full', 'error');
  }
  // Settings also mirror up to Supabase (production only) so any admin on
  // any device sees the same teams/tiers/rep overrides. Fire-and-forget —
  // localStorage already has the fresh value, so the UI doesn't wait on
  // the round-trip and a network failure doesn't roll back the local save.
  saveIndicatorConfigToSupabase().catch(err => console.warn('[ridd] indicator config sync failed', err));
  // Bulk-data persist is expensive — it serializes the entire raw-sales array
  // (100k+ rows on a year upload). Config edits (team/tier/office assignments,
  // exclusions, colors) only change SETTINGS, which are already saved above, so
  // skip the bulk block unless the underlying data actually changed. Detect by
  // reference (indicatorsData + _indicatorRawSales are rebuilt on every
  // upload/sync) plus snapshot count (snapshots are pushed in place).
  const _snapCount = Array.isArray(state._indicatorSnapshots) ? state._indicatorSnapshots.length : 0;
  const _bulkUnchanged = state._indicatorRawSales === _lastBulkRawRef
    && state.indicatorsData === _lastBulkDataRef
    && _snapCount === _lastBulkSnapCount;
  if (!_bulkUnchanged) {
  try {
    const data = { savedAt: new Date().toISOString() };
    // Stamp the upload time on the bulk payload so the IndexedDB restore
    // can tell whether its copy is older than what's already in state
    // (e.g. a fresher upload just pulled from the cloud).
    data.indicatorsUploadedAt = state.indicatorsUploadedAt;
    for (const k of INDICATOR_DATA_FIELDS) {
      if (k === '_indicatorRawSales' && Array.isArray(state[k])) {
        // Strip _rawRow from each sale before persisting. It's a full
        // copy of the original CSV row (~30 columns × ~20 chars each)
        // attached to every sale, so on a year-sized upload it can
        // roughly double the localStorage footprint and trip the
        // browser's ~5MB quota. The in-memory state keeps _rawRow for
        // the current session so the raffle + Top-5 exports still get
        // the full passthrough; on a refresh the exports fall back to
        // their known-column path (both already guard with
        // `Array.isArray(s._rawRow)`), and a re-upload restores the
        // raw rows.
        data[k] = state[k].map(s => {
          if (!s || !s._rawRow) return s;
          const { _rawRow, ...rest } = s;
          return rest;
        });
      } else {
        data[k] = state[k];
      }
    }
    // Snapshot history grows with every import — keep only the last few
    // locally so it can't crowd the raw sales out of the quota.
    if (Array.isArray(data._indicatorSnapshots) && data._indicatorSnapshots.length > 6) {
      data._indicatorSnapshots = data._indicatorSnapshots.slice(-6);
    }
    // IndexedDB is THE bulk store (no quota). The old localStorage paths
    // (plain JSON → gz fallback → slim-without-rows fallback) are retired:
    // the dataset outgrew the 5MB quota on desktops too, and each fallback
    // was another way for a device to resurrect stale data or hold a fresh
    // stamp with no rows. One store, one truth. The legacy localStorage
    // bulk keys are actively removed so an old copy can never shadow IDB.
    _indIdbSet('bulk', data).catch(e => {
      // IDB unavailable (rare: private mode on some browsers) — fall back to
      // the compressed localStorage path, which self-deletes when stale.
      console.warn('[ridd] IndexedDB indicator save failed — using gz fallback', e);
      try { _storeIndicatorDataCompressed(JSON.stringify(data)); } catch { /* memory-only session */ }
    });
    try {
      localStorage.removeItem(INDICATORS_DATA_STORAGE_KEY);
      localStorage.removeItem(INDICATORS_DATA_GZ_KEY);
    } catch { /* ignore */ }
  } catch (err) {
    console.warn('[ridd] indicator bulk save failed', err);
  }
  // Remember what we just persisted so subsequent config-only saves skip this
  // block until the underlying data changes again.
  _lastBulkRawRef = state._indicatorRawSales;
  _lastBulkDataRef = state.indicatorsData;
  _lastBulkSnapCount = _snapCount;
  }
}

// ── Coalesced background re-render ──────────────────────────────────────
// The async boot loaders (settings, company goal, gz cache, IndexedDB bulk
// restore) each used to trigger their OWN full re-render as they resolved —
// four+ complete DOM rebuilds before the user touched anything, a big part
// of why refreshes felt slow. Requests within a short window now collapse
// into a single re-render, and it stays out of the way while the main
// loading sequence is still in flight (it re-renders at the end anyway).
let _bgRemountTimer = null;
// RENDER STABILITY — background repaints wait for a QUIET moment: if the
// user scrolled / tapped / typed in the last ~1.2s the remount re-arms and
// tries again shortly, so fresh data can never yank the page mid-read.
// (Direct user actions still call mountApp() synchronously as always.)
let _lastMountedView = null;
let _lastUserActivity = 0;
if (typeof window !== 'undefined' && !window._riddActivityWired) {
  window._riddActivityWired = true;
  const _act = () => { _lastUserActivity = Date.now(); };
  ['scroll', 'wheel', 'pointerdown', 'touchmove', 'keydown'].forEach(ev => window.addEventListener(ev, _act, { passive: true }));
}
function scheduleBackgroundRemount() {
  if (_bgRemountTimer) return;
  const attempt = (tries) => {
    _bgRemountTimer = null;
    if (!state.profile || typeof mountApp !== 'function' || _loadAndRenderInFlight) return;
    if (Date.now() - _lastUserActivity < 1200 && tries < 8) {
      _bgRemountTimer = setTimeout(() => attempt(tries + 1), 700);
      return;
    }
    mountApp();
  };
  _bgRemountTimer = setTimeout(() => attempt(0), 120);
}
// Healed "Last upload" stamp for page headers. Self-repairs a stored
// timestamp that lags the dataset label (partial state restores), and never
// exposes the dataset's internal filename — just the time.
function indicatorsSyncStampText() {
  if (!state.indicatorsUploadedAt) return '';
  let t = new Date(state.indicatorsUploadedAt);
  const m = /RevHawk sync — (\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(state.indicatorsFileName || '');
  if (m) {
    const labelDay = new Date(+m[3], +m[1] - 1, +m[2]);
    if (isNaN(t) || t < labelDay) {
      const up0 = (state.reportingUploads || [])[0];
      const upT = up0 && up0.uploaded_at ? new Date(up0.uploaded_at) : null;
      t = (upT && upT >= labelDay) ? upT : labelDay;
      state.indicatorsUploadedAt = t.toISOString();
    }
  }
  if (isNaN(t)) return '';
  return t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// ONE sync clock, app-wide (per Isaac). Every stamp shows the SAME
// timestamp (the shared dataset's publish moment) in the SAME zone — the
// user's Time Zone preference, defaulting to Mountain (company clock) —
// with the zone label printed so two users comparing screens can never
// think they're out of sync when they're just in different time zones.
// ONE description of where the numbers come from and how fresh they are
// (provenance audit): every tooltip that talks about the sync quotes this.
const SYNC_CADENCE_TEXT = 'Last sync = the last time the app pulled from RevHawk\u2019s copy of FieldRoutes (every 30 minutes, 8 AM\u201311 PM ET). CRM data = how current that copy is \u2014 the newest FieldRoutes change RevHawk has picked up. If RevHawk stops refreshing, Last sync keeps moving but CRM data stands still, and the stamp turns amber.';
function appSyncStampStr() {
  indicatorsSyncStampText();   // runs the self-heal on the stored timestamp
  if (!state.indicatorsUploadedAt) return '';
  const t = new Date(state.indicatorsUploadedAt);
  if (isNaN(t)) return '';
  const p = (typeof userTzPref === 'function') ? userTzPref() : 'auto';
  const tz = (typeof _TZ_RAW_OFFSET !== 'undefined' && _TZ_RAW_OFFSET[p] != null) ? p : 'America/Denver';
  try {
    return t.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).replace(',', ' \u00b7');
  } catch (e) {
    return t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
// Is the shared dataset OVERDUE? Syncs land hourly on the hour, 8am–11pm ET
// (paused overnight). Data older than ~100 min DURING selling hours means a
// run failed or hasn't landed — the header stamp turns amber so staleness
// is visible instead of silently trusted.
function indicatorsSyncOverdue() {
  return indicatorsSyncStaleness() !== null;
}
// Two-tier staleness: 'amber' (>100 min — one run missed) escalates to
// 'red' (>4 h — multiple consecutive failures, someone should look NOW).
// CRM data age (per Isaac, Sep 29 — the weekend stall): the sync worker's
// heartbeat records how current RevHawk's copy is (`dataAsOf`). Read it
// straight from storage every 5 minutes so every user's stamp can show it.
async function loadCrmDataAsOf() {
  try {
    if (typeof DEMO !== 'undefined' && DEMO) return;
    const { data } = await supabase.storage.from('reporting').download('indicators/sync-heartbeat.json');
    if (!data) return;
    const j = JSON.parse(await data.text());
    const prev = state._crmDataAsOf;
    state._crmDataAsOf = j.dataAsOf || null; state._syncRanAt = j.at || null;
    if (prev !== state._crmDataAsOf && typeof scheduleBackgroundRemount === 'function') scheduleBackgroundRemount();
  } catch (e) { /* best effort — the stamp falls back to the sync time */ }
}
if (!window._crmAsOfWired) { window._crmAsOfWired = true; setTimeout(loadCrmDataAsOf, 4000); setInterval(loadCrmDataAsOf, 5 * 60 * 1000); }
function crmDataAgeLevel() {
  if (!state._crmDataAsOf) return null;
  const t = Date.parse(state._crmDataAsOf); if (isNaN(t)) return null;
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = nowET.getHours();
  if (h < 9 || h >= 23) return null;                     // overnight — nothing new is expected
  const age = Date.now() - t;
  if (age > 6 * 3600000) return 'red';
  if (age > 2 * 3600000) return 'amber';
  return null;
}
function crmDataAsOfStr(short) {
  if (!state._crmDataAsOf) return '';
  const t = new Date(state._crmDataAsOf); if (isNaN(t)) return '';
  const p = (typeof userTzPref === 'function') ? userTzPref() : 'auto';
  const tz = (typeof _TZ_RAW_OFFSET !== 'undefined' && _TZ_RAW_OFFSET[p] != null) ? p : 'America/Denver';
  const sameDay = new Date().toDateString() === t.toDateString();
  try { return t.toLocaleString('en-US', Object.assign({ timeZone: tz, hour: 'numeric', minute: '2-digit' }, (short || sameDay) ? {} : { month: 'short', day: 'numeric' })); } catch (e) { return ''; }
}
function indicatorsSyncStaleness() {
  const _crm = crmDataAgeLevel();
  const _run = _indicatorsRunStaleness();
  if (_crm === 'red' || _run === 'red') return 'red';
  return _crm || _run;
}
function _indicatorsRunStaleness() {
  if (!state.indicatorsUploadedAt) return null;
  const t = new Date(state.indicatorsUploadedAt);
  if (isNaN(t)) return null;
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = nowET.getHours();
  if (h < 8 || h >= 23) return null;                           // overnight pause — big gaps are normal
  if (h === 8 && nowET.getMinutes() < 15) return null;         // give the 8:00 run time to land
  const age = Date.now() - t.getTime();
  if (age > 4 * 60 * 60 * 1000) return 'red';
  if (age > 100 * 60 * 1000) return 'amber';
  return null;
}

function loadIndicatorState() {
  // Read the new split keys first; fall back to the legacy combined key if a
  // user is loading from a state written before the split.
  const applyObj = (parsed) => {
    if (!parsed) return;
    for (const k of INDICATOR_PERSIST_FIELDS) {
      if (parsed[k] !== undefined) state[k] = parsed[k];
    }
  };
  const apply = (raw) => {
    if (!raw) return;
    try { applyObj(JSON.parse(raw)); }
    catch (err) { console.warn('[ridd] failed to parse indicator state', err); }
  };
  // Legacy combined key: only parse it when the split keys don't exist yet
  // (first boot after upgrading). It can be several MB and JSON.parse is
  // synchronous — skipping it when it's redundant shaves real time off every
  // refresh, since the split keys below override all its fields anyway.
  if (!localStorage.getItem(INDICATORS_DATA_STORAGE_KEY) && !localStorage.getItem(INDICATORS_SETTINGS_STORAGE_KEY)) {
    apply(localStorage.getItem(INDICATORS_STORAGE_KEY));      // legacy combined
  }
  apply(localStorage.getItem(INDICATORS_DATA_STORAGE_KEY));   // bulk (overrides legacy data fields)
  apply(localStorage.getItem(INDICATORS_SETTINGS_STORAGE_KEY)); // settings (overrides legacy settings fields)
  // Capture the settings save-stamp for the stale-server guard below.
  try { state._indicatorSettingsSavedAt = (JSON.parse(localStorage.getItem(INDICATORS_SETTINGS_STORAGE_KEY) || 'null') || {}).savedAt || ''; }
  catch { state._indicatorSettingsSavedAt = ''; }
  if (typeof _normalizeRepKeyedMaps === 'function') _normalizeRepKeyedMaps();
  if (typeof _hydrateTeamYears === 'function') _hydrateTeamYears();

  // Compressed bulk cache (written when plain JSON exceeded the quota).
  // Decompression is async, so the page may paint once without raw sales
  // and re-mount the moment they're back.
  const gz = localStorage.getItem(INDICATORS_DATA_GZ_KEY);
  if (gz && typeof DecompressionStream !== 'undefined') {
    (async () => {
      try {
        const bin = atob(gz);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
        // FRESHNESS GUARD — this async path used to apply unconditionally,
        // racing (and losing to) the IndexedDB restore and the cloud pull.
        // A gz copy that can no longer be refreshed (writes fail once the
        // dataset outgrows the quota) would resurrect month-old data on
        // every boot. Only apply when it's NOT older than what we hold;
        // when it IS older, delete it so it can't shadow IndexedDB again.
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* handled below */ }
        const _curUp = state.indicatorsUploadedAt ? Date.parse(state.indicatorsUploadedAt) : 0;
        const _gzUp  = parsed && parsed.indicatorsUploadedAt ? Date.parse(parsed.indicatorsUploadedAt) : 0;
        const _haveRaw = Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length > 0;
        if (parsed && _haveRaw && _curUp && _gzUp && _gzUp < _curUp) {
          console.warn('[ridd] stale compressed indicator cache (' + parsed.indicatorsUploadedAt + ') — dropping it; IndexedDB/cloud copy wins');
          try { localStorage.removeItem(INDICATORS_DATA_GZ_KEY); } catch { /* ignore */ }
        } else if (parsed) {
          applyObj(parsed);
          scheduleBackgroundRemount();
        }
      } catch (e) {
        console.warn('[ridd] compressed indicator cache unreadable', e);
      }
    })();
  }

  // IndexedDB bulk restore — the primary store for all-time-sized uploads
  // that don't fit in localStorage at all. Applied when it's at least as
  // fresh as whatever the localStorage path produced (same save writes both,
  // so equal timestamps mean the idb copy has the full raw-sales array).
  // COHERENCE GUARD — the freshness stamp must describe data we actually
  // HOLD. The stamp persists in the small settings key (always saves) while
  // raw sales live in the big bulk key (can fail quota on phones and fall
  // back to a slim copy WITHOUT rows). On the next boot that fresh-stamp/
  // no-data combo made the cloud refresh think this device was current and
  // skip the fix — the "month-old board with no numbers" bug. No rows → no
  // freshness claim; the cloud copy then applies unconditionally.
  if (state.indicatorsUploadedAt && !(Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length)) {
    state.indicatorsUploadedAt = null;
  }
  const lsBulkAt = (() => {
    try { return (JSON.parse(localStorage.getItem(INDICATORS_DATA_STORAGE_KEY) || 'null') || {}).savedAt || ''; }
    catch { return ''; }
  })();
  (async () => {
    try {
      const bulk = await _indIdbGet('bulk');
      if (!bulk || !bulk.savedAt) return;
      // Never clobber fresher data that landed while we were reading —
      // the cloud refresh may have already pulled a newer admin's upload.
      const curUp  = state.indicatorsUploadedAt ? Date.parse(state.indicatorsUploadedAt) : 0;
      const bulkUp = bulk.indicatorsUploadedAt ? Date.parse(bulk.indicatorsUploadedAt) : 0;
      if (curUp && bulkUp && bulkUp < curUp) return;
      const haveRaw = Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length > 0;
      if (bulk.savedAt >= lsBulkAt || !haveRaw) {
        applyObj(bulk);
        scheduleBackgroundRemount();
      }
    } catch (e) { console.warn('[ridd] IndexedDB indicator restore failed', e); }
  })();
}

