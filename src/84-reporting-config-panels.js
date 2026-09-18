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
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×'),
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
      mountApp();
    }
  };

  return el('div', { class: 'card p-3' },
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
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '440px', overflowY: 'auto' } },
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

  return el('div', { class: 'card p-3' },
    el('div', { class: 'flex items-center gap-2 mb-3' },
      el('h2', { class: 'text-base font-bold' }, 'Cancellation Reasons'),
      configInfoBtn('Cancellation Reasons',
        'Choose which cancellation reasons count as real attrition. Excluded reasons (e.g. duplicates, moved/relocated, paperwork churn) ' +
        'drop out of churn everywhere — the Overview cancel count + rate AND the Geographic attrition map. ' +
        'Click a reason (or its Cancels number) to drill into the exact canceled accounts behind it. Counts are canceled subs in the current snapshot.'),
    ),
    list.length === 0
      ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'Cancellation reasons appear here once a snapshot has canceled subscriptions.')
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '440px', overflowY: 'auto' } },
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
  const list = [...allSources].sort((a, b) => (counts.get(b) || 0) - (counts.get(a) || 0) || a.localeCompare(b));

  const updateSourceConfig = async (source, patch) => {
    logActivity('config_change', { detail: 'Source config: ' + source + ' → ' + JSON.stringify(patch) });
    const existing = cfgBySource.get(source) || { source, included: true };
    const next = { ...existing, ...patch, updated_by: state.profile?.id || null };
    const idx = cfg.findIndex(c => c.source === source);
    if (idx >= 0) cfg[idx] = next; else cfg.push(next);
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

  return el('div', { class: 'card p-3' },
    el('div', { class: 'flex items-center gap-2 mb-3' },
      el('h2', { class: 'text-base font-bold' }, 'Lead Sources'),
      configInfoBtn('Lead Sources',
        'Two controls per source. Revenue Type classifies it as New, Renewal, or Upsell — the single rule the Inside Sales pace and P&L read (renewals are excluded from new-business pace; upsells bucket separately). Defaults follow the source name. ' +
        'In Reporting excludes a source from all snapshot reporting (Overview, Geographic, Rep Performance, Waterfall, Inside Sales) — e.g. Miscellaneous drops out everywhere at once. Counts are total subs per source in the current snapshot.'),
    ),
    list.length === 0
      ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'Lead sources appear here after you upload a snapshot.')
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '440px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-xs' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)', position: 'sticky', top: '0', zIndex: '10' } },
              el('tr', {},
                el('th', { class: 'text-left pl-3 pr-2 py-2 font-semibold' }, 'Lead Source'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Subs'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Revenue Type'),
                el('th', { class: 'text-left pr-3 pl-2 py-2 font-semibold' }, 'In Reporting'),
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
                row.append(
                  el('td', { class: 'pl-3 pr-2 py-1.5 font-medium' }, source),
                  el('td', { class: 'px-2 py-1.5 text-left tabular-nums text-muted-' }, (counts.get(source) || 0).toLocaleString()),
                  el('td', { class: 'px-2 py-1.5 text-left' }, classSelect),
                  el('td', { class: 'pr-3 pl-2 py-1.5 text-left' }, pill),
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
function isAnnualGoalFor(yr) {
  const y = String(yr);
  if (state._isAnnualGoal && state._isAnnualGoal[y] != null) return state._isAnnualGoal[y];
  // Synced copy first (adminRules) — an annual goal typed on one laptop is
  // company truth, not a browser preference.
  const _ar = (typeof _adminRules === 'function') ? _adminRules() : null;
  if (_ar && _ar.isAnnualGoal && _ar.isAnnualGoal[y] != null) return _ar.isAnnualGoal[y];
  try { const v = localStorage.getItem('ridd_is_annual_goal_' + y); if (v != null && v !== '') return Number(v); } catch (e) {}
  return IS_ANNUAL_GOAL[y] != null ? IS_ANNUAL_GOAL[y] : null;
}
function setAnnualGoalFor(yr, value) {
  const y = String(yr);
  if (!state._isAnnualGoal) state._isAnnualGoal = {};
  const num = (value === '' || value == null) ? null : Number(value);
  state._isAnnualGoal[y] = num;
  try {
    const _ar = (typeof _adminRules === 'function' && _adminRules()) || {};
    const m = { ...(_ar.isAnnualGoal || {}) };
    if (num == null) delete m[y]; else m[y] = num;
    _setAdminRule('isAnnualGoal', m);
  } catch (e) { /* local fallback below */ }
  try { if (num == null) localStorage.removeItem('ridd_is_annual_goal_' + y); else localStorage.setItem('ridd_is_annual_goal_' + y, String(num)); } catch (e) {}
}

// P&L assumptions — spend modeled as a % of revenue, editable per year and
// persisted locally. Stored as fractions (0.18 = 18%). Defaults mirror the
// PROJECTIONS-tab config (ad spend 36%, wages 15.5%, incentives 1%).
const IS_ASSUMPTION_DEFAULTS = { ad_spend_pct: 0.36, wages_pct: 0.155, incentive_pct: 0.01 };
function isAssumptionFor(yr, key) {
  const y = String(yr);
  if (state._isAssumptions && state._isAssumptions[y] && state._isAssumptions[y][key] != null) return state._isAssumptions[y][key];
  const _ar = (typeof _adminRules === 'function') ? _adminRules() : null;
  if (_ar && _ar.isAssumptions && _ar.isAssumptions[y] && _ar.isAssumptions[y][key] != null) return _ar.isAssumptions[y][key];
  try { const v = localStorage.getItem('ridd_is_assume_' + y + '_' + key); if (v != null && v !== '') return Number(v); } catch (e) {}
  return IS_ASSUMPTION_DEFAULTS[key];
}
function setAssumptionFor(yr, key, pctValue) {
  const y = String(yr);
  if (!state._isAssumptions) state._isAssumptions = {};
  if (!state._isAssumptions[y]) state._isAssumptions[y] = {};
  const num = (pctValue == null || pctValue === '') ? null : Number(pctValue) / 100; // input is a percent
  state._isAssumptions[y][key] = num;
  try {
    const _ar = (typeof _adminRules === 'function' && _adminRules()) || {};
    const m = { ...(_ar.isAssumptions || {}) };
    m[y] = { ...(m[y] || {}) };
    if (num == null) delete m[y][key]; else m[y][key] = num;
    _setAdminRule('isAssumptions', m);
  } catch (e) { /* local fallback below */ }
  try { if (num == null) localStorage.removeItem('ridd_is_assume_' + y + '_' + key); else localStorage.setItem('ridd_is_assume_' + y + '_' + key, String(num)); } catch (e) {}
}
function reportingIsPacer() {
  const rows = state.reportingSubscriptions || [];
  const MAN = state.reportingIsManual || {};
  const now = new Date(), yr = now.getFullYear(), curM = now.getMonth();
  const NA = -999999;
  const isExcl = reportingExcludedSources();
  // Actual = total CONTRACT VALUE of NEW Office-Staff (inside sales) sales whose
  // initial is PENDING or SERVICED. Excludes renewals, upsells, Sales-Rep (D2D)
  // accounts, and sold-not-started / cancelled-before-initial deadwood.
  // Bucketed by sold date.
  const act = Array(12).fill(0);
  for (const r of rows) {
    const sd = r.sold_date; if (!sd || !String(sd).startsWith(yr + '-')) continue;
    const src = (r.subscription_source || '').trim();
    if (isExcl.has(src || 'Unspecified')) continue;
    if (reportingSourceClass(src) !== 'new') continue;      // NEW only — exclude renewals AND upsells
    if (!reportingIsOfficeStaff(r)) continue;               // Office Staff (rep type) only — excludes Sales Reps
    // FieldRoutes' own Pending/Serviced gate — initial appt Pending or
    // Completed, same rule as Indicators (per Isaac). Blank status = legacy
    // snapshot → fall back to the old sold-not-started heuristic.
    const _ist = String(r.initial_status || '').toLowerCase();
    if (_ist ? (_ist !== 'pending' && _ist !== 'completed') : (!r.initial_service && r.subscription_date_canceled)) continue;
    act[Number(String(sd).slice(5, 7)) - 1] += Number(r.subscription_contract_value) || 0;
  }
  // Annual goal: whatever's in the box (persisted locally), else the model goal.
  const annual = isAnnualGoalFor(yr);
  // Monthly goal = the annual goal box (top-right) × the seasonal allocation.
  // A hand-entered monthly override still wins if one was ever set.
  const goalAt = (m) => {
    const v = MAN[yr + '-' + String(m + 1).padStart(2, '0')]?.projected_revenue;
    if (v != null && Number(v) !== NA) return Number(v);
    return annual != null ? annual * IS_SEASONAL[m] : null;
  };
  const usd0 = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString();
  const ytdAct = act.slice(0, curM + 1).reduce((s, v) => s + v, 0);
  let ytdGoal = 0, anyGoal = false;
  for (let m = 0; m <= curM; m++) { const g = goalAt(m); if (g != null) { ytdGoal += g; anyGoal = true; } }
  const ytdPace = anyGoal && ytdGoal > 0 ? ytdAct / ytdGoal : null;
  const annPct = annual ? ytdAct / annual : null;
  const expCum = IS_PACER_CUM[curM];
  const paceColor = (p) => p == null ? 'var(--text-muted)' : p >= 1 ? '#DF643A' : p >= 0.85 ? '#A9441F' : '#DC2626';
  const paceBg = (p) => p == null ? 'transparent' : p >= 1 ? 'rgba(223,100,58,.15)' : p >= 0.85 ? 'rgba(223,100,58,.12)' : 'rgba(220,38,38,.10)';
  const pctS = (p) => p == null ? '—' : Math.round(p * 100) + '%';

  const kpi = (label, val, sub, color) => el('div', { class: 'flex-1', style: { minWidth: '130px' } },
    el('div', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-xl font-black', style: color ? { color } : {} }, val),
    sub ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, sub) : null);

  const goalInput = el('input', {
    type: 'text', inputmode: 'numeric', placeholder: 'e.g. 4,000,000',
    value: annual != null ? annual.toLocaleString() : '',
    class: 'w-28 text-right text-[11px] rounded border px-2.5 py-1',
    style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
    onchange: (e) => {
      const v = e.target.value.replace(/[$,\s]/g, '');
      if (v !== '' && isNaN(Number(v))) { toast('Enter a number', 'error'); return; }
      setAnnualGoalFor(yr, v);   // local persist — recomputes every monthly goal
      mountApp();
    },
  });

  const cells = REPORTING_MONTH_ABBR.map((lbl, m) => {
    const g = goalAt(m), a = act[m];
    const isCur = m === curM, fut = m > curM;
    const pace = (!fut && g > 0) ? a / g : null;
    return el('div', { class: 'rounded-lg p-2 text-center', style: { background: fut ? 'var(--card-2)' : paceBg(pace), opacity: fut ? .65 : 1, minWidth: 0 } },
      el('div', { class: 'text-[10px] font-bold uppercase' }, lbl + (isCur ? ' · MTD' : '')),
      el('div', { class: 'text-sm font-black', style: { color: fut ? 'var(--text-muted)' : paceColor(pace) } }, fut ? '—' : pctS(pace)),
      el('div', { class: 'text-[10px] tabular-nums' }, fut ? '' : usd0(a)),
      el('div', { class: 'text-[9px] tabular-nums', style: { color: 'var(--text-subtle)' } }, g != null ? 'goal ' + usd0(g) : 'no goal'));
  });

  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-start justify-between gap-2 flex-wrap mb-3' },
      el('div', {},
        el('h3', { class: 'text-base font-bold mb-1' }, 'Inside Sales Pacer'),
        el('div', { class: 'text-[11px] text-muted-' }, 'New Office-Staff contract value vs goal · pending or serviced initials only (renewals, upsells, Sales Reps & sold-not-started excluded) · monthly goal = your Projected Revenue cells, else seasonal curve × annual goal')),
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-subtle)' } }, 'Annual goal $'), goalInput)),
    el('div', { class: 'flex gap-4 flex-wrap mb-3' },
      kpi('YTD Actual', usd0(ytdAct)),
      kpi('YTD Goal', anyGoal ? usd0(ytdGoal) : '—'),
      kpi('YTD Pace', pctS(ytdPace), ytdPace != null ? 'of goal through ' + REPORTING_MONTH_ABBR[curM] : 'set an annual goal →', paceColor(ytdPace)),
      kpi('% of Annual Goal', annPct != null ? (annPct * 100).toFixed(1) + '%' : '—', 'pacer expects ' + Math.round(expCum * 100) + '% by end of ' + REPORTING_MONTH_ABBR[curM], annPct != null ? paceColor(annPct / expCum) : null)),
    el('div', { class: 'grid gap-1.5', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(84px, 1fr))' } }, ...cells));
}

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
  if (force) { state.reportingIsSpend = null; state._isSpendLoading = false; }
  if (state.reportingIsSpend != null || state._isSpendLoading) return;
  state._isSpendLoading = true;
  // No static / hand-entered fallback (per Isaac): QuickBooks via Windsor or
  // nothing — an unbooked month shows blank rather than a made-up number.
  const useFile = () => { state.reportingIsSpend = {}; state._isSpendSource = 'none'; state._isSpendLoading = false; mountApp(); };
  _apiAuthHeaders().then(h => fetch('/api/qbo-spend' + (force ? '?_=' + Date.now() : ''), { headers: h })).then(r => r.ok ? r.json() : null).then(j => {
    if (j && j.bySourceMonth && Object.keys(j.bySourceMonth).length) {
      state.reportingIsSpend = j.bySourceMonth; state._isSpendSource = 'QuickBooks'; state._isSpendPulledAt = j.pulledAt; state._isSpendLoading = false; mountApp();
      // A stale copy was served while Windsor re-pulls in the background — pick up the fresh one shortly.
      if (j.refreshing && !state._isSpendRepoll) { state._isSpendRepoll = true; setTimeout(() => { state._isSpendRepoll = false; reportingLoadQboSpend(true); }, 45000); }
    } else if (j && j.pending) {
      // First pull is running in the background (Windsor ledger takes ~30s) — poll.
      state._isSpendLoading = false; state.reportingIsSpend = null;
      setTimeout(() => reportingLoadQboSpend(false), 25000);
    } else { useFile(); }
  }).catch(useFile);
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
const MKTG_RPS = new Set(['DETROIT', 'JOPLIN', 'LITTLE ROCK']);   // RIDD Pest Solutions branches; the rest are RPC
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
  const branch = {}, source = {}, total = Array.from({ length: 12 }, mk);
  const branches = new Set(), sources = new Set();
  for (const r of rows) {
    const sd = r.sold_date; if (!sd || String(sd).slice(0, 4) !== String(year)) continue;
    const mi = Number(String(sd).slice(5, 7)) - 1; if (!(mi >= 0 && mi < 12)) continue;
    const src = reportingSourceOf(r); if (isExcl.has(src)) continue;
    const cls = reportingSourceClass(src); if (cls === 'renewal') continue;
    if (!reportingIsOfficeStaff(r)) continue;
    if (!gate(r)) continue;
    const off = String(r.office_name || 'UNKNOWN').toUpperCase();
    branches.add(off); sources.add(src);
    const b = (branch[off] = branch[off] || Array.from({ length: 12 }, mk))[mi];
    const s = (source[src] = source[src] || Array.from({ length: 12 }, mk))[mi];
    const cv = Number(r.subscription_contract_value) || 0;
    for (const x of [b, s, total[mi]]) {
      if (cls === 'upsell') { x.upsells++; x.upRev += cv; }
      else { x.subs++; x.rev += cv; }
      x.bookings++;
      if (String(r.initial_status || '').toLowerCase() === 'completed' || r.initial_serviced_date) x.serviced++;
      if (r.subscription_date_canceled) x.cancels++;
    }
  }
  return { branch, source, total, branches: [...branches].sort(), sources: [...sources].sort() };
}
function _mktgBranchList(year) {
  const a = _mktgActuals(year);
  const m = _mktgStore();
  const set = new Set(a.branches);
  Object.keys(m.settings.branchGoals).forEach(b => set.add(b));
  for (const ym in m.spend) for (const ch in m.spend[ym]) Object.keys(m.spend[ym][ch]).forEach(b => set.add(b));
  set.delete('UNKNOWN');
  const rpc = [...set].filter(b => !MKTG_RPS.has(b)).sort(), rps = [...set].filter(b => MKTG_RPS.has(b)).sort();
  return { rpc, rps, all: [...rpc, ...rps] };
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
  const rowEl = (rk) => {
    const isGroup = opts.groupRows && opts.groupRows.has(rk);
    return el('tr', { class: 'border-t border-' + (isGroup ? ' font-bold' : ''), style: isGroup ? { background: 'var(--card-2)' } : {} },
      _mktgTd(opts.label ? opts.label(rk) : rk, { left: true, bold: true, style: { position: 'sticky', left: 0, background: isGroup ? 'var(--card-2)' : 'var(--card)', zIndex: 1, boxShadow: '1px 0 0 var(--border)' } }),
      ...Array.from({ length: 12 }, (_, i) => { const v = cell(rk, i); return _mktgTd(v == null ? '—' : fmtFn(v, rk, i), { style: opts.cellStyle ? (opts.cellStyle(v, rk, i) || {}) : {} }); }),
      _mktgTd((() => { const t = totalOf(rk); return t == null ? '—' : fmtFn(t, rk, 'total'); })(), { bold: true }));
  };
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-start gap-4 gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, title), note ? el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, note) : null),
      opts.headerExtra || null),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
      el('thead', {}, el('tr', {}, _mktgTh(opts.firstCol || '', false), ...MKTG_MONTHS.map(mn => _mktgTh(mn)), _mktgTh('Total'))),
      el('tbody', {}, ...rows.map(rowEl)))));
}
const _mktgUsd0 = (v) => fmt.usd0(v);
const _mktgPct = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(0) + '%';
const _mktgX = (v) => v == null || !isFinite(v) ? '—' : v.toFixed(2) + 'x';
const _mktgDiv = (a, b) => (b > 0 ? a / b : null);
function _mktgYearBar(sub) {
  const y = _mktgYearSel();
  const SUBS = [['pnl', 'P&L'], ['cac', 'CAC'], ['providers', 'Providers'], ['spend', 'Spend entry'], ['projections', 'Projections']];
  return el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' },
    el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...SUBS.map(([v, l]) => el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition',
        style: sub === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
        onclick: () => { state._mktSub = v; mountApp(); },
      }, l))),
    el('div', { class: 'inline-flex items-center gap-1 ' },
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._mktYear = y - 1; mountApp(); } }, '‹'),
      el('span', { class: 'text-sm font-black tabular-nums px-1' }, String(y)),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._mktYear = y + 1; mountApp(); } }, '›')),
    _mktgQboConnectBtn(),
    el('span', { class: 'text-[10px] text-muted-' }, 'FieldRoutes: revenue · subs · bookings   ·   QuickBooks: booked spend   ·   hand-entered: allocation, wages, leads'));
}

