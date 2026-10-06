// ┌─ src/84-reporting-config-panels.js ─────────────────────────────────────────────────────
// │ Service Types / Sources / Cancel reasons config panels, info modals, drill-down modal.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// Small reusable info popup + the ⓘ button that opens it (used by the
// Configurations panels so the explanations live behind an icon).
function openInfoModal(title, body) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-md my-8 overflow-hidden flex flex-col' },
    el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
      el('h2', { class: 'text-base font-bold' }, title),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×'),
    ),
    el('div', { class: 'px-4 pb-4 text-[13px] leading-relaxed', style: { color: 'var(--text-muted)' } }, body),
  );
  overlay.append(card);
  document.body.append(overlay);
}
function configInfoBtn(title, body) {
  return el('button', {
    class: 'shrink-0 rounded-full flex items-center justify-center cursor-pointer transition hover:brightness-110',
    style: { width: '20px', height: '20px', background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)', fontSize: '11px', fontWeight: '900' },
    title: 'Details',
    onclick: () => openInfoModal(title, body),
  }, 'ⓘ');
}

function reportingServiceConfigPanel() {
  // Union of every service name that appears in the config table OR
  // the currently-loaded snapshot, so a freshly-discovered service
  // (still being seeded server-side) shows up immediately.
  const cfg = state.reportingServiceConfig || [];
  const subs = state.reportingSubscriptions || [];
  const cfgByName = new Map(cfg.map(c => [c.service_name, c]));
  const fromData = new Set(subs.map(r => r.subscription).filter(Boolean));
  const allNames = new Set([...cfgByName.keys(), ...fromData]);
  const list = [...allNames].sort((a, b) => a.localeCompare(b)).map(name =>
    cfgByName.get(name) || { service_name: name, category: '', is_recurring: false, is_hidden: false }
  );
  // Effective lifecycle/recurring state per service so the select can show
  // what "Auto" currently resolves to.
  const recurringMap = reportingServiceRecurringMap();
  const lifecycleMap = reportingServiceLifecycleMap();
  const arvAny = new Map();
  const svcCounts = new Map(); // service name → # of subs in the snapshot
  for (const r of subs) {
    const n = r.subscription; if (!n) continue;
    if (!arvAny.has(n)) arvAny.set(n, false);
    if ((Number(r.annual_recurring_value) || 0) > 0) arvAny.set(n, true);
    svcCounts.set(n, (svcCounts.get(n) || 0) + 1);
  }

  const updateConfig = async (name, patch) => {
    logActivity('config_change', { detail: 'Service config: ' + name + ' → ' + JSON.stringify(patch) });
    const existing = cfgByName.get(name) || { service_name: name, category: null, is_recurring: false, is_hidden: false, recurring_override: null };
    const next = { ...existing, ...patch, updated_by: state.profile?.id || null };
    // Optimistic local update so toggles feel instant.
    const idx = cfg.findIndex(c => c.service_name === name);
    if (idx >= 0) cfg[idx] = next; else cfg.push(next);
    if (typeof _svcLifecycleMemo !== 'undefined') _svcLifecycleMemo.rev++;   // in-place edit → rebuild the lifecycle map
    if (DEMO) { saveDemoData(); return; }
    // Don't send recurring_override unless it's actually been set — keeps
    // hidden/category saves working even before reporting_recurring_override.sql
    // adds the column. (A null send would 400 on a missing column.)
    const payload = { ...next };
    if (payload.recurring_override == null && !('recurring_override' in patch)) {
      delete payload.recurring_override;
    }
    if (payload.lifecycle == null && !('lifecycle' in patch)) {
      delete payload.lifecycle;
    }
    const { error } = await supabase
      .from('reporting_service_config')
      .upsert(payload, { onConflict: 'service_name' });
    if (error) {
      toast('Save failed: ' + error.message, 'error');
      // Revert local on failure so the UI doesn't lie.
      if (idx >= 0) cfg[idx] = existing;
      else cfg.splice(cfg.length - 1, 1);
      if (typeof _svcLifecycleMemo !== 'undefined') _svcLifecycleMemo.rev++;
      mountApp();
    }
  };

  return el('div', { class: 'card p-3', id: 'cfg-services' },
    el('div', { class: 'flex items-center gap-2 mb-3' },
      el('h2', { class: 'text-base font-bold' }, 'Service Types'),
      configInfoBtn('Service Type Configuration',
        'Set each service\'s Lifecycle: Recurring (ongoing — active is fine), One-time (flags active subs that have already been serviced), ' +
        'or Retired (flags any active sub — discontinued service). Auto infers from revenue (recurring if it carries Annual Recurring Value). ' +
        'Lifecycle drives churn, ARR, retention, the Active-Customers split, and the "should be closed" flags on the Subscriptions card. Hidden services drop out of charts entirely. ' +
        'Click a service type (or its Subs count) to drill into the exact subscriptions behind it.'),
    ),
    list.length === 0
      ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'Service types appear here after you upload a snapshot.')
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '280px', overflowY: 'scroll', scrollbarWidth: 'thin', scrollbarGutter: 'stable' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)', position: 'sticky', top: '0', zIndex: '10' } },
              el('tr', {},
                el('th', { class: 'text-left pl-3 pr-2 py-2 font-semibold' }, 'Service Type'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Subs'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Lifecycle'),
                el('th', { class: 'text-left pr-3 pl-2 py-2 font-semibold' }, 'Hidden'),
              ),
            ),
            el('tbody', {},
              ...list.map(c => {
                // 'Hidden' tag is always built; we toggle its visibility in
                // place so a click updates instantly without a full re-render.
                const hiddenTag = el('span', {
                  class: 'ml-2 inline-block text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded font-semibold',
                  style: { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)', display: c.is_hidden ? 'inline-block' : 'none' },
                }, 'Hidden');
                // Lifecycle select drives BOTH recurring math and hygiene flags.
                //   Auto      → infer from revenue (recurring if it carries ARV)
                //   Recurring → ongoing; active is expected
                //   One-time  → flag active subs that have already been serviced
                //   Retired   → flag ANY active sub (discontinued service)
                const setLc = String(c.lifecycle || '');
                const effLc = lifecycleMap.get(c.service_name) || (arvAny.get(c.service_name) ? 'recurring' : 'onetime');
                const lcSelect = el('select', {
                  class: 'rounded border px-1.5 py-1 text-xs cursor-pointer',
                  style: { borderColor: 'var(--border-2)', background: 'transparent', color: 'var(--text)' },
                  onchange: (e) => { updateConfig(c.service_name, { lifecycle: e.target.value || null }); mountApp(); },
                },
                  el('option', { value: '',          selected: setLc === '' },         'Auto (' + effLc + ')'),
                  el('option', { value: 'recurring', selected: setLc === 'recurring' }, 'Recurring'),
                  el('option', { value: 'onetime',   selected: setLc === 'onetime' },   'One-time'),
                  el('option', { value: 'retired',   selected: setLc === 'retired' },   'Retired'),
                );
                const row = el('tr', {
                  class: 'border-t',
                  style: { borderColor: 'var(--border)', opacity: c.is_hidden ? '0.55' : '1' },
                });
                // Hidden control as a styled pill (not a native checkbox) so
                // the on/off state always paints, regardless of browser accent
                // rendering. Updates in place — no full re-render.
                const hidPill = el('button', {
                  class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border cursor-pointer transition whitespace-nowrap',
                });
                const paintPill = (hidden) => {
                  hidPill.textContent = hidden ? '✓ Hidden' : 'Hide';
                  Object.assign(hidPill.style, hidden
                    ? { background: 'var(--accent)', color: '#3A1D12', borderColor: 'var(--accent)' }
                    : { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-2)' });
                };
                paintPill(!!c.is_hidden);
                hidPill.onclick = () => {
                  const v = !(c.is_hidden);
                  c.is_hidden = v;
                  updateConfig(c.service_name, { is_hidden: v });
                  paintPill(v);
                  row.style.opacity = v ? '0.55' : '1';
                  hiddenTag.style.display = v ? 'inline-block' : 'none';
                };
                // Drill into the actual subscriptions carrying this service type.
                const svcCount = svcCounts.get(c.service_name) || 0;
                const canDrill = svcCount > 0;
                const drillSvc = () => {
                  const drillRows = subs.filter(r => r.subscription === c.service_name);
                  if (!drillRows.length) { toast('No subscriptions loaded for this service type', 'info'); return; }
                  openReportingDrillModal({ chartTitle: 'Service Types', sliceLabel: c.service_name + ' — ' + drillRows.length + ' subscription' + (drillRows.length === 1 ? '' : 's'), rows: drillRows, formatValue: fmt.usd0 });
                };
                row.append(
                  el('td', { class: 'pl-3 pr-2 py-1.5 font-medium' },
                    el('span', { class: canDrill ? 'cursor-pointer hover:underline' : '', title: canDrill ? 'View the subscriptions with this service type' : '', onclick: canDrill ? drillSvc : null }, c.service_name),
                    hiddenTag,
                  ),
                  el('td', { class: 'px-2 py-1.5 text-left' },
                    canDrill
                      ? el('button', { class: 'tabular-nums font-semibold cursor-pointer hover:underline', style: { color: 'var(--text)' }, title: 'View the subscriptions with this service type', onclick: drillSvc }, svcCount.toLocaleString())
                      : el('span', { class: 'tabular-nums text-muted-' }, '0')),
                  el('td', { class: 'px-2 py-1.5 text-left whitespace-nowrap' }, lcSelect),
                  el('td', { class: 'pr-3 pl-2 py-1.5 text-left' }, hidPill),
                );
                return row;
              }),
            ),
          ),
        ),
  );
}

// Configurations · Cancellation Reasons — pick which reasons count toward
// attrition. An excluded reason drops out of churn EVERYWHERE: Overview
// cancel count + rate AND the Geographic attrition map. Reasons are read live
// from the snapshot's canceled subs; toggles persist to reporting_cancel_config.
// Shared by the Settings panel and the Retention tab's Attrition Steps: the
// consolidated list of cancellation reasons (with snapshot counts), which are
// excluded, and the persisting toggle.
function reportingCancelReasonModel() {
  const cfg  = state.reportingCancelConfig || [];
  const subs = state.reportingSubscriptions || [];
  const cfgByReason = new Map(cfg.map(c => [c.reason, c]));

  // Count canceled subs per reason (volume context) from the snapshot.
  const counts = new Map();
  for (const r of subs) {
    if (!r.subscription_date_canceled) continue;
    const reason = reportingCancelReasonOf(r);
    counts.set(reason, (counts.get(reason) || 0) + 1);
  }
  // Reference the reporting customer report's reason universe (persisted), so
  // the full list shows even when the report's rows aren't loaded in memory.
  for (const reason of (state._reportingCancelReasonsSeen || [])) {
    const r = String(reason || '').trim();
    if (r && !counts.has(r)) counts.set(r, 0);
  }
  // Consolidate variant spellings of the same reason (case/whitespace, and
  // CRM system duplicates like two "Expired Subscription" entries) into ONE
  // row. Distinct compound reasons (e.g. "Apruv | Sent to Collections") have
  // different text so they naturally stay separate.
  const groups = new Map(); // normKey → { key, display, count, variants:Set }
  const addReason = (raw, n) => {
    const key = _normCancelReason(raw);
    if (!key) return;
    let g = groups.get(key);
    if (!g) { g = { key, display: String(raw).trim(), count: 0, variants: new Set() }; groups.set(key, g); }
    g.count += n; g.variants.add(raw);
  };
  for (const [raw, n] of counts) addReason(raw, n);
  for (const c of cfg) addReason(c.reason, 0);
  // Prefer an existing config entry's exact text as the row label.
  for (const g of groups.values()) {
    const cv = [...g.variants].find(v => cfgByReason.has(v));
    if (cv) g.display = String(cv).trim();
  }
  const savedWhatIf = state._retenWhatIf; state._retenWhatIf = null;
  const excludedSet = reportingExcludedCancelReasons(); // normalized keys (official, not what-if)
  state._retenWhatIf = savedWhatIf;
  const list = [...groups.values()].sort((a, b) => b.count - a.count || a.display.localeCompare(b.display));

  const updateCancelConfig = async (reason, patch) => {
    logActivity('config_change', { detail: 'Cancel-reason config: ' + reason + ' → ' + JSON.stringify(patch) });
    const existing = cfgByReason.get(reason) || { reason, counts_attrition: true };
    const next = { ...existing, ...patch, updated_by: state.profile?.id || null };
    const idx = cfg.findIndex(c => c.reason === reason);
    if (idx >= 0) cfg[idx] = next; else cfg.push(next);
    state._reportingCancelConfigStamp = (state._reportingCancelConfigStamp || 0) + 1;
    if (DEMO) { saveDemoData(); return; }
    const { error } = await supabase
      .from('reporting_cancel_config')
      .upsert(next, { onConflict: 'reason' });
    if (error) {
      toast('Save failed: ' + error.message, 'error');
      if (idx >= 0) cfg[idx] = existing; else cfg.splice(cfg.length - 1, 1);
      mountApp();
    }
  };
  // Flip a reason (and its spelling variants) in or out of attrition.
  const setExcluded = (g, excluded) => {
    updateCancelConfig(g.display, { counts_attrition: !excluded });
    g.variants.forEach(v => { if (v !== g.display && cfgByReason.has(v)) updateCancelConfig(v, { counts_attrition: !excluded }); });
  };
  return { cfg, subs, cfgByReason, list, excludedSet, updateCancelConfig, setExcluded };
}
function reportingCancelConfigPanel() {
  const { cfg, subs, cfgByReason, list, excludedSet, updateCancelConfig } = reportingCancelReasonModel();

  return el('div', { class: 'card p-3', id: 'cfg-cancel' },
    el('div', { class: 'flex items-center gap-2 mb-3' },
      el('h2', { class: 'text-base font-bold' }, 'Cancellation Reasons'),
      configInfoBtn('Cancellation Reasons',
        'Choose which cancellation reasons count as real attrition. Excluded reasons (e.g. duplicates, moved/relocated, paperwork churn) ' +
        'drop out of churn everywhere — the Overview cancel count + rate AND the Geographic attrition map. ' +
        'Click a reason (or its Cancels number) to drill into the exact canceled accounts behind it. Counts are canceled subs in the current snapshot.'),
    ),
    list.length === 0
      ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'Cancellation reasons appear here once a snapshot has canceled subscriptions.')
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '280px', overflowY: 'scroll', scrollbarWidth: 'thin', scrollbarGutter: 'stable' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)', position: 'sticky', top: '0', zIndex: '10' } },
              el('tr', {},
                el('th', { class: 'text-left pl-3 pr-2 py-2 font-semibold' }, 'Cancellation Reason'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Cancels'),
                el('th', { class: 'text-left pr-3 pl-2 py-2 font-semibold' }, 'Attrition'),
              ),
            ),
            el('tbody', {},
              ...list.map(g => {
                let excludedNow = excludedSet.has(g.key);
                const row = el('tr', {
                  class: 'border-t',
                  style: { borderColor: 'var(--border)', opacity: excludedNow ? '0.6' : '1' },
                });
                const pill = el('button', {
                  class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border cursor-pointer transition whitespace-nowrap',
                });
                const paint = (excluded) => {
                  pill.textContent = excluded ? '✕ Excluded' : '✓ Counts';
                  Object.assign(pill.style, excluded
                    ? { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-2)' }
                    : { background: 'var(--accent)', color: '#3A1D12', borderColor: 'var(--accent)' });
                };
                paint(excludedNow);
                pill.onclick = () => {
                  excludedNow = !excludedNow;
                  const countsAttr = !excludedNow; // excluded → counts_attrition = false
                  // Sync the canonical reason AND every variant config entry so
                  // all spellings stay aligned (matching is normalized anyway).
                  updateCancelConfig(g.display, { counts_attrition: countsAttr });
                  g.variants.forEach(v => { if (v !== g.display && cfgByReason.has(v)) updateCancelConfig(v, { counts_attrition: countsAttr }); });
                  paint(excludedNow);
                  row.style.opacity = excludedNow ? '0.6' : '1';
                };
                // Drill into the actual canceled accounts behind this reason.
                const drill = () => {
                  const drillRows = subs.filter(r => r.subscription_date_canceled && _normCancelReason(reportingCancelReasonOf(r)) === g.key);
                  if (!drillRows.length) { toast('No canceled accounts loaded for this reason', 'info'); return; }
                  openReportingDrillModal({ chartTitle: 'Cancellations', sliceLabel: g.display + ' — ' + drillRows.length + ' canceled', rows: drillRows, formatValue: fmt.usd0 });
                };
                const canDrill = g.count > 0;
                row.append(
                  el('td', { class: 'pl-3 pr-2 py-1.5 font-medium' + (canDrill ? ' cursor-pointer hover:underline' : ''), title: canDrill ? 'View the canceled accounts' : '', onclick: canDrill ? drill : null }, g.display),
                  el('td', { class: 'px-2 py-1.5 text-left' },
                    canDrill
                      ? el('button', { class: 'tabular-nums font-semibold cursor-pointer hover:underline', style: { color: 'var(--text)' }, title: 'View the canceled accounts', onclick: drill }, g.count.toLocaleString())
                      : el('span', { class: 'tabular-nums text-muted-' }, '0')),
                  el('td', { class: 'pr-3 pl-2 py-1.5 text-left' }, pill),
                );
                return row;
              }),
            ),
          ),
        ),
  );
}

