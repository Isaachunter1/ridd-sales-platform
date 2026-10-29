// ── Reporting tab loaders ────────────────────────────────────────────────
// Two-tier load: metadata (uploads list + service config) loads on app
// boot so the Reporting tab can render instantly. Subscription rows are
// lazy-loaded on demand when an upload is selected — those can be tens
// of thousands of rows and shouldn't block first paint.
async function loadReportingMetadata() {
  if (DEMO || !state.profile || !(isAdminRole(state.profile?.role) || canOpenLoyalty())) return;   // Loyalty tab users read the same snapshot (20260923_loyalty_access.sql)
  try {
    const [uploadsRes, configRes, cancelCfgRes, sourceCfgRes] = await Promise.all([
      supabase.from('reporting_uploads').select('*').order('uploaded_at', { ascending: false }),
      supabase.from('reporting_service_config').select('*').order('service_name'),
      supabase.from('reporting_cancel_config').select('*').order('reason'),
      supabase.from('reporting_source_config').select('*').order('source'),
    ]);
    if (uploadsRes.error) { console.warn('[ridd] reporting_uploads load failed', uploadsRes.error); }
    if (configRes.error)  { console.warn('[ridd] reporting_service_config load failed', configRes.error); }
    if (cancelCfgRes && cancelCfgRes.error) { console.warn('[ridd] reporting_cancel_config load failed (run reporting_cancel_config.sql)', cancelCfgRes.error); }
    if (sourceCfgRes && sourceCfgRes.error) { console.warn('[ridd] reporting_source_config load failed (run reporting_source_config.sql)', sourceCfgRes.error); }
    if (uploadsRes.error || configRes.error) healthReport('settings', false, (uploadsRes.error || configRes.error)); else healthReport('settings', true);
    state.reportingUploads       = uploadsRes.data || [];
    state.reportingServiceConfig = configRes.data || [];
    state.reportingCancelConfig  = (cancelCfgRes && cancelCfgRes.data) || [];
    state.reportingSourceConfig  = (sourceCfgRes && sourceCfgRes.data) || [];
    // Default the active snapshot to the most recent upload.
    if (!state.reportingActiveUploadId && state.reportingUploads.length) {
      state.reportingActiveUploadId = state.reportingUploads[0].id;
    }
    state._reportingLatestId = state.reportingUploads.length ? state.reportingUploads[0].id : null;
  } catch (err) {
    healthReport('settings', false, err);
  }
}