// One-click QuickBooks connect (admin): a plain navigation to the connect
// function (the session token rides in the query — a redirect can't carry
// a header). Intuit bounces back to /?qbo=connected#marketing.
function _mktgQboConnectBtn() {
  // Retired (per Isaac): QuickBooks now comes through Windsor, so there's
  // nothing to connect from the app. Kept as a no-op so callers stay simple.
  return null;
  // eslint-disable-next-line no-unreachable
  if (!isAdminRole(state.profile?.role)) return null;
  const connected = state._isSpendSource === 'QuickBooks';
  return el('button', {
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold border transition hover:brightness-95 whitespace-nowrap',
    style: connected ? { borderColor: 'var(--border-2)', color: 'var(--text-muted)', background: 'var(--card)' } : { background: '#2CA01C', color: '#fff', borderColor: '#2CA01C' },
    title: connected ? 'QuickBooks is connected — click to reconnect / switch company' : 'Authorize the app to read RIDD\u2019s QuickBooks P&L (Advertising & Marketing by branch)',
    onclick: async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session || !session.access_token) { toast('Sign in again first', 'warn'); return; }
        location.href = '/api/qbo-connect?t=' + encodeURIComponent(session.access_token);
      } catch (e) { toast('Could not start the QuickBooks connect: ' + ((e && e.message) || e), 'error'); }
    },
  }, connected ? '\u2713 QuickBooks connected' : 'Connect QuickBooks');
}
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
  const groups = new Set(['RPC', 'RPS', 'RIDD']);
  const rows = [...B.rpc, 'RPC', ...B.rps, 'RPS', 'RIDD'];
  const members = (rk) => rk === 'RPC' ? B.rpc : rk === 'RPS' ? B.rps : rk === 'RIDD' ? B.all : [rk];
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
  const opts = { groupRows: groups, label: (rk) => groups.has(rk) ? rk : _mktgTC(rk), firstCol: 'Branch' };
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
    // Efficiency (per Isaac): ROAS · CAC · Ad spend % of CAC · Wages % of
    // CAC in ONE table with a dropdown, instead of four stacked matrices.
    (() => {
      const METRICS = {
        roas:   { label: 'ROAS',              note: 'new revenue ÷ ad spend · goal ' + T.roas + '+',                                  cell: (rk, i) => _mktgDiv(rev(rk, i), ad(rk, i)), fmt: _mktgX,   total: ratioTotal(rev, ad), style: goalStyle(T.roas, (v, g) => v >= g) },
        cac:    { label: 'CAC',               note: 'total spend ÷ new revenue',                                                      cell: (rk, i) => _mktgDiv(tot(rk, i), rev(rk, i)), fmt: _mktgPct, total: ratioTotal(tot, rev) },
        adcac:  { label: 'Ad spend % of CAC', note: 'ad spend ÷ new revenue · goal ' + Math.round(T.adSpendCac * 100) + '%',         cell: (rk, i) => _mktgDiv(ad(rk, i), rev(rk, i)),  fmt: _mktgPct, total: ratioTotal(ad, rev),  style: goalStyle(T.adSpendCac, (v, g) => v <= g) },
        wgcac:  { label: 'Wages % of CAC',    note: 'wages ÷ new revenue · goal ' + Math.round(T.wagesCac * 100) + '%',              cell: (rk, i) => _mktgDiv(wg(rk, i), rev(rk, i)),  fmt: _mktgPct, total: ratioTotal(wg, rev),  style: goalStyle(T.wagesCac, (v, g) => v <= g) },
        // Cost per job (per Isaac): total spend ÷ subscriptions sold (new +
        // upsell, pending/serviced) — the same rows New revenue is built on.
        cpj:    { label: 'Cost per job',      note: 'total spend ÷ subscriptions (new + upsell · pending/serviced · by sold month)',    cell: (rk, i) => _mktgDiv(tot(rk, i), jobs(rk, i)), fmt: _mktgUsd0, total: ratioTotal(tot, jobs) },
      };
      const key = METRICS[state._mktEffMetric] ? state._mktEffMetric : 'roas';
      const M = METRICS[key];
      const picker = el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer ml-auto',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => { state._mktEffMetric = e.target.value; mountApp(); },
      }, ...Object.entries(METRICS).map(([k, v]) => el('option', { value: k, selected: k === key }, v.label)));
      return _mktgMatrixCard('Efficiency · ' + M.label, M.note, rows, M.cell, M.fmt, { ...opts, total: M.total, cellStyle: M.style, headerExtra: picker });
    })(),
    // (QuickBooks booked vs allocated card dropped — ad spend is QuickBooks-only now.)
  );
}

