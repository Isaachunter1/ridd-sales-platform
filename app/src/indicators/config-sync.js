// ── Supabase-backed indicator config (teams, tiers, rep overrides) ──────
// localStorage worked but was per-browser, per-device — admins re-doing the
// setup every refresh / new machine / cleared cache. This pair pushes the
// same fields up to public.indicator_config (single row, RLS: admin write)
// so any admin on any device sees the same teams.
// Demo mode keeps the localStorage path only — no Supabase round-trip,
// no auth state to lean on.
async function loadIndicatorConfigFromSupabase() {
  if (DEMO || !state.profile) return;
  try {
    const { data, error } = await supabase
      .from('indicator_config').select('*').eq('id', 1).maybeSingle();
    if (error) { console.warn('[ridd] indicator_config select failed', error); return; }
    // Server is the source of truth in production. Empty arrays / objects
    // from the server intentionally overwrite local values so a "reset"
    // from another admin shows up here too.
    const hasServerData = data && (
      (data.competitions && data.competitions.extras && Object.keys(data.competitions.extras).length > 0) ||
      (Array.isArray(data.teams) && data.teams.length > 0) ||
      Object.keys(data.rep_teams || {}).length > 0 ||
      Object.keys(data.rep_tiers || {}).length > 0
    );
    // UNSYNCED-EDITS GUARD — if this browser has config edits that never made
    // it to the server (content differs from the last synced fingerprint),
    // applying the server copy would wipe them. Keep local, push it up.
    // A clean browser always adopts the server copy.
    //
    // STALE-DEVICE ESCAPE HATCH: only keep-local-and-push when our edits were
    // made against the CURRENT server copy. If the server has moved past this
    // browser's baseline, "local edits" are edits to an outdated config —
    // pushing them would clobber newer work from other admins (this exact
    // failure mode showed up as an admin stuck seeing only one competition).
    // Server wins the conflict; the toast tells the admin what happened.
    if (hasServerData && _indCfgDirty() && isAdminRole(state.profile?.role)) {
      const _rec = _indCfgSyncRec();
      const _serverAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
      const _baseAt = _rec && _rec.serverAt ? new Date(_rec.serverAt).getTime() : 0;
      if (!_serverAt || _serverAt <= _baseAt + 1000) {
        console.warn('[ridd] unsynced local indicator config — pushing local up instead of applying server');
        saveIndicatorConfigToSupabase().catch(err => console.warn('[ridd] config push-up failed', err));
        return;
      }
      console.warn('[ridd] server config is NEWER than this browser\'s baseline — adopting server copy (stale local edits discarded)');
      // fall through: apply the server copy below
    }
    if (hasServerData) {
      state._indicatorTeams         = Array.isArray(data.teams) ? data.teams : (state._indicatorTeams || []);
      state._indicatorTeamColors    = data.team_colors   && typeof data.team_colors   === 'object' ? data.team_colors   : (state._indicatorTeamColors || {});
      state._indicatorTeamLogos     = data.team_logos    && typeof data.team_logos    === 'object' ? data.team_logos    : (state._indicatorTeamLogos || {});
      state._indicatorExcludedTeams = Array.isArray(data.team_excluded) ? data.team_excluded : (state._indicatorExcludedTeams || []);
      if (data.competitions && typeof data.competitions === 'object') {
        if (Array.isArray(data.competitions.list)) state._indicatorCompetitions = data.competitions.list;
        if (data.competitions.active)              state._indicatorActiveCompId = data.competitions.active;
        if (Array.isArray(data.competitions.removed)) state._indicatorRemovedDefaults = data.competitions.removed;
        // Power-Ranking exclusions ride in this jsonb too — they used to be
        // per-browser only, so a Salt Lake excluded on desktop still ranked
        // on the admin's phone.
        if (data.competitions.rankExclude && typeof data.competitions.rankExclude === 'object') state._indicatorRankExclude = data.competitions.rankExclude;
        // Rep aliases (duplicate merges) + dismissed dupe pairs sync too —
        // a merge is data correctness, not a view preference: per-browser
        // aliases meant leaderboard totals differed between admin devices.
        if (data.competitions.repAlias && typeof data.competitions.repAlias === 'object') state._indicatorRepAlias = data.competitions.repAlias;
        // Team rep types (per Isaac, Oct 16) — which Manage Teams tab a team lives under.
        if (data.competitions.teamTypes && typeof data.competitions.teamTypes === 'object') state._indicatorTeamTypes = data.competitions.teamTypes;
        // Virtual-comp config rides the same row (per Isaac's rep-UX audit):
        // ISL divisions/history, Kobe window + freeze, KOTH freeze, ★
        // default and pill order now reach EVERY user, not just the admin
        // device that wrote them.
        if (data.competitions.extras && typeof data.competitions.extras === 'object') state._compExtras = data.competitions.extras;
        // Hydrate the synced admin rules back into their state fields so
        // every consumer (leaderboard toggles, deleted-ID exclusions) sees
        // the SHARED values, not this device's leftovers.
        try {
          const _ar = state._compExtras && state._compExtras.adminRules;
          if (_ar) {
            if (Array.isArray(_ar.deletedCustIds)) state.indicatorDeletedCustIds = _ar.deletedCustIds;
            if (typeof _ar.repIncludeRor === 'boolean') state._indicatorRepIncludeRor = _ar.repIncludeRor;
            if (typeof _ar.repIncludeOneTime === 'boolean') state._indicatorRepIncludeOneTime = _ar.repIncludeOneTime;
            if (typeof _ar.repIncludeRenewals === 'boolean') state._indicatorRepIncludeRenewals = _ar.repIncludeRenewals;
            if ('indMyExclTerms' in _ar) state.indicatorMyExclServiceTerms = _ar.indMyExclTerms;
            if ('indExclServices' in _ar) state.indicatorExclServices = _ar.indExclServices;
            if ('indExclTeams' in _ar) state.indicatorExclTeams = _ar.indExclTeams;
          }
        } catch (e) { /* fallback: local values */ }
        if (Array.isArray(data.competitions.pillOrder)) state._compPillOrder = data.competitions.pillOrder;
        if (typeof data.competitions.favMystery === 'boolean') state._compFavoriteMystery = data.competitions.favMystery;
        if (Array.isArray(data.competitions.dupesDismissed)) state._indicatorDismissedDupes = data.competitions.dupesDismissed;
        if (data.competitions.tierYears && typeof data.competitions.tierYears === 'object') state._indicatorRepTierYear = data.competitions.tierYears;
      }
      // rep_teams may arrive as the new by-year shape ({ "2026": {rep:team} })
      // or the legacy flat shape ({ rep:team }). Detect and normalize into the
      // by-year structure; _hydrateTeamYears folds legacy data into this year.
      {
        const rt = (data.rep_teams && typeof data.rep_teams === 'object' && !Array.isArray(data.rep_teams)) ? data.rep_teams : {};
        const keys = Object.keys(rt);
        const looksByYear = keys.length === 0 || keys.every(k => /^\d{4}$/.test(k) && rt[k] && typeof rt[k] === 'object');
        state._indicatorRepTeamByYear = looksByYear ? rt : { [String(new Date().getFullYear())]: rt };
      }
      state._indicatorRepTier       = data.rep_tiers     && typeof data.rep_tiers     === 'object' ? data.rep_tiers     : (state._indicatorRepTier || {});
      state._indicatorRepActive     = data.rep_active    && typeof data.rep_active    === 'object' ? data.rep_active    : (state._indicatorRepActive || {});
      state._indicatorRepOffice     = data.rep_offices   && typeof data.rep_offices   === 'object' ? data.rep_offices   : (state._indicatorRepOffice || {});
      _normalizeRepKeyedMaps();
      if (typeof _hydrateTeamYears === 'function') _hydrateTeamYears();
      // The server copy is now our baseline — record it so this browser
      // counts as CLEAN until the user actually changes something here.
      _indCfgRecordSynced(data.updated_at);
      // One-time team tidy (per Isaac, Oct 16): a real RIDD team on every rep type (no team = RIDD), and the old
      // "Excluded" team becomes "Termite Pros" (a normal, counted team). Admin-only, idempotent; saved once through the normal CAS path.
      try {
        if (isAdminRole(state.profile?.role) && !state._teamTidyOct16 && typeof addTeam === 'function') {
          state._teamTidyOct16 = true;
          let changed = false;
          const reg = state._indicatorTeams || [];
          if (!reg.some(t => /^ridd$/i.test(String(t || '').trim()))) { addTeam('RIDD'); changed = true; }
          if (typeof distinctTeams === 'function' && distinctTeams().includes('Excluded') && !reg.includes('Termite Pros') && typeof renameTeam === 'function') { const r = renameTeam('Excluded', 'Termite Pros'); if (r && r.ok) changed = true; }
          // Termite Pros is a normal team, not an excluded one (per Isaac, Oct 16): no EXCLUDED badge,
          // its reps count again; he takes it off the Power Ranking with the 🏆 picker instead.
          // Once only (marker rides the synced extras), so a later deliberate exclusion sticks.
          state._compExtras = state._compExtras || {};
          const _mig = (state._compExtras.migrations = state._compExtras.migrations || {});
          if (!_mig.termiteProsIncluded) {
            const _drop = (l) => (Array.isArray(l) ? l.filter(t => t !== 'Termite Pros' && t !== 'Excluded') : []);
            (state._indicatorCompetitions || []).forEach(c => { if (c) c.excludedTeams = _drop(c.excludedTeams); });
            state._indicatorExcludedTeams = _drop(state._indicatorExcludedTeams);
            _mig.termiteProsIncluded = true; changed = true;
          }
          if (changed) setTimeout(() => { saveIndicatorState(); if (typeof mountApp === 'function') mountApp(); }, 0);   // local cache + caches + shared sync
        }
      } catch (e) { console.warn('[ridd] team tidy skipped', e); }
      // Another admin's change (teams, aliases, rules) must reach cached boards
      // without a reload: bump the cache revision and repaint.
      if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
      if (typeof _applyLiveDataRules === 'function') _applyLiveDataRules();
      if (typeof scheduleBackgroundRemount === 'function') scheduleBackgroundRemount();
      return;
    }
    // Server row is empty (fresh install). If THIS browser has team data
    // in localStorage, mirror it up — one-time migration so the user
    // doesn't lose what they already configured locally.
    const localHasData =
      (state._indicatorTeams || []).length > 0 ||
      Object.keys(state._indicatorRepTeam || {}).length > 0 ||
      Object.keys(state._indicatorRepTier || {}).length > 0;
    if (localHasData && isAdminRole(state.profile?.role)) {
      console.info('[ridd] migrating indicator config from localStorage → Supabase');
      await _indicatorConfigUpsertNow();   // direct — bypasses the clean-skip (fresh server row)
    }
  } catch (err) {
    console.warn('[ridd] indicator config load threw', err);
  }
}