// Configurations · Lead Sources — exclude sources from ALL snapshot-based
// reporting (Overview, Geographic, Rep Performance, Waterfall, Inside Sales).
// e.g. Miscellaneous. Excluded sources are filtered at the shared `visible`
// set so every tab drops them at once. Toggles persist to
// reporting_source_config. (Marketing tab uses a separate data source and is
// unaffected.)
// Paid lead channels (per Isaac, Sep 30) — set on Configurations → Lead
// sources; Lead reconciliation offers only these as providers. Saved as an
// admin rule (shared across admins).
// Metrics provider per CRM lead source (per Isaac, Sep 30): roll several
// CRM sources into one provider on Marketing → Metrics ("#49 FB" →
// Facebook), or hide one from Metrics. Admin rule sourceProvider
// { [source]: provider | '__hide' }; unset = the source is its own provider.
const MKTG_HIDE = '__hide';
function reportingSourceProviderMap() { const r = (typeof _adminRules === 'function') ? _adminRules() : null; return (r && r.sourceProvider && typeof r.sourceProvider === 'object') ? r.sourceProvider : {}; }
function setReportingSourceProvider(source, val) { const m = Object.assign({}, reportingSourceProviderMap()); if (val == null || val === '') delete m[source]; else m[source] = val; _setAdminRule('sourceProvider', m); }
function reportingProviderOf(source) { const v = reportingSourceProviderMap()[source]; return v === MKTG_HIDE ? null : (v || source); }
// (reportingHiddenProviders removed — unreferenced; settings audit, Sep 30)
function reportingPaidSources() { const r = (typeof _adminRules === 'function') ? _adminRules() : null; return new Set((r && Array.isArray(r.paidSources)) ? r.paidSources : []); }
function setReportingPaidSource(source, on) { const s = reportingPaidSources(); if (on) s.add(source); else s.delete(source); _setAdminRule('paidSources', [...s].sort()); }
function reportingSourceConfigPanel() {
  const cfg  = state.reportingSourceConfig || [];
  const subs = state.reportingSubscriptions || [];
  const cfgBySource = new Map(cfg.map(c => [c.source, c]));

  const counts = new Map();
  for (const r of subs) {
    const src = reportingSourceOf(r);
    counts.set(src, (counts.get(src) || 0) + 1);
  }
  // Every source ever sold: reference the reporting customer report's source
  // universe (persisted) + the company Sources registry, so the full list
  // shows without a snapshot loaded.
  for (const src of (state._reportingSourcesSeen || [])) {
    const s2 = String(src || '').trim();
    if (s2 && !counts.has(s2)) counts.set(s2, 0);
  }
  const registrySources = (state.sources || []).map(x => String(x.name || '').trim()).filter(Boolean);
  const allSources = new Set([...cfgBySource.keys(), ...counts.keys(), ...registrySources]);
  // One Sources table (per Isaac, Sep 30): the FieldRoutes source mirror
  // (in CRM · Sales Log visibility · Pay tab) merged in beside the reporting
  // controls — was a second "All Sources" table under it.
  const regByName = new Map((state.sources || []).map(x => [String(x.name || '').trim(), x]));
  const frLinked = (state.sources || []).filter(x => x.fr_source_id);
  const frStampRaw = frLinked.reduce((m, x) => ((x.fr_synced_at || '') > m ? x.fr_synced_at : m), '');
  // Metrics provider picker: itself / hide / roll into another provider.
  const _pmap = reportingSourceProviderMap();
  const _provOpts = [...new Set([...(typeof MKTG_DEFAULT_CHANNELS !== 'undefined' ? MKTG_DEFAULT_CHANNELS : []), ...(typeof AD_PROVIDERS !== 'undefined' ? AD_PROVIDERS : []), 'PestBooker', 'Organic',
    ...Object.values(_pmap).filter(v => v && v !== MKTG_HIDE), ...allSources])].filter(Boolean).sort((a, b) => a.localeCompare(b));
  const provSel = (source) => {
    const v = _pmap[source] || '';
    return el('select', { class: 'rounded border px-1.5 py-1 text-xs cursor-pointer', style: { borderColor: v ? 'var(--accent)' : 'var(--border-2)', background: 'transparent', color: v === MKTG_HIDE ? 'var(--text-muted)' : 'var(--text)', maxWidth: '170px' },
      onchange: (e) => { setReportingSourceProvider(source, e.target.value || null); logActivity('config_change', { detail: 'Metrics provider: ' + source + ' → ' + (e.target.value || 'itself') }); mountApp(); } },
      el('option', { value: '', selected: !v }, 'Itself'),
      el('option', { value: MKTG_HIDE, selected: v === MKTG_HIDE }, 'Hide on Metrics'),
      ..._provOpts.filter(o => o !== source).map(o => el('option', { value: o, selected: v === o }, '→ ' + o)));
  };
  const chip = (txt, bg, fg, title) => el('span', { class: 'text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded whitespace-nowrap', style: { background: bg, color: fg }, title }, txt);
  const list = [...allSources].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b));

  const updateSourceConfig = async (source, patch) => {
    logActivity('config_change', { detail: 'Source config: ' + source + ' → ' + JSON.stringify(patch) });
    const existing = cfgBySource.get(source) || { source, included: true };
    const next = { ...existing, ...patch, updated_by: state.profile?.id || null };
    const idx = cfg.findIndex(c => c.source === source);
    if (idx >= 0) cfg[idx] = next; else cfg.push(next);
    state.reportingSourceConfig = cfg.slice();   // new identity → reportingSourceClass rebuilds now, not on reload
    if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
    if (DEMO) { saveDemoData(); return; }
    // Don't send revenue_class unless it's actually been set — keeps the
    // Included toggle working even before reporting_source_config gains the
    // revenue_class column (a null/absent send would 400 on the missing column).
    const payload = { ...next };
    if (payload.revenue_class == null && !('revenue_class' in patch)) {
      delete payload.revenue_class;
    }
    const { error } = await supabase
      .from('reporting_source_config')
      .upsert(payload, { onConflict: 'source' });
    if (error) {
      const hint = /revenue_class/.test(error.message || '')
        ? ' — add the column first: ALTER TABLE reporting_source_config ADD COLUMN revenue_class text;'
        : '';
      toast('Save failed: ' + error.message + hint, 'error');
      if (idx >= 0) cfg[idx] = existing; else cfg.splice(cfg.length - 1, 1);
      mountApp();
    }
  };

  return el('div', { class: 'card p-3', id: 'cfg-sources' },
    el('div', { class: 'flex items-center gap-2 mb-3' },
      el('h2', { class: 'text-base font-bold' }, 'Lead Sources'),
      el('span', { class: 'text-[10px] ml-auto', style: { color: 'var(--text-subtle)' } }, (state.sources || []).filter(x => x.is_active !== false).length + ' on the Sales Log · ' + frLinked.length + ' from FieldRoutes' + (frStampRaw ? ' · CRM checked ' + new Date(frStampRaw).toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET' : '')),
      configInfoBtn('Lead Sources',
        'Two controls per source. Revenue Type classifies it as New, Renewal, or Upsell — the single rule the Inside Sales pace and P&L read (renewals are excluded from new-business pace; upsells bucket separately). Defaults follow the source name. ' +
        'In Reporting excludes a source from all snapshot reporting (Overview, Geographic, Rep Performance, Waterfall, Inside Sales) — e.g. Miscellaneous drops out everywhere at once. Counts are total subs per source in the current snapshot. ' +
        'FieldRoutes / Sales Log mirror the CRM source list (hourly): add or hide a source in FieldRoutes and it lands here; visible ones feed the Sales Log dropdown. Pay tab hides a source from the Pay tab’s By Source grid (its sales still pay).'),
    ),
    list.length === 0
      ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'Lead sources appear here after you upload a snapshot.')
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '280px', overflowY: 'scroll', scrollbarWidth: 'thin', scrollbarGutter: 'stable' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)', position: 'sticky', top: '0', zIndex: '10' } },
              el('tr', {},
                el('th', { class: 'text-left pl-3 pr-2 py-2 font-semibold' }, 'Lead Source'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Subs'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Revenue Type'),
                el('th', { class: 'text-left px-2 py-2 font-semibold', title: 'Paid lead channels — the only channels that can earn a sale on Marketing → Attribution. Facebook, Google Ads and Google Local Services are always paid.' }, 'Paid channel'),
                el('th', { class: 'text-left px-2 py-2 font-semibold', title: 'How Marketing → Attribution treats a sale with this source. Last touch: the last paid lead before the sale wins. Priority window: this channel wins when it sent a lead within N days before the sale, even if another touched after. Never overwrite: the sale keeps this source. Keep when booked online: keeps this source only when the sale sits on the RIDD Account - Office house account.' }, 'Attribution rule'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'In Reporting'),
                el('th', { class: 'text-left px-2 py-2 font-semibold', title: 'Which provider row this source rolls into on Marketing → Metrics (e.g. “#49 FB” → Facebook), or Hide to leave it off Metrics.' }, 'Metrics provider'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'FieldRoutes'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Sales Log'),
                el('th', { class: 'text-left pr-3 pl-2 py-2 font-semibold' }, 'Pay tab'),
              ),
            ),
            el('tbody', {},
              ...list.map(source => {
                const c = cfgBySource.get(source) || { source, included: true };
                const excluded0 = c.included === false;
                const row = el('tr', {
                  class: 'border-t',
                  style: { borderColor: 'var(--border)', opacity: excluded0 ? '0.6' : '1' },
                });
                const pill = el('button', {
                  class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border cursor-pointer transition whitespace-nowrap',
                });
                const paint = (excluded) => {
                  pill.textContent = excluded ? '✕ Excluded' : '✓ Included';
                  Object.assign(pill.style, excluded
                    ? { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-2)' }
                    : { background: 'var(--accent)', color: '#3A1D12', borderColor: 'var(--accent)' });
                };
                paint(excluded0);
                pill.onclick = () => {
                  const nowExcluded = !(c.included === false);
                  c.included = !nowExcluded;            // true = included, false = excluded
                  updateSourceConfig(source, { included: !nowExcluded });
                  paint(nowExcluded);
                  row.style.opacity = nowExcluded ? '0.6' : '1';
                };
                // Revenue Type — New / Renewal / Upsell. Blank value = follow the
                // name-based default, which the "Auto" label spells out.
                const nameDefault = /renewal/i.test(source) ? 'renewal' : /upsell/i.test(source) ? 'upsell' : 'new';
                const setClass = c.revenue_class || '';
                const classSelect = el('select', {
                  class: 'rounded border px-1.5 py-1 text-xs cursor-pointer',
                  style: { borderColor: 'var(--border-2)', background: 'transparent', color: 'var(--text)' },
                  onchange: (e) => { c.revenue_class = e.target.value || null; updateSourceConfig(source, { revenue_class: e.target.value || null }); },
                },
                  el('option', { value: '',        selected: setClass === '' },        'Auto (' + nameDefault + ')'),
                  el('option', { value: 'new',     selected: setClass === 'new' },     'New'),
                  el('option', { value: 'renewal', selected: setClass === 'renewal' }, 'Renewal'),
                  el('option', { value: 'upsell',  selected: setClass === 'upsell' },  'Upsell'),
                );
                // Paid channel (per Isaac, Sep 30): only these show as providers on Lead reconciliation.
                const _adPaid = (typeof AD_PROVIDERS !== 'undefined') && AD_PROVIDERS.includes(source);   // ad platforms are always paid
                const isPaid = _adPaid || reportingPaidSources().has(source);
                const _rule = (typeof attrRuleOf === 'function') ? attrRuleOf(source) : '';
                const _priDays = [3, 7, 14, 30]; if (/^pri:/.test(_rule) && !_priDays.includes(Number(_rule.slice(4)))) _priDays.push(Number(_rule.slice(4)));
                const ruleSel = el('select', { class: 'rounded border px-1.5 py-1 text-xs cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'transparent', color: _rule ? 'var(--accent)' : 'var(--text)', fontWeight: _rule ? '700' : '400' },
                  onchange: (e) => { if (typeof setAttrRule === 'function') setAttrRule(source, e.target.value); mountApp(); } },
                  el('option', { value: '', selected: _rule === '' }, isPaid ? 'Last touch' : 'Standard'),
                  ...((isPaid || /^pri:/.test(_rule)) ? _priDays.sort((a, b) => a - b).map(d => el('option', { value: 'pri:' + d, selected: _rule === 'pri:' + d }, 'Priority window · ' + d + ' days')) : []),
                  el('option', { value: 'keep', selected: _rule === 'keep' }, 'Never overwrite'),
                  el('option', { value: 'booked', selected: _rule === 'booked' }, 'Keep when booked online'));
                const paidBtn = _adPaid ? el('span', { class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border whitespace-nowrap inline-block', title: 'Ad platform — always a paid channel', style: { background: '#5F6C5B', color: '#fff', borderColor: '#5F6C5B' } }, '$ Paid') : el('button', { class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border cursor-pointer whitespace-nowrap',
                  style: isPaid ? { background: '#5F6C5B', color: '#fff', borderColor: '#5F6C5B' } : { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-2)' },
                  onclick: () => { setReportingPaidSource(source, !isPaid); mountApp(); } }, isPaid ? '$ Paid' : 'Not paid');
                row.append(
                  el('td', { class: 'pl-3 pr-2 py-1.5 font-medium' }, source),
                  el('td', { class: 'px-2 py-1.5 text-left tabular-nums text-muted-' }, (counts.get(source) || 0).toLocaleString()),
                  el('td', { class: 'px-2 py-1.5 text-left' }, classSelect),
                  el('td', { class: 'px-2 py-1.5 text-left' }, paidBtn),
                  el('td', { class: 'px-2 py-1.5 text-left' }, ruleSel),
                  el('td', { class: 'px-2 py-1.5 text-left' }, pill),
                  el('td', { class: 'px-2 py-1.5 text-left' }, provSel(source)),
                  (() => { const reg = regByName.get(source);
                    return el('td', { class: 'px-2 py-1.5 text-left' }, !reg ? chip('Not listed', 'var(--card-2)', 'var(--text-muted)', 'Seen in sales data but not in the source list')
                      : reg.fr_source_id ? chip('In CRM', 'rgba(95,108,91,.12)', '#5F6C5B', 'Mirrored from FieldRoutes (source ID ' + reg.fr_source_id + ')')
                      : chip('Not in CRM', 'rgba(220,38,38,.10)', '#DC2626', 'Not in the FieldRoutes source list — hidden from the Sales Log automatically')); })(),
                  (() => { const reg = regByName.get(source);
                    return el('td', { class: 'px-2 py-1.5 text-left text-[11px]', style: { color: reg && reg.is_active !== false ? 'var(--text)' : 'var(--text-muted)' }, title: 'Managed in FieldRoutes' }, !reg ? '—' : reg.is_active === false ? 'Hidden' : 'Visible'); })(),
                  (() => { const reg = regByName.get(source);
                    if (!reg || typeof payHiddenSources !== 'function') return el('td', { class: 'pr-3 pl-2 py-1.5' }, '—');
                    const off = !!payHiddenSources()[reg.id];
                    return el('td', { class: 'pr-3 pl-2 py-1.5 text-left' }, el('button', { class: 'text-[11px] font-bold rounded-full px-2.5 py-1 border whitespace-nowrap',
                      style: off ? { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-2)' } : { background: 'rgba(61,122,102,.16)', color: '#5F6C5B', borderColor: 'rgba(61,122,102,.3)' },
                      title: off ? 'Hidden from the Pay tab’s By Source grid — sales on it still pay. Click to show.' : 'Shown on the Pay tab’s By Source grid. Click to hide.',
                      onclick: () => togglePayHiddenSource(reg.id) }, off ? 'Hidden on Pay' : 'On Pay')); })(),
                );
                return row;
              }),
            ),
          ),
        ),
  );
}

// ── Inside Sales (MO) — income-statement style monthly P&L ──────────────
// Revenue + channel spend + subs sold are auto-computed (snapshot rows by
// sold_date + is-spend.json from the marketing pipeline). Projections, wages,
// incentives and call counts are hand-entered cells saved to Supabase
// (reporting_is_manual) so they're shared across every login.
const IS_SOURCES = new Set(['6 Brothers','Angi','Baton','Click-To-Buy','DoLead','Facebook','Google Ads','Google Local Services','Inside Sale','Miscellaneous','Pest Net','Referral','Sellify','Service Direct','Unknown Source','Website','Yelp','eLocal']);
const IS_UPSELL_SOURCES = new Set(['Upsell - Service Pro','Upsell - Termite Pro']);
const IS_MANUAL_FIELDS = ['projected_revenue','projected_ad_spend','projected_wages','wages','incentive_costs','total_calls','qualified_calls'];

async function loadIsManual() {
  if (DEMO) { state.reportingIsManual = state.reportingIsManual || {}; return; }
  const { data, error } = await supabase.from('reporting_is_manual').select('*');
  if (error) { console.warn('[ridd] reporting_is_manual load failed (run inside_sales_schema.sql?)', error); state.reportingIsManual = {}; return; }
  const m = {}; (data || []).forEach(r => { m[r.period] = r; });
  state.reportingIsManual = m;
}
async function saveIsManual(period, field, value) {
  logActivity('config_change', { detail: 'IS P&L cell: ' + field + ' @ ' + period + ' = ' + (value === '' || value == null ? '(cleared)' : value) });
  if (!state.reportingIsManual) state.reportingIsManual = {};
  const cur = state.reportingIsManual[period] || { period };
  cur[field] = (value === '' || value == null) ? null : Number(value);
  state.reportingIsManual[period] = cur;
  if (DEMO) return;
  const payload = { period };
  IS_MANUAL_FIELDS.forEach(f => { if (cur[f] !== undefined) payload[f] = cur[f]; });
  payload.updated_by = state.profile?.id || null;
  const { error } = await supabase.from('reporting_is_manual').upsert(payload, { onConflict: 'period' });
  if (error) toast('Save failed: ' + error.message + ' (run inside_sales_schema.sql?)', 'error');
}

// ── Inside Sales Pacer (from the RIDD Reporting IS sheet) ────────────────
// Cumulative % of the annual goal expected by end of each month, and the
// monthly seasonal allocation. Source: RIDD Reporting.xlsx, IS tab.
const IS_PACER_CUM = [0.025, 0.055, 0.105, 0.20, 0.30, 0.42, 0.595, 0.74, 0.84, 0.93, 0.98, 1];
// Month-over-month seasonal allocation (Jan→Dec). Sums to 100% and lines up
// exactly with IS_PACER_CUM as its running total.
const IS_SEASONAL  = [0.025, 0.03, 0.05, 0.095, 0.10, 0.12, 0.175, 0.145, 0.10, 0.09, 0.05, 0.02];
// Renewals follow their OWN seasonal curve (front/back-loaded — high in winter,
// low through the summer selling season), the inverse of new-sales seasonality.
const IS_RENEWAL_SEASONAL = [0.14, 0.12, 0.10, 0.08, 0.07, 0.05, 0.06, 0.06, 0.06, 0.06, 0.07, 0.13];