// ── CAC: monthly rollup ──
function _mktgCac() {
  const y = _mktgYearSel(), m = _mktgStore(), a = _mktgActuals(y), B = _mktgBranchList(y), s = m.settings;
  // Scope (per Isaac): RIDD · RPC · RPS · or any single office.
  const scope = state._mktCacScope || 'RIDD';
  const scopeBranches = scope === 'RIDD' ? B.all : scope === 'RPC' ? B.rpc : scope === 'RPS' ? B.rps : [scope];
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
  const proj = (i) => { let t = 0; for (const b of scopeBranches) t += (Number(s.branchGoals[b]) || 0) * (s.seasonal[i] || 0); return t; };
  const scopeSel = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer font-semibold',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
    onchange: (e) => { state._mktCacScope = e.target.value; mountApp(); },
  },
    ...[['RIDD', 'RIDD (all)'], ['RPC', 'RPC'], ['RPS', 'RPS']].map(([v, l]) => el('option', { value: v, selected: scope === v }, l)),
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
    el('div', { class: 'flex items-center gap-2 flex-wrap' }, el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Office'), scopeSel),
    _mktgMatrixCard('CAC · ' + (['RIDD', 'RPC', 'RPS'].includes(scope) ? scope : _mktgTC(scope)), 'FieldRoutes revenue & counts · QuickBooks ad spend (allocation for unbooked months) · wages / incentives from Spend entry · projection from Configurations', ROWS.map(r => r[0]),
      (rk, i) => byKey[rk][1](i),
      (v, rk) => byKey[rk][2](v),
      { firstCol: 'Metric', groupRows: new Set(['Total new sales', 'Total new revenue', 'Total spend']),
        total: (rk) => { const r = byKey[rk]; if (r[3] === 'sum') { let t = 0; for (let i = 0; i < 12; i++) t += r[1](i) || 0; return t; } let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += r[4][0](i) || 0; d += r[4][1](i) || 0; } return _mktgDiv(n, d); } }));
}