// ── Config-sync dirty tracking ──────────────────────────────────────────
// THE ROSTER-WIPE BUG: every save used to push this browser's ENTIRE config
// blob to the server — including routine background saves (the auto-derived
// snapshot every 30 minutes). Any open tab holding OLDER rosters/teams would
// rhythmically clobber the server copy, and the admin who actually did the
// work got their edits wiped on the next reload. Now a browser only PUSHES
// when its config CONTENT actually changed since the last sync it saw, and
// only APPLIES the server copy when it has no unsynced edits of its own.
const IND_CFG_SYNC_KEY = 'ridd-ind-cfg-sync-v1';
function _indCfgFingerprint() {
  // NOTE: _indicatorActiveCompId is deliberately NOT part of the fingerprint.
  // The Competitions tab moves that pointer whenever someone just LOOKS at a
  // different comp — including it made every browsing admin count as having
  // "unsynced edits", which pinned their device to a stale local config (and
  // pushed it up). Viewing is not editing.
  const s = JSON.stringify([
    state._indicatorTeams || [], state._indicatorTeamColors || {}, state._indicatorTeamLogos || {},
    state._indicatorExcludedTeams || [],
    { list: state._indicatorCompetitions || [], removed: state._indicatorRemovedDefaults || [], rankExclude: state._indicatorRankExclude || {}, repAlias: state._indicatorRepAlias || {}, teamTypes: state._indicatorTeamTypes || {}, dupesDismissed: state._indicatorDismissedDupes || [], tierYears: state._indicatorRepTierYear || {}, extras: state._compExtras || {}, pillOrder: state._compPillOrder || [], favMystery: !!state._compFavoriteMystery },
    state._indicatorRepTeamByYear || {}, state._indicatorRepTier || {}, state._indicatorRepActive || {}, state._indicatorRepOffice || {},
  ]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h + ':' + s.length;
}
// THE STALE-TAB RESURRECTION BUG (per Isaac, Oct 16 — a removed team kept
// coming back): the sync baseline lived ONLY in localStorage, which every
// tab shares. Tab A removes a team and records "synced at T"; an older tab B
// (still holding the team) then reads that same baseline, looks "dirty"
// against it, claims based_on = T — so CAS accepts it — and pushes the
// removed team back up. The baseline is now kept PER TAB in memory;
// localStorage only seeds a fresh tab's first boot. A tab that hasn't seen
// the latest server copy now correctly reads as stale and adopts it.
let _indCfgTabRec = null;
function _indCfgSyncRec() {
  if (_indCfgTabRec) return _indCfgTabRec;
  try { return JSON.parse(localStorage.getItem(IND_CFG_SYNC_KEY) || 'null'); } catch { return null; }
}
function _indCfgRecordSynced(serverAt) {
  _indCfgTabRec = { hash: _indCfgFingerprint(), serverAt: serverAt || new Date().toISOString() };
  try { localStorage.setItem(IND_CFG_SYNC_KEY, JSON.stringify(_indCfgTabRec)); } catch {}
}
function _indCfgDirty() {
  const r = _indCfgSyncRec();
  // No baseline yet (first boot after this fix deployed): treat as CLEAN so
  // this browser ADOPTS the server copy instead of pushing whatever stale
  // config it happens to hold. A baseline is recorded on that first apply,
  // and real edits diverge from it from then on.
  if (!r) return false;
  return r.hash !== _indCfgFingerprint();
}

// Push the in-memory state up to Supabase. Always also writes localStorage
// (via the caller — saveIndicatorState — so localStorage stays a fast
// local cache). Fire-and-forget pattern means UI never blocks waiting on
// the network; failures surface as a toast and a console warning.
async function _indicatorConfigUpsertNow() {
  const payload = {
    id: 1,
    teams:         state._indicatorTeams || [],
    team_colors:   state._indicatorTeamColors || {},
    team_logos:    state._indicatorTeamLogos || {},
    team_excluded: state._indicatorExcludedTeams || [],
    competitions:  { active: state._indicatorActiveCompId || null, list: state._indicatorCompetitions || [], removed: state._indicatorRemovedDefaults || [], rankExclude: state._indicatorRankExclude || {}, repAlias: state._indicatorRepAlias || {}, teamTypes: state._indicatorTeamTypes || {}, dupesDismissed: state._indicatorDismissedDupes || [], tierYears: state._indicatorRepTierYear || {}, extras: state._compExtras || {}, pillOrder: state._compPillOrder || [], favMystery: !!state._compFavoriteMystery },
    rep_teams:     state._indicatorRepTeamByYear || {},
    rep_tiers:     state._indicatorRepTier || {},
    rep_active:    state._indicatorRepActive || {},
    rep_offices:   state._indicatorRepOffice || {},
    updated_at:    new Date().toISOString(),
    updated_by:    state.profile?.id || null,
  };
  try {
    // COMPARE-AND-SWAP first (indicator_config_cas.sql): the server rejects
    // any write based on an outdated copy, which deterministically ends the
    // "stale device rolls back everyone's config" class of incident. Falls
    // back to the old direct upsert until the SQL has been run.
    const _basedOn = (_indCfgSyncRec() || {}).serverAt || null;
    const { data: casRes, error: casErr } = await supabase
      .rpc('save_indicator_config', { payload, based_on: _basedOn });
    if (!casErr && casRes && casRes.ok) {
      state._tierPending = {};
      state._cfgReplay = [];
      _indCfgRecordSynced(casRes.server_updated_at || payload.updated_at);
      _mirrorNrlaRostersToRows();              // stage-1 dual-write (additive, never blocks)
      return true;
    }
    if (!casErr && casRes && casRes.conflict) {
      // Our edits were based on an outdated config. Server wins: adopt the
      // current copy (the loader's escape hatch applies it since the server
      // is past our baseline).
      console.warn('[ridd] config write rejected by CAS — server moved past this browser; adopting server copy');
      const _preHash = _indCfgFingerprint();
      try { await loadIndicatorConfigFromSupabase(); if (typeof mountApp === 'function') mountApp(); } catch { /* next poll heals */ }
      // Tier tags this admin just set must not be lost to that race (per Isaac,
      // Oct 2 — N/A tags reverted): put them back on top of the server copy
      // and save once more. One retry only, so two devices can't ping-pong.
      const _tp = state._tierPending;
      const _rp = Array.isArray(state._cfgReplay) ? state._cfgReplay.splice(0) : [];
      if (((_tp && Object.keys(_tp).length) || _rp.length) && !state._tierReapplying) {
        state._tierReapplying = true;
        try {
          // Explicit team renames (per Isaac, Oct 16 — "Excluded" → "Termite Pros" kept reverting).
          for (const op of _rp) {
            if (op[0] === 'renameTeam' && typeof renameTeam === 'function' && typeof distinctTeams === 'function' && distinctTeams().includes(op[1])) renameTeam(op[1], op[2]);
          }
          if (Array.isArray(state._cfgReplay)) state._cfgReplay.length = 0;   // the replays above re-queued themselves; this one save carries them
          // (renameTeam already refreshed the local cache via saveDemoData.)
          state._indicatorRepTier = state._indicatorRepTier || {}; state._indicatorRepTierYear = state._indicatorRepTierYear || {};
          for (const k of Object.keys(_tp || {})) {
            if (_tp[k]) { state._indicatorRepTier[k] = _tp[k]; state._indicatorRepTierYear[k] = new Date().getFullYear(); }
            else { delete state._indicatorRepTier[k]; delete state._indicatorRepTierYear[k]; }
          }
          if (typeof _invalidateRepSigIndex === 'function') { _invalidateRepSigIndex(state._indicatorRepTier); _invalidateRepSigIndex(state._indicatorRepTierYear); }
          await _indicatorConfigUpsertNow();
          if (typeof mountApp === 'function') mountApp();
        } finally { state._tierReapplying = false; }
        return true;
      }
      // Only bother the admin when adopting the server copy actually CHANGED
      // something locally — background housekeeping saves (auto-reactivation,
      // boot syncs) hit this race with nothing at stake, and the old red
      // "re-apply your change" toast was pure confusion in that case.
      try {
        if (_indCfgFingerprint() !== _preHash) {
          toast('Another device updated settings first — pulled the latest. If you just changed something, re-apply it.', 'warn');
        }
      } catch { /* boot */ }
      return true; // handled — do NOT retry the stale payload
    }
    if (casErr && !/function|schema cache|does not exist|404/i.test(casErr.message || '')) {
      console.warn('[ridd] save_indicator_config RPC failed', casErr);
      if (typeof toast === 'function') toast('Saved locally — server sync failed (' + (casErr.message || 'unknown') + '), retrying…', 'error');
      return false;
    }
    // RPC not installed yet — legacy direct upsert.
    const { error } = await supabase.from('indicator_config').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[ridd] indicator_config upsert failed', error);
      if (typeof toast === 'function') toast('Saved locally — server sync failed (' + (error.message || 'unknown') + '), retrying…', 'error');
      return false;
    }
    _indCfgRecordSynced(payload.updated_at);   // this content is now the shared truth
    _mirrorNrlaRostersToRows();                // stage-1 dual-write (additive, never blocks)
    return true;
  } catch (err) {
    console.warn('[ridd] indicator_config save threw', err);
    return false;
  }
}
// Single-flight + trailing sync. Rapid edits (roster checkboxes, drag-and-
// drop) used to fire DOZENS of concurrent upserts whose arrival order
// Postgres doesn't guarantee — an early payload could land LAST and roll the
// server copy back, and the next refresh would then clobber the local work
// with that stale row. Now: one request in flight at a time, the payload is
// always rebuilt from CURRENT state at send time, edits made mid-flight
// trigger one trailing send, and failures retry (capped).
let _indCfgUpsertBusy = false, _indCfgUpsertAgain = false, _indCfgUpsertFails = 0;
async function saveIndicatorConfigToSupabase() {
  if (DEMO || !state.profile || !isAdminRole(state.profile?.role)) return;
  // Nothing actually changed since the last sync this browser saw? Then
  // DON'T touch the server — this is what stops background saves in stale
  // tabs from clobbering another admin's fresh roster work.
  if (!_indCfgDirty()) return;
  if (_indCfgUpsertBusy) { _indCfgUpsertAgain = true; return; }
  _indCfgUpsertBusy = true;
  try {
    let ok = await _indicatorConfigUpsertNow();
    while (_indCfgUpsertAgain) { _indCfgUpsertAgain = false; ok = await _indicatorConfigUpsertNow(); }
    if (ok) _indCfgUpsertFails = 0;
    else if (++_indCfgUpsertFails <= 5) setTimeout(() => saveIndicatorConfigToSupabase().catch(() => {}), 3000);
  } finally {
    _indCfgUpsertBusy = false;
  }
}