// RIDD-level monthly projections (Jan→Dec), straight from the PROJECTIONS tab of
// RIDD Reporting.xlsx — revenue goal $4M × seasonal curve × branch ramp. These
// feed the P&L's Projected rows and the pacer so projections sit next to actuals.
// Annual revenue GOAL is $4.0M; the monthly figures sum to $3.904M (Detroit ramps
// up mid-year), which is why we keep the goal separate from the monthly sum.
const IS_ANNUAL_GOAL = { '2024': 2000000, '2025': 1500000, '2026': 4000000 };
const IS_PROJECTIONS = {
  // Prior years: projected revenue = annual goal × the seasonal allocation.
  '2024': {
    projected_revenue:  [50000, 60000, 100000, 190000, 200000, 240000, 350000, 290000, 200000, 180000, 100000, 40000],
  },
  '2025': {
    projected_revenue:  [37500, 45000, 75000, 142500, 150000, 180000, 262500, 217500, 150000, 135000, 75000, 30000],
  },
  '2026': {
    projected_revenue:  [88000, 105600, 176000, 334400, 400000, 480000, 700000, 580000, 400000, 360000, 200000, 80000],
    projected_ad_spend: [35200, 42240, 70400, 133760, 140800, 168960, 246400, 204160, 140800, 126720, 70400, 28160],
    projected_wages:    [13640, 16368, 27280, 51832, 54560, 65472, 95480, 79112, 54560, 49104, 27280, 10912],
  },
};
// Projection value for a period + field. Period is 'YYYY-MM' (one month), a bare
// 'YYYY' (full-year total), or the YTD sentinel (= sum Jan→current month).
function isProjectionAt(period, field, ytdYear, ytdMonth0) {
  const p = String(period);
  const tbl = (y) => (IS_PROJECTIONS[String(y)] || {})[field] || null;
  if (/^\d{4}-\d{2}$/.test(p)) { const t = tbl(p.slice(0, 4)); return t ? (t[Number(p.slice(5, 7)) - 1] ?? null) : null; }
  if (ytdYear != null && p === String(ytdYear)) { const t = tbl(ytdYear); return t ? t.slice(0, (ytdMonth0 ?? 11) + 1).reduce((a, b) => a + b, 0) : null; }
  if (/^\d{4}$/.test(p)) { const t = tbl(p); return t ? t.reduce((a, b) => a + b, 0) : null; }
  return null;
}

// Monthly + YTD pace vs goal. Monthly goal = hand-entered Projected Revenue
// (P&L row) when set, else annual goal × seasonal curve. The annual goal is
// editable here and persisted LOCALLY (browser) so it works even when the
// optional reporting_is_manual table isn't set up — no "save failed" toast.
// (isAnnualGoalFor removed — unreferenced; settings audit, Sep 30)
// (setAnnualGoalFor removed — unreferenced; settings audit, Sep 30)

// P&L assumptions — spend modeled as a % of revenue, editable per year and
// persisted locally. Stored as fractions (0.18 = 18%). Defaults mirror the
// PROJECTIONS-tab config (ad spend 36%, wages 15.5%, incentives 1%).
const IS_ASSUMPTION_DEFAULTS = { ad_spend_pct: 0.36, wages_pct: 0.155, incentive_pct: 0.01 };
// (isAssumptionFor removed — unreferenced; settings audit, Sep 30)
// (setAssumptionFor removed — unreferenced; settings audit, Sep 30)
// (reportingIsPacer removed — unreferenced; settings audit, Sep 30)

// Consolidated Marketing tab = the Inside Sales P&L, topped with the two charts
// the CMO wanted: marketing spend vs IS revenue, and GHL leads by source.
// Incrementally pull GoHighLevel leads. A high-volume location can't be paged
// in one serverless call (24s budget), which left only the latest month and
// made the chart's range filter look broken. We now resume from the cursor the
// function returns, MERGING each budget-bounded slice into one accumulator and
// persisting it to localStorage, so the full 365-day history fills in over a few
// background calls and survives reloads.
function reportingLoadGhlLeads() {
  if (state._ghlLoading || state._ghlDone) return;
  if (state._ghlFailAt && Date.now() - state._ghlFailAt < 120000) return;   // failed page → 2-min cooldown, not a render loop
  // Restore a prior session's accumulated pull before the first network call.
  if (state.reportingGhlLeads == null && !state._ghlRestored) {
    state._ghlRestored = true;
    try {
      const c = JSON.parse(localStorage.getItem('ridd_ghl_leads') || 'null');
      if (c && c.data) { state.reportingGhlLeads = c.data; state._ghlCursor = c.cursor || null; state._ghlDone = !!c.done; }
    } catch (e) {}
    if (state._ghlDone) return; // cached full history
  }
  state._ghlLoading = true;
  const url = '/api/ghl-leads' + (state._ghlCursor ? ('?after=' + encodeURIComponent(JSON.stringify(state._ghlCursor))) : '');
  _apiAuthHeaders({ accept: 'application/json' }).then(h => fetch(url, { headers: h }))
    .then(r => r.ok ? r.json() : null)
    .then(j => {
      state._ghlLoading = false;
      if (!j) { state._ghlFailAt = Date.now(); state.reportingGhlLeads = state.reportingGhlLeads || {}; mountApp(); return; }
      state._ghlFailAt = 0;
      const acc = (state.reportingGhlLeads && state.reportingGhlLeads.bySourceMonth)
        ? state.reportingGhlLeads : { bySourceMonth: {}, leadsBySource: {}, contacts: [], total: 0 };
      const bsm = j.bySourceMonth || {};
      for (const ym in bsm) { acc.bySourceMonth[ym] = acc.bySourceMonth[ym] || {}; for (const s in bsm[ym]) acc.bySourceMonth[ym][s] = (acc.bySourceMonth[ym][s] || 0) + bsm[ym][s]; }
      const lbs = j.leadsBySource || {}; for (const s in lbs) acc.leadsBySource[s] = (acc.leadsBySource[s] || 0) + lbs[s];
      if (Array.isArray(j.contacts) && j.contacts.length) acc.contacts = (acc.contacts || []).concat(j.contacts);
      acc.total = (acc.total || 0) + (j.total || 0);
      acc.pulledAt = j.pulledAt;
      state._ghlCursor = j.nextAfter || null;
      state._ghlDone = !!j.done || !state._ghlCursor;
      acc.partial = !state._ghlDone;
      state.reportingGhlLeads = acc;
      try { localStorage.setItem('ridd_ghl_leads', JSON.stringify({ data: acc, cursor: state._ghlCursor, done: state._ghlDone })); } catch (e) {}
      mountApp();
      if (!state._ghlDone) setTimeout(reportingLoadGhlLeads, 500); // keep gathering older months
    })
    .catch(() => { state._ghlLoading = false; state._ghlFailAt = Date.now(); state.reportingGhlLeads = state.reportingGhlLeads || {}; mountApp(); });
}
function reportingRefreshGhlLeads() {
  state.reportingGhlLeads = null; state._ghlCursor = null; state._ghlDone = false; state._ghlRestored = true; state._ghlLoading = false;
  try { localStorage.removeItem('ridd_ghl_leads'); } catch (e) {}
  reportingLoadGhlLeads();
}

// QuickBooks marketing spend loader (shared by the legacy IS report and the
// Marketing tab): /api/qbo-spend → Advertising & Marketing by branch account
// by month; falls back to the static is-spend.json if QBO isn't configured.
function reportingLoadQboSpend(force) {
  if (devSampleData()) { if (state._isSpendSource !== 'Sample') { state.reportingIsSpend = devSampleQboSpend(); state._isSpendSource = 'Sample'; state._isSpendPulledAt = new Date().toISOString(); state._isSpendLoading = false; } return; }
  if (state._isSpendSource === 'Sample') { state.reportingIsSpend = null; state._isSpendSource = null; state._isSpendLoading = false; }
  if (force) { state.reportingIsSpend = null; state._isSpendLoading = false; }
  if (state.reportingIsSpend != null || state._isSpendLoading) return;
  state._isSpendLoading = true;
  // No static / hand-entered fallback (per Isaac): QuickBooks via Windsor or
  // nothing — an unbooked month shows blank rather than a made-up number.
  const useFile = () => { state.reportingIsSpend = {}; state._isSpendSource = 'none'; state._isSpendLoading = false; mountApp(); };
  _apiAuthHeaders().then(h => fetch('/api/qbo-spend' + (force ? '?_=' + Date.now() : ''), { headers: h })).then(r => r.ok ? r.json() : null).then(j => {
    if (j && j.bySourceMonth && Object.keys(j.bySourceMonth).length) {
      state.reportingIsSpendPayee = j.byPayee || null;
      state.reportingIsSpend = j.bySourceMonth; state._isSpendSource = 'QuickBooks'; state._isSpendPulledAt = j.pulledAt; state._isSpendLoading = false; if (typeof healthReport === 'function') healthReport('qbo', true); mountApp();
      // A stale copy was served while Windsor re-pulls in the background — pick up the fresh one shortly.
      if (j.refreshing && !state._isSpendRepoll) { state._isSpendRepoll = true; setTimeout(() => { state._isSpendRepoll = false; reportingLoadQboSpend(true); }, 45000); }
    } else if (j && j.pending) {
      // First pull is running in the background (Windsor ledger takes ~30s) — poll.
      state._isSpendLoading = false; state.reportingIsSpend = null;
      setTimeout(() => reportingLoadQboSpend(false), 25000);
    } else { if (typeof healthReport === 'function') healthReport('qbo', false, 'QuickBooks spend unavailable — using the uploaded file'); useFile(); }
  }).catch((e) => { if (typeof healthReport === 'function') healthReport('qbo', false, e); useFile(); });
}
// QuickBooks branch accounts → sales-data office names.
const _MKTG_QBO_OFFICE = { 'utah': 'SALT LAKE', 'michigan': 'DETROIT', 'executive': null, 'corporate': null };
function _mktgQboOffice(acct) {
  const base = String(acct || '').replace(/\s*(marketing|advertising)\s*$/i, '').trim();
  const key = base.toLowerCase();
  if (key in _MKTG_QBO_OFFICE) return _MKTG_QBO_OFFICE[key];   // null = company-level (unallocated)
  return base.toUpperCase();
}
// ── MARKETING REPORT v3 (per Isaac, Sep 2026) ────────────────────────────
// Brings the RIDD Reporting workbook into the app: P&L (branch × month),
// CAC (monthly rollup), Providers (lead partner × month), Spend entry (the
// branch × channel allocation that goes to the controller), Projections.
// Sources: FieldRoutes snapshot for revenue / subs / bookings; QuickBooks
// for booked marketing spend (reconciliation row); everything else is
// entered by hand and synced to every admin via the shared config
// (_compExtras.marketing). Quota + goals live in Configurations.
const MKTG_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MKTG_DEFAULT_CHANNELS = ['Facebook', 'Google Ads', 'Google Local Services', 'Angi', 'Baton', 'DoLead', 'ElectGen', 'Pest Net', 'Service Direct'];
// Legal-entity grouping of branches (generalization, Sep 22 2026): entities
// come from RIDD_CONFIG.ENTITIES (default RPC / RPS) and a branch's entity from
// companyGroupOf() — Configurations → branch groups, or the RIDD default
// (Detroit / Joplin / Little Rock = RPS, everything else RPC). One entity =
// no entity rows, just the company total.
const MKTG_ALL = 'RIDD';   // sentinel key for the company-wide row / scope (display label = the company name)
function _mktgEntities() { return Object.keys(COMPANY_NAMES); }
function _mktgEntityOf(branch) { const g = companyGroupOf(branch); const k = Object.keys(COMPANY_NAMES).find(k => COMPANY_NAMES[k] === g); return k || _mktgEntities()[0]; }
function _mktgGroupLabel(rk) { return rk === MKTG_ALL ? CFG.COMPANY_NAME : companyName(rk); }
// Row layout shared by the P&L / Projections matrices: each entity's branches,
// then the entity total; then the company total. A single-entity company gets
// branches + company total only.
function _mktgGroupRows(B) {
  const ents = _mktgEntities(), multi = ents.length > 1;
  const rows = [], groups = new Set([MKTG_ALL]);
  for (const k of ents) { const bs = B.byEntity[k] || []; if (!bs.length && multi) continue; rows.push(...bs); if (multi) { rows.push(k); groups.add(k); } }
  rows.push(MKTG_ALL);
  const members = (rk) => rk === MKTG_ALL ? B.all : (groups.has(rk) ? (B.byEntity[rk] || []) : [rk]);
  return { rows, groups, members };
}
function _mktgStore() {
  state._compExtras = state._compExtras || {};
  const m = state._compExtras.marketing = (state._compExtras.marketing && typeof state._compExtras.marketing === 'object') ? state._compExtras.marketing : {};
  m.spend      = m.spend      || {};   // { ym: { channel: { BRANCH: amt } } }  ← the controller allocation
  m.wages      = m.wages      || {};   // { ym: { BRANCH: amt } }
  m.incentives = m.incentives || {};   // { ym: { BRANCH: amt } }
  m.leads      = m.leads      || {};   // { ym: { channel: n } }
  m.channels   = Array.isArray(m.channels) && m.channels.length ? m.channels : MKTG_DEFAULT_CHANNELS.slice();
  const s = m.settings = m.settings || {};
  if (s.isGoal == null) s.isGoal = 4000000;
  if (s.renewalsGoal == null) s.renewalsGoal = 1600000;
  if (s.isReps == null) s.isReps = 6;
  if (s.loyaltyReps == null) s.loyaltyReps = 5;
  if (!Array.isArray(s.seasonal) || s.seasonal.length !== 12) s.seasonal = [0.025, 0.03, 0.05, 0.095, 0.10, 0.12, 0.175, 0.145, 0.10, 0.09, 0.05, 0.02];
  if (!Array.isArray(s.renewalSeasonal) || s.renewalSeasonal.length !== 12) s.renewalSeasonal = [0.14, 0.12, 0.10, 0.08, 0.07, 0.05, 0.06, 0.06, 0.06, 0.06, 0.07, 0.13];
  if (s.adSpendPct == null) s.adSpendPct = 0.45;
  if (s.wagesPct == null) s.wagesPct = 0.14;
  if (s.incentivesPct == null) s.incentivesPct = 0.01;
  s.targets = s.targets || {};
  if (s.targets.adSpendCac == null) s.targets.adSpendCac = 0.39;
  if (s.targets.wagesCac == null) s.targets.wagesCac = 0.15;
  if (s.targets.roas == null) s.targets.roas = 3;
  if (s.targets.spendPerJob == null) s.targets.spendPerJob = 340;
  s.branchGoals = s.branchGoals || {};        // { BRANCH: revenue goal }
  s.branchAttrition = s.branchAttrition || {}; // { BRANCH: 0.38 }
  s.channelProjections = s.channelProjections || {}; // { channel: [12 spend] }
  return m;
}
function _mktgSave() {
  saveDemoData();
  if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {});
}
const _mktgYm = (y, i) => y + '-' + String(i + 1).padStart(2, '0');
const _mktgTC = (o) => String(o || '').split(' ').map(w => w ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w).join(' ');
// FieldRoutes actuals for one calendar year: per branch/month + per source/month.
function _mktgActuals(year) {
  const rows = state.reportingSubscriptions || [];
  const isExcl = reportingExcludedSources();
  const gate = (r) => {
    const _ist = String(r.initial_status || '').toLowerCase();
    return _ist ? (_ist === 'pending' || _ist === 'completed') : !(!r.initial_service && r.subscription_date_canceled);
  };
  const mk = () => ({ rev: 0, subs: 0, upRev: 0, upsells: 0, bookings: 0, serviced: 0, cancels: 0 });
  const branch = {}, source = {}, srcBranch = {}, total = Array.from({ length: 12 }, mk);
  const branches = new Set(), sources = new Set();
  const OV = (state._mktSrcMode !== 'fr' && typeof attrSourceOverrides === 'function') ? attrSourceOverrides() : null;
  let moved = 0;
  for (const r of rows) {
    const sd = r.sold_date; if (!sd || String(sd).slice(0, 4) !== String(year)) continue;
    const mi = Number(String(sd).slice(5, 7)) - 1; if (!(mi >= 0 && mi < 12)) continue;
    let src = reportingSourceOf(r);
    // Attributed source (per Isaac, Oct 3): where last-touch attribution says
    // this sale's FieldRoutes source is wrong, count it under the channel
    // that earned it — so revenue, closes and CAC by provider are right
    // before anyone fixes FieldRoutes.
    const _ov = OV && r.subscription_id != null ? OV.get(String(r.subscription_id)) : null;
    if (_ov && _ov !== src) { src = _ov; moved++; }
    if (isExcl.has(src)) continue;
    const cls = reportingSourceClass(src); if (cls === 'renewal') continue;
    if (!reportingIsOfficeStaff(r)) continue;
    if (!gate(r)) continue;
    const off = String(r.office_name || 'UNKNOWN').toUpperCase();
    // Provider rows roll CRM sources up (Configurations → Lead sources →
    // Metrics provider); a hidden source still counts in office totals.
    const prov = reportingProviderOf(src);
    branches.add(off); if (prov) sources.add(prov);
    const b = (branch[off] = branch[off] || Array.from({ length: 12 }, mk))[mi];
    const s = prov ? (source[prov] = source[prov] || Array.from({ length: 12 }, mk))[mi] : null;
    const sb = prov ? (srcBranch[prov + '|' + off] = srcBranch[prov + '|' + off] || Array.from({ length: 12 }, mk))[mi] : null;
    const cv = Number(r.subscription_contract_value) || 0;
    for (const x of [b, s, sb, total[mi]].filter(Boolean)) {
      if (cls === 'upsell') { x.upsells++; x.upRev += cv; }
      else { x.subs++; x.rev += cv; }
      x.bookings++;
      if (String(r.initial_status || '').toLowerCase() === 'completed' || r.initial_serviced_date) x.serviced++;
      if (r.subscription_date_canceled) x.cancels++;
    }
  }
  return { branch, source, srcBranch, total, branches: [...branches].sort(), sources: [...sources].sort(), moved, attributed: !!OV };
}
function _mktgBranchList(year) {
  const a = _mktgActuals(year);
  const m = _mktgStore();
  const set = new Set(a.branches);
  Object.keys(m.settings.branchGoals).forEach(b => set.add(b));
  for (const ym in m.spend) for (const ch in m.spend[ym]) Object.keys(m.spend[ym][ch]).forEach(b => set.add(b));
  set.delete('UNKNOWN');
  const byEntity = {}; for (const k of _mktgEntities()) byEntity[k] = [];
  for (const b of [...set].sort()) { const k = _mktgEntityOf(b); (byEntity[k] || (byEntity[k] = [])).push(b); }
  const all = _mktgEntities().flatMap(k => byEntity[k] || []);
  // rpc / rps kept for any caller that still reads them (RIDD's two entities).
  return { byEntity, all, rpc: byEntity.RPC || [], rps: byEntity.RPS || [] };
}
const _mktgSpendBranchMonth = (m, ym, b) => { let t = 0; const M = m.spend[ym] || {}; for (const ch in M) t += Number(M[ch][b]) || 0; return t; };
const _mktgSpendChannelMonth = (m, ym, ch) => { let t = 0; const C = (m.spend[ym] || {})[ch] || {}; for (const b in C) t += Number(C[b]) || 0; return t; };
const _mktgYearSel = () => { if (!state._mktYear) state._mktYear = new Date().getFullYear(); return state._mktYear; };