// ── Providers: lead partner × month ──
function _mktgProviders() {
  const y = _mktgYearSel(), m = _mktgStore(), a = _mktgActuals(y), T = m.settings.targets;
  const channels = [...new Set([...m.channels, ...a.sources.filter(s => reportingSourceClass(s) === 'new')])].sort();
  const rows = [...channels, 'RIDD'];
  const groups = new Set(['RIDD']);
  const srcRow = (ch) => a.source[ch];
  const rev = (ch, i) => ch === 'RIDD' ? channels.reduce((t, c) => t + rev(c, i), 0) : (srcRow(ch) ? srcRow(ch)[i].rev + srcRow(ch)[i].upRev : 0);
  const book = (ch, i) => ch === 'RIDD' ? channels.reduce((t, c) => t + book(c, i), 0) : (srcRow(ch) ? srcRow(ch)[i].bookings : 0);
  const sp = (ch, i) => ch === 'RIDD' ? channels.reduce((t, c) => t + sp(c, i), 0) : _mktgSpendChannelMonth(m, _mktgYm(y, i), ch);
  const leads = (ch, i) => ch === 'RIDD' ? channels.reduce((t, c) => t + leads(c, i), 0) : (Number((m.leads[_mktgYm(y, i)] || {})[ch]) || 0);
  const opts = { groupRows: groups, firstCol: 'Source' };
  const ratioTotal = (num, den) => (rk) => { let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += num(rk, i); d += den(rk, i); } return _mktgDiv(n, d); };
  const gs = (goal, better) => (v) => v == null ? {} : { color: better(v, goal) ? '#5F6C5B' : '#DC2626', fontWeight: '600' };
  // One card, one metric picker (per Isaac, Sep 2026) — the ten source ×
  // month matrices were the same table ten times over. Volume metrics
  // carry the RIDD total row; the two weight views are shares, so no total.
  const wt = (num) => ({ firstCol: 'Source', total: (ch) => { let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += num(ch, i); d += num('RIDD', i); } return _mktgDiv(n, d); } });
  const METRICS = [
    { key: 'rev',     group: 'Volume',     label: 'Revenue',          note: 'FieldRoutes · new + upsell revenue by subscription source', rows, cell: rev, fmt: _mktgUsd0, opts },
    { key: 'spend',   group: 'Volume',     label: 'Ad spend',         note: 'hand-entered allocation (Spend entry), summed across branches', rows, cell: sp, fmt: _mktgUsd0, opts },
    { key: 'leads',   group: 'Volume',     label: 'Leads',            note: 'hand-entered (Spend entry)', rows, cell: leads, fmt: fmt.int, opts },
    { key: 'book',    group: 'Volume',     label: 'Bookings',         note: 'FieldRoutes · accounts sold by source', rows, cell: book, fmt: fmt.int, opts },
    { key: 'cpl',     group: 'Efficiency', label: 'Cost per lead',    note: 'ad spend ÷ leads', rows, cell: (ch, i) => _mktgDiv(sp(ch, i), leads(ch, i)), fmt: _mktgUsd0, opts: { ...opts, total: ratioTotal(sp, leads) } },
    { key: 'spj',     group: 'Efficiency', label: 'Ad spend per job', note: 'ad spend ÷ bookings · goal under ' + fmt.usd0(T.spendPerJob), rows, cell: (ch, i) => _mktgDiv(sp(ch, i), book(ch, i)), fmt: _mktgUsd0, opts: { ...opts, total: ratioTotal(sp, book), cellStyle: gs(T.spendPerJob, (v, g) => v <= g) } },
    { key: 'roas',    group: 'Efficiency', label: 'ROAS',             note: 'revenue ÷ ad spend · goal ' + T.roas + '+', rows, cell: (ch, i) => _mktgDiv(rev(ch, i), sp(ch, i)), fmt: _mktgX, opts: { ...opts, total: ratioTotal(rev, sp), cellStyle: gs(T.roas, (v, g) => v >= g) } },
    { key: 'cac',     group: 'Efficiency', label: 'Ad spend CAC',     note: 'ad spend ÷ revenue (no wages) · goal ' + Math.round(T.adSpendCac * 100) + '%', rows, cell: (ch, i) => _mktgDiv(sp(ch, i), rev(ch, i)), fmt: _mktgPct, opts: { ...opts, total: ratioTotal(sp, rev), cellStyle: gs(T.adSpendCac, (v, g) => v <= g) } },
    { key: 'revW',    group: 'Mix',        label: 'Revenue weight',   note: 'share of the month’s revenue', rows: channels, cell: (ch, i) => _mktgDiv(rev(ch, i), rev('RIDD', i)), fmt: _mktgPct, opts: wt(rev) },
    { key: 'spendW',  group: 'Mix',        label: 'Spend weight',     note: 'share of the month’s ad spend', rows: channels, cell: (ch, i) => _mktgDiv(sp(ch, i), sp('RIDD', i)), fmt: _mktgPct, opts: wt(sp) },
  ];
  const cur = METRICS.find(x => x.key === state._mktProvMetric) || METRICS[0];
  const groupsL = [...new Set(METRICS.map(x => x.group))];
  const picker = el('select', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
    onchange: (e) => { state._mktProvMetric = e.target.value; mountApp(); },
  }, ...groupsL.map(g => el('optgroup', { label: g }, ...METRICS.filter(x => x.group === g).map(x => el('option', { value: x.key, selected: x.key === cur.key }, x.label)))));
  return el('div', { class: 'flex flex-col gap-4' },
    _mktgMatrixCard(cur.label, cur.note, cur.rows, cur.cell, cur.fmt, { ...cur.opts, headerExtra: el('div', { class: 'ml-auto flex items-center gap-2' }, el('span', { class: 'text-[10px] text-muted-' }, 'Metric'), picker) }));
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
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
      el('thead', {}, el('tr', {}, th('Branch', false), ...channels.map(ch => th(ch)), th('Total'), th('Wages'), th('Incentives'))),
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
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
      el('thead', {}, el('tr', {}, th('Channel', false), th('Leads'), th('GHL says'))),
      el('tbody', {}, ...channels.map(ch => el('tr', { class: 'border-t border-' },
        _mktgTd(ch, { left: true, bold: true }),
        el('td', { class: 'px-1 py-1 text-left' }, inp((m.leads[ym] || {})[ch], (v) => { m.leads[ym] = m.leads[ym] || {}; if (v > 0) m.leads[ym][ch] = v; else delete m.leads[ym][ch]; })),
        _mktgTd(ghlFor(ch) == null ? '—' : fmt.int(ghlFor(ch)), { style: { color: 'var(--text-muted)' } })))))));
  return el('div', { class: 'flex flex-col gap-4' }, matrix, leadsCard);
}