// ── IndexedDB cache for reporting snapshots ──────────────────────────────
// localStorage is ~5MB and too small for a 77k-row snapshot; IndexedDB holds
// hundreds of MB. We stash the loaded rows keyed by upload id, so a refresh
// on the SAME snapshot reads from local disk in a few ms instead of
// re-downloading everything. A new upload writes a new key and supersedes it.
const REPORTING_IDB_DB = 'ridd-reporting';
const REPORTING_IDB_STORE = 'snapshots';
function _reportingIdb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexeddb'));
    const req = indexedDB.open(REPORTING_IDB_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(REPORTING_IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function reportingIdbGet(uploadId) {
  try {
    const db = await _reportingIdb();
    return await new Promise((resolve) => {
      const tx = db.transaction(REPORTING_IDB_STORE, 'readonly');
      const r = tx.objectStore(REPORTING_IDB_STORE).get(uploadId);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function reportingIdbPut(uploadId, rows) {
  try {
    const db = await _reportingIdb();
    await new Promise((resolve) => {
      const tx = db.transaction(REPORTING_IDB_STORE, 'readwrite');
      const store = tx.objectStore(REPORTING_IDB_STORE);
      store.put(rows, uploadId);
      // Keep only this snapshot — old ones are stale once a new upload lands.
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        (keysReq.result || []).forEach(k => { if (k !== uploadId && !String(k).startsWith('geo:')) store.delete(k); });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* cache is best-effort */ }
}

// Put without evicting — for static assets (state ZIP boundaries) that
// should outlive snapshot rotations.
async function reportingIdbPutKeep(key, value) {
  try {
    const db = await _reportingIdb();
    await new Promise((resolve) => {
      const tx = db.transaction(REPORTING_IDB_STORE, 'readwrite');
      tx.objectStore(REPORTING_IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

// Phantom offices lingering in the CRM (negative office IDs surface as
// "Office -1" / "Office -7"). They aren't real branches we sold from. The
// sync now filters them at the source, but older snapshots still carry them —
// so we also strip them here, at the single chokepoint every reporting /
// indicators / commission consumer loads through. Revenue, subs, audits,
// everything: gone.
const PHANTOM_OFFICE_NAMES = new Set(['Office -1', 'Office -7']);
function stripPhantomOffices(rows) {
  return Array.isArray(rows) ? rows.filter(r => !PHANTOM_OFFICE_NAMES.has(String(r && r.office_name || '').trim())) : rows;
}
// Background warm-up (per Isaac — the Geographic tab sat on "Downloading
// snapshot…" every morning): once the uploads list is in, quietly pull the
// active snapshot into IndexedDB + state a few seconds after login, with the
// progress toast suppressed. By the time anyone opens Reporting the rows are
// already local. No-op for roles that can't read the snapshot anyway.
function prefetchReportingSnapshot() {
  try {
    const id = state.reportingActiveUploadId;
    if (!id || state.reportingSubscriptionsLoadedFor === id || state._reportingPrefetching) return;
    if (!isAdminRole(state.profile?.role) && !(typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(state.profile))) return;
    state._reportingPrefetching = true;
    const run = () => {
      state._reportingSilent = true;
      loadReportingSubscriptions(id).then(rows => {
        if (rows && rows.length && state.reportingActiveUploadId === id && state.reportingSubscriptionsLoadedFor !== id) {
          state.reportingSubscriptions = rows; healthReport('reporting', true);
          state.reportingSubscriptionsLoadedFor = id;
          if (typeof _refreshRepTypeMap === 'function') { try { _refreshRepTypeMap(); } catch (e) { /* optional */ } }
          if (state.view === 'reporting') mountApp();
        }
      }).catch(() => {}).finally(() => { state._reportingSilent = false; state._reportingPrefetching = false; });
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 3000);
  } catch (e) { state._reportingPrefetching = false; }
}
// Snapshot-side guard for transferred accounts (until the sync's dedupe has
// run): if a snapshot carries the same subscription twice, keep the copy
// whose office matches the row's own customer office — or simply the last
// one seen — so a moved account isn't counted under both branches.
function dedupeSnapshotSubs(rows) {
  if (!Array.isArray(rows) || !rows.length || rows[0].subscription_id == null) return rows;
  const seen = new Map();
  for (const r of rows) { const k = String(r.subscription_id || ''); if (!k) continue; seen.set(k, r); }
  return rows.filter(r => !r.subscription_id || seen.get(String(r.subscription_id)) === r);
}
// Renewal chaining (per Isaac, Sep 2026): when a customer's sub is closed
// with a "Renewal - …" reason and a renewal-source sub opens for the same
// customer around the same time, that is ONE relationship changing plans,
// not a churn + a new sale. We keep both rows (the renewal team's sale is
// still a sale) but stamp the renewal sub with the chain's origin so the
// retention cohorts, tenure and unit economics treat it as a continuation:
//   origin_initial_service / origin_sold_date — the very first sub's dates
//   renewal_prev_arv — ARR of the sub it replaced (expansion = new − prev)
//   is_renewal_cont — true on the renewal sub; renewed_into on the old one
function linkRenewalChains(rows) {
  const isRenewalReason = (r) => /^renewal/i.test(String(reportingCancelReasonOf(r) || '').trim());
  const isRenewalSource = (r) => /^renewal/i.test(String(r.subscription_source || '').trim());
  const byCust = new Map();
  for (const r of rows) { const k = r.customer_id != null ? String(r.customer_id) : ''; if (!k) continue; (byCust.get(k) || byCust.set(k, []).get(k)).push(r); }
  const DAY = 86400000, BEFORE = 45 * DAY, AFTER = 60 * DAY;
  const t = (d) => { if (!d) return NaN; const x = new Date(String(d).slice(0, 10) + 'T00:00'); return isNaN(x) ? NaN : x.getTime(); };
  let links = 0;
  for (const subs of byCust.values()) {
    if (subs.length < 2) continue;
    const olds = subs.filter(r => r.subscription_date_canceled && isRenewalReason(r));
    if (!olds.length) continue;
    const news = subs.filter(r => isRenewalSource(r) && r.sold_date).sort((a, b) => String(a.sold_date).localeCompare(String(b.sold_date)));
    const used = new Set();
    for (const n of news) {
      const ns = t(n.sold_date); if (isNaN(ns)) continue;
      let best = null, bestGap = Infinity;
      for (const o of olds) {
        if (o === n || used.has(o)) continue;
        const oc = t(o.subscription_date_canceled); if (isNaN(oc)) continue;
        const gap = ns - oc;                       // + = opened after the close
        if (gap < -BEFORE || gap > AFTER) continue;
        if (Math.abs(gap) < bestGap) { best = o; bestGap = Math.abs(gap); }
      }
      if (!best) continue;
      used.add(best);
      n.is_renewal_cont = true;
      n.origin_initial_service = best.origin_initial_service || best.initial_service || null;
      n.origin_sold_date = best.origin_sold_date || best.sold_date || null;
      n.renewal_prev_arv = Number(best.annual_recurring_value) || 0;
      best.renewed_into = n.subscription_id || true;
      links++;
    }
  }
  // SECOND PASS — closes with NO cancel reason (per Isaac, Oct 8). The data feed has no reason for ~2,900 older
  // cancels (FieldRoutes does). When such a sub was closed right as a renewal-source sub was sold to the same
  // customer (renewal sold from 7 days before the close to 7 days after), it is that renewal's old plan — checked
  // against Isaac's FieldRoutes sheet: 54 of 55 sampled were renewals there. The old sub gets the renewal's own
  // label as its reason (flagged cancel_reason_inferred) so every rule that reads the reason treats it as a renewal,
  // and the renewal is chained to it like any other. A blank close with no renewal beside it is left alone.
  const NEAR = 7 * DAY; let inferred = 0;
  for (const subs of byCust.values()) {
    if (subs.length < 2) continue;
    const news = subs.filter(r => isRenewalSource(r) && r.sold_date && !r.is_renewal_cont);
    if (!news.length) continue;
    const olds = subs.filter(r => r.subscription_date_canceled && !String(r.subscription_cancellation_reason || '').trim() && !/active/i.test(String(r.subscription_status || '')) && !r.renewed_into);
    if (!olds.length) continue;
    const used = new Set();
    for (const n of news.sort((x, y) => String(x.sold_date).localeCompare(String(y.sold_date)))) {
      const ns = t(n.sold_date); if (isNaN(ns)) continue;
      let best = null, bestGap = Infinity;
      for (const o of olds) {
        if (o === n || used.has(o) || !(String(o.sold_date || '') < String(n.sold_date))) continue;
        const oc = t(o.subscription_date_canceled); if (isNaN(oc)) continue;
        const gap = Math.abs(ns - oc); if (gap > NEAR) continue;
        if (gap < bestGap) { best = o; bestGap = gap; }
      }
      if (!best) continue;
      used.add(best);
      best.subscription_cancellation_reason = String(n.subscription_source).trim();
      best.cancel_reason_inferred = true;
      n.is_renewal_cont = true;
      n.origin_initial_service = best.origin_initial_service || best.initial_service || null;
      n.origin_sold_date = best.origin_sold_date || best.sold_date || null;
      n.renewal_prev_arv = Number(best.annual_recurring_value) || 0;
      best.renewed_into = n.subscription_id || true;
      links++; inferred++;
    }
  }
  state._renewalLinks = links;
  state._renewalReasonsInferred = inferred;
  return rows;
}
async function _loadCrmDeletedIds() {
  if (state._crmDeletedLoaded || DEMO || !supabase) return;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'crm_deleted').maybeSingle();
    const v = data && data.value;
    state._crmDeletedIdsRaw = (v && Array.isArray(v.ids)) ? v.ids.map(x => String(x).trim()).filter(Boolean) : [];
    // Default OFF (Sep 29): the scan list wrongly held live customers, so it
    // only applies when an admin turns it on in Configurations.
    state._crmDeletedIds = (typeof reportingUseCrmDeletedScan === 'function' && reportingUseCrmDeletedScan()) ? state._crmDeletedIdsRaw : [];
    state._crmDeletedMeta = v ? { scanned_at: v.scanned_at || null, checked: v.checked || 0, mirror: v.mirror || 0, skipped: v.skipped_batches || 0, last_error: v.last_error || null } : null;
  } catch (e) { state._crmDeletedIds = state._crmDeletedIds || []; }
  state._crmDeletedLoaded = true;
}
function _stalePendingCustIds(rows) {
  if (!Array.isArray(rows) || !rows.some(r => 'initial_appt_date' in r)) return [];   // older snapshot without the field — do nothing
  const days = (typeof reportingStalePendingDays === 'function') ? reportingStalePendingDays() : 2;
  const cut = new Date(); cut.setDate(cut.getDate() - days); const cutIso = cut.toISOString().slice(0, 10);
  // No appointment at all: keep a 14-day window from the sale date (a fresh
  // sale can take a few days to get its initial booked).
  const cutNo = new Date(); cutNo.setDate(cutNo.getDate() - 14); const cutNoIso = cutNo.toISOString().slice(0, 10);
  const by = new Map();
  for (const r of rows) {
    const id = String(r.customer_id != null ? r.customer_id : ''); if (!id) continue;
    const active = String(r.subscription_status || '').trim().toLowerCase() === 'active';
    const serviced = !!(r.initial_service || r.initial_serviced_date) || String(r.initial_status || '').toLowerCase() === 'completed';
    const appt = r.initial_appt_date ? String(r.initial_appt_date).slice(0, 10) : null;
    const sold = r.sold_date ? String(r.sold_date).slice(0, 10) : null;
    // A frozen / cancelled plan that was ALSO never serviced doesn't make the
    // customer real (per Isaac, Oct 14 — #162269: Active Pest Rodent 6 never
    // booked, plus a frozen never-serviced Pest Rodent 4 sold the next day).
    // Any serviced plan, or an active plan still inside its window, keeps them.
    const stale = active ? (!serviced && (appt ? appt < cutIso : (!!sold && sold < cutNoIso))) : !serviced;
    by.set(id, (by.has(id) ? by.get(id) : true) && stale);
  }
  // Only customers with at least one ACTIVE plan are ghosts — an all-frozen,
  // never-serviced card is already dropped by reportingNeverStarted.
  const hasActive = new Set(rows.filter(r => String(r.subscription_status || '').trim().toLowerCase() === 'active').map(r => String(r.customer_id)));
  return [...by].filter(([k, v]) => v && hasActive.has(k)).map(([k]) => k);
}
function _ghostCopySubs(rows) {
  const act = (r) => String(r.subscription_status || '').trim().toLowerCase() === 'active';
  const live = (r) => /completed|pending/i.test(String(r.initial_status || '')) || (Number(r.subscription_completed_services) || 0) > 0 || !!r.initial_serviced_date;
  const by = new Map();
  for (const r of rows) { if (!act(r)) continue; const k = String(r.customer_id) + '|' + String(r.subscription || '').trim().toLowerCase(); (by.get(k) || by.set(k, []).get(k)).push(r); }
  const out = [];
  for (const [, rs] of by) { if (rs.length < 2 || !rs.some(live)) continue; for (const r of rs) if (!live(r)) out.push(r); }
  return out;
}
// Deleted-in-CRM rules (Configurations → Reporting rules → Deleted CRM
// accounts): orphans, nightly scan, stale pending, ghost copies. Pure over
// the loaded rows; re-run by _applyLiveDataRules() whenever the rules change.
function _filterDeletedRows(rows) {
  state._stalePendingCustIds = _stalePendingCustIds(rows);
  // Ghost copies (per Isaac, Sep 30 — #53790, #178588, #154001, #177531): an
  // Active subscription with NO appointment and NO services that sits beside
  // a real (Pending / serviced) Active subscription of the SAME service on
  // the same customer. It was re-entered and the first one deleted in
  // FieldRoutes; the mirror still carries it as Active. Dropped app-wide
  // (same Stale-pending switch) so it can't inflate active counts / ARR or
  // show as a CRM "duplicate".
  const ghostSubs = (typeof reportingExclStalePending === 'function' && !reportingExclStalePending()) ? [] : _ghostCopySubs(rows);
  state._ghostSubIds = ghostSubs.map(r => String(r.subscription_id));
  const _ghostSet = new Set(ghostSubs);
  const del = deletedCustIdSet();
  // Rows set aside as deleted-in-CRM (orphans + the manual list) are kept in
  // state so the Retention tab can start from the whole snapshot and show
  // this exclusion as a step of its own.
  const _isDel = (r) => _ghostSet.has(r) || del.has(String(r.customer_id != null ? r.customer_id : ''));
  state._deletedSubs = (del.size || _ghostSet.size) ? rows.filter(_isDel) : [];
  return (del.size || _ghostSet.size) ? rows.filter(r => !_isDel(r)) : rows;
}
function _applyLiveDataRules() {
  if (!Array.isArray(state._snapshotAllRows) || !state._snapshotAllRows.length) return;
  state._crmDeletedIds = (typeof reportingUseCrmDeletedScan === 'function' && reportingUseCrmDeletedScan()) ? (state._crmDeletedIdsRaw || []) : [];
  state.reportingSubscriptions = _filterDeletedRows(state._snapshotAllRows);
  if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
}
async function loadReportingSubscriptions(uploadId) {
  const raw = await _loadReportingSubscriptionsRaw(uploadId);
  const noPhantom = stripPhantomOffices(raw);
  const deduped = dedupeSnapshotSubs(noPhantom);
  // Ground-zero bookkeeping (per Isaac): the Retention tab walks down from
  // EVERYTHING in FieldRoutes, so remember what the loader itself dropped.
  state._snapshotLoadDrops = { raw: Array.isArray(raw) ? raw.length : 0, phantom: (Array.isArray(raw) ? raw.length : 0) - (Array.isArray(noPhantom) ? noPhantom.length : 0), dupes: (Array.isArray(noPhantom) ? noPhantom.length : 0) - (Array.isArray(deduped) ? deduped.length : 0) };
  // Cancellation reasons from an uploaded FieldRoutes report fill the blanks before renewal chains are linked.
  if (typeof retenApplyFileReasons === 'function') { try { retenApplyFileReasons(deduped); } catch (e) { /* settings not loaded yet */ } }
  const rows = linkRenewalChains(deduped);
  // Reinstated accounts (per Isaac, Sep 24): a sub that was cancelled and
  // then turned back on is ACTIVE in FieldRoutes but still carries the old
  // cancel date (Joshua Carter #137561, Fredrick Allen #110570). Churn is
  // ONLY subs that are actually frozen/cancelled today — an active sub is not
  // churn, whatever its history. The old date is kept on `reinstated_from`.
  // Grace window (Configurations → Reporting rules, default 30 days): back
  // within the window = never churned; later = the cancel stands (revenue was
  // missed) and the reactivation is a win-back (`winback_at`). The
  // reactivation date comes from the feed (`reactivated_at`); rows without it
  // are treated as reinstated in time.
  const _grace = (typeof reportingReinstateGraceDays === 'function') ? reportingReinstateGraceDays() : 30;
  let _reinstated = 0, _winbacks = 0;
  for (const r of rows) {
    if (r.subscription_date_canceled && String(r.subscription_status || '').trim().toLowerCase() === 'active') {
      const re = r.reactivated_at ? String(r.reactivated_at).slice(0, 10) : null;
      const gap = re ? Math.round((Date.parse(re) - Date.parse(String(r.subscription_date_canceled).slice(0, 10))) / 86400000) : null;
      if (gap != null && gap > _grace) { r.winback_at = re; _winbacks++; continue; }   // churn stands; came back later
      r.reinstated_from = r.subscription_date_canceled; r.subscription_date_canceled = null; _reinstated++;
    }
  }
  state._snapshotReinstated = _reinstated; state._snapshotWinbacks = _winbacks;
  // Blank / "un" / "unknown" states all group under ?? on the Geographic tab.
  if (typeof _normStateCode === 'function') {
    // Typed state vs the ZIP's state (per Isaac, Oct 14). Either can be the
    // typo: #139941 is ZIP 30310 (GA) saved as FL, but Myrtle Beach / Virginia
    // Beach customers with a mistyped ZIP (25906, 24854 …) landed in West
    // Virginia when the ZIP always won. The branch breaks the tie: each
    // office's states come from its customers whose state and ZIP agree, and
    // whichever of the two is one of the office's states wins. A typed value
    // that isn't a US state code (AC, AA, "Connecticut") always yields to the
    // ZIP. Every disagreement is kept on state_crm / zip_state for Auditing.
    const zipSt = (r) => (typeof _stateFromZip === 'function' ? _stateFromZip(r.zip_code) : null);
    const VALID = new Set((typeof _ZIP3_STATE !== 'undefined' ? _ZIP3_STATE : []).map(x => x[2]));
    const offCount = new Map();
    for (const r of rows) {
      r.state = _normStateCode(r.state);
      const z = zipSt(r), o = String(r.office_name || '').trim();
      if (z && z === r.state && o) { const m = offCount.get(o) || offCount.set(o, new Map()).get(o); m.set(z, (m.get(z) || 0) + 1); }
    }
    const offStates = new Map();
    for (const [o, m] of offCount) { const tot = [...m.values()].reduce((a, b) => a + b, 0); offStates.set(o, new Set([...m].filter(([, n]) => n / tot >= 0.02).map(([st]) => st))); }
    for (const r of rows) {
      const z = zipSt(r); if (!z || z === r.state) continue;
      const typed = r.state, home = offStates.get(String(r.office_name || '').trim()) || new Set();
      const typedOk = !!typed && VALID.has(typed);
      const pick = !typedOk ? z : (home.has(z) && !home.has(typed)) ? z : typed;
      r.state_crm = typed || '(blank)'; r.zip_state = z; r.state = pick;
    }
  }
  // Same guard as the sync: a sub sold in the last 7 days whose customer row
  // hasn't landed yet is a feed lag, not a deleted account (Julia Phillips,
  // #180833 — sold and serviced the day of the sync). Clear the flag so it
  // never shows as an orphan, in the steps or anywhere else.
  const _cut = new Date(); _cut.setDate(_cut.getDate() - 7);
  const _cutIso = _cut.toISOString().slice(0, 10);
  for (const r of rows) if (r.customer_missing && r.sold_date && String(r.sold_date).slice(0, 10) >= _cutIso) r.customer_missing = null;
  // Nightly FieldRoutes scan (app_settings.crm_deleted): customer ids the
  // CRM no longer returns. The mirror never forgets a deleted account, so
  // without this they read as live customers forever (per Isaac).
  await _loadCrmDeletedIds();
  const orphans = rows.filter(r => r.customer_missing);
  state._orphanSubs = orphans;
  state._orphanCustIds = [...new Set(orphans.map(r => String(r.customer_id != null ? r.customer_id : '')).filter(Boolean))];
  // Stale pending (per Isaac, Sep 29): customers deleted in FieldRoutes right
  // after signup live on in the mirror as Active + Pending forever (Ethan's
  // #145402, #154418, #162676, #174941, #179903 — all deleted in the CRM).
  // Stand-in until the nightly check / RevHawk catch deletions: a customer
  // whose EVERY sub is active, never serviced, and whose initial appointment
  // date passed 2+ days ago (or has none and was sold 14+ days ago).
  // Everything after the loader's own cleanup is kept, so the deleted-account
  // rules below can be re-applied LIVE when an admin changes them (no reload).
  state._snapshotAllRows = rows;
  const _kept = _filterDeletedRows(rows);
  // The deleted-customer sets just changed — drop every cached indicatorSales() view (per Isaac, Oct 29).
  if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
  return _kept;
}
// Streamed snapshot download with live progress, stall detection and retries.
// supabase-js .download() is one opaque await — if the connection stalls
// (laptop sleep, flaky wifi, dropped socket) it hangs forever and the toast
// freezes at 15% with no way out. Fetching the storage object directly lets
// us: show a real % from the byte stream, abort whenever no bytes arrive for
// STALL_MS, and retry with backoff before giving up to the paged fallback.
// Pass opts.meta:true to get { blob, etag, lastModified, notModified } back;
// with opts.ifNoneMatch / opts.ifModifiedSince the server can answer 304
// ("you already have this") with NO body — that's what keeps dozens of open
// tabs polling for fresh comp data from costing real bandwidth: unless a new
// sync actually landed, each poll is a ~200-byte round trip instead of a
// multi-MB download.
async function _downloadSnapshotBlob(path, onPct, opts) {
  // 45s (was 20s): on a slow connection the first bytes can take 25s+ to
  // arrive (Sep 30 — office network at ~70 KB/s), and a 20s watchdog
  // aborted every try → 'CAN'T REACH SERVER' with the data stuck at the
  // last good pull. Still aborts a truly dead socket.
  const STALL_MS = 45000, TRIES = 3;
  const o = opts || {};
  const url = CFG.SUPABASE_URL + '/storage/v1/object/reporting/' + String(path).split('/').map(encodeURIComponent).join('/');
  const { data: { session } = {} } = await supabase.auth.getSession();
  const token = session && session.access_token;
  if (!token) throw new Error('no session for storage download');
  let lastErr = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const ctrl = new AbortController();
    let watchdog = setTimeout(() => ctrl.abort(), STALL_MS);
    const feed = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ctrl.abort(), STALL_MS); };
    try {
      const headers = { Authorization: 'Bearer ' + token, apikey: CFG.SUPABASE_PUBLISHABLE_KEY };
      if (o.ifNoneMatch) headers['If-None-Match'] = o.ifNoneMatch;
      if (o.ifModifiedSince) headers['If-Modified-Since'] = o.ifModifiedSince;
      const res = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
      if (res.status === 304) {
        clearTimeout(watchdog);
        return o.meta ? { blob: null, notModified: true, etag: o.ifNoneMatch || null, lastModified: o.ifModifiedSince || null } : null;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let blob;
      if (!res.body) {
        blob = await res.blob();
      } else {
        const total = Number(res.headers.get('content-length')) || 0;
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          feed();
          chunks.push(value);
          got += value.byteLength;
          if (onPct) onPct(total ? Math.min(0.99, got / total) : null, got);
        }
        blob = new Blob(chunks);
      }
      clearTimeout(watchdog);
      return o.meta
        ? { blob, notModified: false, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') }
        : blob;
    } catch (e) {
      clearTimeout(watchdog);
      lastErr = e;
      console.warn('[ridd] snapshot download attempt ' + attempt + '/' + TRIES + ' failed:', (e && e.message) || e);
      if (attempt < TRIES) await new Promise(r => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr || new Error('snapshot download failed');
}

async function _loadReportingSubscriptionsRaw(uploadId) {
  if (DEMO || !state.profile) return [];
  // Admins + office staff (Work Queues run on this snapshot — office staff
  // are internal and work customer records all day; D2D field reps stay out).
  if (!isAdminRole(state.profile?.role) && !(typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(state.profile))) return [];
  if (!uploadId) return [];

  // Fast local cache first — instant on refresh when the snapshot is unchanged.
  const cached = await reportingIdbGet(uploadId);
  if (Array.isArray(cached) && cached.length) return cached;

  // FAST PATH — snapshot stored as one gzipped object in Storage: a single
  // download instead of ~78 paged queries (and nothing to silently drop).
  const metaU = (state.reportingUploads || []).find(u => u.id === uploadId);
  if (metaU && metaU.storage_path) {
    try {
      reportingUploadProgress(5, 'Downloading snapshot…');
      const blob = await _downloadSnapshotBlob(metaU.storage_path, (frac, bytes) => {
        reportingUploadProgress(
          frac == null ? 40 : 5 + Math.round(frac * 70),                     // 5 → 75
          'Downloading snapshot… ' + (bytes / 1048576).toFixed(1) + ' MB');
      });
      reportingUploadProgress(80, 'Unpacking…');
      const text = (metaU.storage_path.endsWith('.gz') && typeof DecompressionStream !== 'undefined')
        ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await blob.text();
      const rows = JSON.parse(text);
      reportingIdbPut(uploadId, rows); // cache locally for instant refreshes
      reportingUploadProgress(null);
      return rows;
    } catch (e) { console.warn('[ridd] storage load failed — falling back to paged load', e); }
    reportingUploadProgress(null);
  }
  // PostgREST caps each response at 1000 rows, so a 58k-row snapshot needs
  // ~58 pages. Fetching them one-at-a-time (sequential await) is the reason
  // the tab took forever. Instead we read the total count once, then fan the
  // page requests out in parallel (capped concurrency so we don't hammer the
  // connection), which cuts load time roughly to (pages / CONCURRENCY).
  // Page in parallel, but gently (4 at a time) and with RETRIES. Firing 8+
  // requests at once made Supabase reject/timeout most of them; each failed
  // page silently returned empty, so a 77k-row snapshot loaded only ~19k.
  // Retrying each page with backoff means no page is ever silently dropped.
  const CHUNK = 1000, CONCURRENCY = 8, MAX_TRIES = 6;
  const fetchPage = async (from) => {
    for (let t = 0; t < MAX_TRIES; t++) {
      const { data, error } = await supabase
        .from('reporting_subscriptions')
        .select('*')
        .eq('upload_id', uploadId)
        .order('id', { ascending: true })
        .range(from, from + CHUNK - 1);
      if (!error) return data || [];
      await new Promise(r => setTimeout(r, 250 * (t + 1))); // backoff, then retry
    }
    console.warn('[ridd] reporting page at offset', from, 'failed after retries');
    return [];
  };

  // Count probe tells us how many pages to fan out.
  const { count, error: countErr } = await supabase
    .from('reporting_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('upload_id', uploadId);

  // Fallback: if the count probe fails, page sequentially (progress measured
  // against the snapshot's known row_count from metadata when available).
  if (countErr || count == null) {
    const metaTotal = (((state.reportingUploads || []).find(u => u.id === uploadId)) || {}).row_count || null;
    const all = [];
    for (let from = 0; ; from += CHUNK) {
      const data = await fetchPage(from);
      all.push(...data);
      reportingUploadProgress(
        metaTotal ? Math.min(99, Math.round(100 * all.length / metaTotal)) : 50,
        'Loading snapshot… ' + all.length.toLocaleString() + (metaTotal ? ' / ' + metaTotal.toLocaleString() : '') + ' rows');
      if (data.length < CHUNK) break;
    }
    reportingIdbPut(uploadId, all);
    reportingUploadProgress(null);
    return all;
  }

  const pages = Math.ceil(count / CHUNK);
  const results = new Array(pages);
  let nextPage = 0, loadedRows = 0, aborted = false;
  reportingUploadProgress(0, 'Loading snapshot… 0 / ' + count.toLocaleString() + ' rows');
  const worker = async () => {
    for (;;) {
      // Bail if a newer snapshot became active mid-load (e.g. a fresh upload
      // landed) — no point finishing a slow paged load whose result will be
      // thrown away, and it keeps a stale progress bar on screen.
      if (state.reportingActiveUploadId !== uploadId) { aborted = true; return; }
      const p = nextPage++;
      if (p >= pages) return;
      results[p] = await fetchPage(p * CHUNK);
      loadedRows += results[p].length;
      reportingUploadProgress(
        Math.min(99, Math.round(100 * loadedRows / Math.max(1, count))),
        'Loading snapshot… ' + loadedRows.toLocaleString() + ' / ' + count.toLocaleString() + ' rows');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages) }, worker));
  if (aborted) {                       // superseded by a newer snapshot
    reportingUploadProgress(null);     // clear the leftover progress bar
    return null;                       // caller's guard ignores a null result
  }
  const loaded = results.flat();
  if (loaded.length < count) {
    healthReport('reporting', false, 'snapshot incomplete: ' + loaded.length + ' of ' + count + ' rows');
  } else {
    reportingIdbPut(uploadId, loaded); // only cache a COMPLETE load
    migrateSnapshotToStorage(uploadId, loaded); // make next load a 1-file download
  }
  reportingUploadProgress(null);
  return loaded;
}

// One-time upgrade: take a snapshot that was stored as DB rows (slow paged
// load) and write it as a single gzipped Storage object + stamp storage_path,
// so every future load — on any device — is one fast download. Silently
// no-ops if the storage bucket isn't set up (run reporting_storage.sql).
async function migrateSnapshotToStorage(uploadId, rows) {
  try {
    const u = (state.reportingUploads || []).find(x => x.id === uploadId);
    if (!u || u.storage_path) return;                 // already migrated
    if (!Array.isArray(rows) || !rows.length) return;  // never overwrite a snapshot with an empty load
    if (u.row_count && rows.length < u.row_count) return;   // or a partial one
    if (typeof CompressionStream === 'undefined') return;
    const blob = await new Response(new Blob([JSON.stringify(rows)]).stream()
      .pipeThrough(new CompressionStream('gzip'))).blob();
    const path = 'snapshots/' + uploadId + '.json.gz';
    const { error: stErr } = await supabase.storage.from('reporting').upload(path, blob, { contentType: 'application/gzip', upsert: true });
    if (stErr) return;                                // bucket missing — skip quietly
    const { error: upErr } = await supabase.from('reporting_uploads').update({ storage_path: path }).eq('id', uploadId);
    if (!upErr) { u.storage_path = path; console.info('[ridd] snapshot migrated to storage — future loads will be instant'); }
  } catch { /* best-effort */ }
}

function loadPersistedDemoState() {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.mySales))     state.mySales     = parsed.mySales;
    if (Array.isArray(parsed.allSales))    state.allSales    = parsed.allSales;
    if (Array.isArray(parsed.competitions))state.competitions= parsed.competitions;
    if (Array.isArray(parsed.compRules))   state.compRules   = parsed.compRules;
    if (Array.isArray(parsed.compProgress))state.compProgress= parsed.compProgress;
    if (Array.isArray(parsed.allProfiles) && parsed.allProfiles.length) {
      state.allProfiles = parsed.allProfiles;
      // Sync state.profile from allProfiles so avatar / name / rate edits stick
      if (state.profile?.id) {
        const me = parsed.allProfiles.find(p => p.id === state.profile.id);
        if (me) Object.assign(state.profile, me);
      }
    }
    if (parsed.companyGoal) state.companyGoal = parsed.companyGoal;
    if (parsed.appSettings) state.appSettings = parsed.appSettings;
    if (Array.isArray(parsed.auditLog)) state.auditLog = parsed.auditLog;
    if (parsed.notifLastSeen) state.notifLastSeen = parsed.notifLastSeen;
    // Indicator CSV state is loaded separately by loadIndicatorState() at boot
    // (always runs, even outside DEMO). Don't double-load it here or a stale
    // demo-mode snapshot could overwrite the production CSV upload.
    if (parsed.backendReportUploadedAt) state.backendReportUploadedAt = parsed.backendReportUploadedAt;
    if (parsed.backendReportFileName) state.backendReportFileName = parsed.backendReportFileName;
    // Calendar v2: the schedule is fully user-built. Only keep persisted
    // shifts if the save was made by the v2 code (calendarReset marker). Older
    // snapshots had preset 7–3/9–5/8–4 slots seeded for you — we drop them so
    // the new blank canvas applies.
    if (parsed.calendarReset === true) {
      if (Array.isArray(parsed.shifts)) {
        // Migration: any shift missing department defaults to 'inside_sales'
        state.shifts = parsed.shifts.map(s => s.department ? s : { ...s, department: 'inside_sales' });
      }
      if (Array.isArray(parsed.shiftSwapRequests)) state.shiftSwapRequests = parsed.shiftSwapRequests;
    }
    if (parsed.calendarDepartment) state.calendarDepartment = parsed.calendarDepartment;
    if (parsed.calendarMinReps && typeof parsed.calendarMinReps === 'object') state.calendarMinReps = parsed.calendarMinReps;
    if (parsed.importMappings && typeof parsed.importMappings === 'object') state.importMappings = parsed.importMappings;
    if (Array.isArray(parsed.importHistory)) state.importHistory = parsed.importHistory;
    // Sources are seeded by loadDemoData(); persisted edits (add/hide) win
    // over the defaults so admin changes survive a refresh.
    if (Array.isArray(parsed.sources) && parsed.sources.length) state.sources = parsed.sources;
    // Reporting tab — restore metadata + config. Subscription rows aren't
    // persisted (too big for localStorage), so we keep the active-upload
    // pointer but expect a re-upload before charts have data again.
    if (Array.isArray(parsed.reportingUploads))       state.reportingUploads       = parsed.reportingUploads;
    if (Array.isArray(parsed.reportingServiceConfig)) state.reportingServiceConfig = parsed.reportingServiceConfig;
    if (Array.isArray(parsed.reportingCancelConfig))  state.reportingCancelConfig  = parsed.reportingCancelConfig;
    if (Array.isArray(parsed.reportingSourceConfig))  state.reportingSourceConfig  = parsed.reportingSourceConfig;
    if (parsed.reportingActiveUploadId)               state.reportingActiveUploadId = parsed.reportingActiveUploadId;
  } catch (err) {
    console.warn('[ridd] failed to load demo state', err);
  }
}

function saveDemoData() {
  window._riddMutRev = (window._riddMutRev || 0) + 1;   // view cache: any saved change makes cached screens stale
  // Indicator CSV uploads should persist in production too (not just demo).
  // Keep them in their own localStorage key so this isn't gated by DEMO.
  saveIndicatorState();
  if (!DEMO) return;

  // localStorage is ~5MB per origin. Two fields grow unbounded with use:
  //   auditLog       — every audit/notification event ever, 1 per action
  //   importHistory  — every CSV import receipt
  // Cap both before serializing so a long-running demo session doesn't
  // bloat the snapshot to the point of overflow.
  const AUDIT_CAP  = 500;
  const IMPORT_CAP = 50;
  const cappedAudit  = Array.isArray(state.auditLog)      ? state.auditLog.slice(-AUDIT_CAP)        : [];
  const cappedImport = Array.isArray(state.importHistory) ? state.importHistory.slice(-IMPORT_CAP) : [];

  const buildPayload = (overrides = {}) => JSON.stringify({
    mySales:      state.mySales,
    allSales:     state.allSales,
    competitions: state.competitions,
    compRules:    state.compRules,
    compProgress: state.compProgress,
    allProfiles:  state.allProfiles,
    auditLog:      cappedAudit,
    notifLastSeen: state.notifLastSeen,
    backendReportUploadedAt: state.backendReportUploadedAt,
    backendReportFileName: state.backendReportFileName,
    companyGoal:   state.companyGoal,
    appSettings:   state.appSettings,
    shifts:           state.shifts,
    shiftSwapRequests: state.shiftSwapRequests,
    calendarReset:    true,
    calendarDepartment: state.calendarDepartment,
    calendarMinReps:  state.calendarMinReps || {},
    importMappings:   state.importMappings,
    importHistory:    cappedImport,
    sources:          state.sources,
    // Reporting tab — only metadata + config persist (rows are too big
    // for localStorage). On reload, the active snapshot's row count is
    // restored but the rows themselves need a re-upload to appear.
    reportingUploads:        state.reportingUploads,
    reportingServiceConfig:  state.reportingServiceConfig,
    reportingCancelConfig:   state.reportingCancelConfig,
    reportingSourceConfig:   state.reportingSourceConfig,
    reportingActiveUploadId: state.reportingActiveUploadId,
    savedAt: new Date().toISOString(),
    ...overrides,
  });

  const isQuotaErr = (err) =>
    err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(err.message || ''));

  // Tiered save — drop the least valuable data first when over quota so
  // the user's real work (sales, sources, goals) still persists even on a
  // jammed origin. Toasts only fire on the final outcome so we don't
  // spam the screen with retry noise.
  const tiers = [
    { overrides: {}, label: null },
    { overrides: { auditLog: [] },                              label: 'Demo storage full — cleared old notifications.' },
    { overrides: { auditLog: [], importHistory: [] },           label: 'Demo storage full — cleared notifications + import history.' },
    { overrides: { auditLog: [], importHistory: [], shifts: [], shiftSwapRequests: [] },
      label: 'Demo storage full — cleared notifications, import history, and shifts.' },
  ];

  for (let i = 0; i < tiers.length; i++) {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, buildPayload(tiers[i].overrides));
      if (tiers[i].label) toast(tiers[i].label, 'warn');
      return;
    } catch (err) {
      if (!isQuotaErr(err)) {
        console.error('[ridd] SAVE FAILED:', err.name, err.message, err);
        toast('Save failed: ' + (err.message || err.name || 'unknown error'), 'error');
        return;
      }
      // Quota — fall through to next tier.
    }
  }

  // Even the leanest tier didn't fit. Tell the user what's likely the
  // cause (sales arrays — the only big thing we never drop) so they can
  // act on it instead of seeing a generic "save failed".
  const salesBytes = JSON.stringify(state.allSales || []).length + JSON.stringify(state.mySales || []).length;
  toast('Demo storage full — sales arrays are ~' + Math.round(salesBytes / 1024) + 'KB. Clear demo data in Settings → Admin if needed.', 'error');
}

function clearDemoData() {
  if (!DEMO) return;
  localStorage.removeItem(DEMO_STORAGE_KEY);
  location.reload();
}