// ── shared table helpers ──
function _mktgTh(t, right, title) { return el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right === false ? 'text-left' : 'text-left'), style: { color: 'var(--text-muted)' }, title: title || '' }, t); }
function _mktgTd(v, opts = {}) { return el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap ' + (opts.left ? 'text-left' : 'text-left') + (opts.bold ? ' font-bold' : ''), style: opts.style || {} }, v == null ? '—' : v); }
// A month-matrix card: rows × Jan..Dec + Total. `cell(rowKey, mi)` returns a
// number (or null); `total(rowKey)` optional override; fmt formats.
function _mktgMatrixCard(title, note, rows, cell, fmtFn, opts = {}) {
  const totalOf = (rk) => { if (opts.total) return opts.total(rk); let t = 0, any = false; for (let i = 0; i < 12; i++) { const v = cell(rk, i); if (v != null) { t += v; any = true; } } return any ? t : null; };
  // Phones (per Isaac, Sep 2026): ONE month at a time — a dropdown in the
  // card header picks the month (or the year total); the first column and
  // the header row freeze while the rest scrolls. Desktop keeps Jan..Dec.
  const phone = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } })();
  if (state._mktMobileMonth == null) state._mktMobileMonth = new Date().getMonth();
  const mSel = phone ? state._mktMobileMonth : null;          // 0..11 or 'total'
  const monthIdx = phone ? (mSel === 'total' ? [] : [Number(mSel)]) : Array.from({ length: 12 }, (_, i) => i);
  const showTotal = !phone || mSel === 'total';
  const stickyL = (bg) => ({ position: 'sticky', left: 0, background: bg, zIndex: 1, boxShadow: '1px 0 0 var(--border)' });
  const rowEl = (rk) => {
    const isGroup = opts.groupRows && opts.groupRows.has(rk);
    return el('tr', { class: 'border-t border-' + (isGroup ? ' font-bold' : ''), style: isGroup ? { background: 'var(--card-2)' } : {} },
      (() => { const td = _mktgTd(opts.label ? opts.label(rk) : rk, { left: true, bold: true, style: { ...stickyL(isGroup ? 'var(--card-2)' : 'var(--card)'), ...(phone ? {} : { overflow: 'hidden', textOverflow: 'ellipsis' }) } }); td.title = String(opts.label ? opts.label(rk) : rk); return td; })(),
      ...monthIdx.map(i => { const v = cell(rk, i); return _mktgTd(v == null ? '—' : fmtFn(v, rk, i), { style: opts.cellStyle ? (opts.cellStyle(v, rk, i) || {}) : {} }); }),
      showTotal ? _mktgTd((() => { const t = totalOf(rk); return t == null ? '—' : fmtFn(t, rk, 'total'); })(), { bold: true }) : null);
  };
  const monthPick = phone ? el('select', {
    class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', marginLeft: 'auto' },
    onchange: (e) => { state._mktMobileMonth = e.target.value === 'total' ? 'total' : Number(e.target.value); mountApp(); },
  }, ...MKTG_MONTHS.map((mn, i) => el('option', { value: String(i), selected: mSel === i }, mn)), el('option', { value: 'total', selected: mSel === 'total' }, 'Year total')) : null;
  const thL = _mktgTh(opts.firstCol || '', false);
  Object.assign(thL.style, stickyL('var(--card)'), { zIndex: 3 });
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-start gap-4 gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      // Description line under the title retired (per Isaac, Sep 2026) — the definition rides the title as a tooltip.
      el('div', {}, el('h3', { class: 'text-sm font-bold', title: note || '' }, title)),
      opts.headerExtra || null, monthPick),
    // Fixed column grid on desktop (per Isaac, Sep 29): every matrix card
    // uses the same first-column width and equal month columns, so Jan..Dec
    // line up vertically from card to card instead of each table sizing
    // itself to its own content.
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table', style: phone ? {} : { tableLayout: 'fixed', minWidth: '1180px' } },
      phone ? null : el('colgroup', {}, el('col', { style: { width: '260px' } }), ...monthIdx.map(() => el('col', {})), showTotal ? el('col', { style: { width: '110px' } }) : null),
      el('thead', { style: { position: 'sticky', top: 0, zIndex: 2, background: 'var(--card)' } }, el('tr', {}, thL, ...monthIdx.map(i => _mktgTh(MKTG_MONTHS[i])), showTotal ? _mktgTh('Total') : null)),
      el('tbody', {}, ...rows.map(rowEl)))));
}
const _mktgUsd0 = (v) => fmt.usd0(v);
const _mktgPct = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(0) + '%';
const _mktgX = (v) => v == null || !isFinite(v) ? '—' : v.toFixed(2) + 'x';
const _mktgDiv = (a, b) => (b > 0 ? a / b : null);
function _mktgYearBar(sub) {
  const y = _mktgYearSel();
  // Attribution (lead reconciliation) is a tab of its own (per Isaac, Oct 2) — it lived behind a button on the right.
  const SUBS = [['providers', 'Metrics'], ['demand', 'Demand'], ['recon', 'Attribution'], ['pnl', 'P&L'], ['spend', 'Spend entry'], ['projections', 'Projections']];
  const _recon = sub === 'providers' && state._mktProvView === 'recon';
  return el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' },
    el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...SUBS.map(([v, l]) => el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition',
        style: (v === 'recon' ? _recon : (sub === v && !_recon)) ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
        onclick: () => { if (v === 'recon') { state._mktSub = 'providers'; state._mktProvView = 'recon'; } else { state._mktSub = v; state._mktProvView = 'cac'; } mountApp(); },
      }, l))),
    el('div', { class: 'inline-flex items-center gap-1 ' },
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._mktYear = y - 1; mountApp(); } }, '‹'),
      el('span', { class: 'text-sm font-black tabular-nums px-1' }, String(y)),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._mktYear = y + 1; mountApp(); } }, '›')));
}

// One-click QuickBooks connect (admin): a plain navigation to the connect
// function (the session token rides in the query — a redirect can't carry
// a header). Intuit bounces back to /?qbo=connected#marketing.
// (_mktgQboConnectBtn removed — unreferenced; settings audit, Sep 30)
// Result of the connect round-trip (?qbo=connected|error&msg=…).
(() => {
  try {
    const u = new URL(location.href);
    const r = u.searchParams.get('qbo');
    if (!r) return;
    const msg = u.searchParams.get('msg') || '';
    u.searchParams.delete('qbo'); u.searchParams.delete('msg');
    history.replaceState(null, '', u.pathname + (u.search || '') + (u.hash || '#marketing'));
    const show = () => {
      if (typeof toast !== 'function') return setTimeout(show, 300);
      if (r === 'connected') { toast('QuickBooks connected \u2014 pulling ad spend\u2026', 'success'); if (typeof reportingLoadQboSpend === 'function') setTimeout(() => reportingLoadQboSpend(true), 1500); }
      else toast('QuickBooks connect failed: ' + (msg || 'unknown error'), 'error');
    };
    setTimeout(show, 1200);
  } catch (e) { /* noop */ }
})();

// ── P&L: branch × month ──
function _mktgPnl() {
  const y = _mktgYearSel(), m = _mktgStore(), a = _mktgActuals(y), B = _mktgBranchList(y);
  const { rows, groups, members } = _mktgGroupRows(B);
  const sum = (rk, f) => members(rk).reduce((t, b) => t + (f(b) || 0), 0);
  const rev = (rk, i) => sum(rk, b => (a.branch[b] ? a.branch[b][i].rev + a.branch[b][i].upRev : 0));
  // QuickBooks booked marketing per branch per month (Advertising & Marketing → "<Branch> Marketing").
  const SP = state.reportingIsSpend || {};
  const qbo = (b, i) => { const M = SP[_mktgYm(y, i)] || {}; let t = 0; for (const acct in M) { const off = (typeof _mktgQboOffice === 'function') ? _mktgQboOffice(acct) : null; if (off === b) t += Number(M[acct]) || 0; } return t; };
  // Ad spend (per Isaac): LIVE from QuickBooks — the branch "… Marketing"
  // sub-accounts under Advertising & Marketing on the P&L — with the
  // hand-entered allocation only filling months QuickBooks hasn't booked yet.
  const ad  = (rk, i) => sum(rk, b => qbo(b, i));   // QuickBooks only — no allocation fallback (per Isaac)
  const wg  = (rk, i) => sum(rk, b => Number((m.wages[_mktgYm(y, i)] || {})[b]) || 0);
  const inc = (rk, i) => sum(rk, b => Number((m.incentives[_mktgYm(y, i)] || {})[b]) || 0);
  const tot = (rk, i) => ad(rk, i) + wg(rk, i) + inc(rk, i);
  const jobs = (rk, i) => sum(rk, b => (a.branch[b] ? a.branch[b][i].subs + a.branch[b][i].upsells : 0));
  const opts = { groupRows: groups, label: (rk) => groups.has(rk) ? _mktgGroupLabel(rk) : _mktgTC(rk), firstCol: 'Office' };
  const ratioTotal = (num, den) => (rk) => { let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += num(rk, i); d += den(rk, i); } return _mktgDiv(n, d); };
  const T = m.settings.targets;
  const goalStyle = (goal, better) => (v) => v == null ? {} : { color: better(v, goal) ? '#5F6C5B' : '#DC2626', fontWeight: '600' };
  return el('div', { class: 'flex flex-col gap-4' },
    _mktgMatrixCard('New revenue', 'FieldRoutes · office staff · new + upsell · pending/serviced · by sold month', rows, rev, _mktgUsd0, opts),
    // Spend (per Isaac): Ad spend · Wages · Incentives · Total spend in ONE
    // table with a dropdown — default Total spend.
    (() => {
      const qboNote = (state._isSpendSource === 'QuickBooks' ? 'QuickBooks · Advertising & Marketing by branch' + (state._isSpendPulledAt ? ' · pulled ' + new Date(state._isSpendPulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '') : state._isSpendSource === 'none' ? 'QuickBooks feed unavailable — no spend to show' : 'loading QuickBooks spend…') + ' · P&L Advertising & Marketing · unbooked months show $0';
      const SPEND = {
        total: { label: 'Total spend', note: 'ad spend + wages + incentives', cell: tot },
        ad:    { label: 'Ad spend',    note: qboNote,                          cell: ad },
        wages: { label: 'Wages',       note: 'hand-entered (Spend entry)',     cell: wg },
        inc:   { label: 'Incentives',  note: 'hand-entered (Spend entry)',     cell: inc },
      };
      const key = SPEND[state._mktSpendMetric] ? state._mktSpendMetric : 'total';
      const M = SPEND[key];
      const picker = el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ml-auto',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => { state._mktSpendMetric = e.target.value; mountApp(); },
      }, ...Object.entries(SPEND).map(([k, v]) => el('option', { value: k, selected: k === key }, v.label)));
      return _mktgMatrixCard('Spend · ' + M.label, M.note, rows, M.cell, _mktgUsd0, { ...opts, headerExtra: picker });
    })(),
    // (Efficiency moved to Metrics, per Isaac Sep 30 — ROAS / CAC / Cost/Job / Agency CAC % / Wages % are metrics on the By office view there.)
    // (QuickBooks booked vs allocated card dropped — ad spend is QuickBooks-only now.)
  );
}

// ── CAC: monthly rollup ──
// Buttons beside the Office dropdown on Metrics: open Lead providers / Lead
// reconciliation; the active one (or ← CAC) returns to the CAC page.
function _mktgMetricsButtons(inline) {
  const v = state._mktProvView === 'recon' ? 'recon' : 'cac';
  const b = (key, label) => el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold',
    style: v === key ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onclick: () => { state._mktProvView = v === key ? 'cac' : key; mountApp(); } }, label);
  const btns = [v !== 'cac' ? b('cac', '\u2190 Metrics') : null, b('recon', 'Lead reconciliation')];
  return inline ? el('div', { class: 'flex items-center gap-2', style: { marginLeft: '8px' } }, ...btns) : el('div', { class: 'flex items-center gap-2 flex-wrap' }, ...btns);
}
function _mktgCac() {
  const y = _mktgYearSel(), m = _mktgStore(), a = _mktgActuals(y), B = _mktgBranchList(y), s = m.settings;
  // Scope (per Isaac): RIDD · RPC · RPS · or any single office.
  const scope = state._mktCacScope || 'RIDD';
  const scopeBranches = scope === MKTG_ALL ? B.all : (B.byEntity[scope] ? B.byEntity[scope] : [scope]);
  const zero = { rev: 0, upRev: 0, subs: 0, upsells: 0 };
  const cell = (i) => scopeBranches.reduce((t, b) => { const x = (a.branch[b] || [])[i] || zero; return { rev: t.rev + x.rev, upRev: t.upRev + x.upRev, subs: t.subs + x.subs, upsells: t.upsells + x.upsells }; }, { ...zero });
  const rev = (i) => cell(i).rev, upRev = (i) => cell(i).upRev, subs = (i) => cell(i).subs, ups = (i) => cell(i).upsells;
  // Ad spend: QuickBooks booked per branch, falling back to the hand-entered allocation for unbooked months.
  const SP = state.reportingIsSpend || {};
  const qbo = (b, i) => { const M = SP[_mktgYm(y, i)] || {}; let t = 0; for (const acct in M) { const off = (typeof _mktgQboOffice === 'function') ? _mktgQboOffice(acct) : null; if (off === b) t += Number(M[acct]) || 0; } return t; };
  const ad = (i) => scopeBranches.reduce((t, b) => t + qbo(b, i), 0);   // QuickBooks only
  const wg = (i) => scopeBranches.reduce((t, b) => t + (Number((m.wages[_mktgYm(y, i)] || {})[b]) || 0), 0);
  const inc = (i) => scopeBranches.reduce((t, b) => t + (Number((m.incentives[_mktgYm(y, i)] || {})[b]) || 0), 0);
  const tot = (i) => ad(i) + wg(i) + inc(i);
  const proj = (i) => { let t = 0; for (const b of scopeBranches) t += (Number(s.branchGoals[b]) || 0) * (_mktgSeasonal()[i] || 0); return t; };
  const scopeSel = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer font-semibold',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { state._mktCacScope = e.target.value; mountApp(); },
  },
    ...[[MKTG_ALL, CFG.COMPANY_NAME + ' (all)'], ...(_mktgEntities().length > 1 ? _mktgEntities().map(k => [k, companyName(k)]) : [])].map(([v, l]) => el('option', { value: v, selected: scope === v }, l)),
    ...B.all.map(b => el('option', { value: b, selected: scope === b }, _mktgTC(b))));
  const ROWS = [
    ['CAC %', (i) => _mktgDiv(tot(i), rev(i) + upRev(i)), _mktgPct, 'ratio', [tot, (i) => rev(i) + upRev(i)]],
    ['ROAS', (i) => _mktgDiv(rev(i) + upRev(i), ad(i)), _mktgX, 'ratio', [(i) => rev(i) + upRev(i), ad]],
    ['Cost per job', (i) => _mktgDiv(tot(i), subs(i) + ups(i)), _mktgUsd0, 'ratio', [tot, (i) => subs(i) + ups(i)]],
    ['Weighted ACV', (i) => _mktgDiv(rev(i) + upRev(i), subs(i) + ups(i)), _mktgUsd0, 'ratio', [(i) => rev(i) + upRev(i), (i) => subs(i) + ups(i)]],
    ['Projected revenue', proj, _mktgUsd0, 'sum'],
    ['% of projection', (i) => _mktgDiv(rev(i) + upRev(i), proj(i)), _mktgPct, 'ratio', [(i) => rev(i) + upRev(i), proj]],
    ['New subscriptions', subs, fmt.int, 'sum'],
    ['Upsells', ups, fmt.int, 'sum'],
    ['Total new sales', (i) => subs(i) + ups(i), fmt.int, 'sum'],
    ['New revenue', rev, _mktgUsd0, 'sum'],
    ['Upsell revenue', upRev, _mktgUsd0, 'sum'],
    ['Total new revenue', (i) => rev(i) + upRev(i), _mktgUsd0, 'sum'],
    ['Marketing (ad spend)', ad, _mktgUsd0, 'sum'],
    ['Wages', wg, _mktgUsd0, 'sum'],
    ['Incentives', inc, _mktgUsd0, 'sum'],
    ['Total spend', tot, _mktgUsd0, 'sum'],
  ];
  const byKey = Object.fromEntries(ROWS.map(r => [r[0], r]));
  return el('div', { class: 'flex flex-col gap-4' },
    _mktgMatrixCard('CAC · ' + (scope === MKTG_ALL ? CFG.COMPANY_NAME : B.byEntity[scope] ? companyName(scope) : _mktgTC(scope)), 'FieldRoutes revenue & counts · QuickBooks ad spend (allocation for unbooked months) · wages / incentives from Spend entry · projection from Configurations', ROWS.map(r => r[0]),
      (rk, i) => byKey[rk][1](i),
      (v, rk) => byKey[rk][2](v),
      { firstCol: 'Metric', groupRows: new Set(['Total new sales', 'Total new revenue', 'Total spend']),
        headerExtra: el('div', { class: 'ml-auto flex items-center gap-2' }, el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Office'), scopeSel),
        total: (rk) => { const r = byKey[rk]; if (r[3] === 'sum') { let t = 0; for (let i = 0; i < 12; i++) t += r[1](i) || 0; return t; } let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += r[4][0](i) || 0; d += r[4][1](i) || 0; } return _mktgDiv(n, d); } }));
}