// ── Projections ──
function _mktgProjections() {
  const y = _mktgYearSel(), m = _mktgStore(), s = m.settings, B = _mktgBranchList(y), a = _mktgActuals(y);
  const groups = new Set(['RPC', 'RPS', 'RIDD']);
  const rows = [...B.rpc, 'RPC', ...B.rps, 'RPS', 'RIDD'];
  const members = (rk) => rk === 'RPC' ? B.rpc : rk === 'RPS' ? B.rps : rk === 'RIDD' ? B.all : [rk];
  const goal = (b) => Number(s.branchGoals[b]) || 0;
  const pRev = (rk, i) => members(rk).reduce((t, b) => t + goal(b) * (s.seasonal[i] || 0), 0);
  const pAd  = (rk, i) => pRev(rk, i) * s.adSpendPct;
  const pWg  = (rk, i) => pRev(rk, i) * s.wagesPct;
  const pInc = (rk, i) => pRev(rk, i) * s.incentivesPct;
  const aRev = (rk, i) => members(rk).reduce((t, b) => t + (a.branch[b] ? a.branch[b][i].rev + a.branch[b][i].upRev : 0), 0);
  const opts = { groupRows: groups, label: (rk) => groups.has(rk) ? rk : _mktgTC(rk), firstCol: 'Branch' };
  const num = (v, onSave, opts2 = {}) => el('input', { type: 'number', step: opts2.step || '1', value: v == null ? '' : String(v), class: 'rounded-lg border px-2.5 py-1 text-[11px] text-left', style: { width: opts2.w || '110px', borderColor: 'var(--border-2)' },
    onchange: (e) => { const x = parseFloat(e.target.value); onSave(isNaN(x) ? 0 : x); _mktgSave(); mountApp(); } });
  const goalsCard = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, 'Branch goals · ' + y),
      el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, 'revenue goal per branch · ad spend ' + Math.round(s.adSpendPct * 100) + '% · wages ' + Math.round(s.wagesPct * 100) + '% · incentives ' + Math.round(s.incentivesPct * 100) + '% (rates in Configurations)')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
      el('thead', {}, el('tr', {}, _mktgTh('Branch', false), _mktgTh('Revenue goal'), _mktgTh('Ad spend'), _mktgTh('Wages'), _mktgTh('Incentives'), _mktgTh('Total spend'), _mktgTh('Attrition %', true, 'Projected annual attrition — sets replacement revenue'), _mktgTh('YTD actual'), _mktgTh('% of goal'))),
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
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
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
    _mktgMatrixCard('Projected revenue', 'branch goal × seasonal allocation (Configurations)', rows, pRev, _mktgUsd0, opts),
    _mktgMatrixCard('Actual vs projected', 'FieldRoutes actual ÷ projected', rows, (rk, i) => { const p = pRev(rk, i); return p > 0 ? aRev(rk, i) / p : null; }, _mktgPct, { ...opts, cellStyle: (v) => v == null ? {} : { color: v >= 1 ? '#5F6C5B' : v >= 0.8 ? '#A9441F' : '#DC2626', fontWeight: '600' }, total: (rk) => { let n = 0, d = 0; for (let i = 0; i < 12; i++) { n += aRev(rk, i); d += pRev(rk, i); } return _mktgDiv(n, d); } }),
    _mktgMatrixCard('Projected ad spend', 'projected revenue × ' + Math.round(s.adSpendPct * 100) + '%', rows, pAd, _mktgUsd0, opts),
    _mktgMatrixCard('Projected wages', 'projected revenue × ' + Math.round(s.wagesPct * 100) + '%', rows, pWg, _mktgUsd0, opts),
    _mktgMatrixCard('Projected incentives', 'projected revenue × ' + Math.round(s.incentivesPct * 100) + '%', rows, pInc, _mktgUsd0, opts),
    _mktgMatrixCard('Projected total spend', 'ad spend + wages + incentives', rows, (rk, i) => pAd(rk, i) + pWg(rk, i) + pInc(rk, i), _mktgUsd0, opts),
    chCard);
}

// ── Configurations card: quota + projection rates + targets ──
function reportingMarketingGoalsPanel() {
  const m = _mktgStore(), s = m.settings;
  const num = (v, onSave, opts = {}) => el('input', { type: 'number', step: opts.step || '1', value: v == null ? '' : String(v), class: 'rounded-lg border px-2.5 py-1 text-[11px] text-left', style: { width: opts.w || '110px', borderColor: 'var(--border-2)' },
    onchange: (e) => { const x = parseFloat(e.target.value); onSave(isNaN(x) ? 0 : x); _mktgSave(); mountApp(); } });
  const row = (label, node, hint) => el('div', { class: 'flex items-center gap-4 gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'min-w-0' }, el('div', { class: 'text-[12px] font-semibold' }, label), hint ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, hint) : null), node);
  const pctIn = (get, set) => num(Math.round(get() * 100), (v) => set(v / 100), { w: '70px' });
  const isMonthly = (i) => s.isGoal * (s.seasonal[i] || 0), rnMonthly = (i) => s.renewalsGoal * (s.renewalSeasonal[i] || 0);
  const q = (arr, from) => arr.slice(from, from + 3).reduce((t, v) => t + v, 0);
  const seasonalTable = (title, arr, total, reps, key) => el('div', { class: 'mt-3' },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-1', style: { color: 'var(--text-muted)' } }, title + ' · ' + (Math.round(arr.reduce((t, v) => t + v, 0) * 1000) / 10) + '% allocated'),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, _mktgTh('', false), ...MKTG_MONTHS.map(mn => _mktgTh(mn)))),
      el('tbody', {},
        el('tr', { class: 'border-t border-' }, _mktgTd('%', { left: true, bold: true }), ...arr.map((v, i) => el('td', { class: 'px-1 py-1 text-left' }, num(Math.round(v * 1000) / 10, (x) => { s[key][i] = x / 100; }, { w: '56px', step: '0.5' })))),
        el('tr', { class: 'border-t border-' }, _mktgTd('Quota', { left: true, bold: true }), ...arr.map((v, i) => _mktgTd(fmt.usd0(total * v)))),
        el('tr', { class: 'border-t border-', style: { background: 'var(--card-2)' } }, _mktgTd('Per rep / qtr', { left: true, bold: true }), ...[0, 3, 6, 9].flatMap(f => [_mktgTd(fmt.usd0(total * q(arr, f) / Math.max(1, reps)), { bold: true }), _mktgTd(''), _mktgTd('')]))))));
  return el('div', { class: 'card p-5' },
    el('h2', { class: 'text-base font-bold' }, '🎯 Marketing goals & quota'),
    el('div', { class: 'text-[10px] mt-0.5 mb-2', style: { color: 'var(--text-muted)' } }, 'Drives the Marketing report’s Projections and CAC targets. Saved for every admin.'),
    row('Inside Sales goal', num(s.isGoal, (v) => { s.isGoal = v; }), 'annual new revenue'),
    row('Inside Sales reps', num(s.isReps, (v) => { s.isReps = v; }, { w: '70px' })),
    row('Renewals goal', num(s.renewalsGoal, (v) => { s.renewalsGoal = v; }), 'annual renewal revenue'),
    row('Loyalty reps', num(s.loyaltyReps, (v) => { s.loyaltyReps = v; }, { w: '70px' })),
    row('Ad spend % of revenue', pctIn(() => s.adSpendPct, (v) => { s.adSpendPct = v; }), 'projection rate'),
    row('Wages % of revenue', pctIn(() => s.wagesPct, (v) => { s.wagesPct = v; }), 'projection rate'),
    row('Incentives % of revenue', pctIn(() => s.incentivesPct, (v) => { s.incentivesPct = v; }), 'projection rate'),
    row('Target · ad spend CAC', pctIn(() => s.targets.adSpendCac, (v) => { s.targets.adSpendCac = v; }), 'ad spend ÷ revenue, at or under'),
    row('Target · wages CAC', pctIn(() => s.targets.wagesCac, (v) => { s.targets.wagesCac = v; }), 'wages ÷ revenue, at or under'),
    row('Target · ROAS', num(s.targets.roas, (v) => { s.targets.roas = v; }, { w: '70px', step: '0.1' }), 'revenue ÷ ad spend, at or over'),
    row('Target · ad spend per job', num(s.targets.spendPerJob, (v) => { s.targets.spendPerJob = v; }, { w: '90px' }), 'at or under'),
    seasonalTable('Inside Sales seasonal allocation', s.seasonal, s.isGoal, s.isReps, 'seasonal'),
    seasonalTable('Renewals seasonal allocation', s.renewalSeasonal, s.renewalsGoal, s.loyaltyReps, 'renewalSeasonal'));
}

function reportingMarketingPnl() {
  reportingLoadGhlLeads();
  reportingLoadQboSpend();
  const sub = ['pnl', 'cac', 'providers', 'spend', 'projections'].includes(state._mktSub) ? state._mktSub : 'pnl';
  const body = sub === 'cac' ? _mktgCac() : sub === 'providers' ? _mktgProviders() : sub === 'spend' ? _mktgSpendEntry() : sub === 'projections' ? _mktgProjections() : _mktgPnl();
  return el('div', { class: 'flex flex-col gap-4' }, _mktgYearBar(sub), body);
}