// ── #1 STAGE 1 — normalized roster rows (dual-write) ────────────────────
// The long-term home for rosters is a real table (indicator_rosters — see
// indicator_rosters.sql) instead of one JSON blob: per-row writes, per-row
// timestamps, realtime. Stage 1 = DUAL-WRITE only: every successful config
// sync also mirrors the NRLA rosters into rows, while the blob remains the
// source of truth. Stage 2 (after the season) cuts reads over to the rows;
// stage 3 drops rosters from the blob. A mirror failure never affects the
// blob save — this path is strictly additive.
let _rosterMirrorBusy = false, _rosterMirrorAgain = false;
async function _mirrorNrlaRostersToRows() {
  if (DEMO || !state.profile || !isAdminRole(state.profile?.role)) return;
  if (_rosterMirrorBusy) { _rosterMirrorAgain = true; return; }
  _rosterMirrorBusy = true;
  try {
    do {
      _rosterMirrorAgain = false;
      const comps = (state._indicatorCompetitions || []).filter(c => c && typeof isNrlaComp === 'function' && isNrlaComp(c));
      for (const comp of comps) {
        const cfg = (comp.nrla && typeof comp.nrla === 'object') ? comp.nrla : {};
        const rosters = (cfg.rosters && typeof cfg.rosters === 'object') ? cfg.rosters : {};
        const repIds = (cfg.repIds && typeof cfg.repIds === 'object') ? cfg.repIds : {};
        const rows = [];
        Object.entries(rosters).forEach(([team, list]) => (Array.isArray(list) ? list : []).forEach(rep => rows.push({
          comp_id: comp.id,
          team: String(team).toUpperCase(),
          rep_name: String(rep),
          rep_id: repIds[rep] || null,
          updated_by: state.profile?.id || null,
        })));
        window._rosterMirrorAt = Date.now();
        const del = await supabase.from('indicator_rosters').delete().eq('comp_id', comp.id);
        if (del.error) throw del.error;
        if (rows.length) {
          const ins = await supabase.from('indicator_rosters').insert(rows);
          if (ins.error) throw ins.error;
        }
      }
    } while (_rosterMirrorAgain);
  } catch (err) {
    healthReport('rosters', false, err);
  } finally {
    _rosterMirrorBusy = false;
  }
}
// Realtime foundation — hear other admins' roster changes the moment they
// land (stage 2 will auto-apply them; stage 1 just tells you).
function subscribeRosterRealtime() {
  if ((typeof DEMO !== 'undefined' && DEMO) || window._rosterRtSub || !state.profile) return;
  try {
    window._rosterRtSub = supabase.channel('indicator_rosters_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'indicator_rosters' }, () => {
        if (Date.now() - (window._rosterMirrorAt || 0) < 10000) return;      // our own mirror
        if (window._rosterRtToastAt && Date.now() - window._rosterRtToastAt < 30000) return;
        window._rosterRtToastAt = Date.now();
        // (Toast retired per Isaac, Sep 2026 — the whole app re-syncs on its
        // own now, so a roster-only "refresh to pull the latest" nag was
        // misleading. The subscription stays for the stage-2 auto-apply.)
      })
      .subscribe();
  } catch (e) { console.warn('[ridd] roster realtime subscribe failed', e); }
}