// (Rep vs Office cost tab retired Sep 30 — the Sales Rep eligibility math lives on D2D Sales → Pay, src/94-commission-view.js.)
// ── Providers: lead partner × month ──
// vizOnly (per Isaac, Oct 6): Marketing → Demand asks for just the Revenue-by-provider charts, company-wide.
function _mktgProviders(vizOnly) {
  // Metrics matrix (per Isaac, Sep 30): the P&L Efficiency table moved here
  // and folded into this one card. Toggle By provider / By office:
  //   · By provider — rows = lead sources; the Office picker scopes them to
  //     one market (RIDD · entity · office), so each provider can be read
  //     market by market.
  //   · By office — rows = offices (entity + company totals, as on the P&L);
  //     the Provider picker narrows every office to one provider.
  // Ad spend: office rows with no provider picked = QuickBooks (as the P&L);
  // anything provider-level = the Spend entry allocation (provider × office).
  const y = _mktgYearSel(), m = _mktgStore(), a = _mktgActuals(y), T = m.settings.targets, B = _mktgBranchList(y);
  const mode = vizOnly ? 'provider' : (state._mktMetricsBy === 'office' ? 'office' : 'provider');
  // Facebook / Google Ads straight from the platforms (Windsor) — spend,
  // clicks, impressions, platform leads by campaign → office.
  if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(y);
  const AP = (typeof adPlatformIndex === 'function') ? adPlatformIndex(y, B.all) : null;
  // GoHighLevel leads (last paid touch, else own source) — replaces the
  // hand-entered lead counts once the sync has run.
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const GL = (typeof ghlLeadIndex === 'function') ? ghlLeadIndex(y) : null;
  // Rows are FieldRoutes sources (per Isaac, Oct 2): a GoHighLevel label only
  // gets a row when a FieldRoutes source (or a spend channel) carries that
  // exact name — "$39 FB" is a lead label, never a source a job is booked
  // under, so it must map to Facebook (Settings → GoHighLevel sources), not
  // sit in its own $0 row.
  const _frNames = new Set([...a.sources, ...m.channels, ...((state.sources || []).filter(x => x && x.fr_source_id).map(x => x.name).filter(Boolean))].map(x => String(x).trim().toLowerCase()));
  const glProvs = GL ? [...GL.has].filter(([p, n]) => n >= 20 && p !== 'Unknown' && _frNames.has(String(p).trim().toLowerCase()) && reportingSourceClass(p) !== 'renewal').map(([p]) => p) : [];
  // Rows = providers: defaults + CRM sources (rolled up per Configurations →
  // Lead sources → Metrics provider) + ad platforms + GoHighLevel. A source
  // merged into another provider or set to Hide never gets its own row.
  const _pm = reportingSourceProviderMap();
  const _hideRow = (p) => _pm[p] === MKTG_HIDE || (_pm[p] && _pm[p] !== p);
  const channels = [...new Set([...m.channels, ...a.sources.filter(s => reportingSourceClass(s) !== 'renewal'), ...(AP ? [...AP.has] : []), ...glProvs])].filter(p => !_hideRow(p)).sort();
  const scope = vizOnly ? MKTG_ALL : (state._mktCacScope || MKTG_ALL);
  const scopeBranches = scope === MKTG_ALL ? null : (B.byEntity[scope] ? B.byEntity[scope] : [scope]);
  const provF = mode === 'office' && channels.includes(state._mktMetricsProv) ? state._mktMetricsProv : '';
  const G = _mktgGroupRows(B);
  const officeFull = mode === 'office' && !provF;
  const TOTAL = MKTG_ALL;
  // Each row → the providers (null = all) and offices (null = all) it covers.
  const chsOf = (rk) => mode === 'provider' ? (rk === TOTAL ? channels : [rk]) : (provF ? [provF] : null);
  const bsOf = (rk) => mode === 'provider' ? scopeBranches : G.members(rk);
  // Company row by office also counts what has no office (company-wide
  // campaigns, leads whose ZIP isn't a FieldRoutes office).
  const bsWide = (rk) => mode === 'office' && rk === MKTG_ALL ? null : bsOf(rk);
  const zero = { rev: 0, upRev: 0, bookings: 0 };
  const act = (rk, i) => {
    const chs = chsOf(rk), bs = bsOf(rk), t = { rev: 0, upRev: 0, bookings: 0 };
    const add = (x) => { if (!x) return; t.rev += x.rev; t.upRev += x.upRev; t.bookings += x.bookings; };
    if (!chs) for (const b of bs) add((a.branch[b] || [])[i] || zero);
    else if (!bs) for (const ch of chs) add((a.source[ch] || [])[i] || zero);
    else for (const ch of chs) for (const b of bs) add((a.srcBranch[ch + '|' + b] || [])[i] || zero);
    return t;
  };
  const SP = state.reportingIsSpend || {};
  const qbo = (b, i) => { const M = SP[_mktgYm(y, i)] || {}; let t = 0; for (const acct in M) { const off = (typeof _mktgQboOffice === 'function') ? _mktgQboOffice(acct) : null; if (off === b) t += Number(M[acct]) || 0; } return t; };
  const rev = (rk, i) => { const x = act(rk, i); return x.rev + x.upRev; };
  const book = (rk, i) => act(rk, i).bookings;
  const sp = (rk, i) => {
    const chs = chsOf(rk), bs = bsOf(rk), ym = _mktgYm(y, i);
    if (!chs) return bs.reduce((t, b) => t + qbo(b, i), 0);
    let t = 0;
    for (const ch of chs) { if (AP && AP.has.has(ch)) { t += AP.cell([ch], bsWide(rk), i, 'spend'); continue; } if (!bs) { t += _mktgSpendChannelMonth(m, ym, ch); continue; } const C = (m.spend[ym] || {})[ch] || {}; for (const b of bs) t += Number(C[b]) || 0; }
    return t;
  };
  const wg = (rk, i) => G.members(rk).reduce((t, b) => t + (Number((m.wages[_mktgYm(y, i)] || {})[b]) || 0), 0);
  const inc = (rk, i) => G.members(rk).reduce((t, b) => t + (Number((m.incentives[_mktgYm(y, i)] || {})[b]) || 0), 0);
  const tot = (rk, i) => sp(rk, i) + wg(rk, i) + inc(rk, i);
  const leadsOk = !!GL || (mode === 'provider' && !scopeBranches);   // hand-entered leads are per provider only; GoHighLevel leads carry an office (ZIP)
  const leads = GL ? (rk, i) => GL.cell(chsOf(rk), bsWide(rk), i)
    : (rk, i) => chsOf(rk).reduce((t, ch) => t + (Number((m.leads[_mktgYm(y, i)] || {})[ch]) || 0), 0);
  const leadNote = GL ? 'GoHighLevel · credit = last paid touch for the person, else the lead’s own source · office from the lead’s ZIP' : 'hand-entered (Spend entry)';
  const ratioTotal = (num, den) => (rk) => { let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += num(rk, i); d += den(rk, i); } return _mktgDiv(n, d); };
  const gs = (goal, better) => (v) => v == null ? {} : { color: better(v, goal) ? '#5F6C5B' : '#DC2626', fontWeight: '600' };
  const rows = mode === 'provider' ? [...channels, TOTAL] : G.rows;
  const leafRows = mode === 'provider' ? channels : B.all;
  const groups = mode === 'provider' ? new Set([TOTAL]) : G.groups;
  const opts = { groupRows: groups, firstCol: mode === 'provider' ? 'Provider' : 'Office',
    label: (rk) => groups.has(rk) ? _mktgGroupLabel(rk) : (mode === 'office' ? _mktgTC(rk) : rk) };
  const wt = (num) => ({ ...opts, groupRows: new Set(), total: (rk) => { let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += num(rk, i); d += num(TOTAL, i); } return _mktgDiv(n, d); } });
  const spNote = officeFull ? 'QuickBooks · Advertising & Marketing by branch' : (AP ? [...AP.has].join(' / ') + ' from the ad platforms (Windsor, campaign → office) · other providers from Spend entry' : 'Spend entry allocation (provider × office)');
  const pf = (f) => (rk, i) => AP ? AP.cell(chsOf(rk), bsWide(rk), i, f) : 0;
  const pSp = pf('spend'), pLd = pf('leads'), pCl = pf('clicks'), pIm = pf('impr');
  const apNote = ' · Facebook + Google Ads as the platforms report them (Windsor)';
  const METRICS = [
    { key: 'rev',    group: 'Volume',     label: 'Revenue',        note: 'FieldRoutes · office staff · new + upsell · pending/serviced · by sold month', rows, cell: rev, fmt: _mktgUsd0, opts },
    { key: 'book',   group: 'Volume',     label: 'Jobs',           note: 'FieldRoutes · subscriptions sold (new + upsell · pending/serviced)', rows, cell: book, fmt: fmt.int, opts },
    { key: 'spend',  group: 'Volume',     label: 'Ad spend',       note: spNote, rows, cell: sp, fmt: _mktgUsd0, opts },
    officeFull ? { key: 'wages', group: 'Volume', label: 'Wages',      note: 'hand-entered (Spend entry)', rows, cell: wg, fmt: _mktgUsd0, opts } : null,
    officeFull ? { key: 'inc',   group: 'Volume', label: 'Incentives', note: 'hand-entered (Spend entry)', rows, cell: inc, fmt: _mktgUsd0, opts } : null,
    officeFull ? { key: 'tot',   group: 'Volume', label: 'Total spend', note: 'ad spend + wages + incentives', rows, cell: tot, fmt: _mktgUsd0, opts } : null,
    leadsOk ? { key: 'leads', group: 'Volume', label: 'Leads', note: leadNote, rows, cell: leads, fmt: fmt.int, opts } : null,
    leadsOk ? { key: 'l2j', group: 'Efficiency', label: 'Lead → job %', note: 'FieldRoutes jobs ÷ leads · ' + leadNote, rows, cell: (rk, i) => _mktgDiv(book(rk, i), leads(rk, i)), fmt: _mktgPct, opts: { ...opts, total: ratioTotal(book, leads) } } : null,
    { key: 'roas',   group: 'Efficiency', label: 'ROAS',           note: 'revenue ÷ ad spend · goal ' + T.roas + '+', rows, cell: (rk, i) => _mktgDiv(rev(rk, i), sp(rk, i)), fmt: _mktgX, opts: { ...opts, total: ratioTotal(rev, sp), cellStyle: gs(T.roas, (v, g) => v >= g) } },
    officeFull ? { key: 'cac', group: 'Efficiency', label: 'CAC', note: 'total spend ÷ revenue', rows, cell: (rk, i) => _mktgDiv(tot(rk, i), rev(rk, i)), fmt: _mktgPct, opts: { ...opts, total: ratioTotal(tot, rev) } } : null,
    officeFull ? { key: 'cpj', group: 'Efficiency', label: 'Cost/Job', note: 'total spend ÷ jobs', rows, cell: (rk, i) => _mktgDiv(tot(rk, i), book(rk, i)), fmt: _mktgUsd0, opts: { ...opts, total: ratioTotal(tot, book) } } : null,
    { key: 'spj',    group: 'Efficiency', label: 'Agency Spend / Job', note: 'ad spend ÷ jobs · goal under ' + fmt.usd0(T.spendPerJob), rows, cell: (rk, i) => _mktgDiv(sp(rk, i), book(rk, i)), fmt: _mktgUsd0, opts: { ...opts, total: ratioTotal(sp, book), cellStyle: gs(T.spendPerJob, (v, g) => v <= g) } },
    { key: 'adcac',  group: 'Efficiency', label: 'Agency CAC %',   note: 'ad spend ÷ revenue · goal ' + Math.round(T.adSpendCac * 100) + '%', rows, cell: (rk, i) => _mktgDiv(sp(rk, i), rev(rk, i)), fmt: _mktgPct, opts: { ...opts, total: ratioTotal(sp, rev), cellStyle: gs(T.adSpendCac, (v, g) => v <= g) } },
    officeFull ? { key: 'wgcac', group: 'Efficiency', label: 'Wages %', note: 'wages ÷ revenue · goal ' + Math.round(T.wagesCac * 100) + '%', rows, cell: (rk, i) => _mktgDiv(wg(rk, i), rev(rk, i)), fmt: _mktgPct, opts: { ...opts, total: ratioTotal(wg, rev), cellStyle: gs(T.wagesCac, (v, g) => v <= g) } } : null,
    AP ? { key: 'pleads', group: 'Ad platforms', label: 'Platform leads', note: 'Meta leads + Google conversions' + apNote, rows, cell: pLd, fmt: fmt.int, opts } : null,
    AP ? { key: 'pcpl', group: 'Ad platforms', label: 'Cost per platform lead', note: 'platform spend ÷ platform leads' + apNote, rows, cell: (rk, i) => _mktgDiv(pSp(rk, i), pLd(rk, i)), fmt: _mktgUsd0, opts: { ...opts, total: ratioTotal(pSp, pLd) } } : null,
    AP ? { key: 'clicks', group: 'Ad platforms', label: 'Clicks', note: 'ad clicks' + apNote, rows, cell: pCl, fmt: fmt.int, opts } : null,
    AP ? { key: 'cpc', group: 'Ad platforms', label: 'Cost per click', note: 'platform spend ÷ clicks' + apNote, rows, cell: (rk, i) => _mktgDiv(pSp(rk, i), pCl(rk, i)), fmt: (v) => '$' + (Math.round(v * 100) / 100).toFixed(2), opts: { ...opts, total: ratioTotal(pSp, pCl) } } : null,
    AP ? { key: 'ctr', group: 'Ad platforms', label: 'CTR', note: 'clicks ÷ impressions' + apNote, rows, cell: (rk, i) => _mktgDiv(pCl(rk, i), pIm(rk, i)), fmt: (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(2) + '%', opts: { ...opts, total: ratioTotal(pCl, pIm) } } : null,
    AP ? { key: 'plsale', group: 'Ad platforms', label: 'Platform lead → job %', note: 'FieldRoutes jobs ÷ platform leads' + apNote, rows, cell: (rk, i) => _mktgDiv(book(rk, i), pLd(rk, i)), fmt: _mktgPct, opts: { ...opts, total: ratioTotal(book, pLd) } } : null,
    leadsOk ? { key: 'cpl', group: 'Efficiency', label: 'Cost per lead', note: 'ad spend ÷ leads · ' + leadNote, rows, cell: (rk, i) => _mktgDiv(sp(rk, i), leads(rk, i)), fmt: _mktgUsd0, opts: { ...opts, total: ratioTotal(sp, leads) } } : null,
    { key: 'revW',   group: 'Mix',        label: 'Revenue weight', note: 'share of the month’s revenue', rows: leafRows, cell: (rk, i) => _mktgDiv(rev(rk, i), rev(TOTAL, i)), fmt: _mktgPct, opts: wt(rev) },
    { key: 'spendW', group: 'Mix',        label: 'Spend weight',   note: 'share of the month’s ad spend', rows: leafRows, cell: (rk, i) => _mktgDiv(sp(rk, i), sp(TOTAL, i)), fmt: _mktgPct, opts: wt(sp) },
  ].filter(Boolean);
  // Revenue is the default table (per Isaac); a metric that doesn't exist in
  // the current view (e.g. Wages by provider) falls back to it.
  const cur = METRICS.find(x => x.key === state._mktProvMetric) || METRICS[0];
  const sel = (val, options, on, extra) => el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: Object.assign({ borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, extra || {}), onchange: (e) => on(e.target.value) }, ...options);
  const groupsL = [...new Set(METRICS.map(x => x.group))];
  const picker = sel(cur.key, groupsL.map(g => el('optgroup', { label: g }, ...METRICS.filter(x => x.group === g).map(x => el('option', { value: x.key, selected: x.key === cur.key }, x.label)))), (v) => { state._mktProvMetric = v; mountApp(); });
  const toggle = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...[['provider', 'By provider'], ['office', 'By office']].map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold',
      style: mode === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)', background: 'var(--card)' },
      onclick: () => { state._mktMetricsBy = v; mountApp(); } }, l)));
  const scopeOpts = [[MKTG_ALL, CFG.COMPANY_NAME + ' (all offices)'], ...(_mktgEntities().length > 1 ? _mktgEntities().map(k => [k, companyName(k)]) : []), ...B.all.map(b => [b, _mktgTC(b)])];
  const filter = mode === 'provider'
    ? sel(scope, scopeOpts.map(([v, l]) => el('option', { value: v, selected: scope === v }, l)), (v) => { state._mktCacScope = v; mountApp(); })
    : sel(provF, [el('option', { value: '', selected: !provF }, 'All providers'), ...channels.map(c => el('option', { value: c, selected: provF === c }, c))], (v) => { state._mktMetricsProv = v || null; mountApp(); });
  const scopeLbl = mode === 'provider' ? (scope === MKTG_ALL ? CFG.COMPANY_NAME : B.byEntity[scope] ? companyName(scope) : _mktgTC(scope)) : (provF || 'all providers');
  const srcMode = state._mktSrcMode === 'fr' ? 'fr' : 'attr';
  const srcToggle = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' },
    title: srcMode === 'attr' ? (a.attributed ? a.moved.toLocaleString() + ' sales this year are counted under the channel last-touch attribution gives them instead of the source typed in FieldRoutes.' : 'Lead feeds still loading — showing FieldRoutes sources for now.') : 'Sales counted under the source typed in FieldRoutes.' },
    ...[['attr', 'Attributed source' + (srcMode === 'attr' && a.attributed ? ' · ' + a.moved.toLocaleString() + ' moved' : '')], ['fr', 'FieldRoutes source']].map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold',
      style: srcMode === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)', background: 'var(--card)' },
      onclick: () => { state._mktSrcMode = v; mountApp(); } }, l)));
  const header = el('div', { class: 'ml-auto flex items-center gap-2 flex-wrap' }, srcToggle, toggle,
    el('span', { class: 'text-[10px] text-muted-' }, mode === 'provider' ? 'Office' : 'Provider'), filter,
    el('span', { class: 'text-[10px] text-muted-' }, 'Metric'), picker);
  const GOAL = { spj: { v: T.spendPerJob, better: 'low' }, roas: { v: T.roas, better: 'high' }, adcac: { v: T.adSpendCac, better: 'low' }, wgcac: { v: T.wagesCac, better: 'low' } };
  const lowerIsBetter = ['cpl', 'spj', 'adcac', 'cac', 'cpj', 'wgcac', 'pcpl', 'cpc'].includes(cur.key);
  const rankBy = { rev, book, spend: sp, wages: wg, inc, tot, leads, cpl: sp, spj: sp, roas: sp, adcac: sp, cac: tot, cpj: tot, wgcac: wg, revW: rev, spendW: sp, pleads: pLd, pcpl: pSp, clicks: pCl, cpc: pSp, ctr: pIm, plsale: pLd, l2j: leads }[cur.key] || rev;
  if (vizOnly) { const R = METRICS.find(x => x.key === 'rev') || METRICS[0]; return _mktgProvidersViz(R, { y, channels: leafRows, rankBy: rev, goal: null, lowerIsBetter: false, noun: 'provider', label: opts.label }); }
  // (The two charts under this table moved to Marketing → Demand as Revenue by provider, per Isaac, Oct 6.)
  return el('div', { class: 'flex flex-col gap-4' },
    _mktgMatrixCard(cur.label + ' · by ' + mode + ' · ' + scopeLbl, cur.note, cur.rows, cur.cell, cur.fmt, { ...cur.opts, headerExtra: header }),
    (typeof adCampaignsCard === 'function') ? adCampaignsCard(y, B.all) : null);
}