const REPORTING_MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const reportingMonthLbl = (ym) => { const [y, m] = ym.split('-'); return REPORTING_MONTH_ABBR[Number(m) - 1] + " '" + y.slice(2); };

// Year-over-year: grouped bars = monthly marketing spend (is-spend.json) for this
// year vs last; two lines = monthly new recurring revenue (ARR) for committed-sold
// Office-Staff accounts, this year vs last. X-axis is calendar months Jan→Dec.
function reportingMktgSpendRevChart() {
  const id = 'mktgSpendRev';
  const rows = state.reportingSubscriptions || [];
  const SP = state.reportingIsSpend || {};
  const isExcl = reportingExcludedSources();
  const nowY = new Date().getFullYear();
  const curY = String(nowY), prevY = String(nowY - 1);
  // SAME revenue series as the Inside Sales Pacer (per Isaac): new
  // office-staff CONTRACT revenue, Pending/Serviced gate — no autopay
  // requirement, no ARR. The two charts must tell one story.
  const revByYM = {};
  for (const r of rows) {
    const sd = r.sold_date; if (!sd) continue;
    const src = (r.subscription_source || '').trim();
    if (isExcl.has(src || 'Unspecified')) continue;
    if (reportingSourceClass(src) !== 'new') continue;  // NEW business only (exclude renewals + upsells)
    if (!reportingIsOfficeStaff(r)) continue;
    const _ist = String(r.initial_status || '').toLowerCase();
    if (_ist ? (_ist !== 'pending' && _ist !== 'completed') : (!r.initial_service && r.subscription_date_canceled)) continue;
    const ym = sd.slice(0, 7);
    revByYM[ym] = (revByYM[ym] || 0) + (Number(r.subscription_contract_value) || 0);
  }
  const spendByYM = {};
  for (const ym in SP) { let s = 0; for (const ch in SP[ym]) s += SP[ym][ch] || 0; spendByYM[ym] = s; }
  const monthKeys = (y) => Array.from({ length: 12 }, (_, i) => y + '-' + String(i + 1).padStart(2, '0'));
  // Only plot spend for months we actually have (reliable, branch-categorized)
  // data for — months with no trustworthy spend render as a gap, not a $0 bar.
  const spendCur  = monthKeys(curY).map(k => (k in spendByYM) ? spendByYM[k] : null);
  const spendPrev = monthKeys(prevY).map(k => (k in spendByYM) ? spendByYM[k] : null);
  const revCur    = monthKeys(curY).map(k => revByYM[k] || 0);
  const revPrev   = monthKeys(prevY).map(k => revByYM[k] || 0);
  const hasPrev   = spendPrev.some(v => v > 0) || revPrev.some(v => v > 0);
  const lbl = REPORTING_MONTH_ABBR;
  const cvsWrap = el('div', { style: { position: 'relative', height: '240px', width: '100%' } });
  const cvs = el('canvas', { id }); cvsWrap.append(cvs);
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const cvsEl = document.getElementById(id); if (!cvsEl) return;
    if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
    const isDark = state.theme === 'dark';
    const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const barCur = isDark ? '#E6E6DC' : '#323230', barPrev = isDark ? '#6b6b63' : '#B8B8AE';
    const datasets = [
      { type: 'bar', label: 'Spend ' + curY, data: spendCur, backgroundColor: barCur, order: 3 },
      ...(hasPrev ? [{ type: 'bar', label: 'Spend ' + prevY, data: spendPrev, backgroundColor: barPrev, order: 3 }] : []),
      { type: 'line', label: 'IS Rev ' + curY, data: revCur, borderColor: '#DF643A', backgroundColor: '#DF643A', borderWidth: 2, tension: 0.3, fill: false, pointRadius: 2, order: 1 },
      ...(hasPrev ? [{ type: 'line', label: 'IS Rev ' + prevY, data: revPrev, borderColor: '#DF643A', backgroundColor: '#DF643A', borderWidth: 2, borderDash: [5, 4], tension: 0.3, fill: false, pointRadius: 2, order: 2 }] : []),
    ];
    _chartInstances[id] = new Chart(cvsEl.getContext('2d'), {
      data: { labels: lbl, datasets },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } } }, scales: { x: { ticks: { color: txt }, grid: { color: grid } }, y: { beginAtZero: true, ticks: { color: txt, callback: v => '$' + (v >= 1000 ? (v / 1000) + 'k' : v) }, grid: { color: grid } } } },
    });
  }, 50);
  const _spendStamp = state._isSpendSource === 'QuickBooks'
    ? 'QuickBooks · pulled ' + (state._isSpendPulledAt ? new Date(state._isSpendPulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'just now')
    : state._isSpendSource === 'none' ? '\u26a0 QuickBooks feed unavailable' : 'loading spend\u2026';
  const _spendRefresh = el('button', {
    class: 'text-[11px] font-semibold px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text-muted)' },
    title: 'Re-pull marketing spend from QuickBooks now (bypasses the 1-hour cache)',
    onclick: async (e) => {
      const b = e.currentTarget; b.disabled = true; b.textContent = '\u23f3 pulling\u2026';
      try {
        const h = await _apiAuthHeaders();
        const r = await fetch('/api/qbo-spend?_=' + Date.now(), { headers: h });
        const j = r.ok ? await r.json() : null;
        if (j && j.bySourceMonth && Object.keys(j.bySourceMonth).length) {
          state.reportingIsSpend = j.bySourceMonth; state._isSpendSource = 'QuickBooks'; state._isSpendPulledAt = j.pulledAt;
          toast('QuickBooks spend refreshed', 'success');
        } else toast('QuickBooks pull failed \u2014 check the qbo-spend function logs', 'error');
      } catch (err) { toast('QuickBooks pull failed: ' + ((err && err.message) || err), 'error'); }
      mountApp();
    },
  }, '\u21bb QuickBooks');
  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap mb-1' },
      el('h3', { class: 'text-base font-bold' }, 'Marketing Spend vs Inside Sales Revenue'),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('span', { class: 'text-[10px]', style: { color: state._isSpendSource === 'none' ? '#A9441F' : 'var(--text-subtle)' } }, _spendStamp),
        _mktgQboConnectBtn(),
        _spendRefresh)),
    el('div', { class: 'text-[11px] text-muted- mb-3' }, 'Year-over-year by month · bars = marketing spend (months with verified QuickBooks data only) · lines = new contract revenue, office-staff sold, Pending/Serviced — same series as the pacer · ' + curY + ' solid vs ' + prevY + ' dashed'),
    cvsWrap,
  );
}

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
function reportingMktgLeadsChart() {
  const id = 'mktgLeads';
  const L = state.reportingGhlLeads;
  const loadingMore = !!state._ghlLoading || (!state._ghlDone && !!state._ghlCursor);
  const refreshBtn = el('button', {
    class: 'text-[11px] font-semibold px-2.5 py-1 rounded-lg border cursor-pointer transition hover:brightness-95',
    style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text-muted)' },
    title: 'Re-pull leads from GoHighLevel',
    onclick: () => reportingRefreshGhlLeads(),
  }, loadingMore ? '⏳ loading…' : '↻ refresh');

  const pad = n => String(n).padStart(2, '0');
  const isoOf = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  const today = new Date(), todayIso = isoOf(today);
  const RANGES = [['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['custom', 'Custom']];
  let range = state.mktgLeadsRange;
  if (!RANGES.some(r => r[0] === range)) { try { range = localStorage.getItem('ridd_mktg_leads_range'); } catch {} }
  if (!RANGES.some(r => r[0] === range)) range = 'month';
  let start, end;
  if (range === 'today') { start = end = todayIso; }
  else if (range === 'week') { const d = new Date(today); d.setDate(d.getDate() - d.getDay()); start = isoOf(d); end = todayIso; }
  else if (range === 'month') { start = isoOf(new Date(today.getFullYear(), today.getMonth(), 1)); end = todayIso; }
  else {
    try { state.mktgLeadsFrom = state.mktgLeadsFrom || localStorage.getItem('ridd_mktg_leads_from'); state.mktgLeadsTo = state.mktgLeadsTo || localStorage.getItem('ridd_mktg_leads_to'); } catch {}
    start = state.mktgLeadsFrom || isoOf(new Date(today.getFullYear(), today.getMonth(), 1));
    end = state.mktgLeadsTo || todayIso;
  }

  const filterSel = el('select', {
    class: 'text-[11px] rounded-lg border px-1.5 py-1',
    style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
    onchange: (e) => { state.mktgLeadsRange = e.target.value; try { localStorage.setItem('ridd_mktg_leads_range', e.target.value); } catch {} mountApp(); },
  }, ...RANGES.map(([v, lab]) => el('option', { value: v }, lab)));
  filterSel.value = range;
  const dInput = (val, set) => el('input', { type: 'date', value: val, class: 'text-[11px] rounded-lg border px-1.5 py-1', style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' }, onchange: (e) => { set(e.target.value); mountApp(); } });
  const customInputs = range === 'custom' ? el('div', { class: 'flex items-center gap-1' },
    dInput(start, v => { state.mktgLeadsFrom = v; try { localStorage.setItem('ridd_mktg_leads_from', v); } catch {} }),
    el('span', { class: 'text-[10px] text-muted-' }, '→'),
    dInput(end, v => { state.mktgLeadsTo = v; try { localStorage.setItem('ridd_mktg_leads_to', v); } catch {} })) : null;
  const rangeLabel = (RANGES.find(r => r[0] === range) || [])[1] || '';

  const card = (inner) => el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-start justify-between gap-2 flex-wrap' },
      el('div', {},
        el('h3', { class: 'text-base font-bold mb-1' }, 'Leads by Source'),
        el('div', { class: 'text-[11px] text-muted- mb-3' }, 'GoHighLevel leads by day, stacked by source · ' + rangeLabel + (loadingMore ? ' · loading…' : ''))),
      el('div', { class: 'flex items-center gap-2 flex-wrap' }, filterSel, customInputs, refreshBtn)),
    inner);

  const C = (L && Array.isArray(L.contacts)) ? L.contacts : null;
  if (!C || !C.length) {
    return card(el('div', { class: 'p-8 text-center text-xs text-muted- italic' },
      loadingMore ? 'Loading GoHighLevel leads…'
        : (state.reportingGhlLeads == null ? 'Connecting to GoHighLevel…' : 'No lead detail yet — hit ↻ refresh to pull it from GoHighLevel.')));
  }

  const inRange = C.filter(c => c.d && c.d >= start && c.d <= end);
  const days = []; { let d = new Date(start + 'T00:00'), e = new Date(end + 'T00:00'); let guard = 0; while (d <= e && guard++ < 800) { days.push(isoOf(d)); d.setDate(d.getDate() + 1); } }
  const dayIdx = {}; days.forEach((d, i) => dayIdx[d] = i);
  const srcTot = {};
  inRange.forEach(c => { const s = reportingCanonSource(c.s); srcTot[s] = (srcTot[s] || 0) + 1; });
  const ranked = Object.keys(srcTot).sort((a, b) => srcTot[b] - srcTot[a]);
  const top = ranked.slice(0, 8), rest = new Set(ranked.slice(8));
  const series = [...top, ...(rest.size ? ['Other'] : [])];
  const data = {}; series.forEach(s => data[s] = days.map(() => 0));
  inRange.forEach(c => { let s = reportingCanonSource(c.s); if (rest.has(s)) s = 'Other'; const di = dayIdx[c.d]; if (data[s] && di != null) data[s][di]++; });
  const lbl = days.map(d => { const p = d.split('-'); return REPORTING_MONTH_ABBR[Number(p[1]) - 1] + ' ' + Number(p[2]); });

  const cvsWrap = el('div', { style: { position: 'relative', height: '240px', width: '100%' } });
  const cvs = el('canvas', { id }); cvsWrap.append(cvs);
  setTimeout(() => {
    if (typeof Chart === 'undefined') return;
    const cvsEl = document.getElementById(id); if (!cvsEl) return;
    if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
    const isDark = state.theme === 'dark';
    const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const datasets = series.map((s, i) => ({ label: s, data: data[s], backgroundColor: REPORTING_PALETTE[i % REPORTING_PALETTE.length], stack: 's' }));
    _chartInstances[id] = new Chart(cvsEl.getContext('2d'), {
      type: 'bar', data: { labels: lbl, datasets },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { footer: items => 'Total: ' + items.reduce((s, it) => s + (it.parsed.y || 0), 0).toLocaleString() + ' leads' } } }, scales: { x: { stacked: true, ticks: { color: txt, autoSkip: true, maxRotation: 0 }, grid: { color: grid } }, y: { stacked: true, beginAtZero: true, ticks: { color: txt, precision: 0 }, grid: { color: grid } } } },
    });
  }, 50);
  return card(el('div', {},
    el('div', { class: 'text-[11px] text-muted- mb-2' }, inRange.length.toLocaleString() + ' leads · ' + start + (start === end ? '' : ' → ' + end)),
    cvsWrap));
}

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