// ── My-sales realtime — the transparency loop for reps ───────────────────
// When an admin audits / stages one of MY sales, my open tab hears it and
// toasts immediately: no more "did my sale pass?" texts. RLS scopes the feed
// to rows the rep can read; requires sales in the realtime publication
// (sales_realtime.sql).
function subscribeMySalesRealtime() {
  if ((typeof DEMO !== 'undefined' && DEMO) || window._mySalesRtSub || !state.profile) return;
  if (isAdminRole(state.profile?.role) || isAuditorRole(state.profile?.role)) return;   // reps only
  try {
    const seen = (window._mySalesRtSeen = window._mySalesRtSeen || new Set());
    window._mySalesRtSub = supabase.channel('my_sales_rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales', filter: 'rep_id=eq.' + state.profile.id }, (payload) => {
        const row = payload.new || {};
        const key = row.id + ':' + row.audit_status + ':' + (row.staged_for_payroll ? 1 : 0);
        if (seen.has(key)) return;
        seen.add(key);
        // No pop-ups (per Isaac, Oct 15 — the syncs move statuses all day, so reps were buried in
        // "audit: below minimums" toasts). The rep's lists just refresh quietly.
        if (!row.staged_for_payroll && !(row.audit_status && row.audit_status !== 'pending')) return;
        // Refresh the rep's own lists so the row they're looking at updates.
        refreshSalesData().then(() => { if (INSIDE_SALES_TAB_KEYS.has(state.view)) mountApp(); }).catch(() => {});
      })
      .subscribe();
  } catch (e) { console.warn('[ridd] my-sales realtime subscribe failed', e); }
}