// ── Providers visuals (per Isaac, Sep 2026): two charts under the matrix,
// both driven by the metric picker. (1) Year-to-date ranking — one bar per
// provider, sorted best → worst, coloured against the goal when the metric
// has one, the goal drawn as a line. (2) Monthly trend — the top providers
// as lines (ranked by the volume behind the metric), goal dashed; click a
// bar in (1) to spotlight that provider in (2). ──
function _mktgProvidersViz(cur, o) {
  const { y, channels, rankBy, goal, lowerIsBetter } = o;
  const now = new Date();
  const lastMonth = (y === now.getFullYear()) ? now.getMonth() : (y < now.getFullYear() ? 11 : -1);
  const total = (ch) => { if (cur.opts && cur.opts.total) return cur.opts.total(ch); let t = 0, any = false; for (let i = 0; i < 12; i++) { const v = cur.cell(ch, i); if (v != null && isFinite(v)) { t += v; any = true; } } return any ? t : null; };
  const rankVal = (ch) => { let t = 0; for (let i = 0; i < 12; i++) t += rankBy(ch, i) || 0; return t; };
  const isRatio = !['rev', 'spend', 'leads', 'book', 'wages', 'inc', 'tot', 'pleads', 'clicks'].includes(cur.key);
  const isMix = cur.key === 'revW' || cur.key === 'spendW';
  const ytd = channels.map(ch => ({ ch, v: total(ch), rank: rankVal(ch) })).filter(x => x.v != null && isFinite(x.v) && (isRatio ? x.v > 0 || x.rank > 0 : x.v > 0));
  ytd.sort((a, b) => lowerIsBetter ? a.v - b.v : b.v - a.v);
  const focus = state._mktProvFocus && channels.includes(state._mktProvFocus) ? state._mktProvFocus : null;
  const isDark = state.theme === 'dark';
  const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
  const OK = '#5F6C5B', BAD = '#DC2626', INK = isDark ? '#E6E6DC' : '#323230', ACC = '#DF643A';
  const passes = (v) => !goal ? null : (goal.better === 'low' ? v <= goal.v : v >= goal.v);
  const fmtV = cur.fmt;
  const monthsShown = lastMonth < 0 ? [] : MKTG_MONTHS.slice(0, lastMonth + 1);
  // Fixed colour order by YTD rank of the volume behind the metric (colour
  // follows the provider for the rest of this render, never its position).
  const topN = [...channels].map(ch => ({ ch, r: rankVal(ch) })).filter(x => x.r > 0).sort((a, b) => b.r - a.r).slice(0, 6).map(x => x.ch);
  // Six brand hues in a fixed order (validated: adjacent pairs stay apart under CVD; the legend + table carry identity too).
  const PROV_PALETTE = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#6B2A12', '#E8A06B'];
  const colorOf = {}; topN.forEach((ch, i) => { colorOf[ch] = PROV_PALETTE[i % PROV_PALETTE.length]; });
  if (focus && !colorOf[focus]) colorOf[focus] = ACC;
  const lineChans = focus && !topN.includes(focus) ? [...topN, focus] : topN;

  const idA = 'mktg-prov-rank-' + cur.key, idB = 'mktg-prov-trend-' + cur.key;
  const hA = Math.max(160, 26 * ytd.length + 40);
  const rankCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, cur.label + ' by ' + (o.noun || 'provider') + ' \u00b7 ' + y + (lastMonth >= 0 && lastMonth < 11 ? ' YTD' : '')),
        el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, (lowerIsBetter ? 'lower is better' : 'higher is better') + (goal ? ' \u00b7 goal ' + fmtV(goal.v) + ' (line) \u00b7 green meets it, red misses' : '') + ' \u00b7 click a bar to spotlight it in the trend')),
      focus ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._mktProvFocus = null; mountApp(); } }, 'Clear spotlight \u00b7 ' + focus) : null),
    ytd.length ? el('div', { class: 'p-3', style: { height: hA + 'px' } }, el('canvas', { id: idA }))
      : el('div', { class: 'px-4 py-8 text-center text-[11px]', style: { color: 'var(--text-muted)' } }, 'Nothing to chart yet for ' + cur.label.toLowerCase() + ' \u2014 ' + (isRatio ? 'enter ad spend on the Spend entry tab.' : 'no data in ' + y + '.')));
  const trendCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, cur.label + ' by month \u00b7 ' + (focus ? focus + ' vs the top ' + (o.noun || 'provider') + 's' : 'top ' + lineChans.length + ' ' + (o.noun || 'provider') + 's')),
      el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'ranked by ' + ({ rev: 'revenue', spend: 'ad spend', leads: 'leads', book: 'jobs', wages: 'wages', inc: 'incentives', tot: 'total spend', cpl: 'ad spend', spj: 'ad spend', roas: 'ad spend', adcac: 'ad spend', cac: 'total spend', cpj: 'total spend', wgcac: 'wages', revW: 'revenue', spendW: 'ad spend' }[cur.key] || 'revenue') + ' in ' + y + (goal ? ' \u00b7 goal dashed' : '') + (isRatio ? ' \u00b7 a month with no spend or no result is left blank' : ''))),
    lineChans.length && monthsShown.length ? el('div', { class: 'p-3', style: { height: '280px' } }, el('canvas', { id: idB }))
      : el('div', { class: 'px-4 py-8 text-center text-[11px]', style: { color: 'var(--text-muted)' } }, 'No months to chart yet.'));

  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    // (1) ranking bars
    const cA = document.getElementById(idA);
    if (cA && ytd.length) {
      if (_chartInstances[idA]) { _chartInstances[idA].destroy(); delete _chartInstances[idA]; }
      const labels = ytd.map(x => x.ch);
      const colors = ytd.map(x => { const p = passes(x.v); return p == null ? (focus === x.ch ? ACC : INK) : (p ? OK : BAD); });
      const goalLine = { id: 'goalLine', afterDatasetsDraw(chart) {
        const { ctx, scales: { x }, chartArea } = chart;
        if (goal) { const gx = x.getPixelForValue(goal.v); if (isFinite(gx) && gx >= chartArea.left && gx <= chartArea.right) { ctx.save(); ctx.strokeStyle = txt; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(gx, chartArea.top); ctx.lineTo(gx, chartArea.bottom); ctx.stroke(); ctx.restore(); } }
        // value at the end of each bar
        const meta = chart.getDatasetMeta(0); ctx.save(); ctx.fillStyle = txt; ctx.font = '600 10px "IBM Plex Mono", ui-monospace, monospace'; ctx.textBaseline = 'middle';
        meta.data.forEach((bar, i) => { const v = ytd[i].v; ctx.textAlign = 'left'; ctx.fillText(fmtV(v), bar.x + 6, bar.y); });
        ctx.restore();
      } };
      _chartInstances[idA] = new Chart(cA.getContext('2d'), {
        type: 'bar',
        data: { labels, datasets: [{ label: cur.label, data: ytd.map(x => x.v), backgroundColor: colors, borderWidth: 0, borderRadius: 3, barThickness: 14, maxBarThickness: 16 }] },
        options: { indexAxis: 'y', responsive: true, maintainAspectRatio: false, layout: { padding: { right: 8 } },
          onClick: (evt, els) => { if (!els || !els.length) return; const ch = labels[els[0].index]; state._mktProvFocus = state._mktProvFocus === ch ? null : ch; mountApp(); },
          plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmtV(c.parsed.x) + (goal ? (passes(c.parsed.x) ? ' \u00b7 meets goal' : ' \u00b7 misses goal') : '') } } },
          scales: { x: { beginAtZero: true, suggestedMax: Math.max(...ytd.map(x => x.v), goal ? goal.v : 0) * 1.22, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => fmtV(v) } },
                    y: { grid: { display: false }, ticks: { color: txt, font: { size: 11, weight: (ctx) => labels[ctx.index] === focus ? '700' : '400' } } } } },
        plugins: [goalLine],
      });
    }
    // (2) monthly trend lines
    const cB = document.getElementById(idB);
    if (cB && lineChans.length && monthsShown.length) {
      if (_chartInstances[idB]) { _chartInstances[idB].destroy(); delete _chartInstances[idB]; }
      const ds = lineChans.map(ch => {
        const on = !focus || focus === ch;
        const col = colorOf[ch] || INK;
        return { label: ch, data: monthsShown.map((_, i) => { const v = cur.cell(ch, i); return v == null || !isFinite(v) || (!isRatio && v === 0 && rankBy(ch, i) === 0) ? null : v; }),
          borderColor: on ? col : (isDark ? 'rgba(230,230,220,.18)' : 'rgba(50,50,48,.16)'), backgroundColor: col, borderWidth: focus === ch ? 3 : 2, tension: 0.3, pointRadius: on ? 3 : 0, pointHoverRadius: 5, spanGaps: false, order: focus === ch ? 0 : 1 };
      });
      if (goal) ds.push({ label: 'Goal', data: monthsShown.map(() => goal.v), borderColor: txt, backgroundColor: txt, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, tension: 0, order: 2 });
      _chartInstances[idB] = new Chart(cB.getContext('2d'), {
        type: 'line',
        data: { labels: monthsShown, datasets: ds },
        options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
          plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 }, usePointStyle: true } },
            tooltip: { callbacks: { label: (c) => ' ' + c.dataset.label + ': ' + (c.parsed.y == null ? '\u2014' : fmtV(c.parsed.y)) } } },
          scales: { x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 } } },
                    y: { beginAtZero: !isRatio || isMix, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => fmtV(v) } } } },
      });
    }
  }, 50);
  return el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' }, rankCard, trendCard);
}

// ── Spend entry: the controller allocation (branch × channel) for one month ──
function _mktgSpendEntry() {
  const y = _mktgYearSel(), m = _mktgStore(), B = _mktgBranchList(y);
  if (state._mktEntryMonth == null || !String(state._mktEntryMonth).startsWith(y + '-')) {
    const now = new Date(); state._mktEntryMonth = (now.getFullYear() === y) ? _mktgYm(y, now.getMonth()) : _mktgYm(y, 0);
  }
  const ym = state._mktEntryMonth;
  const channels = m.channels;
  const inp = (val, onSave, opts = {}) => el('input', {
    type: 'number', step: '0.01', min: '0', placeholder: '0', value: val != null && val !== 0 ? String(val) : '',
    class: 'rounded-lg border px-2.5 py-1 text-[11px] text-left', style: { width: opts.w || '96px', borderColor: 'var(--border-2)' },
    onchange: (e) => { const v = parseFloat(e.target.value); onSave(isNaN(v) ? 0 : Math.round(v * 100) / 100); _mktgSave(); mountApp(); },
  });
  const cellSet = (ch, b, v) => { m.spend[ym] = m.spend[ym] || {}; m.spend[ym][ch] = m.spend[ym][ch] || {}; if (v > 0) m.spend[ym][ch][b] = v; else delete m.spend[ym][ch][b]; };
  const monthSel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onchange: (e) => { state._mktEntryMonth = e.target.value; mountApp(); } },
    ...MKTG_MONTHS.map((mn, i) => el('option', { value: _mktgYm(y, i), selected: _mktgYm(y, i) === ym }, mn + ' ' + y)));
  const addChannel = el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' },
    onclick: () => { const n = prompt('New channel / lead partner name (must match the FieldRoutes source name to join revenue):'); if (n && n.trim() && !m.channels.includes(n.trim())) { m.channels.push(n.trim()); _mktgSave(); mountApp(); } } }, '+ Channel');
  const addBranch = el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' },
    onclick: () => { const n = prompt('Branch name (as it appears in FieldRoutes, e.g. TAMPA):'); if (n && n.trim()) { const k = n.trim().toUpperCase(); m.settings.branchGoals[k] = m.settings.branchGoals[k] || 0; _mktgSave(); mountApp(); } } }, '+ Branch');
  // Copy last month's allocation as a starting point.
  const copyPrev = el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' },
    title: 'Copy the previous month’s allocation, wages, incentives and leads into this month (only fills blanks)',
    onclick: () => {
      const [yy, mm] = ym.split('-').map(Number); const prev = mm === 1 ? _mktgYm(yy - 1, 11) : _mktgYm(yy, mm - 2);
      let n = 0;
      for (const ch in (m.spend[prev] || {})) for (const b in m.spend[prev][ch]) { if (!((m.spend[ym] || {})[ch] || {})[b]) { cellSet(ch, b, Number(m.spend[prev][ch][b]) || 0); n++; } }
      for (const k of ['wages', 'incentives', 'leads']) { m[k][ym] = m[k][ym] || {}; for (const b in (m[k][prev] || {})) if (m[k][ym][b] == null) { m[k][ym][b] = m[k][prev][b]; n++; } }
      _mktgSave(); toast('Copied ' + n + ' value' + (n === 1 ? '' : 's') + ' from ' + reportingMonthLbl(prev), 'success'); mountApp();
    } }, 'Copy last month');
  // Export the controller sheet (branch × channel + total) as CSV.
  const exportBtn = el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: () => {
      const esc = (v) => { const s2 = v == null ? '' : String(v); return /[",\n]/.test(s2) ? '"' + s2.replace(/"/g, '""') + '"' : s2; };
      const lines = [['Branch', ...channels, 'Total', 'Wages', 'Incentives'].map(esc).join(',')];
      B.all.forEach(b => lines.push([_mktgTC(b), ...channels.map(ch => (((m.spend[ym] || {})[ch] || {})[b] || 0).toFixed(2)), _mktgSpendBranchMonth(m, ym, b).toFixed(2), (Number((m.wages[ym] || {})[b]) || 0).toFixed(2), (Number((m.incentives[ym] || {})[b]) || 0).toFixed(2)].map(esc).join(',')));
      lines.push(['Total', ...channels.map(ch => _mktgSpendChannelMonth(m, ym, ch).toFixed(2)), B.all.reduce((t, b) => t + _mktgSpendBranchMonth(m, ym, b), 0).toFixed(2), '', ''].map(esc).join(','));
      const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
      const a2 = document.createElement('a'); a2.href = URL.createObjectURL(blob); a2.download = 'RIDD-marketing-spend-' + ym + '.csv'; a2.click();
    } }, '⬇ Controller sheet (.csv)');
  const th = (t, right) => _mktgTh(t, right !== false);
  const matrix = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-center gap-4 gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Ad spend allocation · ' + reportingMonthLbl(ym)),
        el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, 'branch × channel · this is the sheet the controller books from · saved for every admin')),
      el('div', { class: 'flex items-center gap-2 flex-wrap' }, monthSel, copyPrev, addChannel, addBranch, exportBtn)),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table' },
      el('thead', {}, el('tr', {}, th('Office', false), ...channels.map(ch => th(ch)), th('Total'), th('Wages'), th('Incentives'))),
      el('tbody', {},
        ...B.all.map(b => el('tr', { class: 'border-t border-' },
          _mktgTd(_mktgTC(b), { left: true, bold: true, style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, boxShadow: '1px 0 0 var(--border)' } }),
          ...channels.map(ch => el('td', { class: 'px-1 py-1 text-left' }, inp(((m.spend[ym] || {})[ch] || {})[b], (v) => cellSet(ch, b, v), { w: '88px' }))),
          _mktgTd(fmt.usd0(_mktgSpendBranchMonth(m, ym, b)), { bold: true }),
          el('td', { class: 'px-1 py-1 text-left' }, inp((m.wages[ym] || {})[b], (v) => { m.wages[ym] = m.wages[ym] || {}; if (v > 0) m.wages[ym][b] = v; else delete m.wages[ym][b]; })),
          el('td', { class: 'px-1 py-1 text-left' }, inp((m.incentives[ym] || {})[b], (v) => { m.incentives[ym] = m.incentives[ym] || {}; if (v > 0) m.incentives[ym][b] = v; else delete m.incentives[ym][b]; })))),
        el('tr', { class: 'border-t font-bold', style: { background: 'var(--card-2)' } },
          _mktgTd('Total', { left: true, bold: true, style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }),
          ...channels.map(ch => _mktgTd(fmt.usd0(_mktgSpendChannelMonth(m, ym, ch)))),
          _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + _mktgSpendBranchMonth(m, ym, b), 0)), { bold: true }),
          _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + (Number((m.wages[ym] || {})[b]) || 0), 0))),
          _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + (Number((m.incentives[ym] || {})[b]) || 0), 0))))))));
  // Leads by channel for the month (GHL prefill when it has the source).
  const GHL = ((state.reportingGhlLeads && state.reportingGhlLeads.bySourceMonth) || {})[ym] || {};
  const ghlFor = (ch) => { const k = Object.keys(GHL).find(s2 => String(s2).trim().toLowerCase() === ch.toLowerCase()); return k ? Number(GHL[k]) || 0 : null; };
  const leadsCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, 'Leads · ' + reportingMonthLbl(ym)),
      el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, 'hand-entered per channel · GoHighLevel count shown as a hint where it has the source')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table' },
      el('thead', {}, el('tr', {}, th('Channel', false), th('Leads'), th('GHL says'))),
      el('tbody', {}, ...channels.map(ch => el('tr', { class: 'border-t border-' },
        _mktgTd(ch, { left: true, bold: true }),
        el('td', { class: 'px-1 py-1 text-left' }, inp((m.leads[ym] || {})[ch], (v) => { m.leads[ym] = m.leads[ym] || {}; if (v > 0) m.leads[ym][ch] = v; else delete m.leads[ym][ch]; })),
        _mktgTd(ghlFor(ch) == null ? '—' : fmt.int(ghlFor(ch)), { style: { color: 'var(--text-muted)' } })))))));
  return el('div', { class: 'flex flex-col gap-4' }, (typeof mktgSpendUploadCard === 'function') ? mktgSpendUploadCard(B, y) : null, matrix, leadsCard);
}