function reportingLeadAttribution() {
  // Prefer a separately-uploaded leads CSV; otherwise, if the loaded snapshot
  // carries a lead-source column, synthesize the leads straight from it — no
  // separate upload needed.
  let leads = state.reportingLeadRows;
  let fromSnapshot = false, fromGhl = false;
  if (!leads || !leads.length) {
    const withLS = (state.reportingSubscriptions || []).filter(r => r.lead_source && String(r.lead_source).trim());
    if (withLS.length) {
      leads = withLS.map(r => {
        const l = (r.last_name || '').trim(), f = (r.first_name || '').trim();
        return { phone: r.phone, email: r.email, source: r.lead_source, name: (l && f) ? (l + ', ' + f) : (l || f || r.customer_id || '') };
      });
      fromSnapshot = true;
    }
  }
  // No CSV and no lead-source column → fall back to the GoHighLevel leads we
  // already pull in: match those contacts (phone/email) to sold customers.
  if (!leads || !leads.length) {
    const gc = (state.reportingGhlLeads && state.reportingGhlLeads.contacts) || [];
    if (gc.length) {
      leads = gc.map(c => ({ phone: c.p, email: c.e, source: c.s, name: '' }));
      fromGhl = true;
    }
  }
  const fileInput = el('input', {
    type: 'file', accept: '.csv,.txt', style: { display: 'none' },
    onchange: (e) => {
      const f = e.target.files[0]; if (!f) return;
      const rd = new FileReader();
      rd.onload = (ev) => {
        try {
          const rows = parseLeadsCsv(ev.target.result);
          if (!rows.length) { toast('No leads found — need a phone or email column', 'warn'); return; }
          state.reportingLeadRows = rows; state.reportingLeadFile = f.name || ''; state.reportingLeadFilter = 'all'; state.reportingLeadLimit = 200;
          logActivity('config_change', { detail: 'Lead attribution CSV: ' + (f.name || '') + ' · ' + rows.length + ' leads' });
          mountApp();
          toast(rows.length.toLocaleString() + ' leads loaded', 'success');
        } catch (err) { toast('Parse error: ' + err.message, 'error'); }
      };
      rd.readAsText(f);
    },
  });
  const uploadBtn = el('button', {
    class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold transition hover:brightness-95',
    style: { background: 'var(--accent)', color: 'var(--accent-text)' },
    title: 'CSV with phone + email columns (and a source column)',
    onclick: () => fileInput.click(),
  }, fileInput, state.reportingLeadRows ? '📁 Re-upload leads' : '📁 Upload leads CSV');
  const clearBtn = state.reportingLeadRows ? el('button', {
    class: 'text-[11px] font-semibold', style: { color: 'var(--text-muted)' },
    onclick: () => { state.reportingLeadRows = null; state.reportingLeadFile = null; mountApp(); },
  }, 'Clear') : null;
  const subtitle = fromGhl
    ? 'Matching your GoHighLevel leads (phone + email) to sold customers, then checking the GHL source against the CRM tag — no upload needed.'
    : fromSnapshot
      ? 'Reading the lead source straight from the reporting snapshot and checking it against the CRM tag.'
      : 'Match a leads CSV (phone + email) to sold customers, then check the CSV source against the CRM tag.';
  const head = el('div', { class: 'flex items-start justify-between gap-3 flex-wrap mb-2' },
    el('div', {},
      el('h3', { class: 'text-base font-bold' }, 'Lead Attribution'),
      el('div', { class: 'text-[11px] text-muted-' }, subtitle)),
    el('div', { class: 'flex items-center gap-2' },
      state.reportingLeadRows && state.reportingLeadFile ? el('span', { class: 'text-[11px] text-muted-' }, state.reportingLeadFile) : null, clearBtn, uploadBtn));

  if (!leads || !leads.length) {
    return el('div', { class: 'card p-4' }, head,
      el('div', { class: 'p-6 text-center text-xs text-muted- italic' },
        (state._ghlLoading || (!state._ghlDone && state._ghlCursor))
          ? 'Loading your GoHighLevel leads… attribution will appear automatically once they finish pulling in.'
          : 'No lead source available yet. This pulls from GoHighLevel automatically — or add a "Lead Source" column to your Customer Report export, or upload a leads CSV. Phone matches on the last 10 digits.'));
  }

  // Customer contact index from the loaded snapshot (needs phone/email columns).
  const subs = state.reportingSubscriptions || [];
  const custName = (r) => { const l = (r.last_name || '').trim(), f = (r.first_name || '').trim(); return (l && f) ? (l + ', ' + f) : (l || f || r.customer_id || '—'); };
  const byPhone = new Map(), byEmail = new Map(), byCust = new Map();
  for (const r of subs) {
    const cid = r.customer_id || ('p:' + _leadNormPhone(r.phone) + '|e:' + _leadNormEmail(r.email));
    const info = { name: custName(r), source: (r.subscription_source || '').trim(), sold_date: r.sold_date || '' };
    const cur = byCust.get(cid);
    if (!cur || (info.sold_date && (!cur.sold_date || info.sold_date < cur.sold_date))) byCust.set(cid, info);
    const np = _leadNormPhone(r.phone); if (np && !byPhone.has(np)) byPhone.set(np, cid);
    const ne = _leadNormEmail(r.email); if (ne && !byEmail.has(ne)) byEmail.set(ne, cid);
  }
  const hasContact = byPhone.size > 0 || byEmail.size > 0;

  // Match each lead by phone, then email.
  const results = leads.map(L => {
    const np = _leadNormPhone(L.phone), ne = _leadNormEmail(L.email);
    let cid = null, via = null;
    if (np && byPhone.has(np)) { cid = byPhone.get(np); via = 'phone'; }
    else if (ne && byEmail.has(ne)) { cid = byEmail.get(ne); via = 'email'; }
    const cust = cid ? byCust.get(cid) : null;
    const leadSrc = (L.source || '').trim();
    let srcOk = null;
    if (cust && leadSrc && cust.source) {
      srcOk = reportingCanonSource(leadSrc).toLowerCase() === reportingCanonSource(cust.source).toLowerCase();
    }
    return { lead: L, matched: !!cust, via, cust, leadSrc, srcOk };
  });
  const nMatched = results.filter(r => r.matched).length;
  const nMis = results.filter(r => r.srcOk === false).length;
  const rate = results.length ? Math.round(100 * nMatched / results.length) : 0;

  // Filter pills.
  const filt = state.reportingLeadFilter || 'all';
  const pills = [['all', 'All ' + results.length], ['matched', 'Matched ' + nMatched], ['unmatched', 'No match ' + (results.length - nMatched)], ['mismatch', 'Source mismatch ' + nMis]];
  const pillBar = el('div', { class: 'flex items-center gap-1.5 flex-wrap mb-3' }, ...pills.map(([k, lab]) => el('button', {
    class: 'text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer transition',
    style: filt === k ? { background: 'var(--accent)', color: '#3A1D12', borderColor: 'var(--accent)' } : { background: 'transparent', color: 'var(--text-muted)', borderColor: 'var(--border-2)' },
    onclick: () => { state.reportingLeadFilter = k; state.reportingLeadLimit = 200; mountApp(); },
  }, lab)));

  const shown0 = results.filter(r => filt === 'all' ? true : filt === 'matched' ? r.matched : filt === 'unmatched' ? !r.matched : r.srcOk === false);
  const limit = state.reportingLeadLimit || 200;
  const shown = shown0.slice(0, limit);

  const exportCsv = () => {
    const head2 = ['Lead Name', 'Lead Phone', 'Lead Email', 'Lead Source', 'Matched', 'Via', 'Customer', 'CRM Source', 'Source OK'];
    const lines = [head2.map(csvEsc).join(',')];
    for (const r of results) lines.push([
      csvEsc(r.lead.name), csvEsc(r.lead.phone), csvEsc(r.lead.email), csvEsc(r.leadSrc),
      r.matched ? 'yes' : 'no', csvEsc(r.via || ''), csvEsc(r.cust ? r.cust.name : ''), csvEsc(r.cust ? r.cust.source : ''),
      r.srcOk == null ? '' : (r.srcOk ? 'match' : 'MISMATCH'),
    ].join(','));
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = el('a', { href: url, download: 'lead-attribution-' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const cellCls = 'px-2 py-1.5 whitespace-nowrap';
  const table = el('div', { class: 'rounded-lg border overflow-auto', style: { borderColor: 'var(--border)', maxHeight: '420px' } },
    el('table', { class: 'w-full text-[11px]' },
      el('thead', { class: 'text-[9px] uppercase tracking-wider sticky top-0', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
        el('tr', {},
          el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Lead'),
          el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Lead Source'),
          el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Match'),
          el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Customer (CRM)'),
          el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'CRM Source'),
          el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Source'))),
      el('tbody', {}, ...shown.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: cellCls },
          el('div', { class: 'font-medium' }, r.lead.name || r.lead.phone || r.lead.email || '—'),
          (r.lead.name && (r.lead.phone || r.lead.email)) ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, r.lead.phone || r.lead.email) : null),
        el('td', { class: cellCls + ' text-muted-' }, r.leadSrc || '—'),
        el('td', { class: cellCls },
          r.matched
            ? el('span', { class: 'text-[10px] font-bold', style: { color: '#DF643A' } }, '✓ ' + r.via)
            : el('span', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-subtle)' } }, '—')),
        el('td', { class: cellCls }, r.cust ? r.cust.name : '—'),
        el('td', { class: cellCls + ' text-muted-' }, r.cust ? (r.cust.source || '—') : '—'),
        el('td', { class: cellCls },
          r.srcOk == null ? el('span', { style: { color: 'var(--text-subtle)' } }, '—')
            : r.srcOk ? el('span', { style: { color: '#DF643A', fontWeight: '700' } }, '✓')
              : el('span', { class: 'px-1.5 py-0.5 rounded text-[10px] font-bold', style: { background: 'rgba(220,38,38,.12)', color: '#B91C1C' } }, '✕ mismatch')))))));

  const moreBar = shown0.length > shown.length ? el('div', { class: 'flex justify-center pt-2' },
    el('button', { class: 'text-[11px] font-semibold rounded-full px-2.5 py-1 border cursor-pointer', style: { background: 'var(--accent)', color: '#3A1D12', borderColor: 'var(--accent)' },
      onclick: () => { state.reportingLeadLimit = (state.reportingLeadLimit || 200) + 400; mountApp(); } }, 'Show ' + Math.min(400, shown0.length - shown.length) + ' more (' + shown.length.toLocaleString() + ' of ' + shown0.length.toLocaleString() + ')')) : null;

  return el('div', { class: 'card p-4' }, head,
    !hasContact ? el('div', { class: 'card p-3 mb-3 text-[11px]', style: { background: 'rgba(223,100,58,.12)' } },
      '⚠ The loaded Customer Report snapshot has no phone or email columns, so nothing can match. Re-export it with Phone Number and Email columns and re-upload the snapshot.') : null,
    el('div', { class: 'grid gap-2 mb-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(90px, 1fr))' } },
      ...[['Leads', results.length.toLocaleString()], ['Matched', nMatched.toLocaleString() + ' · ' + rate + '%'], ['Source mismatches', nMis.toLocaleString()]].map(([l, v]) =>
        el('div', { class: 'rounded-lg p-2 text-center', style: { background: 'var(--card-2)' } },
          el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, l),
          el('div', { class: 'text-base font-bold tabular-nums' }, v)))),
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' }, pillBar,
      el('button', { class: 'text-[11px] font-semibold rounded-lg px-2.5 py-1 border cursor-pointer', style: { background: 'var(--card-2)', color: 'var(--text)', borderColor: 'var(--border)' }, onclick: exportCsv }, '↓ Export results')),
    table, moreBar);
}