// ── Config history & restore ────────────────────────────────────────────
// Every write to indicator_config is snapshotted server-side by a DB trigger
// (indicator_config_history.sql — last 50 kept). This modal lists snapshots
// and restores any of them: applied locally, then pushed as the new shared
// copy (the restore makes this browser dirty, so the normal sync sends it up).
function _applyIndicatorConfigSnapshot(data) {
  if (!data || typeof data !== 'object') return;
  state._indicatorTeams         = Array.isArray(data.teams) ? data.teams : [];
  state._indicatorTeamColors    = data.team_colors  && typeof data.team_colors  === 'object' ? data.team_colors  : {};
  state._indicatorTeamLogos     = data.team_logos   && typeof data.team_logos   === 'object' ? data.team_logos   : {};
  state._indicatorExcludedTeams = Array.isArray(data.team_excluded) ? data.team_excluded : [];
  if (data.competitions && typeof data.competitions === 'object') {
    if (Array.isArray(data.competitions.list)) state._indicatorCompetitions = data.competitions.list;
    if (data.competitions.active)              state._indicatorActiveCompId = data.competitions.active;
    if (Array.isArray(data.competitions.removed)) state._indicatorRemovedDefaults = data.competitions.removed;
  }
  const rt = (data.rep_teams && typeof data.rep_teams === 'object' && !Array.isArray(data.rep_teams)) ? data.rep_teams : {};
  const keys = Object.keys(rt);
  const looksByYear = keys.length === 0 || keys.every(k => /^\d{4}$/.test(k) && rt[k] && typeof rt[k] === 'object');
  state._indicatorRepTeamByYear = looksByYear ? rt : { [String(new Date().getFullYear())]: rt };
  state._indicatorRepTier   = data.rep_tiers   && typeof data.rep_tiers   === 'object' ? data.rep_tiers   : {};
  state._indicatorRepActive = data.rep_active  && typeof data.rep_active  === 'object' ? data.rep_active  : {};
  state._indicatorRepOffice = data.rep_offices && typeof data.rep_offices === 'object' ? data.rep_offices : {};
  if (typeof _normalizeRepKeyedMaps === 'function') _normalizeRepKeyedMaps();
  if (typeof _hydrateTeamYears === 'function') _hydrateTeamYears();
}
async function openIndicatorConfigHistoryModal() {
  if (!state.profile || !isAdminRole(state.profile?.role)) { toast('Admins only', 'error'); return; }
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, '🕘 Config history'),
        el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
          'Teams · rosters · competitions — every change, last 50 snapshots. Restore rolls the shared config back for every admin.')),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
    el('div', { class: 'p-6 text-center text-sm', style: { color: 'var(--text-muted)' } }, 'Loading…'));
  overlay.append(card);
  document.body.append(overlay);
  let rows = [];
  try {
    const { data, error } = await supabase.from('indicator_config_history')
      .select('id, saved_at, updated_by, config').order('id', { ascending: false }).limit(50);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    card.lastChild.textContent = 'History unavailable — run indicator_config_history.sql in the Supabase SQL editor first. (' + ((err && err.message) || err) + ')';
    return;
  }
  if (!rows.length) { card.lastChild.textContent = 'No snapshots yet — they appear as config changes are saved.'; return; }
  const summarize = (cfg) => {
    try {
      const comps = (cfg.competitions && cfg.competitions.list) || [];
      const nrla = comps.find(c => c && (c.scoring === 'nrla' || /\bnrla\b/i.test(c.name || '')));
      const rosters = (nrla && nrla.nrla && nrla.nrla.rosters) || {};
      const nRost = Object.values(rosters).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
      return (cfg.teams || []).length + ' teams · ' + comps.length + ' comps · ' + nRost + ' rostered reps';
    } catch (e) { return ''; }
  };
  const who = (id) => { const p = (state.allProfiles || []).find(x => x.id === id); return p ? (p.full_name || p.email || '') : ''; };
  const body = el('div', { class: 'overflow-y-auto flex-1' });
  rows.forEach((r, i) => {
    const t = r.saved_at ? new Date(r.saved_at) : null;
    const when = t ? t.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '—';
    body.append(el('div', { class: 'flex items-center justify-between gap-3 px-5 py-2.5 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'min-w-0' },
        el('div', { class: 'text-sm font-bold' }, when,
          i === 0 ? el('span', { class: 'ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded', style: { background: 'rgba(255,107,61,.15)', color: '#DF643A' } }, 'current') : null),
        el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, summarize(r.config) + (who(r.updated_by) ? ' · by ' + who(r.updated_by) : ''))),
      i === 0 ? null : el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0',
        style: { background: '#F2148C', color: '#fff' },
        onclick: () => {
          if (!confirm('Restore the config from ' + when + '? This becomes the shared copy for every admin.')) return;
          _applyIndicatorConfigSnapshot(r.config);
          logActivity('comp_change', { detail: 'Config restored from history snapshot ' + when });
          saveDemoData();                        // local save; dirty → pushes to the server
          toast('Config restored from ' + when + ' — syncing to the server…', 'success');
          close();
          mountApp();
        },
      }, 'Restore')));
  });
  card.replaceChild(body, card.lastChild);
}