// ── Projections ──
function _mktgProjections() {
  const y = _mktgYearSel(), m = _mktgStore(), s = m.settings, B = _mktgBranchList(y), a = _mktgActuals(y);
  const { rows, groups, members } = _mktgGroupRows(B);
  const goal = (b) => Number(s.branchGoals[b]) || 0;
  const pRev = (rk, i) => members(rk).reduce((t, b) => t + goal(b) * (_mktgSeasonal()[i] || 0), 0);
  const pAd  = (rk, i) => pRev(rk, i) * s.adSpendPct;
  const pWg  = (rk, i) => pRev(rk, i) * s.wagesPct;
  const pInc = (rk, i) => pRev(rk, i) * s.incentivesPct;
  const aRev = (rk, i) => members(rk).reduce((t, b) => t + (a.branch[b] ? a.branch[b][i].rev + a.branch[b][i].upRev : 0), 0);
  const opts = { groupRows: groups, label: (rk) => groups.has(rk) ? _mktgGroupLabel(rk) : _mktgTC(rk), firstCol: 'Office' };
  const num = (v, onSave, opts2 = {}) => el('input', { type: 'number', step: opts2.step || '1', value: v == null ? '' : String(v), class: 'rounded-lg border px-2.5 py-1 text-[11px] text-left', style: { width: opts2.w || '110px', borderColor: 'var(--border-2)' },
    onchange: (e) => { const x = parseFloat(e.target.value); onSave(isNaN(x) ? 0 : x); _mktgSave(); mountApp(); } });
  const goalsCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, 'Branch goals · ' + y),
      el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, 'revenue goal per branch · ad spend ' + Math.round(s.adSpendPct * 100) + '% · wages ' + Math.round(s.wagesPct * 100) + '% · incentives ' + Math.round(s.incentivesPct * 100) + '% (rates in Configurations)')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table' },
      el('thead', {}, el('tr', {}, _mktgTh('Office', false), _mktgTh('Revenue goal'), _mktgTh('Ad spend'), _mktgTh('Wages'), _mktgTh('Incentives'), _mktgTh('Total spend'), _mktgTh('Attrition %', true, 'Projected annual attrition — sets replacement revenue'), _mktgTh('YTD actual'), _mktgTh('% of goal'))),
      el('tbody', {},
        ...B.all.map(b => { const g = goal(b); const ytd = aRev(b, 0) + [1,2,3,4,5,6,7,8,9,10,11].reduce((t, i) => t + aRev(b, i), 0); return el('tr', { class: 'border-t border-' },
          _mktgTd(_mktgTC(b), { left: true, bold: true }),
          el('td', { class: 'px-1 py-1 text-left' }, num(g, (v) => { s.branchGoals[b] = v; })),
          _mktgTd(fmt.usd0(g * s.adSpendPct)), _mktgTd(fmt.usd0(g * s.wagesPct)), _mktgTd(fmt.usd0(g * s.incentivesPct)), _mktgTd(fmt.usd0(g * (s.adSpendPct + s.wagesPct + s.incentivesPct)), { bold: true }),
          el('td', { class: 'px-1 py-1 text-left' }, num(s.branchAttrition[b] != null ? Math.round(s.branchAttrition[b] * 100) : '', (v) => { s.branchAttrition[b] = v / 100; }, { w: '70px' })),
          _mktgTd(fmt.usd0(ytd)), _mktgTd(g > 0 ? (ytd / g * 100).toFixed(0) + '%' : '—', { style: { color: g > 0 && ytd / g >= 1 ? '#5F6C5B' : 'inherit' } })); }),
        el('tr', { class: 'border-t font-bold', style: { background: 'var(--card-2)' } },
          _mktgTd('RIDD', { left: true, bold: true }),
          _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + goal(b), 0)), { bold: true }),
          _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + goal(b), 0) * s.adSpendPct)), _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + goal(b), 0) * s.wagesPct)), _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + goal(b), 0) * s.incentivesPct)),
          _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + goal(b), 0) * (s.adSpendPct + s.wagesPct + s.incentivesPct)), { bold: true }), _mktgTd(''), _mktgTd(fmt.usd0(B.all.reduce((t, b) => t + [0,1,2,3,4,5,6,7,8,9,10,11].reduce((u, i) => u + aRev(b, i), 0), 0))), _mktgTd(''))))));
  // Channel projections: planned spend by channel × month.
  const channels = m.channels;
  const chProj = (ch, i) => Number((s.channelProjections[ch] || [])[i]) || 0;
  const chCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, 'Lead-partner spend plan · ' + y),
      el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, 'planned ad spend per channel per month · compare to Providers → Ad spend')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table' },
      el('thead', {}, el('tr', {}, _mktgTh('Channel', false), ...MKTG_MONTHS.map(mn => _mktgTh(mn)), _mktgTh('Total'))),
      el('tbody', {},
        ...channels.map(ch => el('tr', { class: 'border-t border-' },
          _mktgTd(ch, { left: true, bold: true, style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 } }),
          ...MKTG_MONTHS.map((_, i) => el('td', { class: 'px-1 py-1 text-left' }, num(chProj(ch, i) || '', (v) => { s.channelProjections[ch] = s.channelProjections[ch] || Array(12).fill(0); s.channelProjections[ch][i] = v; }, { w: '84px' }))),
          _mktgTd(fmt.usd0([0,1,2,3,4,5,6,7,8,9,10,11].reduce((t, i) => t + chProj(ch, i), 0)), { bold: true }))),
        el('tr', { class: 'border-t font-bold', style: { background: 'var(--card-2)' } },
          _mktgTd('Total', { left: true, bold: true }),
          ...MKTG_MONTHS.map((_, i) => _mktgTd(fmt.usd0(channels.reduce((t, ch) => t + chProj(ch, i), 0)))),
          _mktgTd(fmt.usd0(channels.reduce((t, ch) => t + [0,1,2,3,4,5,6,7,8,9,10,11].reduce((u, i) => u + chProj(ch, i), 0), 0)), { bold: true }))))));
  return el('div', { class: 'flex flex-col gap-4' },
    goalsCard,
    _mktgMatrixCard('Projected revenue', 'branch goal × the monthly allocation in Settings → Goals', rows, pRev, _mktgUsd0, opts),
    _mktgMatrixCard('Actual vs projected', 'FieldRoutes actual ÷ projected', rows, (rk, i) => { const p = pRev(rk, i); return p > 0 ? aRev(rk, i) / p : null; }, _mktgPct, { ...opts, cellStyle: (v) => v == null ? {} : { color: v >= 1 ? '#5F6C5B' : v >= 0.8 ? '#A9441F' : '#DC2626', fontWeight: '600' }, total: (rk) => { let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += aRev(rk, i); d += pRev(rk, i); } return _mktgDiv(n, d); } }),
    _mktgMatrixCard('Projected ad spend', 'projected revenue × ' + Math.round(s.adSpendPct * 100) + '%', rows, pAd, _mktgUsd0, opts),
    _mktgMatrixCard('Projected wages', 'projected revenue × ' + Math.round(s.wagesPct * 100) + '%', rows, pWg, _mktgUsd0, opts),
    _mktgMatrixCard('Projected incentives', 'projected revenue × ' + Math.round(s.incentivesPct * 100) + '%', rows, pInc, _mktgUsd0, opts),
    _mktgMatrixCard('Projected total spend', 'ad spend + wages + incentives', rows, (rk, i) => pAd(rk, i) + pWg(rk, i) + pInc(rk, i), _mktgUsd0, opts),
    chCard);
}

// Month weights for the branch-goal projections (per Isaac, Sep 30): the
// shape of the company's NEW monthly goal in Settings → Goals — one seasonal
// curve for the whole app. Falls back to the old marketing curve until a
// Goals allocation exists.
function _mktgSeasonal() {
  const g = (typeof deptGoalObj === 'function') ? deptGoalObj('office') : null;
  const arr = g && Array.isArray(g.monthly_new) && g.monthly_new.length === 12 ? g.monthly_new.map(v => Number(v) || 0) : null;
  const tot = arr ? arr.reduce((a, b) => a + b, 0) : 0;
  if (tot > 0) return arr.map(v => v / tot);
  return _mktgStore().settings.seasonal;
}
// ── Configurations card: projection rates + targets ──
function reportingMarketingGoalsPanel() {
  const m = _mktgStore(), s = m.settings;
  const num = (v, onSave, opts = {}) => el('input', { type: 'number', step: opts.step || '1', value: v == null ? '' : String(v), class: 'rounded-lg border px-2.5 py-1 text-[11px] text-right tabular-nums shrink-0', style: { width: '96px', borderColor: 'var(--border-2)' },
    onchange: (e) => { const x = parseFloat(e.target.value); onSave(isNaN(x) ? 0 : x); _mktgSave(); mountApp(); } });
  const row = (label, node, hint) => el('div', { class: 'flex items-center justify-between gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'min-w-0' }, el('div', { class: 'text-xs font-semibold' }, label), hint ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, hint) : null), node);
  const pctIn = (get, set) => num(Math.round(get() * 100), (v) => set(v / 100));
  return el('div', { class: 'card p-5' },
    el('h2', { class: 'text-base font-bold' }, '🎯 Marketing targets'),
    el('div', { class: 'text-[10px] mt-0.5 mb-2', style: { color: 'var(--text-muted)' } }, 'Drives the Marketing report’s Projections and CAC targets. Saved for every admin. Team and rep goals — and the monthly allocation projections follow — are set in Settings → Goals.'),
    row('Ad spend % of revenue', pctIn(() => s.adSpendPct, (v) => { s.adSpendPct = v; }), 'projection rate'),
    row('Wages % of revenue', pctIn(() => s.wagesPct, (v) => { s.wagesPct = v; }), 'projection rate'),
    row('Incentives % of revenue', pctIn(() => s.incentivesPct, (v) => { s.incentivesPct = v; }), 'projection rate'),
    row('Target · ad spend CAC', pctIn(() => s.targets.adSpendCac, (v) => { s.targets.adSpendCac = v; }), 'ad spend ÷ revenue, at or under'),
    row('Target · wages CAC', pctIn(() => s.targets.wagesCac, (v) => { s.targets.wagesCac = v; }), 'wages ÷ revenue, at or under'),
    row('Target · ROAS', num(s.targets.roas, (v) => { s.targets.roas = v; }, { step: '0.1' }), 'revenue ÷ ad spend, at or over'),
    row('Target · ad spend per job', num(s.targets.spendPerJob, (v) => { s.targets.spendPerJob = v; }), 'at or under'));
}

function reportingMarketingPnl() {
  reportingLoadGhlLeads();
  reportingLoadQboSpend();
  // CAC moved under Metrics (was Providers), per Isaac, Sep 30.
  if (state._mktSub === 'cac') { state._mktSub = 'providers'; state._mktProvView = 'cac'; }
  if (state._mktSub === 'acq') state._mktSub = 'providers';
  const sub = ['pnl', 'providers', 'spend', 'projections', 'demand'].includes(state._mktSub) ? state._mktSub : 'providers';   // Metrics opens first (per Isaac)
  // Metrics (per Isaac, Sep 30): CAC on the page; Lead providers and Lead
  // reconciliation are buttons to the right of the Office dropdown.
  // Lead providers now sits directly under the CAC table (per Isaac, Sep 30).
  const provView = state._mktProvView === 'recon' ? 'recon' : 'cac';
  const body = sub === 'providers' ? (provView === 'recon' ? el('div', { class: 'flex flex-col gap-4' }, mktgAttributionView())
      : el('div', { class: 'flex flex-col gap-4' }, _mktgCac(), _mktgProviders()))
    : sub === 'demand' ? _mktgDemand() : sub === 'spend' ? _mktgSpendEntry() : sub === 'projections' ? _mktgProjections() : _mktgPnl();
  // Needs attention (owner-only feed) lives on the Marketing tab (per Isaac, Sep 2026).
  return el('div', { class: 'flex flex-col gap-4' }, (typeof exceptionFeedCard === 'function') ? exceptionFeedCard() : null, (() => { try { return mktgLeadFlowTask(); } catch (e) { return null; } })(), _mktgYearBar(sub), body);
}

const REPORTING_MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const reportingMonthLbl = (ym) => { const [y, m] = ym.split('-'); return REPORTING_MONTH_ABBR[Number(m) - 1] + " '" + y.slice(2); };

// Year-over-year: grouped bars = monthly marketing spend (is-spend.json) for this
// year vs last; two lines = monthly new recurring revenue (ARR) for committed-sold
// Office-Staff accounts, this year vs last. X-axis is calendar months Jan→Dec.
// (reportingMktgSpendRevChart removed — unreferenced; settings audit, Sep 30)

// Light source normalizer for GHL lead tags (mirrors the old marketing page).
function reportingCanonSource(raw) {
  const s = (raw || '').toString().trim(), L = s.toLowerCase();
  if (s === '[object Object]' || !s) return 'Unknown';
  if (/google ads|paid search/.test(L)) return 'Google Ads';
  if (/local services/.test(L)) return 'Google LSA';
  if (/gravitate|paid social|\bfb\b|facebook|social media/.test(L)) return 'Facebook';
  if (/angi/.test(L)) return 'Angi';
  if (/pest ?net/.test(L)) return 'Pest Net';
  if (/dolead/.test(L)) return 'DoLead';
  if (/baton/.test(L)) return 'Baton';
  if (/service direct/.test(L)) return 'Service Direct';
  if (/click-to-buy|clicki/.test(L)) return 'Click-To-Buy';
  if (/organic|direct traffic|ridd form|crm workflow/.test(L)) return 'Website';
  if (/referral/.test(L)) return 'Referral';
  return s;
}

// GHL leads by DAY, stacked by source. Date presets: today / this week /
// this month / custom. Built from the per-lead contacts (with dates) the
// function now returns, so short recent ranges work even on a partial pull.
// (reportingMktgLeadsChart removed — unreferenced; settings audit, Sep 30)

// ── Lead attribution ─────────────────────────────────────────────────────
// Match an imported leads CSV (phone + email + source) against the loaded
// Customer Report snapshot. Phone is normalized to its last 10 digits so a
// leading 1, formatting, or a bare number all collapse to one key. For each
// matched lead we compare the CSV's source against how the CRM tagged that
// customer, surfacing mis-sourced accounts.
const _leadNormPhone = (s) => {
  let d = String(s == null ? '' : s).replace(/\D/g, '');
  if (d.length === 11 && d[0] === '1') d = d.slice(1); // drop US country code
  return d.length >= 10 ? d.slice(0, 10) : '';         // core 10 digits (ignore any trailing extension)
};
const _leadNormEmail = (s) => String(s == null ? '' : s).trim().toLowerCase();

function parseLeadsCsv(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const parseLine = (line) => { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') { if (q && line[i + 1] === '"') { cur += '"'; i++; } else q = !q; } else if (c === ',' && !q) { out.push(cur); cur = ''; } else cur += c; } out.push(cur); return out.map(s => s.trim()); };
  const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
  const hdr = parseLine(lines[0]).map(norm);
  const idx = (...al) => { for (const a of al.map(norm)) { const i = hdr.indexOf(a); if (i !== -1) return i; } return -1; };
  const iP = idx('phone', 'phonenumber', 'cell', 'cellphone', 'mobile', 'mobilephone');
  const iE = idx('email', 'emailaddress', 'e-mail');
  const iS = idx('source', 'leadsource', 'utmsource', 'channel', 'attributionsource', 'medium');
  const iN = idx('name', 'fullname', 'contactname', 'customer', 'firstname');
  const iD = idx('date', 'dateadded', 'createddate', 'created', 'datecreated');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseLine(lines[i]);
    const row = { phone: iP >= 0 ? (c[iP] || '') : '', email: iE >= 0 ? (c[iE] || '') : '', source: iS >= 0 ? (c[iS] || '') : '', name: iN >= 0 ? (c[iN] || '') : '', date: iD >= 0 ? (c[iD] || '') : '' };
    if (row.phone || row.email) out.push(row);
  }
  return out;
}

// (reportingLeadAttribution removed — unreferenced; settings audit, Sep 30)


// ── CRM vocabulary panel (Configurations) ─────────────────────────────
// Generalization slice 2 (Isaac, Sep 22 2026): shows what the app takes
// each FieldRoutes label to MEAN — cancel reasons, sold-by employee types,
// lead sources, and the rescission window — and lets an admin tag the
// company's own labels into those buckets. Untouched = RIDD's defaults
// (the patterns the rules always used), so RIDD's numbers never move.
// Values listed are the distinct labels observed in the reporting snapshot.
const _crmVocabObsMemo = { subs: null, out: null };
function _crmVocabObserved() {
  const subs = state.reportingSubscriptions || [];
  if (_crmVocabObsMemo.out && _crmVocabObsMemo.subs === subs) return _crmVocabObsMemo.out;
  const cnt = (map, k) => { const key = String(k == null ? '' : k).replace(/\s+/g, ' ').trim(); if (!key) return; map.set(key, (map.get(key) || 0) + 1); };
  const reasons = new Map(), sellers = new Map(), sources = new Map();
  for (const r of subs) { cnt(reasons, reportingCancelReasonOf(r)); cnt(sellers, r.sold_by_type); cnt(sources, reportingSourceOf(r)); }
  const list = (m) => [...m.entries()].sort((a, b) => b[1] - a[1]);
  const out = { reasons: list(reasons), sellerTypes: list(sellers), sources: list(sources) };
  _crmVocabObsMemo.subs = subs; _crmVocabObsMemo.out = out;
  return out;
}
function reportingCrmVocabPanel() {
  const V = crmVocab();
  const rules = _adminRules(); const stored = rules && rules.crmVocab && typeof rules.crmVocab === 'object' ? rules.crmVocab : {};
  const obs = _crmVocabObserved();
  const save = (next) => { setCrmVocab(next); _crmVocabObsMemo.out = null; toast('CRM vocabulary saved', 'success'); mountApp(); };
  const listFor = (group, key) => (stored[group] && Array.isArray(stored[group][key])) ? stored[group][key].slice() : null;
  const setList = (group, key, arr) => { const next = JSON.parse(JSON.stringify(stored)); next[group] = next[group] || {}; if (arr && arr.length) next[group][key] = arr; else delete next[group][key]; if (next[group] && !Object.keys(next[group]).length) delete next[group]; save(Object.keys(next).length ? next : null); };
  const isDefault = (group, key) => !V[group][key];
  const GROUP_LABEL = { reasons: ['Cancel reasons', 'Which of the CRM’s cancel reasons mean a rescission, a merge into another subscription, or a renewal. The attrition steps read these.'], sellerTypes: ['Sold-by employee types', 'Which FieldRoutes employee types are door-to-door reps, inside sales / office staff, and technicians. Scopes the Sales tabs, the rescission rule and CRM checks.'], sources: ['Lead sources', 'Which lead sources are door-to-door, technician upsells, termite upsells, and the default/blank values reps forget to change. The Needs-attention CRM checks read these.'] };
  const section = (group) => {
    const values = obs[group];
    return el('div', { class: 'py-2 border-t', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'text-[11px] font-bold' }, GROUP_LABEL[group][0]),
      el('div', { class: 'text-[10px] mb-1.5', style: { color: 'var(--text-subtle)' } }, GROUP_LABEL[group][1]),
      ...CRM_VOCAB_BUCKETS[group].map(([key, desc]) => {
        const configured = listFor(group, key);
        const matched = values.filter(([v]) => _crmMatch(group, key, v));
        const open = state._crmVocabOpen === group + ':' + key;
        return el('div', { class: 'mb-1' },
          el('div', { class: 'flex items-center gap-2 cursor-pointer', onclick: () => { state._crmVocabOpen = open ? null : group + ':' + key; mountApp(); } },
            el('span', { class: 'text-[10px] font-semibold uppercase tracking-wider', style: { minWidth: '92px', color: 'var(--text-muted)' } }, (open ? '▾ ' : '▸ ') + key.replace('_', ' ')),
            el('span', { class: 'text-[11px] flex-1 min-w-0 truncate' }, matched.length ? matched.map(([v, n]) => v + ' (' + fmt.int(n) + ')').join(' · ') : el('span', { style: { color: 'var(--text-subtle)' } }, 'nothing in the data matches')),
            el('span', { class: 'text-[9px] font-semibold px-1.5 py-0.5 rounded-full shrink-0', style: isDefault(group, key) ? { background: 'var(--card-2)', color: 'var(--text-muted)' } : { background: 'rgba(223,100,58,.12)', color: 'var(--accent)' } }, isDefault(group, key) ? 'default' : 'custom')),
          open ? el('div', { class: 'mt-1 mb-2 rounded-lg p-2', style: { background: 'var(--card-2)' } },
            el('div', { class: 'text-[10px] mb-1', style: { color: 'var(--text-subtle)' } }, desc + '. Tick every label in the CRM that means this. Untick everything to go back to the default pattern.'),
            el('div', { class: 'flex flex-col', style: { maxHeight: '220px', overflowY: 'auto' } },
              ...values.map(([v, n]) => {
                const on = configured ? configured.map(_crmNorm).includes(_crmNorm(v)) : _crmMatch(group, key, v);
                return el('label', { class: 'flex items-center gap-2 py-0.5 text-[11px] cursor-pointer' },
                  el('input', { type: 'checkbox', checked: on, onchange: () => { const cur = configured ? configured.slice() : matched.map(([x]) => x); const i = cur.map(_crmNorm).indexOf(_crmNorm(v)); if (i >= 0) cur.splice(i, 1); else cur.push(v); setList(group, key, cur); } }),
                  el('span', { class: 'flex-1 min-w-0 truncate' }, v), el('span', { class: 'tabular-nums', style: { color: 'var(--text-subtle)' } }, fmt.int(n)));
              }),
              values.length ? null : el('div', { class: 'text-[11px] py-1', style: { color: 'var(--text-subtle)' } }, 'No values in the snapshot yet.')),
            configured ? el('button', { class: 'mt-1.5 text-[10px] font-bold', style: { color: 'var(--accent)' }, onclick: () => setList(group, key, null) }, 'Reset to default') : null) : null);
      }));
  };
  const win = el('input', { type: 'number', min: 0, max: 30, step: 1, value: V.rorWindowDays, class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '64px' },
    onchange: (e) => { const d = Math.max(0, Math.round(Number(e.target.value) || 0)); const next = JSON.parse(JSON.stringify(stored)); if (d && d !== CRM_VOCAB_DEFAULTS.rorWindowDays) next.rorWindowDays = d; else delete next.rorWindowDays; save(Object.keys(next).length ? next : null); } });
  return el('div', { class: 'card p-4', id: 'cfg-vocab' },
    el('div', { class: 'flex items-center justify-between gap-2 mb-1' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'CRM vocabulary')),
      V.configured ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { if (confirm('Reset every vocabulary tag to the defaults?')) save(null); } }, 'Reset all') : null),
    el('div', { class: 'flex items-center justify-between gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)' }, title: 'The right-of-rescission window: a door-to-door sale cancelled within this many days of the sale is a rescission, not a customer. State law; RIDD’s markets are 3.' },
      el('span', { class: 'text-[11px] font-semibold' }, 'Rescission window (days)'), el('div', { class: 'flex items-center gap-2' }, win, el('span', { class: 'text-[9px] font-semibold px-1.5 py-0.5 rounded-full', style: V.rorWindowDays === CRM_VOCAB_DEFAULTS.rorWindowDays ? { background: 'var(--card-2)', color: 'var(--text-muted)' } : { background: 'rgba(223,100,58,.12)', color: 'var(--accent)' } }, V.rorWindowDays === CRM_VOCAB_DEFAULTS.rorWindowDays ? 'default' : 'custom'))),
    section('reasons'), section('sellerTypes'), section('sources'));
}

// ── Company setup checklist (onboarding) ──────────────────────────────
// Generalization slice 8 (Isaac, Sep 22 2026): the "onboarding hour" for a
// company that isn't RIDD, as a checklist over the SAME Configurations panels
// — nothing new to configure, just the order and a status per step computed
// from their data. Shows at the top of Configurations while anything is
// still open; once every step is done it folds to a one-line link at the
// bottom (RIDD lands there on day one).
function _setupSteps() {
  const subs = state.reportingSubscriptions || [];
  const obs = _crmVocabObserved();
  const hit = (group, key) => obs[group].some(([v]) => _crmMatch(group, key, v));
  const svcCfg = state.reportingServiceConfig || [];
  const explicitSvc = svcCfg.filter(c => ['recurring', 'onetime', 'retired'].includes(c.lifecycle) || c.recurring_override === true || c.recurring_override === false).length;
  const svcNames = new Set(subs.map(r => r.subscription).filter(Boolean));
  const svcDefaulted = [...svcNames].filter(n => { const c = svcCfg.find(x => x.service_name === n); return !c || !(['recurring', 'onetime', 'retired'].includes(c.lifecycle) || c.recurring_override === true || c.recurring_override === false); }).length;
  const srcCfg = state.reportingSourceConfig || [];
  const srcNames = new Set(subs.map(reportingSourceOf));
  const srcUnset = [...srcNames].filter(n => !srcCfg.some(c => c.source === n)).length;
  const offices = state.offices || [];
  const branchNames = new Set(subs.map(r => (r.office_name || '').trim()).filter(Boolean));
  const unmappedBranches = [...branchNames].filter(b => !offices.some(o => String(o.name || '').trim().toLowerCase() === b.toLowerCase())).length;
  const people = (state.allProfiles || []).length;
  const goal = state.companyGoal && (Number(state.companyGoal.new_goal || state.companyGoal.annual || state.companyGoal.goal || 0) > 0 || Object.keys(state.companyGoal).length > 0);
  const goTo = (id) => () => { state.reportingSubTab = 'config'; state._setupOpen = true; mountApp(); requestAnimationFrame(() => { const n = document.getElementById(id); if (n) n.scrollIntoView({ behavior: 'smooth', block: 'start' }); }); };
  const goAdmin = () => { state.view = 'admin'; history.replaceState(null, '', '#admin'); mountApp(); };
  return [
    { key: 'data', title: 'Data feed', done: subs.length > 0, detail: subs.length ? fmt.int(subs.length) + ' subscriptions in the reporting snapshot' : 'No snapshot yet — run the sync, then the reporting snapshot builds on the next pass', action: subs.length ? null : ['Uploads', () => { state.reportingSubTab = 'uploads'; mountApp(); }] },
    { key: 'vocab', title: 'CRM vocabulary', done: subs.length > 0 && hit('reasons', 'ror') && (hit('sellerTypes', 'sales_rep') || hit('sellerTypes', 'office_staff') || hit('sellerTypes', 'technician')) && hit('sources', 'd2d'),
      detail: !subs.length ? 'Needs data first' : [['reasons', 'ror', 'rescission reason'], ['reasons', 'renewal', 'renewal reason'], ['sellerTypes', 'sales_rep', 'door-to-door type'], ['sellerTypes', 'office_staff', 'office-staff type'], ['sellerTypes', 'technician', 'technician type'], ['sources', 'd2d', 'door-to-door source']].map(([g, k, l]) => (hit(g, k) ? '✓ ' : '✗ ') + l).join(' · ') + ' · rescission window ' + crmRorWindowDays() + 'd', action: ['Open', goTo('cfg-vocab')] },
    { key: 'services', title: 'Service types', done: explicitSvc > 0, detail: svcNames.size ? explicitSvc + ' set explicitly · ' + svcDefaulted + ' on the default guess (recurring unless named “One Time…”)' : 'Needs data first', action: ['Open', goTo('cfg-services')] },
    { key: 'sources', title: 'Lead sources', done: srcCfg.length > 0, detail: srcNames.size ? srcCfg.length + ' configured · ' + srcUnset + ' source' + (srcUnset === 1 ? '' : 's') + ' in the data with no row yet (counted as new revenue, included)' : 'Needs data first', action: ['Open', goTo('cfg-sources')] },
    { key: 'cancel', title: 'Cancellation reasons', done: (state.reportingCancelConfig || []).length > 0 || obs.reasons.length === 0, detail: obs.reasons.length + ' distinct reason' + (obs.reasons.length === 1 ? '' : 's') + ' in the data · ' + (state.reportingCancelConfig || []).length + ' classified as retained', action: ['Open', goTo('cfg-cancel')] },
    { key: 'branches', title: 'Branches', done: offices.length > 0 && unmappedBranches === 0, detail: offices.length + ' office' + (offices.length === 1 ? '' : 's') + ' set up' + (unmappedBranches ? ' · ' + unmappedBranches + ' branch name' + (unmappedBranches === 1 ? '' : 's') + ' in the data with no office row (add the office or a rename)' : ''), action: ['Settings', goAdmin] },
    { key: 'goals', title: 'Goals', done: !!goal, detail: goal ? 'Department goal set' : 'No department goal yet — the pacer and daily goals need one', action: ['Settings', goAdmin] },
    { key: 'users', title: 'Users', done: people > 1, detail: people + ' user' + (people === 1 ? '' : 's') + ' — invite reps and leads; roles follow their CRM employee type', action: ['Settings', goAdmin] },
  ];
}
function reportingSetupCard() {
  if (!isAdminRole(state.profile?.role)) return null;
  if (state.reportingActiveUploadId && !state.reportingSubscriptionsLoadedFor) return null;   // snapshot still loading — don't flash an empty checklist
  let steps; try { steps = _setupSteps(); } catch (e) { return null; }
  const done = steps.filter(s => s.done).length, all = steps.length;
  const complete = done === all;
  if (complete && !state._setupOpen) return null;
  const dot = (ok) => el('span', { class: 'inline-flex items-center justify-center rounded-full shrink-0 text-[10px] font-black', style: { width: '18px', height: '18px', background: ok ? 'rgba(47,125,50,.15)' : 'rgba(223,100,58,.15)', color: ok ? '#2F7D32' : 'var(--accent)' } }, ok ? '✓' : '•');
  return el('div', { class: 'card p-4', id: 'cfg-setup' },
    el('div', { class: 'flex items-center justify-between gap-2 mb-1' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Company setup · ' + done + ' of ' + all), el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Do these in order the first time; each one is a card on this tab or a Settings page. Status is read from the data, so it updates as you go.')),
      complete ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--text-muted)' }, onclick: () => { state._setupOpen = false; mountApp(); } }, 'Hide') : null),
    el('div', { class: 'h-1.5 rounded-full mb-2', style: { background: 'var(--card-2)' } }, el('div', { class: 'h-full rounded-full', style: { width: (done / all * 100) + '%', background: '#2F7D32', transition: 'width .3s' } })),
    ...steps.map((s, i) => el('div', { class: 'flex items-start gap-2 py-1.5 border-t', style: { borderColor: 'var(--border)' } },
      dot(s.done),
      el('div', { class: 'flex-1 min-w-0' }, el('div', { class: 'text-[11px] font-semibold' }, (i + 1) + '. ' + s.title), el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, s.detail)),
      s.action ? el('button', { class: 'rounded-lg border px-2 py-0.5 text-[10px] font-semibold shrink-0', style: { borderColor: 'var(--border-2)' }, onclick: s.action[1] }, s.action[0]) : null)));
}
function reportingSetupLink() {
  if (!isAdminRole(state.profile?.role) || state._setupOpen || (state.reportingActiveUploadId && !state.reportingSubscriptionsLoadedFor)) return null;
  let steps; try { steps = _setupSteps(); } catch (e) { return null; }
  if (steps.some(s => !s.done)) return null;   // the card is showing instead
  return el('button', { class: 'text-[10px] font-semibold self-start', style: { color: 'var(--text-subtle)' }, onclick: () => { state._setupOpen = true; mountApp(); } }, '✓ Company setup complete · show checklist');
}

// ── Operations baseline panel (Configurations) ────────────────────────
// Generalization slice 9: the Operations tab's "<year>" and "vs <year>"
// columns compare against a baseline table. RIDD's is the 2025 COO sheet
// baked into src/89 (the default); another company pastes its own here as
// CSV — metric,office,value — with ALL as the company-wide office. Values
// are weekly averages for counts and the ratio itself for rates.
const OPS_BASELINE_METRIC_KEYS = ['upsell_per_prod', 'upsell', 'appts_per_route', 'completion', 'done', 'sch', 'routes', 'prod', 'prod_per_appt', 'prod_per_route', 'prod_per_hr', 'svc_minutes', 'resvc_pct', 'resvc', 'hrs_excl', 'fr_reviews', 'spend_per_appt', 'spend_per_hr_incl', 'spend_per_hr_excl', 'reviews'];
function reportingOpsBaselinePanel() {
  if (!isAdminRole(state.profile?.role)) return null;
  const r = _adminRules(); const stored = r && r.opsBaseline && typeof r.opsBaseline === 'object' && r.opsBaseline.values ? r.opsBaseline : null;
  const B = opsBaseline();
  const open = !!state._opsBaseOpen;
  const toCsv = (vals) => { const out = []; for (const k in vals) for (const o in vals[k]) out.push(k + ',' + (o === 'RIDD' ? 'ALL' : o) + ',' + vals[k][o]); return out.join('\n'); };
  const parse = (txt) => {
    const values = {}; let bad = 0;
    for (const line of String(txt || '').split(/\r?\n/)) {
      const t = line.trim(); if (!t || /^metric\s*,/i.test(t)) continue;
      const m = /^([a-z_]+)\s*,\s*([^,]+?)\s*,\s*(-?[\d.]+)\s*%?$/i.exec(t);
      if (!m || !OPS_BASELINE_METRIC_KEYS.includes(m[1])) { bad++; continue; }
      (values[m[1]] = values[m[1]] || {})[m[2] === 'ALL' ? 'ALL' : m[2]] = Number(m[3]);
    }
    return { values, bad };
  };
  const yearIn = el('input', { type: 'number', min: 2000, max: 2100, value: B.year, class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '72px' } });
  const ta = el('textarea', { rows: 8, placeholder: 'metric,office,value\ncompletion,ALL,0.93\ndone,ALL,2400\ndone,Atlanta,270', class: 'w-full rounded-lg border px-2 py-1 text-[11px] font-mono', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } }, stored ? toCsv(stored.values) : '');
  const msg = el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '');
  return el('div', { class: 'card p-4', id: 'cfg-ops-baseline' },
    el('div', { class: 'flex items-center justify-between gap-2 cursor-pointer', onclick: () => { state._opsBaseOpen = !open; mountApp(); } },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, (open ? '▾ ' : '▸ ') + 'Operations baseline · ' + B.year)),
      el('span', { class: 'text-[9px] font-semibold px-1.5 py-0.5 rounded-full', style: stored ? { background: 'rgba(223,100,58,.12)', color: 'var(--accent)' } : { background: 'var(--card-2)', color: 'var(--text-muted)' } }, stored ? 'custom' : 'default')),
    open ? el('div', { class: 'mt-2 flex flex-col gap-2' },
      el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'One row per metric and office: metric key, office name (ALL = company-wide), value. Counts are weekly averages; rates are the ratio (0.93, not 93). Keys: ' + OPS_BASELINE_METRIC_KEYS.join(', ') + '.'),
      el('div', { class: 'flex items-center gap-2' }, el('span', { class: 'text-[11px] font-semibold' }, 'Baseline year'), yearIn),
      ta, msg,
      el('div', { class: 'flex items-center gap-2' },
        el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => { const { values, bad } = parse(ta.value); if (!Object.keys(values).length) { msg.textContent = 'Nothing parsed' + (bad ? ' — ' + bad + ' line' + (bad === 1 ? '' : 's') + ' not understood' : '') + '.'; return; } _setAdminRule('opsBaseline', { year: Number(yearIn.value) || B.year, values }); toast('Operations baseline saved' + (bad ? ' · ' + bad + ' line' + (bad === 1 ? '' : 's') + ' skipped' : ''), 'success'); mountApp(); } }, 'Save baseline'),
        stored ? el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { _setAdminRule('opsBaseline', null); toast('Back to the default baseline', 'success'); mountApp(); } }, 'Use default') : null)) : null);
}
