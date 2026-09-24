// ┌─ src/96-retention.js ─────────────────────────────────────────────────────
// │ Reporting → Retention: attrition steps, what-ifs, reconcile tool, cohort waterfall, monthly churn, trends.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ── "How attrition is calculated" — step-by-step walkthrough with what-if
// slicers (per Isaac). Every step shows how many subscriptions it removes
// from the book (or how many cancels it strips), and any removable step can
// be switched off for THIS session to see attrition with vs without it.
// The official rules (Settings → Configurations) are untouched.
function _retenWhatIf(key, official) {
  const w = state._retenWhatIf;
  if (!w || state.reportingSubTab !== 'waterfall' || typeof w[key] !== 'boolean') return official;
  return w[key];
}
function retenWhatIfActive() {
  const w = state._retenWhatIf; if (!w) return false;
  if (w.reasons && Object.keys(w.reasons).length) return true;
  if (w.branches && Object.keys(w.branches).length) return true;
  return Object.keys(w).some(k => typeof w[k] === 'boolean' && w[k] !== _retenOfficial()[k]);
}
// ── GROUND ZERO (per Isaac): every subscription FieldRoutes has, before any
// app rule touches it. Branch renames still apply (cosmetic); nothing is
// excluded. The scope steps below take it down to the reporting population.
const _retenGroundMemo = { subs: null, del: null, ren: '', out: null };
function retenGroundZero() {
  const subs = state.reportingSubscriptions || [], del = state._deletedSubs || [];
  const ren = reportingBranchRenames(); const renKey = JSON.stringify(ren);
  const m = _retenGroundMemo;
  if (m.out && m.subs === subs && m.del === del && m.ren === renKey) return m.out;
  let base = del.length ? subs.concat(del) : subs;
  if (Object.keys(ren).length) base = base.map(r => { const o = (r.office_name || '').trim(); return ren[o] ? { ...r, office_name: ren[o] } : r; });
  m.subs = subs; m.del = del; m.ren = renKey; m.out = base;
  return base;
}
// Scope steps: what stands between "everything in FieldRoutes" and the
// population the rest of Reporting reads. Each is toggleable on the
// Retention tab (session what-ifs); official = the saved Configurations.
// Branches currently OUT of the retention funnel: the saved Configurations
// exclusions plus/minus the session picks made on the step's checklist.
// (Per Isaac: every branch is IN by default on this tab — the Configurations
// branch exclusions apply to the other Reporting tabs, not here.)
function retenBranchesOff() {
  const off = new Set();
  const w = state._retenWhatIf && state._retenWhatIf.branches;
  if (w && typeof w === 'object' && state.reportingSubTab === 'waterfall') for (const k in w) { if (w[k] === false) off.add(k); }
  return off;
}
// Memoized per (ground array, rules) — the waterfall builds the population
// and the steps card walks the same chain, so one pass serves both, and a
// re-render with nothing changed costs nothing.
const _retenScopeMemo = new WeakMap();
function retenScopeSteps(rows) {
  const key = JSON.stringify([_adminRules() || null, state._retenWhatIf || null, state.reportingSubTab, (state.reportingServiceConfig || []).map(c => c.service_name + ':' + (c.lifecycle || '') + ':' + (c.is_recurring == null ? '' : c.is_recurring)).join('|'), (state.reportingSourceConfig || []).length, (state.indicatorDeletedCustIds || []).length]);
  const hit = _retenScopeMemo.get(rows);
  if (hit && hit.key === key) return hit.res;
  const res = _retenScopeStepsBuild(rows);
  _retenScopeMemo.set(rows, { key, res });
  return res;
}
function _retenScopeStepsBuild(rows) {
  const n = (v) => Number(v || 0).toLocaleString();
  const manual = new Set((state.indicatorDeletedCustIds || []).map(x => String(x).trim()).filter(Boolean));   // (folded into the orphan step — the manual list is empty today)
  const crmDel = new Set((state._crmDeletedIds || []).map(String));
  const crmMeta = state._crmDeletedMeta;
  const crmStamp = crmMeta && crmMeta.scanned_at ? ' Last FieldRoutes check: ' + new Date(crmMeta.scanned_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + '.' : ' FieldRoutes check has not run yet.';
  const cfgByName = new Map((state.reportingServiceConfig || []).map(c => [c.service_name, c]));
  const exclSrc = reportingExcludedSources();
  const off = _retenOfficial();
  const on = (k) => _retenWhatIf(k, off[k]);
  const steps = [];
  let cur = rows;
  const run = (key, title, detail, test, locked) => {
    const active = locked ? true : on(key);
    const removed = active ? cur.filter(test) : [];
    const left = active ? cur.filter(r => !test(r)) : cur;
    steps.push({ key, title, detail, removed, left, active, locked: !!locked });
    cur = left;
  };
  // Step 1 is LOCKED (per Isaac): a subscription that never received its
  // initial service cannot retain or churn, so the funnel starts from the
  // subs with a completed initial — the same pull he takes from FieldRoutes.
  run('initial', 'Remove subscriptions that have not received an initial service yet', 'Subscriptions whose initial service is not yet marked Completed in FieldRoutes — still pending, never started, or cancelled before the first visit. These have not become customers yet: they cannot retain and they cannot churn, so counting them either way would distort the rate. They are removed here and the funnel starts from everyone who has actually been serviced. Always applied.', r => !r.initial_service, true);
  // (The branch pick is no longer a step — per Isaac, Sep 21. It scopes
  // "Everything in FieldRoutes" itself, from the 🏢 dropdown on the bar; see
  // _retenOfficeSlice.)
  // Configuration rules run next, LOCKED (per Isaac, Sep 2026 — every
  // number on the Overview already has them applied, so the steps must
  // too or the two tabs drift). Change them in Reporting → Configurations.
  run('orphans', 'Remove accounts deleted in FieldRoutes', 'Customers that have been deleted inside FieldRoutes. The app\u2019s mirror keeps every row it ever synced, so a nightly check asks FieldRoutes which customer ids still exist and anything FieldRoutes no longer returns is removed here, along with subscriptions that have no customer record at all and any ids listed manually in Configurations. If the CRM no longer has the account, it is not part of the book.' + crmStamp, r => { const id = String(r.customer_id != null ? r.customer_id : ''); return (reportingAutoExcludeOrphans() && (!!r.customer_missing || crmDel.has(id))) || manual.has(id); }, true);
  // Always-on steps come first (per Isaac, Sep 2026): the locked ones the
  // sheet does every time, then the toggles.
  const lifecycleByName = reportingServiceLifecycleMap();
  const recurringByName = reportingServiceRecurringMap();
  run('onetime', 'Remove one-time service types', 'Service types set to a One-time lifecycle in Configurations \u2192 Service types (the \u201cOne Time \u2026\u201d treatments, Initials, Reservices, Inspection-style items). A one-time job is complete when it is done \u2014 there is nothing recurring to retain, so it cannot count as churn when it ends. These still count as revenue on the Overview and in the P&L; they are only set aside for attrition.', r => { const lc = lifecycleByName.get(r.subscription); return !(lc === 'recurring' || lc === 'retired'); }, true);
  // Hidden types run AFTER one-time types (per Isaac, Sep 21): the hidden
  // list is mostly performed one-time work that should fall off above.
  run('hidden', 'Remove hidden service types', 'Service types marked Hidden in Configurations \u2192 Service types: late fees, inspections, admin and billing items. These are line items on an account, not a pest-control plan a customer can keep or cancel, so they are removed before anything is counted.', r => !!(cfgByName.get(r.subscription) || {}).is_hidden, true);
  // Excluded lead sources run AFTER one-time types (per Isaac, Sep 21).
  run('sources', 'Remove excluded lead sources', 'Subscriptions whose lead source is switched off in Configurations \u2192 Lead sources' + (exclSrc.size ? ': ' + [...exclSrc].join(', ') : ' (none today)') + '. These sources are internal or bookkeeping channels rather than real customer acquisition (upsells recorded as new subs, internal saves, test and unknown sources), so the accounts behind them are not part of the retention book.', r => exclSrc.has(reportingSourceOf(r)), true);
  run('retired', 'Remove retired service types', 'Service types marked Retired in Configurations \u2014 plans RIDD no longer sells or services. A retired plan that ended was closed by the company, not lost by the customer, so it is kept out of the book rather than counted as churn.', r => !recurringByName.get(r.subscription), true);
  run('status', 'Keep every account status', 'Active, Frozen and cancelled subscriptions all stay in \u2014 nothing is removed here for status. Dropping cancelled accounts at this point would hide the churn the rate is meant to measure; a cancel is counted by its cancel date in the steps that follow.', r => !(!!r.initial_service && r.initial_service >= '2000-01-01'), true);
  return { steps, out: cur };
}
const _retenOfficeMemo = { g: null, by: new Map() };
function _retenOfficeSlice(office) {
  const g = retenGroundZero();
  if (_retenOfficeMemo.g !== g) { _retenOfficeMemo.g = g; _retenOfficeMemo.by = new Map(); }
  // The 🏢 branch pick scopes the ground itself (per Isaac, Sep 21): untick
  // a branch and it is gone from "Everything in FieldRoutes" down.
  const brOff = retenBranchesOff();
  const k = (office || 'all') + '|' + [...brOff].sort().join(',');
  if (!_retenOfficeMemo.by.has(k)) { let rows = reportingFilterByOffice(g, office || 'all'); if (brOff.size) rows = rows.filter(r => !brOff.has((r.office_name || '').trim())); _retenOfficeMemo.by.set(k, rows); }
  return _retenOfficeMemo.by.get(k);
}
function _retenOfficial() {
  const saved = state._retenWhatIf; state._retenWhatIf = null;
  const o = { initial: true, orphans: reportingAutoExcludeOrphans(), branches: true, hidden: true, sources: reportingExcludedSources().size > 0, popRor: [...retenPopExclReasons()].some(_isRorReason), popRorTiming: true, popRorServiced: true, popCombined: [...retenPopExclReasons()].some(x => /combined/.test(x)), popRenew: [...retenPopExclReasons()].some(x => !_isRorReason(x) && !/combined/.test(x)), zero: retenExclZeroPay(), oneSvc: retenExclOneSvc(), oneSvcExempt: true, frozenOneSvc: retenExclFrozenOneSvc(), exclReasons: reportingExcludedCancelReasons().size > 0, ror: reportingExcludeRorChurn() };
  state._retenWhatIf = saved;
  return o;
}
// Trailing 12 months: cancels in the last 365 days ÷ the book exactly a year
// ago. The always-comparable operating number (YTD isn't, until December).
function retenTrailing12(book) {
  const today = new Date();
  const start = new Date(today); start.setFullYear(start.getFullYear() - 1);
  const st = start.toISOString().slice(0, 10), en = today.toISOString().slice(0, 10);
  const boy = book.filter(r => r.initial_service < st && (!r._effCancel || r._effCancel >= st));
  const counted = boy.filter(r => r._effCancel && r._effCancel >= st && r._effCancel <= en);
  return { rate: boy.length ? counted.length / boy.length : null, c: counted.length, boy: boy.length, st, en, rows: { boy, counted } };
}
// Branch picker on the Attrition Steps bar (per Isaac, Sep 2026 — moved up
// out of step 3). Same state as before: state._retenWhatIf.branches holds
// {name:false} for every branch that is OUT; everything is in by default.
function retenBranchDropdown(g0) {
  const counts = new Map(); g0.forEach(r => { const o = (r.office_name || '').trim() || 'Unknown'; counts.set(o, (counts.get(o) || 0) + 1); });
  const names = [...counts.keys()].sort((a, b) => counts.get(b) - counts.get(a));
  const off = retenBranchesOff();
  const inN = names.filter(o => !off.has(o)).length;
  const later = (fn) => requestAnimationFrame(() => setTimeout(fn, 0));
  const setBranches = (br) => { const nw = { ...(state._retenWhatIf || {}) }; if (br) nw.branches = br; else delete nw.branches; state._retenWhatIf = nw; later(mountApp); };
  const wrap = el('div', { class: 'relative shrink-0', onclick: (e) => e.stopPropagation() });
  const label = off.size === 0 ? 'RIDD' : inN === 1 ? names.find(o => !off.has(o)) : inN + ' of ' + names.length + ' branches';
  const btn = el('button', {
    class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold whitespace-nowrap transition hover:brightness-95',
    style: { borderColor: off.size ? 'var(--accent)' : 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
    title: 'Which branches are in the retention book',
    onclick: () => { state._retenBranchOpen = !state._retenBranchOpen; place(); panel.style.display = state._retenBranchOpen ? 'block' : 'none'; if (state._retenBranchOpen) clampDropdownPanel(panel); },
  }, '🏢 ' + label + ' ▾');
  // The steps card clips overflow, so the panel floats fixed under the button.
  const place = () => { try { const r = btn.getBoundingClientRect(); panel.style.top = (r.bottom + 4) + 'px'; panel.style.right = Math.max(8, window.innerWidth - r.right) + 'px'; } catch { /* ignore */ } };
  const panel = el('div', { class: 'rounded-xl border shadow-lg p-2', style: { position: 'fixed', zIndex: 60, display: state._retenBranchOpen ? 'block' : 'none', background: 'var(--card)', borderColor: 'var(--border-2)', minWidth: '240px', maxHeight: '60vh', overflowY: 'auto' } },
    el('div', { class: 'flex items-center justify-between gap-2 px-1 pb-1.5 mb-1 border-b', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Branches'),
      el('span', { class: 'inline-flex items-center gap-1' },
        // None (per Isaac): clear every branch, then tick the one to look at.
        el('button', { class: 'rounded-md border px-1.5 py-0.5 text-[10px] font-bold', style: { borderColor: 'var(--border-2)', color: 'var(--text-subtle)' }, title: 'Take every branch out, then tick just the one you want', onclick: () => { const br = {}; names.forEach(o => { br[o] = false; }); setBranches(br); } }, 'None'),
        // Reset puts every branch back in.
        el('button', { class: 'rounded-md border px-1.5 py-0.5 text-[10px] font-bold', style: { borderColor: off.size ? 'var(--accent)' : 'var(--border-2)', color: off.size ? 'var(--accent)' : 'var(--text-subtle)' }, title: 'Every branch back in the book', onclick: () => setBranches(null) }, 'Reset'))),
    ...names.map(o => {
      const isOff = off.has(o);
      const cb = el('input', { type: 'checkbox', checked: !isOff, style: { accentColor: 'var(--accent)' }, onchange: (e) => {
        const br = { ...((state._retenWhatIf || {}).branches || {}) };
        if (e.target.checked) delete br[o]; else br[o] = false;
        setBranches(Object.keys(br).length ? br : null); } });
      cb.checked = !isOff; cb.defaultChecked = !isOff;
      return el('label', { class: 'flex items-center gap-2 text-[11px] cursor-pointer rounded px-1.5 py-1 hover:brightness-95' + (isOff ? '' : ' font-semibold'), style: { color: isOff ? 'var(--text-subtle)' : 'var(--text)' } },
        cb, el('span', { class: 'flex-1 truncate' }, o), el('span', { class: 'tabular-nums', style: { color: 'var(--text-subtle)' } }, (counts.get(o) || 0).toLocaleString()));
    }));
  if (state._retenBranchOpen) setTimeout(place, 0);
  if (state._retenBranchOpen) setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
    if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
    if (wrap.contains(ev.target)) return;
    panel.style.display = 'none'; state._retenBranchOpen = false;
    document.removeEventListener('mousedown', closer);
  }), 0);
  wrap.append(btn, panel);
  return wrap;
}
function retenMethodCard(pop, _retenEff, ground, infoBtn) {
  const year = new Date().getFullYear();
  const yStart = year + '-01-01', pStart = (year - 1) + '-01-01';
  const recurringByName = reportingServiceRecurringMap();
  // `ground` = everything FieldRoutes has for this office (retenGroundZero);
  // `pop` = what is left after the scope steps (what the tab reads).
  const g0 = Array.isArray(ground) ? ground : pop;
  const scopeSteps = Array.isArray(ground) ? retenScopeSteps(ground).steps : [];
  const n0 = pop.length;
  const lifecycleByName = reportingServiceLifecycleMap();
  // Sheet Step 1 "take out all one-time services" is two things in the app:
  // service types whose lifecycle is one-time (or unknown), then retired types.
  const s1o = pop.filter(r => lifecycleByName.get(r.subscription) === 'recurring' || lifecycleByName.get(r.subscription) === 'retired');
  const s1 = s1o.filter(r => !!recurringByName.get(r.subscription));
  const s2 = s1.filter(r => !!r.initial_service && r.initial_service >= '2000-01-01');
  // Population steps, applied in order so each count is "removed at this step".
  const popSet = retenPopExclReasons();
  const rorOn = [...popSet].some(_isRorReason);
  const rorTimingOn = _retenWhatIf('popRorTiming', true);
  const closedBy = (r, kind) => r.subscription_date_canceled && popSet.has(_normCancelReason(reportingCancelReasonOf(r))) && crmReasonIs(kind, reportingCancelReasonOf(r));   // kind: 'combined' | 'renewal' (src/12-crm-vocab.js)
  const rorByReason = (r) => !!r.subscription_date_canceled && _isRorReason(_normCancelReason(reportingCancelReasonOf(r)));
  const s2r = s2.filter(r => !(rorOn && rorByReason(r)));                       // minus RORs coded as such (the sheet's rule)
  const step1a = s2r.filter(r => !(rorOn && rorTimingOn && _reporting3dayRor(r)));   // minus RORs caught by timing (app extra)
  const step1b = step1a.filter(r => !closedBy(r, 'combined'));                  // minus combined
  const step1 = step1b.filter(r => !closedBy(r, 'renewal'));                    // minus renewals
  const byReason1 = {}; step1b.forEach(r => { if (closedBy(r, 'renewal')) { const k = String(reportingCancelReasonOf(r) || '').trim(); byReason1[k] = (byReason1[k] || 0) + 1; } });
  const step2 = step1.filter(r => !(retenExclZeroPay() && (Number(r.annual_recurring_value) || 0) <= 0));
  const svcOf = (r) => Number(r.subscription_completed_services) || 0;
  const sentricon = (r) => retenOneSvcExemptTerms().some(t => String(r.subscription || '').toLowerCase().includes(t));
  const soldThisYear = (r) => { const d = r.sold_date ? new Date(r.sold_date) : (r.initial_service ? new Date(r.initial_service) : null); return d && !isNaN(d) && d.getFullYear() >= year; };
  const oneSvcAll = step2.filter(r => svcOf(r) <= 1);
  const oneSvcKept = oneSvcAll.filter(r => _retenOneSvcExempt(r));
  // 7: never got a 2nd treatment — prior-year one-service subs (Sentricon exempt)
  const step2b = step2.filter(r => !(retenExclOneSvc() && svcOf(r) <= 1 && !sentricon(r) && !soldThisYear(r)));
  // 8: sold this year but already frozen after one treatment
  const step3 = step2b.filter(r => !retenPopulationExcluded(r));
  const book = _retenEff(pop);   // the real thing — should equal step3 in size
  // Cancel steps for the current year (YTD) and last year.
  const excl = reportingExcludedCancelReasons();
  const cancelSteps = (yr) => {
    const st = yr + '-01-01', en = yr + '-12-31';
    const boy = book.filter(r => r.initial_service < st && (!r._effCancel || r._effCancel >= st));
    const raw = boy.filter(r => r.subscription_date_canceled && r.subscription_date_canceled >= st && r.subscription_date_canceled <= en);
    const exclRows = raw.filter(r => excl.has(_normCancelReason(reportingCancelReasonOf(r))));
    const rorRows = raw.filter(r => !excl.has(_normCancelReason(reportingCancelReasonOf(r))) && reportingExcludeRorChurn() && _reporting3dayRor(r));
    const countedRows = boy.filter(r => r._effCancel && r._effCancel >= st && r._effCancel <= en);
    return { boy: boy.length, raw: raw.length, exclN: exclRows.length, rorN: rorRows.length, counted: countedRows.length, rate: boy.length ? countedRows.length / boy.length : null,
      rows: { boy, raw, excl: exclRows, ror: rorRows, counted: countedRows } };
  };
  // Cohort read (per Isaac, Sep 22): Blended = the book on Jan 1 followed
  // through the year (what the steps always showed); Same-year = accounts
  // first serviced IN the year that cancelled in the same year ÷ everything
  // first serviced in the year. Toggle on the header; the waterfall shows both.
  // (Same-year attrition lives on the Cohort Waterfall's diagonal — per Isaac, Sep 22.)
  const cur = cancelSteps(year), prev = cancelSteps(year - 1);
  // Projected full-year attrition: this year's YTD cancels scaled by the
  // share of last year's cancels that had happened by today's date.
  const projected = (() => {
    const t = new Date();
    const cutoff = (year - 1) + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
    const byNow = prev.rows.counted.filter(r => r._effCancel <= cutoff).length;
    const share = prev.counted ? byNow / prev.counted : null;
    return share && share > 0.05 && cur.boy ? (cur.counted / share) / cur.boy : null;
  })();
  // Official numbers (rules exactly as saved) for the with-vs-without read.
  let official = null;
  if (retenWhatIfActive()) { const saved = state._retenWhatIf; state._retenWhatIf = null; try { const b = _retenEff(pop); const cs = (yr) => { const st = yr + '-01-01', en = yr + '-12-31'; const boy = b.filter(r => r.initial_service < st && (!r._effCancel || r._effCancel >= st)); const c = boy.filter(r => r._effCancel && r._effCancel >= st && r._effCancel <= en).length; return boy.length ? c / boy.length : null; }; official = { book: b.length, cur: cs(year), prev: cs(year - 1) }; } finally { state._retenWhatIf = saved; } }
  const pct = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const n = (v) => Number(v || 0).toLocaleString();
  const w = state._retenWhatIf || {};
  const off = _retenOfficial();
  const isOn = (k) => typeof w[k] === 'boolean' ? w[k] : off[k];
  const chip = (k) => el('button', {
    class: 'rounded-full px-2 py-0.5 text-[10px] font-bold transition hover:brightness-95 shrink-0',
    style: isOn(k) ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' },
    title: isOn(k) ? 'Applied — click to switch OFF for this session and see attrition without it' : 'Switched off for this session — click to apply again',
    onclick: () => { const nw = { ...(state._retenWhatIf || {}) }; nw[k] = !isOn(k); state._retenWhatIf = nw; mountApp(); },
  }, isOn(k) ? 'ON' : 'OFF');
  // Every count is a drill: the exact subscriptions removed at that step (or
  // included in that total), so the math can be followed down to accounts.
  const drill = (title, rows, what) => rows && rows.length ? () => openReportingDrillModal({ chartTitle: 'Attrition steps · ' + title, sliceLabel: n(rows.length) + ' subscription' + (rows.length === 1 ? '' : 's') + (what ? ' · ' + what : ''), rows, formatValue: fmt.usd0 }) : null;
  const clickable = (node, fn) => { if (fn) { node.classList.add('cursor-pointer', 'hover:underline'); node.title = 'Click to see the subscriptions'; node.onclick = (e) => { e.stopPropagation(); fn(); }; } return node; };
  // Each step shows what it removes AND the running book after it (both drillable).
  const step = (num, title, detail, removed, chipKey, fixedNote, rowsRemoved, rowsLeft, noteRows) => el('div', { class: 'flex items-start gap-3 py-2 border-t border-' },
    el('div', { class: 'w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-black shrink-0', style: { background: 'var(--card-2)', color: 'var(--text)' } }, String(num)),
    el('div', { class: 'flex-1 min-w-0' },
      el('div', { class: 'text-sm font-semibold' }, title),
      el('div', { class: 'text-[11px] text-muted-' }, detail)),
    el('div', { class: 'text-right shrink-0 tabular-nums' },
      removed != null ? clickable(el('div', { class: 'text-sm font-bold', style: { color: removed ? '#DC2626' : 'var(--text-subtle)' } }, removed ? '−' + n(removed) : '0'), drill(title, rowsRemoved, 'removed at this step')) : null,
      fixedNote ? clickable(el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, fixedNote), drill(title, noteRows, 'kept by this step')) : null,
      rowsLeft ? clickable(el('div', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-muted)' } }, n(rowsLeft.length) + ' remain'), drill(title + ' · remaining', rowsLeft, 'still in the book after this step')) : null),
    chipKey ? chip(chipKey) : el('span', { class: 'text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0', style: { color: 'var(--text-subtle)', border: '1px solid var(--border)' }, title: 'Always applied' }, 'ALWAYS'));
  const total = (label, val, sub, rowsIn) => el('div', { class: 'flex items-center justify-between py-2 border-t-2 border-', style: { borderColor: 'var(--border-2)' } },
    el('div', {}, el('div', { class: 'text-sm font-black' }, label), sub ? el('div', { class: 'text-[11px] text-muted-' }, sub) : null),
    clickable(el('div', { class: 'text-lg font-black tabular-nums' }, val), drill(label, rowsIn, 'included')));
  const notIn = (a, b) => { const set = new Set(b); return a.filter(r => !set.has(r)); };
  const reasonList = Object.entries(byReason1).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + n(v)).join(' · ');
  const open = state._retenMethodOpen === true;   // collapsed by default (per Isaac)
  const whatIf = retenWhatIfActive();
  const card = el('div', { class: 'card overflow-hidden', style: whatIf ? { outline: '2px solid var(--accent)' } : {} },
    // Two rows (per Isaac, Sep 2026): title + controls right-justified on
    // the first, the three attrition numbers across the second.
    el('div', { class: 'px-5 py-3 flex flex-col gap-2 cursor-pointer', onclick: () => { state._retenMethodOpen = !open; mountApp(); } },
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('h3', { class: 'text-sm font-bold flex-1 min-w-0' }, (open ? '▾ ' : '▸ ') + 'Attrition Steps'),
        el('span', { class: 'inline-flex' }, retenBranchDropdown(retenGroundZero())),
        whatIf ? el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: (e) => { e.stopPropagation(); state._retenWhatIf = null; mountApp(); } }, 'Reset to official') : null,
        (() => {
          const inp = el('input', { type: 'file', accept: '.csv,text/csv', style: { display: 'none' } });
          inp.addEventListener('change', () => {
            const f = inp.files && inp.files[0]; if (!f) return;
            const rd = new FileReader();
            rd.onload = () => { try { const rows = retenParseCsv(rd.result); if (!rows.length || !('customer id' in rows[0]) || !('subscription' in rows[0])) { toast('CSV needs Customer ID and Subscription columns', 'error'); return; } openRetenReconcileModal(retenReconcile(rows, pop, book, _retenEff, g0)); } catch (e) { toast('Could not read that CSV: ' + (e && e.message || e), 'error'); } };
            rd.readAsText(f);
          });
          return el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, title: 'Upload a FieldRoutes Customer Report (CSV) and diff it against the app', onclick: (e) => { e.stopPropagation(); inp.click(); } }, '\u21c4 Reconcile', inp);
        })(),
        infoBtn ? el('span', { class: 'inline-flex', onclick: (e) => e.stopPropagation() }, infoBtn) : null),
      el('div', { class: 'flex items-center justify-end gap-4 tabular-nums reten-tiles' },
        // Last year's full-year attrition first (per Isaac) — same rules, whole year, drillable to the counted cancels.
        (() => { const fn = drill((year - 1) + ' \u00b7 counted cancels', prev.rows.counted, 'counted as churn'); return el('div', { class: 'text-right', title: n(prev.counted) + ' counted cancels in ' + (year - 1) + ' \u00f7 ' + n(prev.boy) + ' on the books Jan 1, ' + (year - 1) }, el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, (year - 1) + ' attrition'), el('div', { class: 'text-base font-black', style: fn ? { cursor: 'pointer' } : {}, onclick: fn ? (e) => { e.stopPropagation(); fn(); } : null }, pct(prev.rate), official ? el('span', { class: 'text-[10px] font-semibold ml-1', style: { color: 'var(--text-muted)' } }, 'official ' + pct(official.prev)) : null)); })(),
        el('div', { class: 'text-right' }, el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, year + ' YTD attrition'), el('div', { class: 'text-base font-black' }, pct(cur.rate), official ? el('span', { class: 'text-[10px] font-semibold ml-1', style: { color: 'var(--text-muted)' } }, 'official ' + pct(official.cur)) : null)),
        el('div', { class: 'text-right' }, el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, year + ' projected attrition'), el('div', { class: 'text-base font-black' }, pct(projected), el('span', { class: 'text-[10px] font-semibold ml-1', style: { color: 'var(--text-muted)' } }, 'seasonal pace'))),
        (() => { const t = retenTrailing12(book); const fn = drill('Trailing 12 months · counted cancels', t.rows.counted, 'counted as churn'); return el('div', { class: 'text-right', title: n(t.c) + ' cancels ' + t.st + ' → ' + t.en + ' ÷ ' + n(t.boy) + ' on the books a year ago' }, el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Trailing 12 months'), el('div', { class: 'text-base font-black', style: fn ? { cursor: 'pointer' } : {}, onclick: fn ? (e) => { e.stopPropagation(); fn(); } : null }, pct(t.rate))); })())));

  if (!open) return card;
  const loadDrops = state._snapshotLoadDrops || null;
  let stepNo = 0;
  const next = () => ++stepNo;
  card.append(el('div', { class: 'px-5 pb-4' },
    // ── GROUND ZERO — every subscription in FieldRoutes, nothing removed.
    el('div', { class: 'flex items-center justify-between py-2 gap-3' },
      el('div', {}, el('div', { class: 'text-sm font-black' }, 'Everything in FieldRoutes'),
        el('div', { class: 'text-[11px] text-muted-' }, 'Every subscription in the synced snapshot, any status, any service type — the top of the funnel.'
          + (retenBranchesOff().size ? ' Branches out (🏢 dropdown above): ' + [...retenBranchesOff()].join(', ') + '.' : '')
          + (loadDrops && (loadDrops.phantom || loadDrops.dupes) ? ' The loader itself set aside ' + n(loadDrops.phantom) + ' phantom-office row' + (loadDrops.phantom === 1 ? '' : 's') + ' and ' + n(loadDrops.dupes) + ' duplicate' + (loadDrops.dupes === 1 ? '' : 's') + ' of the same subscription id (' + n(loadDrops.raw) + ' raw rows).' : ''))),
      clickable(el('div', { class: 'text-lg font-black tabular-nums' }, n(g0.length)), drill('Everything in FieldRoutes', g0, 'the whole snapshot'))),
    ...scopeSteps.map(st => {
      const node = step(next(), st.title, st.detail, st.removed.length, st.locked ? null : st.key, null, st.removed, st.left);
      if (st.key === 'orphans' && isAdminRole(state.profile?.role)) {
        // Admin: run the FieldRoutes deleted-customer check now instead of
        // waiting for the 4am pass (P1-8).
        const btn = el('button', {
          class: 'mt-1.5 rounded-lg border px-2.5 py-0.5 text-[11px] font-bold transition hover:brightness-95',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          title: 'Ask FieldRoutes which customer ids still exist (~90 API calls, about two minutes), then reload Retention',
          onclick: async (e) => {
            e.stopPropagation(); btn.disabled = true; btn.textContent = 'Starting\u2026';
            try {
              const h = await _apiAuthHeaders({ 'Content-Type': 'application/json' });
              const r = await fetch('/api/crm-deleted-scan-now', { method: 'POST', headers: h });
              const j = await r.json().catch(() => ({}));
              if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status));
              toast(j.message || 'FieldRoutes check started', 'success'); btn.textContent = 'Running \u2014 reload in ~2 min';
            } catch (err) { toast('Could not start the check: ' + (err && err.message || err), 'error'); btn.disabled = false; btn.textContent = '\u21bb Run FieldRoutes check now'; }
          },
        }, '\u21bb Run FieldRoutes check now');
        node.children[1].append(btn);
      }
      return node;
    }),
    // (one-time / retired / status steps now run in the locked scope chain above)
    step(next(), 'Remove 3-day RORs coded in the CRM', 'Subscriptions cancelled with the reason \u201c3 Day ROR\u201d \u2014 the customer used the three-day right of rescission on a door-to-door sale. The contract was legally undone before service began, so this was never a customer and is neither retained nor churned.', s2.length - s2r.length, 'popRor', null, notIn(s2, s2r), s2r),
    (() => {
      const removed = notIn(s2r, step1a);
      // RORs caught by TIMING whose reason isn't coded "3 Day ROR" — fix these in FieldRoutes.
      const miscoded = removed;
      const node = step(next(), 'Remove 3-day RORs caught by timing', 'Door-to-door subscriptions cancelled within three days of the sale whatever reason was typed in FieldRoutes, unless the step below keeps them. Timing makes these rescissions in substance \u2014 the rep or office simply coded a different reason \u2014 so they are treated the same as the coded RORs above. Switch it off to count only the reason as coded.', s2r.length - step1a.length, rorOn ? 'popRorTiming' : null, rorOn ? null : 'needs the ROR step on', removed, step1a);
      if (miscoded.length) node.children[1].append(el('button', {
        class: 'mt-1.5 rounded-lg px-2 py-0.5 text-[11px] font-bold', style: { background: 'rgba(220,38,38,.10)', color: '#DC2626', border: '1px solid rgba(220,38,38,.3)' },
        title: 'Cancelled within 3 days of the sale but the reason in FieldRoutes is not “3 Day ROR” — open the list and correct them in the CRM',
        onclick: (e) => { e.stopPropagation(); openReportingDrillModal({ chartTitle: 'Attrition steps · RORs miscoded in the CRM', sliceLabel: n(miscoded.length) + ' subscription' + (miscoded.length === 1 ? '' : 's') + ' · cancelled within 3 days but reason ≠ “3 Day ROR”', rows: miscoded, formatValue: fmt.usd0 }); },
      }, '⚑ ' + n(miscoded.length) + ' miscoded — fix the reason in the CRM'));
      return node;
    })(),
    (() => {
      // Timing-RORs that were serviced twice or more (per Isaac, Sep 21): the
      // dates say ROR, the appointments say customer. Kept by default; the
      // list is here so the CRM can be cleaned up over time.
      const kept = (rorOn && rorTimingOn && _retenWhatIf('popRorServiced', true)) ? s2r.filter(r => _reporting3dayRorByDates(r) && svcOf(r) > 1) : [];
      return step(next(), 'Keep timing-RORs with 2+ completed appointments', 'Exemption to the step above: a subscription cancelled within three days of its sale date but with two or more completed appointments was really serviced \u2014 the sold or cancel date in FieldRoutes is wrong, not the customer. These stay in the book; if the cancel reason is a renewal, the renewals step below counts them as retained, otherwise they are a real cancel counted by date. Switch off to treat them as RORs. Open the list to fix the dates in the CRM.', 0, rorOn && rorTimingOn ? 'popRorServiced' : null, n(kept.length) + ' kept', null, null, kept);
    })(),
    step(next(), 'Remove combined subscriptions', 'Subscriptions cancelled with the reason \u201cCombined Subscriptions\u201d \u2014 the plan was merged into another subscription on the same account, which carries on. The customer is still with RIDD, so counting the closed line as churn would double-count a customer who never left.', step1a.length - step1b.length, 'popCombined', null, notIn(step1a, step1b), step1b),
    step(next(), 'Remove renewals', 'Subscriptions cancelled with a Renewal reason (Outbound, Loyalty, Service Pro Upsell, Inbound) \u2014 the old plan was closed because the customer signed a renewal. The renewal subscription stays in the book carrying the original start date, so the customer is counted once, as retained, and the closed plan is not a loss.' + (reasonList ? ' Removed: ' + reasonList + '.' : ''), step1b.length - step1.length, 'popRenew', null, notIn(step1b, step1), step1),
    step(next(), 'Remove subs with no ARR', 'Subscriptions with $0 annual recurring value. Attrition is measured on recurring revenue, and a sub that bills nothing can neither be kept nor lost in dollar terms, so it is removed rather than diluting the rate.', step1.length - step2.length, 'zero', null, notIn(step1, step2), step2),
    step(next(), 'Remove prior-year subs that never received a 2nd treatment', 'Subscriptions from prior years that only ever received a single service. A recurring plan that never had a second visit never became an ongoing customer relationship, so it is removed rather than counted as churn. Only prior-year subs are judged this way \u2014 ' + year + ' one-visit accounts (' + n(oneSvcAll.filter(r => soldThisYear(r)).length) + ') stay: they are just young.', step2.length - step2b.length, 'oneSvc', null, notIn(step2, step2b), step2b),
    (() => {
      const kept = step2b.filter(r => svcOf(r) <= 1 && sentricon(r) && !soldThisYear(r));
      return step(next(), 'Keep Sentricon one-visit subs', 'Exemption to the step above: ' + retenOneSvcExemptTerms().join(', ') + ' is annual — one visit a year IS the service — so those subs stay in the book. Switch off to remove them too.', 0, 'oneSvcExempt', n(kept.length) + ' kept', null, null, kept);
    })(),
    step(next(), 'Remove ' + year + ' subs frozen after one treatment', 'Accounts sold this year that took one visit and already cancelled \u2014 the same never-became-a-customer logic as the prior-year step, applied to this year\u2019s subs only once they have actually cancelled. Active ' + year + ' one-visit accounts (' + n(oneSvcKept.length) + ') stay — they are just young.', step2b.length - step3.length, 'frozenOneSvc', null, notIn(step2b, step3), step3),
    total('Retention book', n(book.length), 'Subscriptions the rest of this tab counts', book),
    // ── 9 · Excluded cancel reasons — configured RIGHT HERE (per Isaac) so
    // the card shows exactly what counts. A checked reason means a sub that
    // cancelled for it stays in the book as RETAINED (not a lost customer).
    (() => {
      const model = reportingCancelReasonModel();
      const cancelled = book.filter(r => r.subscription_date_canceled);
      const byKey = new Map(); cancelled.forEach(r => { const k = _normCancelReason(reportingCancelReasonOf(r)); byKey.set(k, (byKey.get(k) || []).concat([r])); });
      const neutralised = cancelled.filter(r => excl.has(_normCancelReason(reportingCancelReasonOf(r))));
      const rowsFor = model.list.filter(g => (byKey.get(g.key) || []).length || model.excludedSet.has(g.key));
      const listEl = el('div', { class: 'grid gap-x-4 gap-y-1 mt-2', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' } },
        ...rowsFor.map(g => {
          const rs = byKey.get(g.key) || [];
          const isEx = model.excludedSet.has(g.key);
          const cb = el('input', { type: 'checkbox', checked: excl.has(g.key), style: { accentColor: 'var(--accent)' }, onclick: (e) => e.stopPropagation(), onchange: (e) => {
            // Slicer, not a setting: overrides live in state._retenWhatIf.reasons for this session only.
            const nw = { ...(state._retenWhatIf || {}) }; const rs = { ...(nw.reasons || {}) };
            if (e.target.checked === model.excludedSet.has(g.key)) delete rs[g.key]; else rs[g.key] = e.target.checked;
            nw.reasons = rs; state._retenWhatIf = nw; mountApp(); } });
          cb.checked = excl.has(g.key); cb.defaultChecked = cb.checked;   // property AND default — a re-serialised node keeps only one of them
          const nowEx = excl.has(g.key);
          if (nowEx) cb.style.accentColor = '#DC2626';
          // Red = being removed from churn (treated as retained); grey = counts as churn.
          return el('label', { class: 'flex items-center gap-2 text-[11px] cursor-pointer rounded px-1' + (nowEx ? ' font-semibold' : ''), style: nowEx ? { color: '#DC2626', background: 'rgba(220,38,38,.06)' } : { color: 'var(--text-muted)' }, onclick: (e) => e.stopPropagation() },
            cb, el('span', { class: 'flex-1 truncate', title: g.display + (nowEx ? ' · removed from churn' : ' · counts as churn') + (nowEx !== isEx ? ' · differs from the saved setting' : '') }, g.display, nowEx !== isEx ? el('span', { style: { color: 'var(--accent)' } }, ' *') : null),
            clickable(el('span', { class: 'tabular-nums' }, n(rs.length)), rs.length ? drill(g.display, rs, 'cancelled for this reason') : null));
        }));
      // Sits AFTER the Retention book on purpose: it does not shrink the
      // book — these subs stay in it as retained — it takes them out of the
      // CHURN count. The number is labelled so it can't read as a book step.
      const node = step(next(), 'Count these cancel reasons as retained', 'The book above stays at ' + n(book.length) + ' — this step changes what counts as churn, not who is in the book. By default every dated cancel counts as churn. Tick a reason and subscriptions cancelled for it are treated as RETAINED — the company ended it, the customer did not leave. Unticked reasons count as churn. These are slicers for this tab and session only (an * marks a reason that differs from the saved setting); the saved list lives in Reporting → Configurations → Cancellation reasons and drives the rest of the app.', neutralised.length, 'exclReasons', n(neutralised.length) + ' cancels moved from churn to retained', neutralised, null, neutralised);
      node.children[1].append(listEl);
      return node;
    })(),
    // (Attrition + pacing tiles retired per Isaac, Sep 2026 — the bar at the top carries YTD / projected / trailing 12.)
    null));
  return card;
}

function reportingWaterfall() {
  const gate = reportingDataGate();
  if (gate) return gate;
  // Retention hosts three sections now (per Isaac): the retention analytics
  // suite, Customer Health (churn defense), and Next Best Service (attach).
  // Sep 23 (per Isaac): Retention is the whole tab — Renewals and Customer
  // Health moved to the Loyalty group; Contract Length is folded in below.
  state._retenSection = 'retention';
  const scope = reportingScope();
  // Office + Metrics filters retired (per Isaac, Sep 2026): the branch pick
  // on Attrition Steps is the office scope now, Contract Length and Rep are
  // their own tables below, and Accounts / ARR is a toggle on the waterfall.
  const office = 'all', compareOffice = 'all', inCompare = false;
  const officeLabel = scope.officeLabel;
  const mode = state._rtWaterfallArr ? 'arv' : 'subscription';
  // Time range only matters for Contract Length / Rep (it scopes which subs
  // qualify); the cohort modes are inherently all-time. Compare offices is
  // a Waterfall-only tool — side-by-side retention matrices.
  // (Standalone filter bar retired — Office + Compare live on the matrix
  // card itself now, the methodology ⓘ rides the Group-rows-by bar, and
  // Contract/Rep keep a compact time-range select there too.)
  // Cohort modes are all-time BY DEFINITION — and their time-range picker is
  // hidden, so a range set on another tab must not silently shrink them.
  // Contract/Rep modes keep the visible, user-controlled range.
  // ALL modes are all-time (per Isaac: "cohorts are by year — that's how we
  // look at them"). The shared Time-range picker no longer applies here; it
  // was collapsing Contract Length to one column when another tab sat on YTD.
  // Populations walk down from EVERYTHING in FieldRoutes (per Isaac) through
  // the scope steps — so a step switched off on the Attrition Steps card
  // changes every card on this tab, not just the walkthrough.
  const groundA = _retenOfficeSlice(office);
  const groundB = inCompare ? _retenOfficeSlice(compareOffice) : null;
  const popA = retenScopeSteps(groundA).out;
  const popB = inCompare ? retenScopeSteps(groundB).out : null;
  if (!state.reportingWaterfallCohort) state.reportingWaterfallCohort = 'all';
  const cohortSel = (mode === 'contract' || mode === 'rep') ? state.reportingWaterfallCohort : 'all';
  // The #/Attrition-% toggle is retired — cells show the count AND the
  // %-of-cohort together, with the step attrition rate on hover.

  const modes = [
    ['subscription',    'Subscription'],
    ['arv',             'ARR'],
    ['contract',        'Contract Length'],
    ['rep',             'Rep'],
  ];

  const waterfallA = buildReportingWaterfall(popA, mode, cohortSel);
  const waterfallB = inCompare ? buildReportingWaterfall(popB, mode, cohortSel) : null;

  const _methodologyInfo = (typeof reportingMethodologyInfoBtn === 'function') ? reportingMethodologyInfoBtn() : null;
  // (Office / Metrics bar retired — see above.)

  // Cell color = retention % vs cohort total. Green → red gradient.
  // For Subscription/ARV (cohort) we compare each cell to that row's
  // total; for Contract Length / Rep modes the row total isn't a true
  // starting cohort, so we compare to the row's max cell instead.
  const cellColor = (rowDef, value) => {
    if (!value) return 'transparent';   // blank cell (e.g. before the cohort existed) → white, not red
    const baseline = (mode === 'subscription' || mode === 'arv' || cohortSel !== 'all')
      ? rowDef.total
      : Math.max(...Object.values(rowDef.byYear));
    if (!baseline) return 'transparent';
    const pct = value / baseline;
    const hue = Math.max(0, Math.min(120, pct * 120));
    return `hsl(${hue}, 70%, 88%)`;
  };

  const fmtCell = (v, isTotal) => {
    if (mode === 'arv') return v > 0 ? '$' + Math.round(v).toLocaleString() : (isTotal ? '$0' : '');
    return v > 0 ? v.toLocaleString() : (isTotal ? '0' : '');
  };

  const renderMatrix = (data, sideLabel) => {
    // (empty-data handling moved below the header so the Office/Compare
    // controls never vanish — an empty office must still offer the exit)
    const rowLabel = (id) => {
      if (mode === 'subscription' || mode === 'arv') return String(id);
      if (mode === 'contract') return id === 'other' ? 'Other' : id + ' mo';
      return id; // rep name
    };
    const _isB = sideLabel === '__B__';
    const _officeSel = el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', minWidth: '150px' },
      onchange: (e) => { state[_isB ? 'reportingCompareOffice' : 'reportingOffice'] = e.target.value; mountApp(); },
    },
      el('option', { value: 'all', selected: (_isB ? compareOffice : office) === 'all' }, 'All Offices'),
      ...scope.offices.map(o => el('option', { value: o, selected: (_isB ? compareOffice : office) === o }, o)));
    const _cmpBtn = el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition hover:brightness-95',
      style: inCompare
        ? { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border)' }
        : { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: () => {
        state.reportingCompareMode = !inCompare;
        if (!inCompare && state.reportingCompareOffice === office) {
          state.reportingCompareOffice = scope.offices.find(o => o !== office) || 'all';
        }
        mountApp();
      },
    }, inCompare ? '✕ Exit compare' : 'Compare');
    return el('div', { class: 'card overflow-hidden flex flex-col' },
      el('div', { class: 'px-3 py-2 flex items-center gap-2 flex-wrap', style: { borderBottom: '1px solid var(--border)' } },
        _isB && el('span', { class: 'text-[10px] uppercase tracking-widest font-black', style: { color: 'var(--accent)' } }, 'vs'),
        _officeSel,
        !_isB && _cmpBtn),
      data.rowDefs.length === 0
        ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'No data for this mode.')
        : el('div', { class: 'overflow-auto' },
        el('table', { class: 'w-full text-xs tabular-nums' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
            el('tr', {},
              el('th', { class: 'text-left px-3 py-2 font-semibold sticky left-0', style: { background: 'var(--card-2)' } },
                mode === 'subscription' || mode === 'arv' ? 'Cohort Year' :
                mode === 'contract' ? 'Contract Length' : 'Rep'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, mode === 'arv' ? 'Total ARR' : 'Total'),
              ...data.years.map(y => el('th', { class: 'text-left px-2 py-2 font-semibold' }, String(y))),
            ),
          ),
          el('tbody', {},
            ...data.rowDefs.map(row => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'text-left px-3 py-2 font-semibold sticky left-0', style: { background: 'var(--card)' } }, rowLabel(row.id)),
              el('td', { class: 'text-left px-2 py-2 font-bold' }, fmtCell(row.total, true)),
              ...data.years.map(y => {
                const v = row.byYear[y] || 0;
                // Count AND % together (the old toggle is gone): the small %
                // is the cell ÷ the row's all-time total — on cohort views
                // that's "share of the cohort still active"; on Contract/Rep
                // book views it's "share of everything this row ever had
                // still active at that year-end". Hover = step attrition.
                const cohortBase = row.total;
                // The inline % is the STEP ATTRITION vs the prior year-end
                // (per Isaac — "attrition on the BOY cohort"); the share of
                // the cohort still active moved into the hover.
                let stepTitle = '';
                let stepPct = null;
                if (cohortBase && (mode === 'subscription' || mode === 'arv' || cohortSel !== 'all')) {
                  const firstYear = (mode === 'subscription' || mode === 'arv') ? Number(row.id) : Number(cohortSel);
                  if (y >= firstYear) {
                    const prev = y === firstYear ? row.total : (row.byYear[y - 1] || 0);
                    if (prev) {
                      stepPct = (1 - v / prev) * 100;
                      stepTitle = stepPct.toFixed(1) + '% attrition vs prior year — ' + fmtCell(v) + ' of ' + fmtCell(prev) + ' retained'
                        + (v > 0 ? ' · ' + Math.round(v / cohortBase * 100) + '% of the original cohort still active' : '');
                    }
                  }
                }
                const _bg = cellColor(row, v);
                return el('td', {
                  class: 'text-left px-2 py-2 tabular-nums',
                  style: _bg === 'transparent' ? {} : { background: _bg, color: '#323230', fontWeight: '600' },
                  title: stepTitle,
                }, fmtCell(v),
                  stepPct != null && v > 0
                    ? el('span', { style: { fontSize: '9px', marginLeft: '4px', fontWeight: '700', color: stepPct > 0 ? '#B91C1C' : '#DF643A', opacity: '.85' } },
                        (stepPct >= 0 ? '−' : '+') + Math.abs(stepPct).toFixed(1) + '%')
                    : (cohortBase > 0 && v > 0) ? el('span', { style: { fontSize: '9px', opacity: '.65', marginLeft: '4px' } }, Math.round(v / cohortBase * 100) + '%') : null);
              }),
            )),
            // ── TOTAL row ──
            // Counts view: column sums (whole-book survivors per year-end).
            // Rate view: WEIGHTED attrition per year — 1 − Σ survivors ÷
            // Σ prior-year survivors across every cohort active that year,
            // so big cohorts pull the blend exactly by their size.
            (() => {
              const cells = data.years.map(y => {
                const sum = data.rowDefs.reduce((a, row) => a + (row.byYear[y] || 0), 0);
                return el('td', { class: 'text-left px-2 py-2 font-bold' }, fmtCell(sum, true));
              });
              const grandTotal = data.rowDefs.reduce((a, row) => a + (row.total || 0), 0);
              const lastY = data.years[data.years.length - 1];
              const surviving = data.rowDefs.reduce((a, row) => a + (row.byYear[lastY] || 0), 0);
              const totalCell = el('td', {
                class: 'text-left px-2 py-2 font-bold',
                title: grandTotal > 0 ? 'Lifetime: ' + fmtCell(surviving) + ' of ' + fmtCell(grandTotal) + ' still active (' + Math.round(surviving / grandTotal * 100) + '%)' : '',
              }, fmtCell(grandTotal, true));
              return el('tr', { class: 'border-t-2', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
                el('td', { class: 'text-left px-3 py-2 font-black sticky left-0', style: { background: 'var(--card-2)' } }, 'TOTAL'),
                totalCell,
                ...cells);
            })(),
          ),
        ),
      ),
    );
  };

  // Blended Attrition (workbook: B.O.Y. survivors of existing cohorts vs
  // the same subs at E.O.Y. — new sales during the year never enter).
  const money0 = (v) => '$' + Math.round(v || 0).toLocaleString();
  // ── Attrition drill — click a year: WHO left and WHY. Same population,
  // same effective-cancel rules as the table itself, so counts reconcile. ──
  // Shared prep — recurring + serviced subs with the EFFECTIVE cancel date
  // (excluded reasons / 3-day ROR don't count), identical to the waterfall.
  const _retenEffCache = new Map();
  const _retenEff = (pop) => {
    // Memoized per population array + rules — four cards + drills share one
    // pass instead of each re-cloning the 65k-row book.
    const _rulesKey = (retenExclRenewalSubs() ? 'R' : '') + (retenExclZeroPay() ? 'Z' : '') + (retenExclFrozenOneSvc() ? 'F' : '') + (retenExclOneSvc() ? 'O' : '') + (reportingExcludeRorChurn() ? 'r' : '') + '|' + [...retenPopExclReasons()].join(',') + '|' + retenOneSvcExemptTerms().join(',') + '|' + reportingExcludedCancelReasons().size + '|' + JSON.stringify(state._retenWhatIf || null);
    const hit = _retenEffCache.get(pop);
    if (hit && hit._rulesKey === _rulesKey) return hit;
    const recurringByName = reportingServiceRecurringMap();
    const excludedReasons = reportingExcludedCancelReasons();
    const out = pop
      .filter(r => !!recurringByName.get(r.subscription))
      .filter(r => !!r.initial_service && r.initial_service >= '2000-01-01')   // garbage dates can't blow up the year walks
      .filter(r => !retenPopulationExcluded(r))   // workbook Steps 4–6 (Configurations → Reporting rules)
      .map(r => {
        const realCancel = r.subscription_date_canceled
          && !excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r)))
          && !(reportingExcludeRorChurn() && _reporting3dayRor(r))
          ? r.subscription_date_canceled : null;
        return { ...r, initial_service: r.origin_initial_service || r.initial_service, _effCancel: realCancel };
      });
    out._rulesKey = _rulesKey;
    _retenEffCache.set(pop, out);
    return out;
  };
  const MONTHS_S = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  // Period-aware drill: a YEAR (blended table rows) or a single MONTH
  // (seasonality cells). Same book/churn construction either way.
  const openAttritionDrill = (pop, year, month) => {
    const rows = _retenEff(pop);
    const pad2 = (n) => String(n).padStart(2, '0');
    const periodStart = month ? year + '-' + pad2(month) + '-01' : year + '-01-01';
    const inPeriod = (iso) => month ? String(iso).slice(0, 7) === year + '-' + pad2(month) : String(iso).slice(0, 4) === String(year);
    const periodLabel = month ? MONTHS_S[month - 1] + ' ' + year : String(year);
    const prevLabel = month ? MONTHS_S[month - 1] + ' ' + (year - 1) : String(year - 1);
    const boyRows = rows.filter(r => r.initial_service < periodStart && (!r._effCancel || r._effCancel >= periodStart));
    const attr = boyRows.filter(r => r._effCancel && inPeriod(r._effCancel));
    const excluded = boyRows.filter(r => !r._effCancel && r.subscription_date_canceled && inPeriod(r.subscription_date_canceled));
    const arrOf = (rs) => rs.reduce((a, r) => a + (Number(r.annual_recurring_value) || 0), 0);
    const lifeMonths = (r) => {
      const a = new Date(r.initial_service + 'T00:00'), b = new Date(String(r._effCancel || r.subscription_date_canceled) + 'T00:00');
      return (isNaN(a) || isNaN(b)) ? null : Math.max(0, (b - a) / 2629800000);
    };
    const groupBy2 = (rs, keyFn) => {
      const m = new Map();
      rs.forEach(r => { const k = keyFn(r) || '—'; let g = m.get(k); if (!g) { g = []; m.set(k, g); } g.push(r); });
      return [...m.entries()].map(([k, g]) => ({ key: k, n: g.length, arr: arrOf(g), lives: g.map(lifeMonths).filter(v => v != null) }))
        .sort((a, b) => b.n - a.n);
    };
    const byReason  = groupBy2(attr, r => reportingCancelReasonOf(r));
    // Prior-period comparison — same construction one year back (same month
    // for month drills), so each reason shows whether its BITE of the book
    // is improving or worsening.
    const prevStart = month ? (year - 1) + '-' + pad2(month) + '-01' : (year - 1) + '-01-01';
    const inPrev = (iso) => month ? String(iso).slice(0, 7) === (year - 1) + '-' + pad2(month) : String(iso).slice(0, 4) === String(year - 1);
    const boyPrev = rows.filter(r => r.initial_service < prevStart && (!r._effCancel || r._effCancel >= prevStart));
    const attrPrev = boyPrev.filter(r => r._effCancel && inPrev(r._effCancel));
    const prevPtsByReason = new Map(groupBy2(attrPrev, r => reportingCancelReasonOf(r))
      .map(g => [g.key, boyPrev.length ? g.n / boyPrev.length * 100 : 0]));
    const byService = groupBy2(attr, r => r.subscription).slice(0, 6);
    const byOffice  = groupBy2(attr, r => r.office_name).slice(0, 6);
    const lives = attr.map(lifeMonths).filter(v => v != null).sort((a, b) => a - b);
    const median = lives.length ? lives[Math.floor(lives.length / 2)] : 0;
    const under12 = lives.length ? lives.filter(v => v < 12).length / lives.length : 0;
    const rate = boyRows.length ? attr.length / boyRows.length : 0;
    // Early losses — acquired AND lost inside this period. A PE analyst
    // wants this visible next to (never inside) the churn rate: it's the
    // sales-quality bridge between our BoY churn and a BI tool's raw
    // "total ARR lost" number.
    const earlyLosses = rows.filter(r => inPeriod(r.initial_service) && r._effCancel && inPeriod(r._effCancel));

    const overlay = el('div', { class: 'modal-overlay' });
    const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
    document.addEventListener('keydown', _escClose);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
    // Stat tiles drill to their accounts (per Isaac, Sep 2026).
    const stat = (label, val, sub, drillRows) => el('div', { class: 'flex-1 px-3 py-2 rounded-xl' + (drillRows && drillRows.length ? ' cursor-pointer transition hover:brightness-95' : ''), style: { background: 'var(--card-2)', minWidth: '110px' },
      title: drillRows && drillRows.length ? 'Click for the accounts' : '',
      onclick: drillRows && drillRows.length ? () => openReportingDrillModal({ chartTitle: periodLabel + ' attrition · ' + label, sliceLabel: fmt.int(drillRows.length) + ' accounts · ' + money0(arrOf(drillRows)) + ' ARR', rows: drillRows, formatValue: (v) => fmt.usd0(v) }) : undefined },
      el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
      el('div', { class: 'text-lg font-black tabular-nums' }, val),
      sub && el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, sub));
    const maxN = byReason.length ? byReason[0].n : 1;
    const reasonRow = (g) => {
      const avgLife = g.lives.length ? g.lives.reduce((a, b) => a + b, 0) / g.lives.length : null;
      return el('div', { class: 'py-2 border-t border-' },
        el('div', { class: 'flex items-center justify-between gap-2 text-xs' },
          el('span', { class: 'font-semibold truncate' }, g.key),
          el('span', { class: 'tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } },
            fmt.int(g.n) + ' · ' + (attr.length ? (g.n / attr.length * 100).toFixed(1) : '0') + '% of churn · '
            + (boyRows.length ? (g.n / boyRows.length * 100).toFixed(2) : '0') + ' pts of rate')),
        el('div', { class: 'mt-1 rounded-full overflow-hidden', style: { height: '5px', background: 'var(--card-2)' } },
          el('div', { style: { width: Math.max(2, g.n / maxN * 100) + '%', height: '100%', background: '#DC2626', opacity: '.75' } })),
        el('div', { class: 'mt-0.5 text-[10px] tabular-nums flex items-center gap-2 flex-wrap', style: { color: 'var(--text-subtle)' } },
          el('span', {}, money0(g.arr) + ' ARR lost' + (avgLife != null ? ' · avg lifetime ' + avgLife.toFixed(1) + ' mo' : '')),
          // YoY: this reason's contribution to the attrition RATE (pts of
          // BOY book) vs last year — normalized, so book growth can't hide
          // a worsening reason. Red = biting harder, green = improving.
          (() => {
            if (!boyPrev.length) return null;
            const nowPts = boyRows.length ? g.n / boyRows.length * 100 : 0;
            const prevPts = prevPtsByReason.get(g.key);
            if (prevPts == null) return el('span', { class: 'font-bold', style: { color: '#A9441F' } }, 'new vs ' + prevLabel);
            const d = nowPts - prevPts;
            if (Math.abs(d) < 0.005) return el('span', { class: 'font-bold' }, 'flat vs ' + prevLabel);
            return el('span', { class: 'font-bold', style: { color: d > 0 ? '#DC2626' : '#DF643A' } },
              (d > 0 ? '▲ +' : '▼ −') + Math.abs(d).toFixed(2) + ' pts vs ' + prevLabel);
          })()));
    };
    const miniTable = (title, groups) => el('div', { class: 'flex-1 min-w-[220px]' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, title),
      ...groups.map(g => el('div', { class: 'flex items-center justify-between text-[11px] py-1 border-t border-' },
        el('span', { class: 'truncate' }, g.key),
        el('span', { class: 'tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } },
          fmt.int(g.n) + ' · ' + (attr.length ? (g.n / attr.length * 100).toFixed(0) : '0') + '%'))));
    // ⬇ Reconciliation export — EVERY sub with a cancel date in this period,
    // flagged counted / not-counted-and-why. Built to line up row-by-row
    // against an external BI's churn widget (RevHawk) via Customer ID.
    const exportPeriodCsv = () => {
      const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
      const countedIds = new Set(attr);
      const L = [['Customer ID', 'Subscription', 'Office', 'State', 'Cancellation Reason', 'Initial Service', 'Date Canceled', 'Effective Cancel', 'ARV', 'Counted As Churn', 'Why Not'].map(esc).join(',')];
      let n = 0;
      rows.forEach(r => {
        const rawCxl = r.subscription_date_canceled;
        const eff = r._effCancel;
        const inP = (eff && inPeriod(eff)) || (rawCxl && inPeriod(rawCxl));
        if (!inP) return;
        let counted = countedIds.has(r), why = '';
        if (!counted) {
          if (!eff) why = 'reason excluded from attrition (or ROR)';
          else if (r.initial_service >= periodStart) why = 'started inside the period (not in the BoY book)';
          else if (eff && !inPeriod(eff) && rawCxl && inPeriod(rawCxl)) why = 'effective cancel falls in a different period';
          else why = 'outside this drill\u2019s population';
        }
        n++;
        L.push([r.customer_id, r.subscription, r.office_name, r.state, reportingCancelReasonOf(r), r.initial_service, rawCxl || '', eff || '', Math.round(Number(r.annual_recurring_value) || 0), counted ? 'YES' : 'no', why].map(esc).join(','));
      });
      if (!n) return toast('No cancels found in ' + periodLabel, 'warn');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(['\ufeff' + L.join('\n')], { type: 'text/csv' }));
      a.download = ('churn-reconciliation-' + periodLabel).replace(/\s+/g, '-').toLowerCase() + '.csv';
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    };
    const card = el('div', { class: 'card w-full max-w-2xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
      el('div', { class: 'flex items-start justify-between gap-3 p-4 pb-2' },
        el('div', {},
          el('h2', { class: 'text-base font-bold' }, periodLabel + ' Attrition — who left and why')),
        el('div', { class: 'flex items-center gap-2' },
          el('button', {
            class: 'rounded-lg border px-2.5 py-1.5 text-[10px] font-bold cursor-pointer transition hover:brightness-95 whitespace-nowrap',
            style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
            title: 'CSV of EVERY cancel dated in this period — counted or not, with the reason it was excluded. XLOOKUP it against RevHawk / the CRM by Customer ID.',
            onclick: exportPeriodCsv,
          }, '⬇ Reconcile CSV'),
          el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: () => overlay.remove() }, '×'))),
      el('div', { class: 'px-4 pb-4 overflow-y-auto' },
        el('div', { class: 'flex gap-2 flex-wrap mb-3' },
          stat('B.O.Y. book', fmt.int(boyRows.length), null, boyRows),
          stat('Churned', fmt.int(attr.length), (rate * 100).toFixed(2) + '% attrition', attr),
          stat('ARR lost', money0(arrOf(attr)), null, [...attr].sort((a, b) => (Number(b.annual_recurring_value) || 0) - (Number(a.annual_recurring_value) || 0))),
          stat('Median lifetime', median.toFixed(1) + ' mo', Math.round(under12 * 100) + '% left within 12 mo', attr.filter(r => { const v = lifeMonths(r); return v != null && v < 12; })),
          earlyLosses.length > 0 && stat('Early losses', fmt.int(earlyLosses.length), money0(arrOf(earlyLosses)) + ' ARR — sold & lost inside ' + periodLabel + ' · sales quality, NOT in the churn rate', earlyLosses)),
        el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, 'By cancellation reason'),
        // Donut (per Isaac, Sep 2026) — replaces the bar list. Legend rows
        // and slices both drill to the accounts behind that reason.
        (() => {
          if (!byReason.length) return el('div', { class: 'text-xs py-4 text-center', style: { color: 'var(--text-muted)' } }, 'No counted cancels in ' + periodLabel + '.');
          const PAL = (typeof REPORTING_PALETTE !== 'undefined' && REPORTING_PALETTE.length) ? REPORTING_PALETTE : ['#DF643A', '#2F4F4F', '#A9441F', '#5F6C5B', '#DC2626', '#C9B79C', '#8B5E3C', '#6B8E9F'];
          const colorOf = (i) => PAL[i % PAL.length];
          const rowsOf = (key) => attr.filter(r => (reportingCancelReasonOf(r) || '—') === key);
          const drillReason = (g) => openReportingDrillModal({ chartTitle: periodLabel + ' attrition · ' + g.key, sliceLabel: fmt.int(g.n) + ' accounts · ' + money0(g.arr) + ' ARR lost', rows: rowsOf(g.key), formatValue: (v) => fmt.usd0(v) });
          const cid = 'attrReasonPie_' + Math.random().toString(36).slice(2, 8);
          const cvs = el('canvas', { id: cid });
          setTimeout(() => {
            if (typeof Chart === 'undefined' || !document.getElementById(cid)) return;
            new Chart(cvs.getContext('2d'), {
              type: 'doughnut',
              data: { labels: byReason.map(g => g.key), datasets: [{ data: byReason.map(g => g.n), backgroundColor: byReason.map((_, i) => colorOf(i)), borderWidth: 1, borderColor: state.theme === 'dark' ? '#0A0B0D' : '#FFFFFF' }] },
              options: { responsive: true, maintainAspectRatio: false, cutout: '58%',
                onClick: (evt, els) => { if (els && els.length) drillReason(byReason[els[0].index]); },
                plugins: { legend: { display: false }, tooltip: { callbacks: { label: (c) => ' ' + fmt.int(c.parsed) + ' · ' + (attr.length ? (c.parsed / attr.length * 100).toFixed(1) : '0') + '% of churn' } } } },
            });
          }, 30);
          const legendRow = (g, i) => { const avgLife = g.lives.length ? g.lives.reduce((a, b) => a + b, 0) / g.lives.length : null; return el('div', {
            class: 'flex items-center gap-2 py-1 text-xs cursor-pointer transition hover:brightness-95 border-t border-', title: 'Click for the accounts', onclick: () => drillReason(g) },
            el('span', { class: 'shrink-0', style: { width: '10px', height: '10px', background: colorOf(i), borderRadius: '2px' } }),
            el('span', { class: 'font-semibold truncate flex-1' }, g.key),
            el('span', { class: 'tabular-nums whitespace-nowrap text-[11px]', style: { color: 'var(--text-muted)' } }, fmt.int(g.n) + ' · ' + (attr.length ? (g.n / attr.length * 100).toFixed(1) : '0') + '%'),
            el('span', { class: 'tabular-nums whitespace-nowrap text-[10px] hidden sm:inline', style: { color: 'var(--text-subtle)' } }, money0(g.arr) + (avgLife != null ? ' · ' + avgLife.toFixed(1) + ' mo' : ''))); };
          return el('div', { class: 'flex flex-col sm:flex-row gap-4 items-center sm:items-start' },
            el('div', { class: 'shrink-0', style: { position: 'relative', width: '220px', height: '220px' } }, cvs),
            el('div', { class: 'flex-1 min-w-0 w-full' }, ...byReason.map(legendRow)));
        })(),
        el('div', { class: 'flex gap-5 flex-wrap mt-4' },
          miniTable('Top services', byService),
          miniTable('Top offices', byOffice)),
        excluded.length > 0 && el('div', { class: 'mt-4 text-[11px] px-3 py-2 rounded-lg', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
          '+ ' + fmt.int(excluded.length) + ' cancel(s) in ' + periodLabel + ' did NOT count as churn (config-excluded reasons or 3-day ROR): '
          + groupBy2(excluded, r => reportingCancelReasonOf(r)).slice(0, 5).map(g => g.key + ' ×' + g.n).join(' · ')),
      ));
    overlay.append(card);
    document.body.append(overlay);
  };
  // ── Cohort waterfall (Isaac's sheet): rows = first-service year, columns
  // = year-end, cells = accounts from that cohort still active at that
  // year-end. Built from the SAME retention book as Attrition Steps, with an
  // office dropdown (RIDD = every office).
  // Cohort-age palette (per Isaac, Sep 22): every cohort's year 1 is the same
  // colour, year 2 the same, and so on — so the same-age cells line up
  // visually down the diagonals instead of colouring by survival.
  const COHORT_AGE_BG = ['#DCEFD6', '#E4EED0', '#F1EBC7', '#F7E3C2', '#F7D9C4', '#F3CFC9', '#EBC9D3', '#E2CCE0'];
  const renderBlended = (pop) => {
    const scoped = pop;   // office scope comes from the tab's top filter
    const rows = _retenEff(scoped);
    const yearOf = (iso) => Number(String(iso || '').slice(0, 4));
    const thisYear = new Date().getFullYear();
    const cohorts = [...new Set(rows.map(r => yearOf(r.initial_service)).filter(y => y >= 2000))].sort();
    if (!cohorts.length) return null;
    const years = []; for (let y = cohorts[0]; y <= thisYear; y++) years.push(y);
    const todayIso = new Date().toISOString().slice(0, 10);
    const endOf = (y) => y >= thisYear ? todayIso : y + '-12-31';
    const isArr = mode === 'arv';
    const val = (rs) => isArr ? rs.reduce((a, r) => a + (Number(r.annual_recurring_value) || 0), 0) : rs.length;
    const num = isArr ? money0 : (v) => Math.round(v).toLocaleString();
    const byCohort = new Map(); rows.forEach(r => { const y = yearOf(r.initial_service); if (!byCohort.has(y)) byCohort.set(y, []); byCohort.get(y).push(r); });
    const cell = (c, y) => { const rs = byCohort.get(c) || []; const en = endOf(y); return rs.filter(r => r.initial_service <= en && (!r._effCancel || r._effCancel > en)); };
    const colTotal = (y) => cohorts.filter(c => c <= y).reduce((a, c) => a + val(cell(c, y)), 0);
    // Blended attrition per year-end column: cohorts that existed at the prior
    // year-end, followed to this year-end.
    const blended = (y) => { const prior = cohorts.filter(c => c < y); const boy = prior.reduce((a, c) => a + val(cell(c, y - 1)), 0); const eoy = prior.reduce((a, c) => a + val(cell(c, y)), 0); return boy ? 1 - eoy / boy : null; };
    const th = (t, o = {}) => el('th', { class: 'px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (o.left ? 'text-left' : 'text-right'), style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0, left: o.corner ? 0 : undefined, zIndex: o.corner ? 3 : 2 } }, t);
    const td = (t, o = {}) => el('td', { class: 'px-2.5 py-1.5 tabular-nums whitespace-nowrap ' + (o.left ? 'text-left font-semibold' : 'text-right') + (o.bold ? ' font-black' : ''), style: { color: o.muted ? 'var(--text-subtle)' : undefined, background: o.sticky ? (o.bg || 'var(--card)') : (o.bg || undefined), position: o.sticky ? 'sticky' : undefined, left: o.sticky ? 0 : undefined, zIndex: o.sticky ? 1 : undefined, boxShadow: o.sticky ? '1px 0 0 var(--border)' : undefined, cursor: o.onclick ? 'pointer' : undefined }, onclick: o.onclick }, t);
    const drillRows = (title, rs) => rs.length ? () => openReportingDrillModal({ chartTitle: 'Cohort waterfall · ' + title, sliceLabel: rs.length.toLocaleString() + ' subscription' + (rs.length === 1 ? '' : 's'), rows: rs, formatValue: fmt.usd0 }) : undefined;
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Cohort Waterfall' + (office !== 'all' ? ' · ' + office : ''))),
        el('div', { class: 'inline-flex', style: { border: '1px solid var(--border-2)' } },
          ...[[false, 'Subs'], [true, 'ARR']].map(([v, l]) => el('button', {
            class: 'px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
            style: !!state._rtWaterfallArr === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card)', color: 'var(--text-muted)' },
            onclick: () => { state._rtWaterfallArr = v; mountApp(); },
          }, l))),
        null),
      el('div', { style: { overflow: 'auto', maxHeight: '70vh' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th('Year', { left: true, corner: true }), th(isArr ? 'ARR' : 'Subs'), ...years.map(y => th(String(y))))),
        el('tbody', {},
          ...cohorts.map(c => { const all = byCohort.get(c) || []; return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            td(String(c), { left: true, sticky: true }),
            td(num(val(all)), { bold: true, onclick: drillRows(c + ' cohort', all) }),
            ...years.map(y => { if (y < c) return td('', {}); const rs = cell(c, y);
              // Cell = share of the cohort lost IN this year (per Isaac, Sep 22): alive at the
              // prior year-end (the whole cohort in its first year) minus alive now, over the
              // prior figure. The diagonal is same-year / first-year attrition. Hover = counts;
              // click = the cancelled accounts.
              const prevRs = y === c ? all : cell(c, y - 1); const en = endOf(y);
              const lost = prevRs.filter(r => r._effCancel && r._effCancel <= en && (y === c || r._effCancel > (y - 1) + '-12-31'));
              const a = val(prevRs) > 0 ? 1 - val(rs) / val(prevRs) : null;
              // Both reads in the cell (per Isaac): what's still active, and the % lost that year underneath.
              return td(el('div', { class: 'flex flex-col items-end leading-tight' }, el('span', {}, num(val(rs))), el('span', { class: 'text-[10px] font-semibold', style: { color: a == null ? 'var(--text-subtle)' : a > 0 ? '#B91C1C' : 'var(--text-subtle)' } }, a == null ? '\u2014' : '\u2212' + (a * 100).toFixed(1) + '%')), { title: num(val(lost)) + ' of ' + num(val(prevRs)) + ' lost in ' + (y >= thisYear ? y + ' to date' : y) + ' \u00b7 ' + num(val(rs)) + ' still active', onclick: lost.length ? drillRows(c + ' cohort \u00b7 cancelled in ' + y + ' (' + num(val(lost)) + ' of ' + num(val(prevRs)) + ')', lost) : undefined, bg: COHORT_AGE_BG[Math.min(y - c, COHORT_AGE_BG.length - 1)] }); })); }),
          el('tr', { class: 'border-t-2 font-black', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
            td('Total', { left: true, sticky: true, bg: 'var(--card-2)' }), td(num(val(rows)), { bold: true }),
            ...years.map(y => td(num(colTotal(y)), { bold: true }))),
          el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            td('Blended attrition', { left: true, sticky: true, muted: true }), td('', {}),
            ...years.map(y => { const a = blended(y); return td(a == null ? '—' : (a * 100).toFixed(1) + '%', { bold: true, muted: a == null, onclick: a == null ? undefined : () => openAttritionDrill(scoped, y) }); }))))));
  };
  // ── SEASONALITY — monthly churn rate, months × years. Finds the "do we
  // bleed customers at certain points of the year" pattern. Cell = churn ÷
  // book at month start; click any cell for that month's reason breakdown. ──
  const seasonalityCard = (pop, label) => {
    const rows = _retenEff(pop);
    if (!rows.length) return null;
    const pad2 = (n) => String(n).padStart(2, '0');
    const startsByYm = {}, cancelsByYm = {}, reasonsByYm = {};
    // Per-reason view (per Isaac, Sep 24): pick one cancellation reason and
    // the grid shows THAT reason's churn month by month / year by year —
    // numerator = cancels with the reason, denominator = the whole book.
    const R = state._churnSeasonReason || '';
    const reasonCounts = {};
    let minY = 9999;
    rows.forEach(r => {
      const sYm = String(r.initial_service).slice(0, 7);
      startsByYm[sYm] = (startsByYm[sYm] || 0) + 1;
      minY = Math.min(minY, Number(sYm.slice(0, 4)) || 9999);
      if (r._effCancel) {
        const cYm = String(r._effCancel).slice(0, 7);
        const reason = reportingCancelReasonOf(r);
        // PE-standard churn: only subs that EXISTED at the month's start
        // count — an account acquired and lost inside the same month is a
        // sales-quality event, not book erosion. (The denominator already
        // excluded same-month starts; the numerator now matches, so these
        // cells agree exactly with the click-through drill.)
        if (sYm < cYm) {
          reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
          if (R && reason !== R) return;
          cancelsByYm[cYm] = (cancelsByYm[cYm] || 0) + 1;
          const rs = reasonsByYm[cYm] || (reasonsByYm[cYm] = {});
          rs[reason] = (rs[reason] || 0) + 1;
        }
      }
    });
    const reasonSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '220px' },
      title: 'Show churn for one cancellation reason (cancels with that reason ÷ the whole book)',
      onchange: (e) => { state._churnSeasonReason = e.target.value; mountApp(); } },
      el('option', { value: '', selected: !R }, 'All reasons'),
      ...Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).map(([k, n]) => el('option', { value: k, selected: k === R }, k + ' (' + fmt.int(n) + ')')));
    const now = new Date();
    const curY = now.getFullYear(), curM = now.getMonth() + 1;
    // Walk the whole book month by month so each cell's denominator is the
    // TRUE book at that month's start (same-month starts excluded). The walk
    // subtracts ALL cancels (including same-month acquire-lose, which the
    // churn numerator excludes) so the running book stays honest.
    const allCancelsByYm = {};
    rows.forEach(r => { if (r._effCancel) { const k = String(r._effCancel).slice(0, 7); allCancelsByYm[k] = (allCancelsByYm[k] || 0) + 1; } });
    const bookAt = {};
    let book = 0;
    for (let y = minY; y <= curY; y++) for (let m = 1; m <= 12; m++) {
      const ym = y + '-' + pad2(m);
      bookAt[ym] = book;
      book += (startsByYm[ym] || 0) - (allCancelsByYm[ym] || 0);
    }
    const yearsAvail = [];
    for (let y = minY; y <= curY; y++) yearsAvail.push(y);
    // Always the rolling last 5 years (per Isaac) — no year picker.
    let yearsShown = yearsAvail.slice(-5);
    yearsShown = [...yearsShown].sort((a, b) => a - b);
    const rateOf = (y, m) => {
      const ym = y + '-' + pad2(m);
      const den = bookAt[ym] || 0;
      if (!den) return null;
      return { rate: (cancelsByYm[ym] || 0) / den, n: cancelsByYm[ym] || 0, den };
    };
    const heat = (rate) => {
      const t = Math.max(0, Math.min(1, rate / 0.05));   // 5%/mo = full red
      return `hsl(${120 * (1 - t)}, 70%, 88%)`;
    };
    const topReasons = (y, m) => {
      const rs = reasonsByYm[y + '-' + pad2(m)] || {};
      return Object.entries(rs).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => k + ' ×' + n).join(' · ');
    };
    const monthRow = (m) => {
      const cells = yearsShown.map(y => {
        if (y === curY && m > curM) return el('td', { class: 'px-2 py-1.5' }, '');
        const v = rateOf(y, m);
        if (!v) return el('td', { class: 'px-2 py-1.5', style: { color: 'var(--text-subtle)' } }, '—');
        // Current month is PARTIAL — project the full-month pace so it reads
        // against complete months: cancels ÷ days elapsed × days in month.
        let pace = null;
        if (y === curY && m === curM) {
          const nowNY = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
          const dayNum = nowNY.getDate();
          const daysInM = new Date(y, m, 0).getDate();
          if (dayNum >= 3 && dayNum < daysInM) pace = (v.n / dayNum * daysInM) / v.den;   // too noisy the first couple days
        }
        return el('td', {
          class: 'px-2 py-1.5 tabular-nums cursor-pointer transition hover:brightness-95',
          style: { background: heat(pace != null ? pace : v.rate), color: '#323230', fontWeight: '600' },
          title: MONTHS_S[m - 1] + ' ' + y + ': ' + v.n + ' of ' + fmt.int(v.den) + ' churned'
            + (pace != null ? ' so far — trending to ' + (pace * 100).toFixed(2) + '% at the current pace (~' + Math.round(pace * v.den) + ' cancels by month-end)' : '')
            + (topReasons(y, m) ? ' — ' + topReasons(y, m) : '') + '. Click for the full breakdown.',
          onclick: () => openAttritionDrill(pop, y, m),
        }, (v.rate * 100).toFixed(2) + '%', el('span', { class: 'text-[9px] ml-1 whitespace-nowrap', style: { opacity: '.65' } }, '(' + fmt.int(v.n) + ' of ' + fmt.int(v.den) + ')'),
          pace != null && el('div', { class: 'text-[9px] font-bold', style: { opacity: '.75', marginTop: '1px' } },
            '→ ' + (pace * 100).toFixed(2) + '% pace'));
      });
      return el('tr', { class: 'border-t border-' },
        el('td', { class: 'px-2.5 py-1.5 font-semibold', style: { position: 'sticky', left: 0, zIndex: 1, background: 'var(--card)', boxShadow: '1px 0 0 var(--border)' } }, MONTHS_S[m - 1]), ...cells);
    };
    // Header controls: every history year as a toggle chip + Table/Graph view.
    // Overlay + Timeline merged into one Graph view — any legacy stored
    // value ('graph' was Overlay, 'reasons' pre-merge) lands on it.
    const view = ['graph', 'timeline', 'reasons'].includes(state._churnSeasonView) ? 'timeline' : 'table';
    const yearsDrop = (() => {
      const wrap = el('div', { class: 'relative' });
      const panel = el('div', {
        class: 'card absolute p-1.5',
        style: { top: 'calc(100% + 6px)', right: '0', minWidth: '130px', maxHeight: '260px', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._churnYearsOpen ? 'block' : 'none' },
      },
        ...yearsAvail.slice().sort((a, b) => b - a).map(y => {
          const on = yearsShown.includes(y);
          return el('button', {
            class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
            style: { color: 'var(--text)', background: on ? 'var(--card-2)' : 'transparent' },
            onclick: (e) => {
              e.stopPropagation();
              const next = on ? yearsShown.filter(x => x !== y) : [...yearsShown, y];
              state._churnSeasonYears = next.length ? next : [y];
              state._churnYearsOpen = true;   // keep the panel open while picking
              mountApp();
            },
          }, el('span', { style: { fontSize: '13px' } }, on ? '☑' : '☐'), el('span', {}, String(y)));
        }));
      const btn = el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer border flex items-center gap-1.5 transition hover:brightness-95',
        style: yearsShown.length > 1
          ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
          : { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Pick which years show as columns / overlay lines',
        onclick: (e) => {
          e.stopPropagation();
          const open = panel.style.display === 'block';
          panel.style.display = open ? 'none' : 'block';
          state._churnYearsOpen = !open;
          if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
            if (wrap.contains(ev.target)) return;
            panel.style.display = 'none'; state._churnYearsOpen = false;
            document.removeEventListener('mousedown', closer);
          }), 0); }
        },
      }, 'Years · ' + yearsShown.length);
      if (state._churnYearsOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
        if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
        if (wrap.contains(ev.target)) return;
        panel.style.display = 'none'; state._churnYearsOpen = false;
        document.removeEventListener('mousedown', closer);
      }), 0); }
      wrap.append(btn, panel);
      return wrap;
    })();
    const viewToggle = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...[['table', 'Table'], ['timeline', 'Graph']].map(([v, l]) => el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold cursor-pointer transition',
        style: view === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
        onclick: () => { state._churnSeasonView = v; mountApp(); },
      }, l)));
    // Month column frozen while the years swipe (per Isaac) — frozen-table
    // keeps it a real table on phones.
    const tableEl = () => el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-xs frozen-table' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-' },
          el('tr', {},
            el('th', { class: 'text-left px-2.5 py-2 font-semibold', style: { position: 'sticky', left: 0, zIndex: 2, background: 'var(--card)', boxShadow: '1px 0 0 var(--border)' } }, 'Month'),
            ...yearsShown.map(y => el('th', { class: 'text-left px-2 py-2 font-semibold' }, String(y))))),
        el('tbody', {}, ...Array.from({ length: 12 }, (_, i) => monthRow(i + 1)),
          // ── TOTAL row (per Isaac): the year's monthly rates added up (≈ the
          // annual attrition the months compound to) with the cancels behind it.
          (() => {
            const tot = yearsShown.map(y => {
              let n = 0, rate = 0, months = 0;
              for (let m = 1; m <= 12; m++) { if (y === curY && m > curM) break; const v = rateOf(y, m); if (!v) continue; n += v.n; rate += v.rate; months++; }
              return months ? { n, rate, months, partial: y === curY } : null;
            });
            return el('tr', { class: 'border-t-2', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
              el('td', { class: 'px-2.5 py-2 font-black', style: { position: 'sticky', left: 0, zIndex: 1, background: 'var(--card-2)', boxShadow: '1px 0 0 var(--border)' } }, 'Total'),
              ...tot.map((t, i) => t ? el('td', { class: 'px-2 py-2 tabular-nums font-black', title: MONTHS_S[0] + '–' + MONTHS_S[t.months - 1] + ' ' + yearsShown[i] + ': ' + fmt.int(t.n) + ' cancels · monthly rates added up' + (t.partial ? ' (year to date)' : '') },
                (t.rate * 100).toFixed(1) + '%', el('span', { class: 'text-[9px] ml-1', style: { opacity: '.65' } }, '(' + fmt.int(t.n) + ')'),
                t.partial ? el('div', { class: 'text-[9px] font-bold', style: { opacity: '.6', marginTop: '1px' } }, 'YTD') : null)
                : el('td', { class: 'px-2 py-2', style: { color: 'var(--text-subtle)' } }, '—')));
          })())));
    // ── TIMELINE — one continuous monthly churn line across all history,
    // draggable: grab the chart and pull forwards/backwards through time. ──
    // ── REASONS — MoM churn-rate contribution per cancellation reason:
    // each line = that reason's cancels ÷ book at month start, so lines are
    // comparable as the book grows and they SUM to the total monthly rate. ──
    const reasonTotals = (() => {
      const t = new Map();
      Object.values(reasonsByYm).forEach(rs => Object.entries(rs).forEach(([k, n]) => t.set(k, (t.get(k) || 0) + n)));
      return [...t.entries()].sort((a, b) => b[1] - a[1]);
    })();
    const selReasons = (() => {
      const all = reasonTotals.map(([k]) => k);
      const sel = Array.isArray(state._churnReasonSel) ? state._churnReasonSel.filter(r => all.includes(r)) : [];
      return sel.length ? sel : all.slice(0, 5);   // default: top 5 by volume
    })();
    const seriesDrop = (() => {
      const TOTAL_KEY = '__total__';
      const wrap = el('div', { class: 'relative' });
      const selNow = (Array.isArray(state._churnSeries) && state._churnSeries.length)
        ? state._churnSeries.filter(k => k === TOTAL_KEY || reasonTotals.some(([r]) => r === k))
        : [TOTAL_KEY];
      const rowFor = (key, labelTxt, count) => {
        const on = selNow.includes(key);
        return el('button', {
          class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
          style: { color: 'var(--text)', background: on ? 'var(--card-2)' : 'transparent' },
          onclick: (e) => {
            e.stopPropagation();
            const next = on ? selNow.filter(x => x !== key) : [...selNow, key];
            state._churnSeries = next.length ? next : [TOTAL_KEY];
            state._churnSeriesOpen = true;
            mountApp();
          },
        }, el('span', { style: { fontSize: '13px' } }, on ? '☑' : '☐'),
           el('span', { class: 'flex-1 truncate' }, labelTxt),
           count != null && el('span', { class: 'tabular-nums', style: { color: 'var(--text-subtle)' } }, fmt.int(count)));
      };
      const panel = el('div', {
        class: 'card absolute p-1.5',
        style: { top: 'calc(100% + 6px)', right: '0', minWidth: '250px', maxHeight: '320px', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._churnSeriesOpen ? 'block' : 'none' },
      },
        rowFor(TOTAL_KEY, 'Total churn rate', null),
        el('div', { class: 'px-2.5 pt-2 pb-0.5 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'By cancellation reason'),
        ...reasonTotals.map(([r, n]) => rowFor(r, r, n)));
      const btn = el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer border flex items-center gap-1.5 transition hover:brightness-95',
        style: selNow.length > 1 || selNow[0] !== TOTAL_KEY
          ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
          : { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Pick what plots: the total churn rate and/or individual cancellation reasons (reason lines sum to the total)',
        onclick: (e) => {
          e.stopPropagation();
          const open = panel.style.display === 'block';
          panel.style.display = open ? 'none' : 'block';
          state._churnSeriesOpen = !open;
          if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
            if (wrap.contains(ev.target)) return;
            panel.style.display = 'none'; state._churnSeriesOpen = false;
            document.removeEventListener('mousedown', closer);
          }), 0); }
        },
      }, 'Series · ' + selNow.length);
      if (state._churnSeriesOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
        if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
        if (wrap.contains(ev.target)) return;
        panel.style.display = 'none'; state._churnSeriesOpen = false;
        document.removeEventListener('mousedown', closer);
      }), 0); }
      wrap.append(btn, panel);
      return wrap;
    })();
    // Window (zoom) — widen to 36mo/All and the seasonal humps stack up for
    // YoY reading; drag still pans within the window.
    const windowSel = el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      title: 'How many months are visible at once',
      onchange: (e) => { state._churnWindow = e.target.value; state._churnPanStart = null; mountApp(); },
    }, ...[['12', '12 mo'], ['24', '24 mo'], ['36', '36 mo'], ['all', 'All']]
      .map(([v, l]) => { const o = el('option', { value: v }, l); if (String(state._churnWindow || 'all') === v) o.selected = true; return o; }));
    // (Trend overlay button removed, per Isaac — state._churnTrend stays off.)
    state._churnTrend = false;
    // Years filter for the Graph view — restrict the timeline to specific
    // years (empty = all history). Selected years plot back-to-back.
    const graphYearsSel = (Array.isArray(state._churnGraphYears) ? state._churnGraphYears.filter(y => yearsAvail.includes(y)) : []);
    const graphYearsDrop = (() => {
      const wrap = el('div', { class: 'relative' });
      const isAll = graphYearsSel.length === 0;
      const rowFor = (y) => {
        const on = isAll || graphYearsSel.includes(y);
        return el('button', {
          class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
          style: { color: 'var(--text)', background: (!isAll && on) ? 'var(--card-2)' : 'transparent' },
          onclick: (e) => {
            e.stopPropagation();
            // From "All": clicking a year narrows to just that year.
            // Otherwise toggle; emptying the list goes back to All.
            const next = isAll ? [y] : (on ? graphYearsSel.filter(x => x !== y) : [...graphYearsSel, y]);
            state._churnGraphYears = next;
            state._churnGraphYearsOpen = true;
            state._churnPanStart = null;
            mountApp();
          },
        }, el('span', { style: { fontSize: '13px' } }, on ? '☑' : '☐'), el('span', {}, String(y)));
      };
      const panel = el('div', {
        class: 'card absolute p-1.5',
        style: { top: 'calc(100% + 6px)', right: '0', minWidth: '140px', maxHeight: '280px', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._churnGraphYearsOpen ? 'block' : 'none' },
      },
        el('button', {
          class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer text-left transition hover:brightness-95',
          style: { color: 'var(--text)', background: isAll ? 'var(--card-2)' : 'transparent' },
          onclick: (e) => { e.stopPropagation(); state._churnGraphYears = []; state._churnGraphYearsOpen = true; state._churnPanStart = null; mountApp(); },
        }, el('span', { style: { fontSize: '13px' } }, isAll ? '☑' : '☐'), el('span', {}, 'All years')),
        el('div', { class: 'px-2.5 pt-2 pb-0.5 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Specific years'),
        ...yearsAvail.slice().sort((a, b) => b - a).map(rowFor));
      const btn = el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer border flex items-center gap-1.5 transition hover:brightness-95',
        style: !isAll
          ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
          : { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Restrict the graph to specific years (they plot back-to-back); All = the full history',
        onclick: (e) => {
          e.stopPropagation();
          const open = panel.style.display === 'block';
          panel.style.display = open ? 'none' : 'block';
          state._churnGraphYearsOpen = !open;
          if (!open) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
            if (wrap.contains(ev.target)) return;
            panel.style.display = 'none'; state._churnGraphYearsOpen = false;
            document.removeEventListener('mousedown', closer);
          }), 0); }
        },
      }, 'Years · ' + (isAll ? 'All' : graphYearsSel.length));
      if (state._churnGraphYearsOpen) { clampDropdownPanel(panel); setTimeout(() => document.addEventListener('mousedown', function closer(ev) {
        if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); return; }
        if (wrap.contains(ev.target)) return;
        panel.style.display = 'none'; state._churnGraphYearsOpen = false;
        document.removeEventListener('mousedown', closer);
      }), 0); }
      wrap.append(btn, panel);
      return wrap;
    })();
    // YoY — stack the selected years Jan–Dec on ONE axis so the same months
    // line up (this is the old Overlay, reborn inside the Graph view). Color
    // = year; when multiple series are picked, dash pattern = series.
    const yoyOn = !!state._churnYoY;
    const yoyBtn = el('button', {
      class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer border transition hover:brightness-95',
      style: yoyOn
        ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
        : { borderColor: 'var(--border-2)', color: 'var(--text)' },
      title: 'Overlay the selected years Jan–Dec on the same axis — same months stack for year-over-year reading',
      onclick: () => { state._churnYoY = !state._churnYoY; mountApp(); },
    }, 'YoY');
    const yoyEl = () => (() => {
      const TOTAL_KEY = '__total__';
      const selSeries = (Array.isArray(state._churnSeries) && state._churnSeries.length)
        ? state._churnSeries.filter(k => k === TOTAL_KEY || reasonTotals.some(([r]) => r === k))
        : [TOTAL_KEY];
      const yrs = yearsAvail.slice(-5).slice().sort((a, b) => a - b);
      const nameOf = (k) => k === TOTAL_KEY ? 'Total churn' : k;
      const valOf = (key, y, m) => {
        if (y === curY && m > curM) return null;
        const ym = y + '-' + pad2(m);
        const den = bookAt[ym] || 0;
        if (den < 10) return null;
        return (key === TOTAL_KEY ? (cancelsByYm[ym] || 0) : ((reasonsByYm[ym] || {})[key] || 0)) / den;
      };
      const cid = 'chart-churn-yoy-' + String(label || 'main').replace(/[^a-z0-9]/gi, '-') + (inCompare ? '-cmp' : '');
      const palette2 = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
      const DASHES = [[], [6, 4], [2, 3], [10, 4, 2, 4]];
      const hint = el('div', { class: 'px-4 pt-2 text-[10px]', style: { color: 'var(--text-subtle)' } },
        'Jan–Dec, one line per year — same months stack for YoY' + (selSeries.length > 1 ? ' · dash pattern = series' : ' · ' + nameOf(selSeries[0])));
      const wrapEl = el('div', { class: 'px-4 pb-4 pt-1', style: { position: 'relative', height: '280px' } }, el('canvas', { id: cid }));
      setTimeout(() => {
        if (typeof Chart === 'undefined') return;
        const cvs = document.getElementById(cid);
        if (!cvs) return;
        if (_chartInstances[cid]) { _chartInstances[cid].destroy(); delete _chartInstances[cid]; }
        const isDark = state.theme === 'dark';
        const txt = isDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)';
        const grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
        const dsets = [];
        yrs.forEach((y, yi) => selSeries.forEach((key, si) => dsets.push({
          label: String(y) + (selSeries.length > 1 ? ' · ' + nameOf(key) : ''),
          data: Array.from({ length: 12 }, (_, mi) => valOf(key, y, mi + 1)),
          borderColor: y === curY ? '#DF643A' : palette2[yi % palette2.length],
          backgroundColor: 'transparent',
          borderWidth: y === curY ? 3 : 2,
          borderDash: DASHES[si % DASHES.length],
          spanGaps: true, tension: 0.3, pointRadius: 2.5, pointHoverRadius: 5, pointHitRadius: 10,
          _year: y, _key: key,
        })));
        _chartInstances[cid] = new Chart(cvs.getContext('2d'), {
          type: 'line',
          data: { labels: MONTHS_S, datasets: dsets },
          options: {
            responsive: true, maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: true },
            plugins: {
              legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 }, usePointStyle: true } },
              tooltip: { callbacks: { label: (ctx) => {
                const y = ctx.dataset._year, key = ctx.dataset._key, m = ctx.dataIndex + 1;
                const ym = y + '-' + pad2(m);
                const den = bookAt[ym] || 0;
                const n = key === TOTAL_KEY ? (cancelsByYm[ym] || 0) : ((reasonsByYm[ym] || {})[key] || 0);
                return ctx.dataset.label + ': ' + (ctx.parsed.y * 100).toFixed(2) + '% (' + n + ' of ' + fmt.int(den) + ')';
              } } },
            },
            scales: {
              y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => (v * 100).toFixed(1) + '%' } },
              x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 } } },
            },
          },
        });
      }, 50);
      return el('div', {}, hint, wrapEl);
    })();
    const timelineEl = () => (() => {
      const TOTAL_KEY = '__total__';
      const selSeries = (Array.isArray(state._churnSeries) && state._churnSeries.length)
        ? state._churnSeries.filter(k => k === TOTAL_KEY || reasonTotals.some(([r]) => r === k))
        : [TOTAL_KEY];
      const pad2b = (n) => String(n).padStart(2, '0');
      const seq = [];
      const _yrsFilter = graphYearsSel.length ? graphYearsSel : null;
      for (let y = minY; y <= curY; y++) for (let m = 1; m <= 12; m++) {
        if (y === curY && m > curM) break;
        if (_yrsFilter && !_yrsFilter.includes(y)) continue;
        const ym = y + '-' + pad2b(m);
        const den = bookAt[ym] || 0;
        seq.push({ ym, label: MONTHS_S[m - 1] + ' ' + String(y).slice(2), den, n: cancelsByYm[ym] || 0 });
      }
      let _first = 0;
      while (_first < seq.length && (seq[_first].den || 0) < 10) _first++;
      if (_first > 0) seq.splice(0, _first);
      const winPref = state._churnWindow || 'all';
      const VISIBLE = winPref === 'all' ? Math.max(6, seq.length) : Math.min(Number(winPref) || 24, Math.max(6, seq.length));
      const maxStart = Math.max(0, seq.length - VISIBLE);
      if (state._churnPanStart == null || state._churnPanStart > maxStart) state._churnPanStart = maxStart;
      const cid = 'chart-churn-timeline-' + String(label || 'main').replace(/[^a-z0-9]/gi, '-') + (inCompare ? '-cmp' : '');
      const palette = ['#DF643A', '#5F6C5B', '#323230', '#A78256', '#9C3F1E', '#8E9C8A', '#FFB899', '#C9B98A', '#3F4A3C', '#E8A06B', '#7C857A', '#6B2A12'];
      const hint = el('div', { class: 'px-4 pt-2 text-[10px]', style: { color: 'var(--text-subtle)' } },
        '↔ Drag to move through time · showing ' + VISIBLE + ' of ' + seq.length + ' months · reason lines are their share of the monthly rate and sum to the total');
      const wrapEl = el('div', { class: 'px-4 pb-4 pt-1', style: { position: 'relative', height: '280px' } },
        el('canvas', { id: cid, style: { cursor: 'grab', touchAction: 'pan-y' } }));
      setTimeout(() => {
        if (typeof Chart === 'undefined') return;
        const cvs = document.getElementById(cid);
        if (!cvs) return;
        if (_chartInstances[cid]) { _chartInstances[cid].destroy(); delete _chartInstances[cid]; }
        const isDark = state.theme === 'dark';
        const txt = isDark ? 'rgba(255,255,255,.55)' : 'rgba(0,0,0,.5)';
        const grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
        const windowOf = (start) => seq.slice(start, start + VISIBLE);
        // Least-squares fit over the visible window's non-null points →
        // a straight dashed line showing the direction of travel.
        const trendOf = (vals) => {
          const pts = vals.map((v, x) => [x, v]).filter(([, v]) => v != null);
          if (pts.length < 3) return null;
          const n = pts.length;
          const sx = pts.reduce((a, [x]) => a + x, 0), sy = pts.reduce((a, [, v]) => a + v, 0);
          const sxx = pts.reduce((a, [x]) => a + x * x, 0), sxy = pts.reduce((a, [x, v]) => a + x * v, 0);
          const den = n * sxx - sx * sx;
          if (!den) return null;
          const m = (n * sxy - sx * sy) / den, b = (sy - m * sx) / n;
          return { line: vals.map((_, x) => m * x + b), slope: m };
        };
        const dsBase = (start) => selSeries.map((key, i) => key === TOTAL_KEY
          ? {
              label: 'Total churn',
              data: windowOf(start).map(p => p.den >= 10 ? p.n / p.den : null),
              borderColor: '#DC2626', backgroundColor: 'rgba(220,38,38,.10)', fill: selSeries.length === 1,
              spanGaps: true, tension: 0.3, borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 5, pointHitRadius: 10, order: 0,
            }
          : {
              label: key,
              data: windowOf(start).map(p => p.den >= 10 ? ((reasonsByYm[p.ym] || {})[key] || 0) / p.den : null),
              borderColor: palette[i % palette.length], backgroundColor: 'transparent',
              spanGaps: true, tension: 0.3, borderWidth: 2, pointRadius: 1.5, pointHoverRadius: 5, pointHitRadius: 10, order: 1,
            });
        const dsFor = (start) => {
          const base = dsBase(start);
          if (!state._churnTrend) return base;
          const trends = [];
          base.forEach(d => {
            const t = trendOf(d.data);
            if (!t) return;
            trends.push({
              label: d.label + ' trend',
              data: t.line,
              borderColor: d.borderColor, backgroundColor: 'transparent',
              borderDash: [5, 5], borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0,
              fill: false, tension: 0, order: 2, _slope: t.slope,
            });
          });
          return base.concat(trends);
        };
        const ch = new Chart(cvs.getContext('2d'), {
          type: 'line',
          data: { labels: windowOf(state._churnPanStart).map(p => p.label), datasets: dsFor(state._churnPanStart) },
          options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            // Tooltip only when the cursor (or a tap) is ON a dot — not
            // anywhere in the plot. mode stays 'index' so hitting one dot
            // still shows every series for that month.
            interaction: { mode: 'index', intersect: true },
            plugins: {
              legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 }, usePointStyle: true, filter: (item) => !/ trend$/.test(item.text) } },
              tooltip: { callbacks: { label: (ctx) => {
                if (/ trend$/.test(ctx.dataset.label)) {
                  const sl = (ctx.dataset._slope || 0) * 100;
                  return ctx.dataset.label + ': ' + (sl >= 0 ? '▲ +' : '▼ −') + Math.abs(sl).toFixed(3) + ' pts/mo';
                }
                const p = windowOf(state._churnPanStart)[ctx.dataIndex];
                if (!p) return ctx.dataset.label + ': ' + (ctx.parsed.y * 100).toFixed(2) + '%';
                const n = ctx.dataset.label === 'Total churn' ? p.n : ((reasonsByYm[p.ym] || {})[ctx.dataset.label] || 0);
                return ctx.dataset.label + ': ' + (ctx.parsed.y * 100).toFixed(2) + '% (' + n + ' of ' + fmt.int(p.den) + ')';
              } } },
            },
            scales: {
              y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => (v * 100).toFixed(1) + '%' } },
              x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: VISIBLE > 30 ? 24 : 12 } },
            },
          },
        });
        _chartInstances[cid] = ch;
        let dragging = false, startX = 0, startPan = 0;
        const repaint = () => {
          const w = windowOf(state._churnPanStart);
          ch.data.labels = w.map(p => p.label);
          ch.data.datasets = dsFor(state._churnPanStart);
          ch.update('none');
        };
        cvs.addEventListener('pointerdown', (e) => {
          dragging = true; startX = e.clientX; startPan = state._churnPanStart;
          cvs.style.cursor = 'grabbing';
          try { cvs.setPointerCapture(e.pointerId); } catch (err) { /* fine */ }
        });
        cvs.addEventListener('pointermove', (e) => {
          if (!dragging) return;
          const pxPerMonth = (ch.chartArea ? (ch.chartArea.right - ch.chartArea.left) : cvs.clientWidth) / VISIBLE;
          const delta = Math.round((startX - e.clientX) / Math.max(4, pxPerMonth));
          const next = Math.max(0, Math.min(maxStart, startPan + delta));
          if (next !== state._churnPanStart) { state._churnPanStart = next; repaint(); }
        });
        const endDrag = () => { dragging = false; cvs.style.cursor = 'grab'; };
        cvs.addEventListener('pointerup', endDrag);
        cvs.addEventListener('pointercancel', endDrag);
        cvs.addEventListener('pointerleave', endDrag);
      }, 50);
      return el('div', {}, hint, wrapEl);
    })();
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b border- flex items-center justify-between gap-2 flex-wrap' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, 'Monthly Churn' + (label ? ' — ' + label : '') + (R ? ' · ' + R : ''))),
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          view === 'table' ? reasonSel : null,
          view === 'timeline' ? seriesDrop : null,
          (view === 'timeline' && !yoyOn) ? windowSel : null,
          view === 'timeline' ? yoyBtn : null,
          viewToggle,
          )),
      view === 'timeline' ? (yoyOn ? yoyEl() : timelineEl()) : tableEl());
  };

  // ── START-MONTH COHORTS — the retention side: do customers signed in
  // April stick better than October signups? Rows = the month a customer
  // STARTED (all years pooled); columns = survival at 3/12/24 months. ──
  const startCohortCard = (pop, label) => {
    const rows = _retenEff(pop);
    if (!rows.length) return null;
    // % still active (default) or the subscriptions LEFT at each horizon (per Isaac).
    const smMode = state._rtStartMonthMode === 'count' ? 'count' : 'pct';
    const smCell = (kept, eligible) => smMode === 'count' ? fmt.int(kept) : ((kept / eligible) * 100).toFixed(1) + '%';
    const today = new Date();
    const addM = (iso, n) => { const d = new Date(iso + 'T00:00'); d.setMonth(d.getMonth() + n); return d; };
    const HORIZONS = [3, 6, 9, 12, 18, 24];   // (6, 9, 18 added per Isaac, Sep 2026)
    const byMonth = Array.from({ length: 12 }, () => []);
    rows.forEach(r => {
      const d = new Date(r.initial_service + 'T00:00');
      if (!isNaN(d)) byMonth[d.getMonth()].push(r);
    });
    const greenHeat = (pct) => `hsl(${Math.max(0, Math.min(120, pct * 120))}, 70%, 88%)`;
    const monthRow = (m) => {
      const cohort = byMonth[m];
      const cells = HORIZONS.map(h => {
        const eligible = cohort.filter(r => addM(r.initial_service, h) <= today);
        if (eligible.length < 25) return el('td', { class: 'px-2 py-1.5', style: { color: 'var(--text-subtle)' }, title: 'Fewer than 25 subs old enough for this horizon' }, '—');
        const kept = eligible.filter(r => !r._effCancel || new Date(r._effCancel + 'T00:00') >= addM(r.initial_service, h));
        const pct = kept.length / eligible.length;
        return el('td', {
          class: 'px-2 py-1.5 tabular-nums',
          style: { background: greenHeat(pct), color: '#323230', fontWeight: '600' },
          title: fmt.int(kept.length) + ' of ' + fmt.int(eligible.length) + ' subs starting in ' + MONTHS_S[m] + ' (any year) still active ' + h + ' months in',
        }, smCell(kept.length, eligible.length), smMode === 'count' ? el('span', { class: 'text-[9px] ml-1', style: { opacity: '.6' } }, '/ ' + fmt.int(eligible.length)) : null);
      });
      const churned = cohort.filter(r => r._effCancel);
      const lives = churned.map(r => {
        const a = new Date(r.initial_service + 'T00:00'), b = new Date(r._effCancel + 'T00:00');
        return (isNaN(a) || isNaN(b)) ? null : Math.max(0, (b - a) / 2629800000);
      }).filter(v => v != null).sort((a, b) => a - b);
      const medLife = lives.length ? lives[Math.floor(lives.length / 2)] : null;
      return el('tr', { class: 'border-t border-' },
        el('td', { class: 'px-2.5 py-1.5 font-semibold' }, MONTHS_S[m]),
        el('td', { class: 'px-2 py-1.5 tabular-nums', style: { color: 'var(--text-muted)' } }, fmt.int(cohort.length)),
        ...cells,
        el('td', { class: 'px-2 py-1.5 tabular-nums', style: { color: 'var(--text-muted)' } }, medLife == null ? '—' : medLife.toFixed(1) + ' mo'));
    };
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b border- flex items-center justify-between gap-2 flex-wrap' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, '🌱 Retention by Start Month' + (label ? ' — ' + label : ''))),
        el('div', { class: 'flex items-center gap-2' },
          el('div', { class: 'inline-flex', style: { border: '1px solid var(--border-2)' } },
            ...[['pct', '% kept'], ['count', 'Subs left']].map(([k, l]) => el('button', {
              class: 'px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95',
              style: smMode === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card)', color: 'var(--text-muted)' },
              onclick: () => { state._rtStartMonthMode = k; mountApp(); },
            }, l))),
          configInfoBtn('Retention by Start Month',
          'Each row pools every sub whose first service landed in that calendar month, across all years. The 3/12/24-month columns show the share still active that long after starting (or, with “Subs left”, how many of the eligible subs are still active) — only subs old enough for the horizon count, and months with fewer than 25 eligible subs show a dash. Median lifetime is measured on churned subs only (survivors would push it higher). Same attrition rules as everywhere: excluded reasons and 3-day ROR count as retained.'))),
      el('div', { class: 'scroll-x' },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-' },
            el('tr', {},
              el('th', { class: 'text-left px-2.5 py-2 font-semibold' }, 'Start Month'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Subs'),
              ...HORIZONS.map(h => el('th', { class: 'text-left px-2 py-2 font-semibold' }, h + ' Mo')),
              el('th', { class: 'text-left px-2 py-2 font-semibold', title: 'Median lifetime of the subs that churned' }, 'Med Life'))),
          el('tbody', {},
            ...Array.from({ length: 12 }, (_, i) => monthRow(i)),
            // ── ALL row — the whole book pooled, so each horizon column is
            // the true WEIGHTED average (kept ÷ eligible across every month,
            // not an average of the monthly averages). ──
            (() => {
              const cells = HORIZONS.map(h => {
                const eligible = rows.filter(r => addM(r.initial_service, h) <= today);
                if (eligible.length < 25) return el('td', { class: 'px-2 py-2', style: { color: 'var(--text-subtle)' } }, '—');
                const kept = eligible.filter(r => !r._effCancel || new Date(r._effCancel + 'T00:00') >= addM(r.initial_service, h));
                const pct = kept.length / eligible.length;
                return el('td', {
                  class: 'px-2 py-2 tabular-nums font-black',
                  style: { background: greenHeat(pct), color: '#323230' },
                  title: fmt.int(kept.length) + ' of ' + fmt.int(eligible.length) + ' subs (all start months pooled) still active ' + h + ' months in',
                }, smCell(kept.length, eligible.length), smMode === 'count' ? el('span', { class: 'text-[9px] ml-1 font-normal', style: { opacity: '.6' } }, '/ ' + fmt.int(eligible.length)) : null);
              });
              const churned = rows.filter(r => r._effCancel);
              const lives = churned.map(r => {
                const a = new Date(r.initial_service + 'T00:00'), b = new Date(r._effCancel + 'T00:00');
                return (isNaN(a) || isNaN(b)) ? null : Math.max(0, (b - a) / 2629800000);
              }).filter(v => v != null).sort((a, b) => a - b);
              const medLife = lives.length ? lives[Math.floor(lives.length / 2)] : null;
              return el('tr', { class: 'border-t-2', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } },
                el('td', { class: 'px-2.5 py-2 font-black' }, 'ALL'),
                el('td', { class: 'px-2 py-2 tabular-nums font-bold' }, fmt.int(rows.length)),
                ...cells,
                el('td', { class: 'px-2 py-2 tabular-nums', style: { color: 'var(--text-muted)' } }, medLife == null ? '—' : medLife.toFixed(1) + ' mo'));
            })()))));
  };

  // ── LTV — lifetime value by segment. LTV = monthly ARPU ÷ monthly churn
  // (trailing 24 months), i.e. avg monthly recurring $ × implied lifetime.
  // Segments: overall, contract lengths, top services, offices. ──
  const ltvCard = (pop, label) => {
    const rows = _retenEff(pop);
    if (!rows.length) return null;
    const pad2 = (n) => String(n).padStart(2, '0');
    const now = new Date();
    const curYL = now.getFullYear();
    const trailing = [];
    for (let i = 24; i >= 1; i--) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); trailing.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1)); }
    const segStats = (subset) => {
      if (!subset.length) return null;
      const startsByYm = {}, cancelsByYm = {};
      let minY = 9999;
      subset.forEach(r => {
        const s = String(r.initial_service).slice(0, 7);
        startsByYm[s] = (startsByYm[s] || 0) + 1;
        minY = Math.min(minY, Number(s.slice(0, 4)) || 9999);
        if (r._effCancel) { const c = String(r._effCancel).slice(0, 7); cancelsByYm[c] = (cancelsByYm[c] || 0) + 1; }
      });
      const bookAt = {};
      let book = 0;
      for (let y = minY; y <= curYL; y++) for (let m = 1; m <= 12; m++) {
        const ym = y + '-' + pad2(m);
        bookAt[ym] = book;
        book += (startsByYm[ym] || 0) - (cancelsByYm[ym] || 0);
      }
      let bm = 0, cc = 0;
      trailing.forEach(ym => { bm += bookAt[ym] || 0; cc += cancelsByYm[ym] || 0; });
      const arvSubs = subset.filter(r => Number(r.annual_recurring_value) > 0);
      const avgArv = arvSubs.length ? arvSubs.reduce((a, r) => a + Number(r.annual_recurring_value), 0) / arvSubs.length : 0;
      const churned = subset.filter(r => r._effCancel);
      const lives = churned.map(r => {
        const a = new Date(r.initial_service + 'T00:00'), b = new Date(r._effCancel + 'T00:00');
        return (isNaN(a) || isNaN(b)) ? null : Math.max(0, (b - a) / 2629800000);
      }).filter(v => v != null).sort((a, b) => a - b);
      const medLife = lives.length ? lives[Math.floor(lives.length / 2)] : null;
      const churn = bm > 0 ? cc / bm : null;
      // Implied lifetime capped at 10 years — a near-zero churn segment
      // otherwise prints a comedy LTV.
      const lifeMo = churn > 0 ? Math.min(120, 1 / churn) : (churn === 0 ? 120 : null);
      return {
        n: subset.length, avgArv, churn, bookMonths: bm, medLife,
        lifeMo, ltv: (lifeMo != null && avgArv > 0) ? (avgArv / 12) * lifeMo : null,
      };
    };
    const segs = [];
    segs.push({ section: 'Overall' });
    segs.push({ name: 'All recurring subs', s: segStats(rows) });
    segs.push({ section: 'By contract length' });
    [12, 18, 24].forEach(L => segs.push({ name: L + ' Months', s: segStats(rows.filter(r => (Number(r.agreement_length) || 0) === L)) }));
    segs.push({ section: 'By service (top 8 by subs)' });
    const svcCounts = new Map();
    rows.forEach(r => svcCounts.set(r.subscription, (svcCounts.get(r.subscription) || 0) + 1));
    [...svcCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
      .forEach(([svc]) => segs.push({ name: svc, s: segStats(rows.filter(r => r.subscription === svc)) }));
    segs.push({ section: 'By office' });
    const offCounts = new Map();
    rows.forEach(r => { const o = r.office_name || '—'; offCounts.set(o, (offCounts.get(o) || 0) + 1); });
    [...offCounts.entries()].sort((a, b) => b[1] - a[1])
      .forEach(([o]) => segs.push({ name: o, s: segStats(rows.filter(r => (r.office_name || '—') === o)) }));
    const money2 = fmt.usd0;
    // Column sort (click a header) — rows re-order WITHIN their section so
    // Overall / contract / service / office groups stay intact.
    const _sort = state._ltvSort || null;
    let segsSorted = segs;
    if (_sort && _sort.key) {
      const valFor = (g) => {
        if (!g.s) return _sort.key === 'name' ? g.name : -Infinity;
        switch (_sort.key) {
          case 'name':  return g.name;
          case 'n':     return g.s.n;
          case 'arv':   return g.s.avgArv || 0;
          case 'churn': return g.s.churn == null ? -Infinity : g.s.churn;
          case 'life':  return g.s.lifeMo == null ? -Infinity : g.s.lifeMo;
          case 'med':   return g.s.medLife == null ? -Infinity : g.s.medLife;
          case 'ltv':   return g.s.ltv == null ? -Infinity : g.s.ltv;
          default: return 0;
        }
      };
      const out = [];
      let buf = [];
      const flush = () => {
        if (!buf.length) return;
        buf.sort((a, b) => {
          const va = valFor(a), vb = valFor(b);
          const c = (typeof va === 'string' || typeof vb === 'string') ? String(va).localeCompare(String(vb)) : (va - vb);
          return _sort.dir === 'asc' ? c : -c;
        });
        out.push(...buf); buf = [];
      };
      segs.forEach(g => { if (g.section) { flush(); out.push(g); } else buf.push(g); });
      flush();
      segsSorted = out;
    }
    const bodyRows = segsSorted.map(g => {
      if (g.section) return el('tr', {}, el('td', { colspan: 7, class: 'px-2.5 pt-3 pb-1 text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, g.section));
      const s = g.s;
      const small = !s || s.n < 50 || s.bookMonths < 300;
      return el('tr', { class: 'border-t border-' + (small ? '' : ''), style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-2.5 py-1.5 font-semibold truncate', style: { maxWidth: '220px' } }, g.name),
        el('td', { class: 'px-2 py-1.5 tabular-nums', style: { color: 'var(--text-muted)' } }, s ? fmt.int(s.n) : '—'),
        el('td', { class: 'px-2 py-1.5 tabular-nums', style: { color: 'var(--text-muted)' } }, s && s.avgArv ? money2(s.avgArv) : '—'),
        el('td', { class: 'px-2 py-1.5 tabular-nums' }, (s && s.churn != null && !small) ? (s.churn * 100).toFixed(2) + '%' : '—'),
        el('td', { class: 'px-2 py-1.5 tabular-nums' }, (s && s.lifeMo != null && !small) ? s.lifeMo.toFixed(0) + ' mo' + (s.lifeMo >= 120 ? '+' : '') : '—'),
        el('td', { class: 'px-2 py-1.5 tabular-nums', style: { color: 'var(--text-muted)' } }, (s && s.medLife != null) ? s.medLife.toFixed(1) + ' mo' : '—'),
        el('td', { class: 'px-2 py-1.5 tabular-nums font-black', style: (s && s.ltv != null && !small) ? { color: 'var(--accent)' } : { color: 'var(--text-subtle)' } },
          (s && s.ltv != null && !small) ? money2(s.ltv) : (small && s && s.n ? 'small sample' : '—')));
    });
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b border- flex items-center justify-between gap-2 flex-wrap' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, '💎 LTV' + (label ? ' — ' + label : ''))),
        configInfoBtn('Lifetime Value',
          'Same population and churn rules as everything on this tab (recurring + serviced subs; excluded reasons and 3-day ROR count as retained). Monthly churn = countable cancels ÷ book-months over the TRAILING 24 MONTHS, per segment — so LTV reflects how the segment retains TODAY, not its whole history. Implied lifetime = 1 ÷ monthly churn, capped at 120 months. Avg ARV averages subs with a recurring value; LTV = monthly ARPU × implied lifetime. Median lifetime (churned subs only) is shown as the observed sanity check. Segments under 50 subs or 300 book-months show "small sample" — don\u2019t price a deal off those.')),
      el('div', { class: 'scroll-x' },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-' },
            el('tr', {},
              ...[['name', 'Segment'], ['n', 'Subs'], ['arv', 'Avg ARV'], ['churn', 'Mo Churn'], ['life', 'Implied Life'], ['med', 'Med Life (churned)'], ['ltv', 'LTV']].map(([k, h], i) => el('th', {
                class: 'text-left py-2 font-semibold cursor-pointer select-none hover:text-default ' + (i === 0 ? 'px-2.5' : 'px-2'),
                style: (_sort && _sort.key === k) ? { color: 'var(--accent)', fontWeight: '800' } : {},
                title: 'Sort by ' + h + ' (within each section)',
                onclick: () => {
                  const cur = state._ltvSort || {};
                  state._ltvSort = { key: k, dir: cur.key === k ? (cur.dir === 'desc' ? 'asc' : 'desc') : (k === 'name' ? 'asc' : 'desc') };
                  mountApp();
                },
              }, h)))),
          el('tbody', {}, ...bodyRows))));
  };

  // ── LAST RESORT RETENTION — do <$99-initial accounts stick worse? Same
  // population + effective-cancel rules as everything else on this tab.
  // Cohort-year rows keep the comparison honest (Last Resort sales skew
  // recent, so a single blended % would flatter them).
  // ── ATTRITION TRENDS — Performance-Trends-style chart for churn (per
  // Isaac): monthly attrition rate, year-over-year lines, with a metric
  // picker where Last Resort is one of the views. Same math as the
  // seasonality grid (cancels ÷ true book at month start, same-month
  // acquire-lose excluded), just drawn as lines.
  const LAST_RESORT_START = '2026-06-05';
  // Churn-timing drill (per Isaac): a breakdown by cancellation reason,
  // not a customer table — subs, ARR and share of each; a row opens the
  // accounts behind that reason.
  const openChurnReasonModal = (title, rs) => {
    const reasonOf = (r) => String(reportingCancelReasonOf(r) || 'Unspecified').trim() || 'Unspecified';
    const by = new Map();
    for (const r of rs) { const k = reasonOf(r); const g = by.get(k) || (by.set(k, { k, n: 0, arr: 0, rows: [] }), by.get(k)); g.n++; g.arr += Number(r.annual_recurring_value) || 0; g.rows.push(r); }
    const list = [...by.values()].sort((a, b) => b.n - a.n);
    const totN = rs.length, totArr = list.reduce((a, g) => a + g.arr, 0);
    const overlay = el('div', { class: 'modal-overlay' });
    const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
    const esc = (e) => { if (e.key === 'Escape') close(); };
    document.addEventListener('keydown', esc);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    const th = (t, right) => el('th', { class: 'px-3 py-1.5 text-[9px] uppercase tracking-widest font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)' } }, t);
    const td = (t, right, cls = '') => el('td', { class: 'px-3 py-1.5 text-xs ' + (right ? 'text-right tabular-nums ' : '') + cls }, t);
    const pctOf = (a, b) => b ? (100 * a / b).toFixed(1) + '%' : '—';
    const bar = (p) => el('span', { class: 'inline-block align-middle mr-2 rounded-full overflow-hidden', style: { width: '70px', height: '6px', background: 'var(--card-2)' } }, el('span', { class: 'block h-full', style: { width: Math.max(2, p) + '%', background: 'var(--accent)' } }));
    const modal = el('div', { class: 'card w-full max-w-3xl p-5 my-8 overflow-y-auto', style: { maxHeight: 'calc(100vh - 64px)' } },
      el('div', { class: 'flex items-start justify-between gap-3' },
        el('div', {}, el('h3', { class: 'text-base font-bold' }, title)),
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: close }, 'Close')),
      el('div', { class: 'overflow-x-auto mt-3' }, el('table', { class: 'w-full' },
        el('thead', { style: { background: 'var(--card-2)' } }, el('tr', {}, th('Reason'), th('Share'), th('Subs', true), th('% subs', true), th('ARR', true), th('% ARR', true))),
        el('tbody', {}, ...list.map(g => el('tr', { class: 'border-t cursor-pointer hover:brightness-95 transition', style: { borderColor: 'var(--border)' }, title: 'Click for the ' + g.n + ' account' + (g.n === 1 ? '' : 's'),
            onclick: () => openReportingDrillModal({ chartTitle: title + ' · ' + g.k, sliceLabel: g.n + ' counted cancel' + (g.n === 1 ? '' : 's'), rows: g.rows, formatValue: fmt.usd0 }) },
          td(el('span', { class: 'font-semibold' }, g.k)),
          td(bar(totN ? 100 * g.n / totN : 0)),
          td(fmt.int(g.n), true), td(pctOf(g.n, totN), true), td(fmt.usd0(g.arr), true), td(pctOf(g.arr, totArr), true))),
          el('tr', { class: 'border-t font-bold', style: { borderColor: 'var(--border-2)', background: 'var(--card-2)' } }, td('Total'), td(''), td(fmt.int(totN), true), td('100%', true), td(fmt.usd0(totArr), true), td('100%', true))))));
    overlay.append(modal);
    document.body.append(overlay);
  };
  // ── CHURN TIMING (per Isaac, Sep 2026) — WHEN cancels get keyed in:
  // day-of-week × hour heatmap of counted cancels, with the two marginals
  // (by weekday, by hour). Hours are the branch's local clock (the sync
  // stamps canceled_at on the company clock, shifted per office the same
  // way sold_at is on the War Room). Window + reason pills; Subs / ARR.
  // Automated cancels (collections runs) show up as a single hot hour —
  // the reason pill lets you take them out to see the human pattern. ──
  const churnTimingCard = (pop, label) => {
    const rows = _retenEff(pop).filter(r => r._effCancel);
    const stamped = rows.filter(r => r.canceled_at && /^\d{4}-\d{2}-\d{2} \d{2}/.test(String(r.canceled_at)));
    const title = el('h3', { class: 'text-sm font-bold' }, 'Churn Timing' + (label ? ' — ' + label : ''));
    if (!stamped.length) {
      return el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, title),
        el('div', { class: 'px-4 py-6 text-center text-[11px]', style: { color: 'var(--text-muted)' } }, 'Cancel times arrive with the next FieldRoutes sync (the snapshot only carried the cancel date until now).'));
    }
    // Window (per Isaac, Sep 23): one dropdown — today · this week · last
    // week · this month · last month · last 90 · last 12 months · YTD · all ·
    // custom (start / end). Weeks run Sun–Sat like the rest of the app.
    const WIN = [['today', 'Today'], ['week', 'This week'], ['lastweek', 'Last week'], ['month', 'This month'], ['lastmonth', 'Last month'], [90, 'Last 90 days'], [365, 'Last 12 months'], ['ytd', 'YTD'], ['all', 'All time'], ['custom', 'Custom…']];
    const win = WIN.some(w => String(w[0]) === String(state._rtChurnWin)) ? state._rtChurnWin : 90;
    const mode = state._rtChurnMode === 'arr' ? 'arr' : 'subs';
    const today = new Date(); const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const shift = (d, fn) => { const x = new Date(d); fn(x); return x; };
    const range = (() => {
      const t = iso(today);
      if (win === 'today') return [t, t];
      if (win === 'week') return [iso(shift(today, x => x.setDate(x.getDate() - x.getDay()))), t];
      if (win === 'lastweek') { const s0 = shift(today, x => x.setDate(x.getDate() - x.getDay() - 7)); return [iso(s0), iso(shift(s0, x => x.setDate(x.getDate() + 6)))]; }
      if (win === 'month') return [iso(new Date(today.getFullYear(), today.getMonth(), 1)), t];
      if (win === 'lastmonth') return [iso(new Date(today.getFullYear(), today.getMonth() - 1, 1)), iso(new Date(today.getFullYear(), today.getMonth(), 0))];
      if (win === 'ytd') return [today.getFullYear() + '-01-01', t];
      if (win === 'all') return ['0000', '9999'];
      if (win === 'custom') return [state._rtChurnFrom || iso(shift(today, x => x.setDate(x.getDate() - 29))), state._rtChurnTo || t];
      return [iso(new Date(today.getTime() - (Number(win) - 1) * 86400000)), t];
    })();
    const inWin = stamped.filter(r => r._effCancel >= range[0] && r._effCancel <= range[1]);
    // Reason pills: every reason in the window, biggest first; "All" plus one-click exclude of the top automated one.
    const reasonOf = (r) => String(reportingCancelReasonOf(r) || 'Unspecified').trim() || 'Unspecified';
    const byReason = new Map(); inWin.forEach(r => byReason.set(reasonOf(r), (byReason.get(reasonOf(r)) || 0) + 1));
    const reasons = [...byReason.entries()].sort((a, b) => b[1] - a[1]);
    const rsel = state._rtChurnReason || 'all';
    const excl = state._rtChurnExcl || null;   // one reason hidden (e.g. collections)
    const use = inWin.filter(r => (rsel === 'all' || reasonOf(r) === rsel) && (!excl || reasonOf(r) !== excl));
    const val = (r) => mode === 'arr' ? (Number(r.annual_recurring_value) || 0) : 1;
    const fmtV = (v) => mode === 'arr' ? fmt.usdShort(v) : fmt.int(v);
    // Local day/hour.
    const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const local = (r) => { const m = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/.exec(String(r.canceled_at)); if (!m) return null; const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]) + ((typeof _saleHourOffset === 'function') ? _saleHourOffset(r.office_name) : 0), Number(m[5])); return { day: (d.getDay() + 6) % 7, hour: d.getHours() }; };
    const grid = DAYS.map(() => Array(24).fill(0)), gridRows = DAYS.map(() => Array.from({ length: 24 }, () => []));
    const byDay = Array(7).fill(0), byHour = Array(24).fill(0);
    let tot = 0;
    for (const r of use) { const l = local(r); if (!l) continue; const v = val(r); grid[l.day][l.hour] += v; gridRows[l.day][l.hour].push(r); byDay[l.day] += v; byHour[l.hour] += v; tot += v; }
    const max = Math.max(1, ...grid.map(a => Math.max(...a)));
    // Hours shown: 6a–9p always; earlier/later only when something landed there.
    const hours = []; for (let h = 0; h < 24; h++) if ((h >= 6 && h <= 21) || byHour[h] > 0) hours.push(h);
    const hl = (h) => h === 0 ? '12a' : h === 12 ? '12p' : h < 12 ? h + 'a' : (h - 12) + 'p';
    const isDark = state.theme === 'dark';
    const cellBg = (v) => { if (!v) return 'transparent'; const t = Math.pow(v / max, 0.6); return 'rgba(223,100,58,' + (0.12 + 0.78 * t).toFixed(3) + ')'; };
    const cellFg = (v) => (v / max) > 0.55 ? '#fff' : 'var(--text)';
    const drill = (title2, rs) => rs.length ? () => openChurnReasonModal('Churn timing \u00b7 ' + title2, rs) : null;
    const pill = (on, txt, fn, ttl) => el('button', { class: 'rounded-full px-2 py-0.5 text-[10px] font-bold transition hover:brightness-95 shrink-0', title: ttl || '', style: on ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }, onclick: fn }, txt);
    const winSel = el('select', { class: 'rounded-lg border px-2 py-0.5 text-[10px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { const v = e.target.value; state._rtChurnWin = /^\d+$/.test(v) ? Number(v) : v; mountApp(); } },
      ...WIN.map(([k, l]) => el('option', { value: String(k), selected: String(win) === String(k) }, l)));
    const dateIn = (key, val) => el('input', { type: 'date', value: val, class: 'rounded-lg border px-1.5 py-0.5 text-[10px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { if (e.target.value) { state[key] = e.target.value; mountApp(); } } });
    const controls = el('div', { class: 'flex items-center gap-1.5 flex-wrap' },
      pill(mode === 'subs', 'Subs', () => { state._rtChurnMode = 'subs'; mountApp(); }), pill(mode === 'arr', 'ARR', () => { state._rtChurnMode = 'arr'; mountApp(); }),
      el('span', { style: { width: '6px' } }),
      winSel,
      win === 'custom' ? dateIn('_rtChurnFrom', range[0]) : null, win === 'custom' ? el('span', { class: 'text-[10px] text-muted-' }, '–') : null, win === 'custom' ? dateIn('_rtChurnTo', range[1]) : null);
    const reasonSel = el('select', { class: 'rounded-lg border px-2 py-0.5 text-[10px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '220px' },
      onchange: (e) => { state._rtChurnReason = e.target.value; state._rtChurnExcl = null; mountApp(); } },
      el('option', { value: 'all', selected: rsel === 'all' }, 'All reasons (' + inWin.length + ')'),
      ...reasons.map(([k, n]) => el('option', { value: k, selected: rsel === k }, k + ' (' + n + ')')));
    const topReason = reasons[0] ? reasons[0][0] : null;
    const exclBtn = rsel === 'all' && topReason ? pill(excl === topReason, (excl === topReason ? 'Showing without ' : 'Hide ') + topReason, () => { state._rtChurnExcl = excl === topReason ? null : topReason; mountApp(); }, 'Automated cancel runs land on one hour — take the biggest reason out to see the human pattern') : null;
    const th = (t) => el('th', { class: 'px-1 py-1 text-[9px] uppercase tracking-wider font-semibold text-center', style: { color: 'var(--text-muted)' } }, t);
    const heat = el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full', style: { borderCollapse: 'separate', borderSpacing: '2px', fontSize: '10px' } },
      el('thead', {}, el('tr', {}, el('th', {}), ...hours.map(h => th(hl(h))), th('Total'))),
      el('tbody', {}, ...DAYS.map((d, di) => el('tr', {},
        el('td', { class: 'px-1 text-[10px] font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)' } }, d),
        ...hours.map(h => { const v = grid[di][h], fn = drill(d + ' ' + hl(h), gridRows[di][h]); return el('td', { class: 'text-center tabular-nums', title: d + ' ' + hl(h) + ' · ' + fmtV(v) + (tot ? ' · ' + (100 * v / tot).toFixed(1) + '% of the window' : ''), style: { background: cellBg(v), color: cellFg(v), borderRadius: '3px', height: '26px', minWidth: '30px', cursor: fn ? 'pointer' : 'default', border: '1px solid ' + (v ? 'transparent' : 'var(--border)') }, onclick: fn }, v ? fmtV(v) : ''); }),
        (() => { const v = byDay[di], fn = drill(d, gridRows[di].flat()); return el('td', { class: 'text-center tabular-nums font-bold', style: { cursor: fn ? 'pointer' : 'default', color: 'var(--text)' }, onclick: fn }, v ? fmtV(v) : ''); })())),
        el('tr', {}, el('td', { class: 'px-1 text-[10px] font-bold', style: { color: 'var(--text-muted)' } }, 'Total'),
          ...hours.map(h => { const v = byHour[h], fn = drill(hl(h), gridRows.map(a => a[h]).flat()); return el('td', { class: 'text-center tabular-nums font-bold', style: { cursor: fn ? 'pointer' : 'default' }, onclick: fn }, v ? fmtV(v) : ''); }),
          el('td', { class: 'text-center tabular-nums font-black' }, fmtV(tot))))));
    // Marginal bars (Chart.js): share by weekday and by hour.
    const idD = 'churn-dow-' + (label || 'a').replace(/\W+/g, ''), idH = 'churn-hour-' + (label || 'a').replace(/\W+/g, '');
    const bars = (id, ttl) => el('div', {}, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-1', style: { color: 'var(--text-subtle)' } }, ttl), el('div', { style: { height: '120px' } }, el('canvas', { id })));
    setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      const txt = isDark ? '#C9C9BE' : '#555', gridc = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
      const mk = (id, labels, data, onIdx) => { const c = document.getElementById(id); if (!c) return; if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
        const mx = Math.max(...data), hi = data.map(v => v === mx && mx > 0 ? '#DF643A' : (isDark ? '#7C857A' : '#5F6C5B'));
        _chartInstances[id] = new Chart(c.getContext('2d'), { type: 'bar', data: { labels, datasets: [{ data, backgroundColor: hi, borderWidth: 0, borderRadius: 3, maxBarThickness: 22 }] },
          options: { responsive: true, maintainAspectRatio: false, onClick: (e, els) => { if (els && els.length) onIdx(els[0].index); },
            plugins: { legend: { display: false }, tooltip: { callbacks: { label: (x) => ' ' + fmtV(x.parsed.y) + (tot ? ' · ' + (100 * x.parsed.y / tot).toFixed(1) + '%' : '') } } },
            scales: { x: { grid: { display: false }, ticks: { color: txt, font: { size: 9 }, autoSkip: false, maxRotation: 0 } }, y: { beginAtZero: true, grid: { color: gridc }, ticks: { color: txt, font: { size: 9 }, callback: (v) => fmtV(v), maxTicksLimit: 4 } } } } }); };
      mk(idD, DAYS, byDay, (i) => { const fn = drill(DAYS[i], gridRows[i].flat()); if (fn) fn(); });
      mk(idH, hours.map(hl), hours.map(h => byHour[h]), (i) => { const h = hours[i]; const fn = drill(hl(h), gridRows.map(a => a[h]).flat()); if (fn) fn(); });
    }, 50);
    // One-line read: the busiest day and hour.
    const bd = byDay.indexOf(Math.max(...byDay)), bh = byHour.indexOf(Math.max(...byHour));
    const read = tot ? DAYS[bd] + ' is the heaviest day (' + (100 * byDay[bd] / tot).toFixed(0) + '%) and ' + hl(bh) + ' the heaviest hour (' + (100 * byHour[bh] / tot).toFixed(0) + '%)' + (excl ? ' · ' + excl + ' hidden' : '') : 'Nothing in this window.';
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('div', {}, title),
        el('div', { class: 'flex items-center gap-2 flex-wrap' }, controls, reasonSel)),
      el('div', { class: 'grid grid-cols-1 lg:grid-cols-3 gap-4 p-4 items-start' },
        el('div', { style: { gridColumn: 'span 2 / span 2' }, class: 'churn-heat-col' }, heat),
        el('div', { class: 'flex flex-col gap-3' }, bars(idD, 'By weekday'), bars(idH, 'By hour'))));
  };
  const attritionTrendsCard = (pop, label) => {
    const rows = _retenEff(pop);
    if (!rows.length) return null;
    const pad2 = (n) => String(n).padStart(2, '0');
    const _isLR = (r) => Number(r.initial_price) < 99 && String(r.sold_date || r.initial_service || '') >= LAST_RESORT_START;
    // Metric pills — MULTI-SELECT (per Isaac): overlay any mix of series.
    // Color = metric, dash = year. Baseline = avg monthly attrition across
    // the selected PRIOR years, all accounts.
    const METRICS = [
      ['all',  'All',         (r) => true],
      ['lr',   'Last Resort', _isLR],
      ['std',  'Standard',    (r) => !_isLR(r)],
      ['base', 'Baseline'],
    ];
    const _validSegs = new Set(METRICS.map(([k]) => k));
    let segsSel = ['all'];
    // Monthly churn-rate lookup for an arbitrary subset — book-walk identical
    // to the seasonality card.
    const rateFnFor = (subsetFn) => {
      const rs = rows.filter(subsetFn);
      if (!rs.length) return () => null;
      const startsByYm = {}, cancelsByYm = {}, allCancelsByYm = {};
      let minY = 9999;
      rs.forEach(r => {
        const sYm = String(r.initial_service).slice(0, 7);
        startsByYm[sYm] = (startsByYm[sYm] || 0) + 1;
        minY = Math.min(minY, Number(sYm.slice(0, 4)) || 9999);
        if (r._effCancel) {
          const cYm = String(r._effCancel).slice(0, 7);
          allCancelsByYm[cYm] = (allCancelsByYm[cYm] || 0) + 1;
          if (sYm < cYm) cancelsByYm[cYm] = (cancelsByYm[cYm] || 0) + 1;
        }
      });
      if (minY === 9999) return () => null;
      const bookAt = {};
      let book = 0;
      const curY0 = new Date().getFullYear();
      for (let y = minY; y <= curY0; y++) for (let m = 1; m <= 12; m++) {
        const ym = y + '-' + pad2(m);
        bookAt[ym] = book;
        book += (startsByYm[ym] || 0) - (allCancelsByYm[ym] || 0);
      }
      return (y, m) => {
        const ym = y + '-' + pad2(m);
        const den = bookAt[ym] || 0;
        if (den < 10) return null;                       // tiny book = noise
        return (cancelsByYm[ym] || 0) / den * 100;
      };
    };
    const now = new Date(), curY = now.getFullYear(), curM = now.getMonth() + 1;
    const clip = (y, m, v) => (y === curY && m >= curM) ? null : v;   // current month partial → drop
    const MONTH_LBL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    // Year picker — every year the population has first-service data for.
    let _minY = 9999;
    rows.forEach(r => { const y = Number(String(r.initial_service).slice(0, 4)); if (y > 2000) _minY = Math.min(_minY, y); });
    const yearsAvail = [];
    for (let y = _minY; y <= curY; y++) yearsAvail.push(y);
    // Span dropdown (per Isaac): this year vs last year by default, or the
    // last 3 / 5 years. All accounts only — the Last Resort / Standard /
    // Baseline series are retired for now.
    const span = [2, 3, 5].includes(Number(state._retTrendSpan)) ? Number(state._retTrendSpan) : 2;
    let yearsSel = yearsAvail.slice(-span);
    yearsSel = [...yearsSel].sort((a, b) => a - b);
    let datasets = [];
    const isDark = state.theme === 'dark';
    const gray = isDark ? '#6b6b63' : '#B8B8AE';
    const SEG_COLORS = { all: isDark ? '#E6E6DC' : '#323230', lr: '#DC2626', std: '#DF643A' };
    // One colour per year (per Isaac — five dotted black lines were unreadable):
    // this year = charcoal, then orange, sage, blue, purple, teal going back.
    const YEAR_PALETTE = [isDark ? '#E6E6DC' : '#323230', '#DF643A', '#5F6C5B', '#2563EB', '#7C3AED', '#0D9488', '#CA8A04'];
    const _colorFor = (y) => YEAR_PALETTE[Math.min(YEAR_PALETTE.length - 1, Math.max(0, curY - y))];
    const _dashFor = (y) => y === curY ? [] : [];
    // Baseline: one dashed gray line — the selected PRIOR years averaged
    // (all accounts). Needs at least one pre-current year selected.
    if (segsSel.includes('base')) {
      const fAll = rateFnFor(() => true);
      const baseYears = yearsSel.filter(y => y < curY);
      if (baseYears.length) {
        const baseline = MONTH_LBL.map((_, i) => {
          const vals = baseYears.map(y => fAll(y, i + 1)).filter(v => v != null);
          return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
        });
        datasets.push({ label: 'Baseline avg ' + baseYears[0] + (baseYears.length > 1 ? '–' + baseYears[baseYears.length - 1] : ''), data: baseline, borderColor: gray, backgroundColor: gray, borderDash: [6, 4], borderWidth: 3 });
      }
    }
    METRICS.forEach(([k, lbl, fn]) => {
      if (k === 'base' || !segsSel.includes(k)) return;
      const f = rateFnFor(fn);
      yearsSel.forEach(y => {
        const data = MONTH_LBL.map((_, i) => clip(y, i + 1, f(y, i + 1)));
        if (!data.some(v => v != null)) return;
        const col = k === 'all' ? _colorFor(y) : SEG_COLORS[k];
        datasets.push({ label: lbl + ' ' + y, data, borderColor: col, backgroundColor: col, borderDash: _dashFor(y), borderWidth: y === curY ? 3 : 2 });
      });
    });
    const id = 'retAttrTrends' + (label ? '_' + String(label).replace(/\W/g, '') : '');
    const cvsWrap = el('div', { style: { position: 'relative', height: '240px', width: '100%' } });
    cvsWrap.append(el('canvas', { id }));
    setTimeout(() => {
      if (typeof Chart === 'undefined') return;
      const cvsEl = document.getElementById(id); if (!cvsEl) return;
      if (_chartInstances[id]) { _chartInstances[id].destroy(); delete _chartInstances[id]; }
      const txt = isDark ? '#C9C9BE' : '#555', grid = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
      _chartInstances[id] = new Chart(cvsEl.getContext('2d'), {
        type: 'line',
        data: { labels: MONTH_LBL, datasets: datasets.map(d => ({ ...d, borderWidth: d.borderWidth || 2, tension: 0.3, fill: false, pointRadius: 2, spanGaps: false })) },
        options: { responsive: true, maintainAspectRatio: false,
          plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } } },
          scales: { x: { ticks: { color: txt }, grid: { color: grid } },
                    y: { beginAtZero: true, ticks: { color: txt, callback: v => v + '%' }, grid: { color: grid } } } },
      });
    }, 50);
    return el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between gap-2 flex-wrap mb-1' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, 'Attrition Trends' + (label ? ' — ' + label : ''))),
        el('select', {
          class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
          style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
          onchange: (e) => { state._retTrendSpan = Number(e.target.value); mountApp(); },
        }, ...[[2, curY + ' vs ' + (curY - 1)], [3, 'Last 3 years'], [5, 'Last 5 years']].map(([v, l]) => el('option', { value: String(v), selected: span === v }, l)))),
      cvsWrap);
  };

  const lifetimeCard = (() => {
    // Reads the retention book and its COUNTED cancels (per Isaac) — the
    // steps card decides what is in; no card-level chips.
    const _yrL = state._rtAttrYear || 'all';
    const _yOfL = (r) => { const d = r.sold_date ? new Date(r.sold_date) : null; return d && !isNaN(d) ? d.getFullYear() : null; };
    const _isRenewL = (r) => reportingSourceClass(r.subscription_source) === 'renewal'
      || /^renewal\b/i.test(_normCancelReason(r.subscription_cancellation_reason));
    const _isOneL = (r) => /^\s*one[\s-]?time/i.test(String(r.subscription || ''))
      || ((Number(r.agreement_length) || 0) <= 1 && !/sentricon/i.test(String(r.subscription || '')));
    const rowsL = [];
    for (const r of _retenEff(popA)) {
      if (_yrL !== 'all' && _yOfL(r) !== _yrL) continue;
      if (!r.sold_date || !r._effCancel) continue;
      const t = Math.round((new Date(r._effCancel) - new Date(r.sold_date)) / 86400000);
      if (!(t >= 0 && t <= 4000)) continue;
      rowsL.push({ r, t });
    }
    if (!rowsL.length) return null;
    const _med = (arr) => { const s2 = [...arr].sort((a, b) => a - b); return s2[Math.floor((s2.length - 1) / 2)]; };
    const allT = rowsL.map(x => x.t);
    const medAll = _med(allT);
    const avgAll = allT.reduce((a, b) => a + b, 0) / allT.length;
    const moTxt = (d) => (d / 30.44).toFixed(1) + ' mo';
    // month-of-life histogram: every month out to the longest life in the
    // book (per Isaac, Sep 2026 — no 24+ bucket; the strip scrolls / drags
    // / swipes sideways instead).
    const lastMo = Math.max(24, ...rowsL.map(x => Math.floor(x.t / 30)));
    const buckets = Array.from({ length: lastMo + 1 }, () => []);
    for (const x of rowsL) buckets[Math.floor(x.t / 30)].push(x.r);
    const maxB = Math.max(...buckets.map(b => b.length), 1);
    const BAR_W = 26;   // px per month — 24 months ≈ one card width, the rest scrolls
    const barL = (b, i) => el('button', {
      class: 'flex flex-col shrink-0 cursor-pointer transition hover:brightness-110',
      style: { width: BAR_W + 'px', background: 'transparent', border: 'none', padding: '0 2px', height: '100%' },
      title: 'Month ' + i + ' of life — ' + fmt.int(b.length) + ' cancel' + (b.length === 1 ? '' : 's'),
      onclick: () => b.length && openReportingDrillModal({
        chartTitle: 'Cancelled in month ' + i + ' of customer life',
        sliceLabel: fmt.int(b.length) + ' account' + (b.length === 1 ? '' : 's'),
        rows: b, formatValue: (v) => fmt.usd0(v) }),
    }, el('div', {
      style: {
        height: (b.length ? Math.max(2, b.length / maxB * 84) : 0) + 'px',
        background: (i >= 2 && i <= 5) ? '#DC2626' : (i >= 11 && i <= 13) ? '#A9441F' : 'var(--accent)',
      } }));
    // by-reason lifetime table (merges trailing-period label variants)
    const byReason = {};
    for (const x of rowsL) {
      const k = String(x.r.subscription_cancellation_reason || '').trim() ? reportingCancelReasonOf(x.r) : '(no reason logged)';
      (byReason[k] = byReason[k] || []).push(x);
    }
    // Year-1 / year-2 weight (per Isaac, Sep 24): of every cancel that
    // happened in the first year of life, what share was THIS reason — and
    // the same for the second year (months 13–24).
    const _allY1 = rowsL.filter(x => x.t <= 365).length || 1;
    const _allY2 = rowsL.filter(x => x.t > 365 && x.t <= 730).length || 1;
    // Per-reason stats up front so the headers can sort on any of them.
    const statsOf = (k) => {
      const xs = byReason[k];
      const ts = xs.map(x => x.t);
      const med = _med(ts);
      const avg = ts.reduce((a, b) => a + b, 0) / ts.length;
      const in90 = ts.filter(t => t <= 90).length / ts.length;
      const in365 = ts.filter(t => t <= 365).length / _allY1;                 // this reason's share of ALL year-1 cancels
      const in730 = ts.filter(t => t > 365 && t <= 730).length / _allY2;      // …and of all year-2 cancels
      const arvs = xs.map(x => Number(x.r.annual_recurring_value) || 0);
      const avgArv = arvs.reduce((a, b) => a + b, 0) / (arvs.length || 1);
      const arrLost = arvs.reduce((a, b) => a + b, 0);
      // Where in the customer's life this reason strikes: month-of-life
      // histogram (0..35, 36+), its peak, and the share that left while
      // still inside their contract term (agreement_length months).
      const hist = new Array(37).fill(0);
      for (const t of ts) hist[Math.min(36, Math.floor(t / 30))]++;
      let peak = 0; for (let i = 1; i < hist.length; i++) if (hist[i] > hist[peak]) peak = i;
      let termN = 0, inTerm = 0;
      for (const x of xs) { const m = Number(x.r.agreement_length) || 0; if (m <= 1) continue; termN++; if (x.t < m * 30.44) inTerm++; }
      const inTermPct = termN ? inTerm / termN : null;
      return { xs, med, avg, in90, in365, in730, avgArv, arrLost, hist, peak, inTermPct, n: xs.length, share: xs.length / rowsL.length };
    };
    const _statCache = new Map();
    const S = (k) => { if (!_statCache.has(k)) _statCache.set(k, statsOf(k)); return _statCache.get(k); };
    const LCOLS = [
      { key: 'reason', label: 'Cancellation Reason', str: true, get: (k) => k.toLowerCase() },
      { key: 'n',      label: 'Cancels',      get: (k) => S(k).n,        tip: 'Counted cancels with this reason' },
      { key: 'share',  label: 'Share',        get: (k) => S(k).share,    tip: 'Share of every counted cancel' },
      { key: 'lost',   label: 'ARR lost',     get: (k) => S(k).arrLost,  tip: 'Annual recurring value that walked out with this reason' },
      { key: 'med',    label: 'Median Life',  get: (k) => S(k).med,      tip: 'Half left sooner, half later' },
      { key: 'peak',   label: 'Peak month',   get: (k) => S(k).peak,     tip: 'Month of customer life where this reason strikes most often' },
      { key: 'in365',  label: 'Yr 1 weight',  get: (k) => S(k).in365,    tip: 'Of every cancel in the first year of life, the share with this reason' },
      { key: 'in730',  label: 'Yr 2 weight',  get: (k) => S(k).in730,    tip: 'Of every cancel in the second year of life (months 13–24), the share with this reason' },
      { key: 'arv',    label: 'Avg ARV',      get: (k) => S(k).avgArv },
    ];
    if (!state._rtLifeSort) state._rtLifeSort = { key: 'n', dir: 'desc' };
    // Sort + expand/collapse repaint ONLY this table (per Isaac, Sep 24): a
    // full remount redrew every chart on the tab and the page jumped.
    let _tableRepaint = null;
    const sortedReasons = () => { const ls = state._rtLifeSort; const lc = LCOLS.find(c => c.key === ls.key) || LCOLS[1];
      return Object.keys(byReason).filter(k => byReason[k].length >= 10)
        .sort((a, b) => { const av = lc.get(a), bv = lc.get(b); const d = lc.str ? String(av).localeCompare(String(bv)) : av - bv; return ls.dir === 'asc' ? d : -d; }); };
    const rks = sortedReasons();
    const thL = (lab) => { const lsort = state._rtLifeSort; const c = LCOLS.find(x => x.label === lab); const on = c && lsort.key === c.key; return el('th', {
      class: 'text-left px-3 py-2 whitespace-nowrap cursor-pointer select-none' + (on ? ' font-black' : ''),
      style: on ? { color: 'var(--accent)' } : {}, title: ((c && c.tip) ? c.tip + ' · ' : '') + 'click to sort',
      onclick: () => { if (!c) return; state._rtLifeSort = on ? { key: c.key, dir: lsort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.str ? 'asc' : 'desc' }; if (_tableRepaint) _tableRepaint(); else mountApp(); },
    }, lab + (on ? (lsort.dir === 'asc' ? ' ▲' : ' ▼') : '')); };
    const reasonRow = (k) => {
      const { xs, med, in365, in730, avgArv, arrLost, hist, peak, share } = S(k);
      return el('tr', {
        class: 'border-t cursor-pointer transition hover:brightness-95',
        style: { borderColor: 'var(--border)' },
        onclick: () => openReportingDrillModal({
          chartTitle: 'Customer lifetime — ' + k,
          sliceLabel: fmt.int(xs.length) + ' cancels · median ' + fmt.int(med) + ' days',
          rows: xs.map(x => x.r), formatValue: (v) => fmt.usd0(v) }),
      },
        el('td', { class: 'px-3 py-2 whitespace-nowrap font-semibold' }, k),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, fmt.int(xs.length)),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, (share * 100).toFixed(1) + '%'),
        el('td', { class: 'px-3 py-2 text-left tabular-nums font-bold' }, fmt.usd0(arrLost)),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, fmt.int(med) + 'd',
          el('span', { class: 'text-[10px] font-normal text-muted-' }, ' · ' + moTxt(med))),
        el('td', { class: 'px-3 py-2 text-left tabular-nums font-bold', style: (peak >= 2 && peak <= 5) ? { color: '#DC2626' } : (peak >= 11 && peak <= 13) ? { color: '#A9441F' } : {} }, peak >= 36 ? '36+' : 'mo ' + peak),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, (in365 * 100).toFixed(1) + '%'),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, (in730 * 100).toFixed(1) + '%'),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, fmt.usd0(avgArv)));
    };
    const statL = (lab, val, sub) => el('div', { class: 'text-left' },
      el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-bold' }, lab),
      el('div', { class: 'text-sm font-bold tabular-nums' }, val,
        sub ? el('span', { class: 'text-[10px] font-normal text-muted-' }, ' · ' + sub) : null));
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 flex items-center justify-between flex-wrap gap-3' },
        el('div', {},
          el('div', { class: 'font-display text-lg' }, 'Customer Lifetime'),
          el('div', { class: 'text-[11px] text-muted-' },
            'Sold date → cancel date for cancelled accounts · '
            + (_yrL === 'all' ? 'all years in the book' : 'sold ' + _yrL)
            + (office !== 'all' ? ' · ' + officeLabel(office) : '')
            + ' · click a bar or a reason to see the accounts.')),
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          statL('Median life', fmt.int(medAll) + 'd', moTxt(medAll)),
          statL('Average', fmt.int(Math.round(avgAll)) + 'd', moTxt(avgAll)),
          statL('Cancels', fmt.int(rowsL.length), null))),
      el('div', { class: 'px-4 pb-2' },
        // Scroll strip: native swipe on touch, click-and-drag with a mouse.
        (() => {
          const strip = el('div', { class: 'overflow-x-auto', style: { cursor: 'grab', scrollbarWidth: 'thin', WebkitOverflowScrolling: 'touch', overscrollBehaviorX: 'contain' } },
            el('div', { class: 'flex items-end', style: { height: '92px', width: (buckets.length * BAR_W) + 'px' } }, ...buckets.map(barL)),
            el('div', { class: 'flex pt-1', style: { width: (buckets.length * BAR_W) + 'px' } }, ...buckets.map((b, i) => el('div', {
              class: 'shrink-0 text-center text-[9px] text-muted- tabular-nums',
              style: { width: BAR_W + 'px' } }, (i % 3 === 0) ? String(i) : ''))));
          let down = false, sx = 0, sl = 0, moved = false;
          strip.addEventListener('mousedown', (e) => { down = true; moved = false; sx = e.pageX; sl = strip.scrollLeft; strip.style.cursor = 'grabbing'; });
          const end = () => { down = false; strip.style.cursor = 'grab'; };
          strip.addEventListener('mouseleave', end); strip.addEventListener('mouseup', end);
          strip.addEventListener('mousemove', (e) => { if (!down) return; const dx = e.pageX - sx; if (Math.abs(dx) > 3) moved = true; strip.scrollLeft = sl - dx; e.preventDefault(); });
          // A drag must not fire the bar's click at the end of it.
          strip.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); moved = false; } }, true);
          return strip;
        })(),
        el('div', { class: 'flex items-center justify-between pt-1 text-[10px] text-muted-' },
          el('span', {}, 'Month of customer life at cancel \u00b7 drag or swipe for later months (to month ' + lastMo + ')'),
          el('span', { class: 'flex items-center gap-3' },
            el('span', { class: 'flex items-center gap-1' }, el('span', { style: { width: '8px', height: '8px', background: '#DC2626', display: 'inline-block' } }), 'collections cliff (mo 2–5)'),
            el('span', { class: 'flex items-center gap-1' }, el('span', { style: { width: '8px', height: '8px', background: '#A9441F', display: 'inline-block' } }), 'contract end (mo 11–13)')))),
      // By-reason table is collapsed by default (per Isaac, Sep 2026) —
      // click the bar to expand it under the chart.
      (() => {
        // Expand / collapse in the DOM (per Isaac, Sep 24 — a full remount
        // redrew every chart on the tab and the page jumped).
        let openR = state._rtLifeReasonsOpen === true;
        const tableWrap = el('div', { class: 'overflow-x-auto border-t', style: { borderColor: 'var(--border)', display: openR ? '' : 'none' } });
        let built = false;
        const build = (force) => { if (built && !force) return; built = true; tableWrap.replaceChildren(el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-' }, el('tr', { style: { background: 'var(--card-2)' } }, ...LCOLS.map(c => thL(c.label)))),
          el('tbody', {}, ...sortedReasons().map(reasonRow)))); };
        _tableRepaint = () => build(true);
        if (openR) build();
        const arrow = el('span', { class: 'text-[10px] uppercase tracking-widest font-bold' }, (openR ? '\u25be ' : '\u25b8 ') + 'Lifetime by cancellation reason');
        const hint = el('span', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, rks.length + ' reasons · ' + (openR ? 'click to collapse' : 'click to expand'));
        const bar = el('button', {
          class: 'w-full flex items-center justify-between gap-3 px-4 py-2.5 border-t text-left transition hover:brightness-95',
          style: { borderColor: 'var(--border)', background: 'var(--card-2)', color: 'var(--text)' },
          onclick: () => {
            openR = !openR; state._rtLifeReasonsOpen = openR;
            if (openR) build();
            tableWrap.style.display = openR ? '' : 'none';
            arrow.textContent = (openR ? '\u25be ' : '\u25b8 ') + 'Lifetime by cancellation reason';
            hint.textContent = rks.length + ' reasons · ' + (openR ? 'click to collapse' : 'click to expand');
          },
        }, arrow, hint);
        return el('div', {}, bar, tableWrap);
      })());
  })();

  const _pm = (l, f) => { const r = f(); _profMark(l); return r; };
  // "None" in the branch picker empties the book. Every card returns null on
  // an empty population, which made the tab look broken — so (per Isaac) the
  // cards stay put as blank shells until a branch is ticked again.
  const _bookEmpty = !popA.length;
  const _shell = (title, node) => node || (!_bookEmpty ? null : el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b flex items-center justify-between gap-3', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, title),
      el('span', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-subtle)' } }, '0 subscriptions')),
    el('div', { class: 'px-4 py-6 text-center text-[11px]', style: { color: 'var(--text-subtle)' } }, 'No branches selected \u2014 tick a branch on Attrition Steps.')));
  const renderSide = (data, pop, label, sideMark) => el('div', { class: 'flex flex-col gap-4' },
    // Matrix wants ~560px; when it can't have it (phones) the blended table
    // wraps underneath instead of both squeezing side by side.
    // (Cohort matrix hidden per Isaac, Sep 2026 — renderMatrix stays for when it comes back.)
    _shell('Attrition Trends', _pm('ret:trends', () => attritionTrendsCard(pop, label))),   // right under Attrition Steps (per Isaac, Sep 2026)
    _shell('Churn Timing', _pm('ret:timing', () => churnTimingCard(pop, label))),
    _shell('Customer Lifetime', lifetimeCard),                       // Customer Lifetime follows the trends chart (per Isaac)
    _shell('Cohort Waterfall', _pm('ret:blended', () => renderBlended(pop))),
    _shell('Monthly Churn', _pm('ret:seasonality', () => seasonalityCard(pop, label))),
    _shell('\ud83c\udf31 Retention by Start Month', _pm('ret:cohorts', () => startCohortCard(pop, label))));   // (LTV card retired per Isaac, Sep 2026)

  const body = inCompare
    ? el('div', { class: 'flex flex-col gap-4' },
        renderSide(waterfallA, popA, officeLabel(office), '__A__'),
        renderSide(waterfallB, popB, officeLabel(compareOffice), '__B__'))
    : renderSide(waterfallA, popA, null, '__A__');


  // ── ATTRITION BY REP TYPE (per Isaac) — who sold it: Door to Door,
  // Office Staff, Technician. Same population as the tab (office scope,
  // hidden-service/source filters, Steps 4-6 exclusions, serviced-only),
  // same cancel semantics: save-backs count Active, reason-excluded cancels
  // and (per the Overview toggle) 3-day RORs count as retained.
  // One card builder, two groupings (per Isaac, Sep 2026): by rep TYPE and by
  // SOURCE. Same population, same chips, same year picker — only the grouping
  // and the title change.
  // Drill summary (per Isaac, Sep 2026): more than a list of accounts —
  // the headline numbers, then where / when / why, each row drilling to
  // its own accounts.
  const _attrDrillSummary = (label, t) => {
    const arvOf = (rs) => rs.reduce((a, r) => a + (Number(r.annual_recurring_value) || 0), 0);
    const attr = t.subs ? t.cancelled / t.subs : null;
    const MS_D = 86400000;
    const lives = t.cxlRows.map(r => { const sd = r.sold_date ? new Date(r.sold_date) : null, cd = r._effCancel ? new Date(r._effCancel) : null; return sd && cd && !isNaN(sd) && !isNaN(cd) && cd >= sd ? (cd - sd) / MS_D : null; }).filter(v => v != null).sort((a, b) => a - b);
    const medLife = lives.length ? lives[Math.floor((lives.length - 1) / 2)] : null;
    const tile = (lab, val, sub, color) => el('div', { class: 'flex-1 px-3 py-2 rounded-xl', style: { background: 'var(--card-2)', minWidth: '120px' } },
      el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, lab),
      el('div', { class: 'text-lg font-black tabular-nums leading-tight', style: color ? { color } : {} }, val),
      sub ? el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, sub) : null);
    const group = (keyOf) => { const m = new Map(); for (const r of t.rows) { const k = keyOf(r); if (!m.has(k)) m.set(k, { subs: 0, cxl: 0, arv: 0, arvCxl: 0, rows: [], cxlRows: [] }); const g = m.get(k); g.subs++; g.arv += Number(r.annual_recurring_value) || 0; g.rows.push(r); if (r._effCancel) { g.cxl++; g.arvCxl += Number(r.annual_recurring_value) || 0; g.cxlRows.push(r); } } return [...m.entries()]; };
    const mini = (title, entries, opts = {}) => {
      const list = entries.sort((a, b) => (opts.sortKey ? String(b[0]).localeCompare(String(a[0])) : b[1].subs - a[1].subs)).slice(0, opts.limit || 8);
      const th = (x) => el('th', { class: 'px-2 py-1 text-[9px] uppercase tracking-wider font-semibold text-left whitespace-nowrap', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, x);
      const td = (x, o = {}) => el('td', { class: 'px-2 py-1 tabular-nums whitespace-nowrap text-left' + (o.bold ? ' font-bold' : ''), style: o.style || {} }, x);
      return el('div', { class: 'flex-1 min-w-0 rounded-xl border overflow-hidden', style: { borderColor: 'var(--border)', minWidth: '220px' } },
        el('div', { class: 'px-2 py-1.5 text-[10px] uppercase tracking-widest font-bold border-b', style: { color: 'var(--text-subtle)', borderColor: 'var(--border)' } }, title),
        el('table', { class: 'w-full text-[11px]' },
          el('thead', {}, el('tr', {}, th(opts.col || ''), th(opts.cxlOnly ? 'Cancels' : 'Subs'), opts.cxlOnly ? th('Share') : th('Cancelled'), opts.cxlOnly ? th('ARR lost') : th('Attrition'))),
          el('tbody', {}, ...list.map(([k, g]) => { const a = g.subs ? g.cxl / g.subs : null; return el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95', style: { borderColor: 'var(--border)' }, title: 'Click for the accounts',
            onclick: (e) => { e.stopPropagation(); openReportingDrillModal({ chartTitle: label + ' · ' + title + ' · ' + k, sliceLabel: fmt.int((opts.cxlOnly ? g.cxlRows : g.rows).length) + ' accounts', rows: opts.cxlOnly ? g.cxlRows : g.rows, formatValue: (v) => fmt.usd0(v) }); } },
            td(k, { bold: true }),
            td(fmt.int(opts.cxlOnly ? g.cxl : g.subs)),
            opts.cxlOnly ? td(t.cancelled ? (g.cxl / t.cancelled * 100).toFixed(0) + '%' : '—') : td(fmt.int(g.cxl)),
            opts.cxlOnly ? td(fmt.usd0(g.arvCxl)) : td(a == null ? '—' : (a * 100).toFixed(1) + '%', { bold: true, style: a != null && a >= 0.35 ? { color: '#DC2626' } : a != null && a < 0.2 ? { color: 'var(--ok)' } : {} })); }))));
    };
    const yearOf = (r) => { const d = r.sold_date ? new Date(r.sold_date) : null; return d && !isNaN(d) ? String(d.getFullYear()) : '—'; };
    const reasonOf = (r) => reportingCancelReasonOf(r) || 'Unspecified';
    const byReason = group(reasonOf).filter(([, g]) => g.cxl > 0).map(([k, g]) => [k, { ...g, subs: g.cxl }]);
    return el('div', { class: 'flex flex-col gap-3' },
      el('div', { class: 'flex gap-2 flex-wrap' },
        tile('Subs in the book', fmt.int(t.subs), fmt.usd0(arvOf(t.rows)) + ' ARR sold'),
        tile('Active', fmt.int(t.active), fmt.usd0(arvOf(t.rows.filter(r => !r._effCancel))) + ' ARR retained', 'var(--ok)'),
        tile('Cancelled', fmt.int(t.cancelled), fmt.usd0(arvOf(t.cxlRows)) + ' ARR lost', '#DC2626'),
        tile('Attrition', attr == null ? '—' : (attr * 100).toFixed(1) + '%', 'cancelled ÷ subs', attr != null && attr >= 0.35 ? '#DC2626' : undefined),
        tile('Median life', medLife == null ? '—' : (medLife / 30.44).toFixed(1) + ' mo', 'sold → cancel, cancelled subs')),
      el('div', { class: 'flex gap-3 flex-wrap' },
        mini('By office', group(r => (r.office_name || '').trim() || 'Unknown'), { col: 'Office' }),
        mini('By year sold', group(yearOf), { col: 'Year', sortKey: true }),
        mini('Why they left', byReason, { col: 'Reason', cxlOnly: true })));
  };
  const _attritionByCard = (dim) => {
    // Sold-year cohort filter (per Isaac - the card had no time dimension
    // and read as "some year"). 'all' = the whole book in the snapshot;
    // a year = accounts SOLD that year, cancels any time since.
    const _yearOf = (r) => { const d = r.sold_date ? new Date(r.sold_date) : null; return d && !isNaN(d) ? d.getFullYear() : null; };
    const _rtYears = [...new Set(popA.map(_yearOf).filter(Boolean))].sort((a, b) => b - a);
    if (state._rtAttrYear !== 'all' && !_rtYears.includes(state._rtAttrYear)) state._rtAttrYear = 'all';
    const _rtYear = state._rtAttrYear || 'all';
    // The population IS the retention book (per Isaac, Sep 2026): every
    // step and toggle on the Attrition Steps card decides what is in here —
    // renewals, RORs, one-time, under-2-services, excluded reasons. No
    // card-level chips any more; cancels are the book's counted cancels.
    const TYPE_LABEL = (r) => {
      if (dim === 'source') return String(r.subscription_source || '').trim() || 'Unspecified';
      if (dim === 'contract') { const m = Number(r.agreement_length) || 0; return m === 12 ? '12 mo' : m === 18 ? '18 mo' : m === 24 ? '24 mo' : m > 24 ? '24+ mo' : m > 0 ? 'Under 12 mo' : 'No term'; }
      // Rep: the CRM name when the warehouse has it. RevHawk's employee
      // mirror only carries ACTIVE FieldRoutes employees (verified Sep 2026:
      // every row active=1), so anyone who has since left has an id on the
      // sub but no name — those show as "Former rep #id" rather than one
      // giant Unknown bucket, and pick up their name automatically the day
      // the mirror includes inactive employees.
      if (dim === 'rep') { const nm = (typeof flipLastFirst === 'function' ? flipLastFirst(String(r.sold_by || '').trim()) : String(r.sold_by || '').trim()); if (nm) return nm; const id = String(r.sold_by_id || '').trim(); return id && id !== '0' ? 'Former rep #' + id : 'Unknown'; }
      const t = String(r.sold_by_type || '').trim();
      const role = crmSellerRole(t);
      if (role) return CRM_SELLER_LABELS[role];
      return t ? (t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()) : 'Unknown';
    };
    const mk = () => ({ subs: 0, active: 0, cancelled: 0, arv: 0, arvCxl: 0, rows: [], cxlRows: [] });
    const byType = {}; const total = mk();
    for (const r of _retenEff(popA)) {
      if (_rtYear !== 'all' && _yearOf(r) !== _rtYear) continue;
      const g = byType[TYPE_LABEL(r)] = byType[TYPE_LABEL(r)] || mk();
      const arv = Number(r.annual_recurring_value) || 0;
      for (const t of [g, total]) {
        t.subs++; t.arv += arv; t.rows.push(r);
        if (r._effCancel) { t.cancelled++; t.arvCxl += arv; t.cxlRows.push(r); }
        else t.active++;
      }
    }
    if (!total.subs && _rtYear === 'all') return null;
    const ORDER = dim === 'contract' ? ['12 mo', '18 mo', '24 mo', '24+ mo', 'Under 12 mo', 'No term'] : ['Door to Door', 'Office Staff', 'Technician'];
    // Rep: fold reps under 20 subs into "Other reps" so the table reads; biggest first.
    if (dim === 'rep') { const MINR = 20; const other = mk(); for (const k of Object.keys(byType)) { if (byType[k].subs < MINR) { const g = byType[k]; for (const f of ['subs', 'active', 'cancelled', 'arv', 'arvCxl']) other[f] += g[f]; other.rows.push(...g.rows); other.cxlRows.push(...g.cxlRows); delete byType[k]; } } if (other.subs) byType['Other reps (under ' + MINR + ' subs)'] = other; }
    const keys = (dim === 'source' || dim === 'rep')
      ? Object.keys(byType).sort((a, b) => (a.startsWith('Other reps') ? 1 : b.startsWith('Other reps') ? -1 : 0) || byType[b].subs - byType[a].subs || a.localeCompare(b))   // biggest first
      : [...ORDER.filter(k => byType[k]), ...Object.keys(byType).filter(k => !ORDER.includes(k)).sort()];
    const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(1) + '%' : '\u2014';
    const th = (lab, right) => el('th', { class: (right ? 'text-left' : 'text-left') + ' px-3 py-2 whitespace-nowrap' }, lab);
    const row = (label, t, bold) => {
      const attr = t.subs > 0 ? t.cancelled / t.subs : null;
      return el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95' + (bold ? ' font-bold' : ''), style: { borderColor: 'var(--border)', background: bold ? 'var(--card-2)' : '' }, title: 'Click for the counted cancels',
        onclick: () => t.rows.length && openReportingDrillModal({ chartTitle: (dim === 'source' ? 'Attrition by Source · ' : dim === 'rep' ? 'Attrition by Rep · ' : dim === 'contract' ? 'Attrition by Contract Length · ' : 'Attrition by Rep Type · ') + label, sliceLabel: fmt.int(t.cxlRows.length) + ' counted cancels of ' + fmt.int(t.subs), rows: t.cxlRows, formatValue: (v) => fmt.usd0(v), summary: _attrDrillSummary(label, t) }) },
        el('td', { class: 'px-3 py-2 whitespace-nowrap' + (bold ? '' : ' font-semibold') }, label),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, fmt.int(t.subs)),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, fmt.int(t.active)),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, fmt.int(t.cancelled)),
        el('td', { class: 'px-3 py-2 text-left tabular-nums font-bold', style: attr != null && attr >= 0.15 ? { color: '#DC2626' } : attr != null && attr < 0.08 ? { color: '#DF643A' } : {} }, pct(t.cancelled, t.subs)),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, pct(t.active, t.subs)),
        el('td', { class: 'px-3 py-2 text-left tabular-nums' }, pct(t.arvCxl, t.arv)));
    };
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('div', { class: 'font-display text-lg', title: (dim === 'source' ? 'Where the account CAME FROM \u00b7 ' : dim === 'contract' ? 'Agreement length on the subscription \u00b7 ' : dim === 'rep' ? 'The rep who sold it \u00b7 \u201cFormer rep #id\u201d = inactive in FieldRoutes, so the CRM export carries no name \u00b7 ' : 'Who SOLD the account \u00b7 ') + (_rtYear === 'all' ? 'all years in the book' : 'sold in ' + _rtYear + ', cancels to date') + ' \u00b7 same population and cancel rules as this tab' + (office !== 'all' ? ' \u00b7 ' + officeLabel : '') + '.' }, dim === 'source' ? 'Attrition by Source' : dim === 'contract' ? 'Attrition by Contract Length' : dim === 'rep' ? 'Attrition by Rep' : 'Attrition by Rep Type')),
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          el('select', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
            onchange: (e) => { state._rtAttrYear = e.target.value === 'all' ? 'all' : Number(e.target.value); mountApp(); },
          },
            el('option', { value: 'all', selected: _rtYear === 'all' }, 'All years'),
            ..._rtYears.map(y => el('option', { value: String(y), selected: _rtYear === y }, 'Sold ' + y))))),
      !total.subs ? el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'No accounts in this cohort under the current rules.') :
      el('div', { style: { overflow: 'auto', maxHeight: (dim === 'source' || dim === 'rep') ? '460px' : 'none' } }, el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-', style: { position: 'sticky', top: 0, zIndex: 1 } }, el('tr', { style: { background: 'var(--card-2)' } },
          th(dim === 'source' ? 'Source' : dim === 'contract' ? 'Contract Length' : dim === 'rep' ? 'Rep' : 'Rep Type'), th('Subs', 1), th('Active', 1), th('Cancelled', 1), th('Attrition %', 1), th('Retention %', 1), th('ARR Attrition %', 1))),
        el('tbody', {},
          ...keys.map(k => row(k, byType[k])),
          row('RIDD \u00b7 Total', total, true)))),
      el('div', { class: 'px-4 py-2 text-[10px] text-muted- border-t', style: { borderColor: 'var(--border)' } }, 'Same book as Attrition Steps — switch a step or a reason up there and this table follows.'));
  };
  // (The four Attrition-by tables — Source / Rep / Contract Length / Rep
  // Type — are ONE card with a dimension dropdown, per Isaac, Sep 2026.
  // Only the picked dimension is built. See attritionByCard below.)
  // -- Attrition by Source (per Isaac, Sep 2026: the old Attrition-by-Source
  // table and the Source Quality Ledger folded into one). Population = the
  // retention book, so the steps card decides what is in; cancels are the
  // book's counted cancels. Two columns are deliberately measured on the
  // FULL serviced pool for the source, because they describe the source
  // even though those subs leave the book: ROR % (buyer's remorse) and
  // Delinquent % (never really paid). Sortable; small sources fold into
  // "Other" so the table reads.
  const sourceAttritionCard = (() => {
    const MS_D = 86400000;
    const _yearOf = (r) => { const d = r.sold_date ? new Date(r.sold_date) : null; return d && !isNaN(d) ? d.getFullYear() : null; };
    const _rtYear = state._rtAttrYear || 'all';
    const _srcOf = (r) => String(r.subscription_source || '').trim() || 'Unspecified';
    const _aliveS = (r) => /active/i.test(String(r.subscription_status || ''));
    const _isDelinq = (r) => /delinquen/i.test(_normCancelReason(r.subscription_cancellation_reason));
    const mk = () => ({ subs: 0, active: 0, cxl: 0, arvSold: 0, arrKept: 0, lives: [], rows: [], cxlRows: [], pool: 0, poolCxl: 0, ror: 0, delinq: 0 });
    const bySrc = new Map();
    const get = (k) => { let g = bySrc.get(k); if (!g) { g = mk(); bySrc.set(k, g); } return g; };
    // 1. the book
    for (const r of _retenEff(popA)) {
      if (_rtYear !== 'all' && _yearOf(r) !== _rtYear) continue;
      const g = get(_srcOf(r));
      const arv = Number(r.annual_recurring_value) || 0;
      g.subs++; g.arvSold += arv; g.rows.push(r);
      if (r._effCancel) {
        g.cxl++; g.cxlRows.push(r);
        const sd = r.sold_date ? new Date(r.sold_date) : null, cd = new Date(r._effCancel);
        if (sd && !isNaN(sd) && !isNaN(cd) && cd >= sd) g.lives.push((cd - sd) / MS_D);
      } else { g.active++; g.arrKept += arv; }
    }
    // 2. the full serviced pool — ROR and delinquent rates per source
    for (const r of popA) {
      if (_rtYear !== 'all' && _yearOf(r) !== _rtYear) continue;
      if (!((Number(r.subscription_completed_services) || 0) > 0)) continue;
      const g = get(_srcOf(r));
      g.pool++;
      const cxl = r.subscription_date_canceled && !_aliveS(r);
      if (!cxl) continue;
      g.poolCxl++;
      if (_reporting3dayRor(r) || _isRorReason(_normCancelReason(r.subscription_cancellation_reason))) g.ror++;
      if (_isDelinq(r)) g.delinq++;
    }
    const total = mk();
    for (const g of bySrc.values()) { for (const k of ['subs', 'active', 'cxl', 'arvSold', 'arrKept', 'pool', 'poolCxl', 'ror', 'delinq']) total[k] += g[k]; total.lives.push(...g.lives); total.rows.push(...g.rows); total.cxlRows.push(...g.cxlRows); }
    if (!total.subs && _rtYear === 'all') return null;
    const MIN = 0;   // every source on its own row (per Isaac, Sep 23 — no "Other (small sources)" fold)
    const other = mk(); const named = [];
    for (const [k, g] of bySrc) {
      if (g.subs >= MIN) named.push([k, g]);
      else { for (const f of ['subs', 'active', 'cxl', 'arvSold', 'arrKept', 'pool', 'poolCxl', 'ror', 'delinq']) other[f] += g[f]; other.lives.push(...g.lives); other.rows.push(...g.rows); other.cxlRows.push(...g.cxlRows); }
    }
    const _med = (a) => { if (!a.length) return null; const t = [...a].sort((x, y) => x - y); return t[Math.floor((t.length - 1) / 2)]; };
    const COLS = [
      { key: 'source',  label: 'Source',       left: true, get: ([k]) => k.toLowerCase(), str: true },
      { key: 'subs',    label: 'Subs',         get: ([, g]) => g.subs, tip: 'Subscriptions from this source in the retention book' },
      { key: 'active',  label: 'Active',       get: ([, g]) => g.active },
      { key: 'cxl',     label: 'Cancelled',    get: ([, g]) => g.cxl, tip: 'Counted cancels (the book’s rules)' },
      { key: 'attr',    label: 'Attrition %',  get: ([, g]) => g.subs ? g.cxl / g.subs : -1, tip: 'Cancelled ÷ subs' },
      { key: 'kept',    label: 'ARR retained', get: ([, g]) => g.arrKept, tip: 'Annual recurring value of the active subs' },
      { key: 'perSub',  label: '$ Kept / Sub', get: ([, g]) => g.subs ? g.arrKept / g.subs : 0, tip: 'Retained ARR ÷ every sub the source produced — the quality headline' },
      { key: 'ror',     label: 'ROR %',        get: ([, g]) => g.pool ? g.ror / g.pool : -1, tip: '3-day right-of-rescission cancels ÷ every serviced sub from the source (full pool, not just the book)' },
      { key: 'delinq',  label: 'Delinq %',     get: ([, g]) => g.pool ? g.delinq / g.pool : -1, tip: 'Died delinquent / collections ÷ every serviced sub from the source (full pool)' },
      { key: 'life',    label: 'Med. life',    get: ([, g]) => _med(g.lives) ?? -1, tip: 'Median sold → cancel for the counted cancels' },
      { key: 'arv',     label: 'Avg ARV',      get: ([, g]) => g.subs ? g.arvSold / g.subs : 0 },
    ];
    if (!state._rtSrcSort) state._rtSrcSort = { key: 'subs', dir: 'desc' };
    const sort = state._rtSrcSort;
    const col = COLS.find(c => c.key === sort.key) || COLS[1];
    named.sort((a, b) => { const av = col.get(a), bv = col.get(b); const d = col.str ? String(av).localeCompare(String(bv)) : av - bv; return sort.dir === 'asc' ? d : -d; });
    if (other.subs) named.push(['Other (small sources)', other]);
    const pct = (n, d) => d > 0 ? (n / d * 100).toFixed(1) + '%' : '—';
    const th = (c) => el('th', {
      class: 'px-3 py-2 whitespace-nowrap text-left cursor-pointer select-none' + (sort.key === c.key ? ' font-black' : ''),
      style: sort.key === c.key ? { color: 'var(--accent)' } : {}, title: (c.tip ? c.tip + ' · ' : '') + 'click to sort',
      onclick: () => { state._rtSrcSort = sort.key === c.key ? { key: c.key, dir: sort.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: c.str ? 'asc' : 'desc' }; mountApp(); },
    }, c.label + (sort.key === c.key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : ''));
    const td = (t, o = {}) => el('td', { class: 'px-3 py-2 whitespace-nowrap text-left tabular-nums' + (o.bold ? ' font-bold' : ''), style: o.style || {} }, t);
    const row = ([k, g], bold) => {
      const attr = g.subs ? g.cxl / g.subs : null;
      const med = _med(g.lives);
      return el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95' + (bold ? ' font-bold' : ''), style: { borderColor: 'var(--border)', background: bold ? 'var(--card-2)' : '' }, title: 'Click for the counted cancels',
        onclick: () => g.cxlRows.length && openReportingDrillModal({ chartTitle: 'Attrition by Source · ' + k, sliceLabel: fmt.int(g.cxlRows.length) + ' counted cancels of ' + fmt.int(g.subs), rows: g.cxlRows, formatValue: (v) => fmt.usd0(v) }) },
        el('td', { class: 'px-3 py-2 whitespace-nowrap' + (bold ? '' : ' font-semibold') }, k),
        td(fmt.int(g.subs)), td(fmt.int(g.active)), td(fmt.int(g.cxl)),
        td(pct(g.cxl, g.subs), { bold: true, style: attr != null && attr >= 0.15 ? { color: '#DC2626' } : attr != null && attr < 0.08 ? { color: '#DF643A' } : {} }),
        td(fmt.usd0(g.arrKept)), td(g.subs ? fmt.usd0(g.arrKept / g.subs) : '—', { bold: true }),
        td(pct(g.ror, g.pool), { style: g.pool && g.ror / g.pool >= 0.05 ? { color: '#DC2626', fontWeight: '700' } : {} }),
        td(pct(g.delinq, g.pool), { style: g.pool && g.delinq / g.pool >= 0.10 ? { color: '#DC2626', fontWeight: '700' } : {} }),
        td(med == null ? '—' : (med / 30.44).toFixed(1) + ' mo'),
        td(g.subs ? fmt.usd0(g.arvSold / g.subs) : '—'));
    };
    const _rtYears = [...new Set(popA.map(_yearOf).filter(Boolean))].sort((a, b) => b - a);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('div', { class: 'font-display text-lg', title: 'Where the account CAME FROM · ' + (_rtYear === 'all' ? 'all years in the book' : 'sold in ' + _rtYear) + (office !== 'all' ? ' · ' + officeLabel(office) : '') + ' · ROR % and Delinq % are measured on every serviced sub from the source, the rest on the retention book. Click a column to sort, a row for the cancels.' }, 'Attrition by Source')),
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          el('select', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
            onchange: (e) => { state._rtAttrYear = e.target.value === 'all' ? 'all' : Number(e.target.value); mountApp(); },
          },
            el('option', { value: 'all', selected: _rtYear === 'all' }, 'All years'),
            ..._rtYears.map(y => el('option', { value: String(y), selected: _rtYear === y }, 'Sold ' + y))))),
      !total.subs ? el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'No accounts in this cohort under the current rules.') :
      el('div', { style: { overflow: 'auto', maxHeight: '520px' } }, el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-', style: { position: 'sticky', top: 0, zIndex: 1 } }, el('tr', { style: { background: 'var(--card-2)' } }, ...COLS.map(th))),
        el('tbody', {}, ...named.map(x => row(x, false)), row(['RIDD · Total', total], true)))),
      el('div', { class: 'px-4 py-2 text-[10px] text-muted- border-t', style: { borderColor: 'var(--border)' } }, 'Same book as Attrition Steps — switch a step or a reason up there and this table follows. Sources under ' + MIN + ' subs fold into Other.'));
  })();

  // ("True Attrition" bar retired per Isaac, Sep 2026.)

  // -- Customer Lifetime (per Isaac) -- how long cancelled customers lasted,
  // sold date -> cancel date, as a month-of-life histogram (the "when do we
  // lose them" curve) and a by-reason lifetime table. Same population rules
  // as this tab; the noise classes (3-day ROR, one-time, renewals) exclude
  // by default via the chips, and the card follows the Attrition year picker.
  // Red bars = the collections cliff (months 2-5); amber = the 12-month
  // contract-end window (months 11-13).


  // -- Renewal Retention (per Isaac) -- do renewed accounts stick better
  // than accounts left month-to-month? NOT renewals vs new sales (renewals
  // only happen within 2 months of term end, so new accounts are not a fair
  // baseline). Fair frame: of accounts that REACHED contract end, compare
  // the ones that renewed against the ones riding month-to-month.
  // -- Renewal Retention (per Isaac, rebuilt Sep 2026 as one plain table) --
  // Rows = each renewal type, all renewals, and the accounts that reached
  // contract end and rode month-to-month instead. Columns = the counts the
  // rate is built from, so every number can be checked. Group by type or by
  // the year the renewal was sold. Sentricon excluded (never renews).
  // -- Renewal Retention (per Isaac, Sep 2026: rebuilt as a survival
  // waterfall). Lifetime "cancelled ÷ subs" punished the older cohorts, so
  // every row now reads at the SAME horizons — % still active 3 / 6 / 9 /
  // 12 / 18 / 24 months after the renewal was sold. Month-to-month rides
  // the same horizons measured from contract end, so the comparison is
  // fair. Sentricon excluded.
  const renewalRetentionCard = (() => {
    // Rebuilt simple (per Isaac, Sep 2026): the same shape as the Attrition
    // by table — one row per renewal type (or the year the renewal was
    // sold), Subs / Active / Cancelled / Attrition % / Retention % / ARR
    // Attrition %, plus the two tenure reads he cares about: the customer's
    // age when they renewed and their age today. A Month-to-month row
    // (reached contract end, never renewed) sits underneath for contrast.
    const now = new Date();
    const grp = state._rtRenewGroup === 'year' ? 'year' : 'type';
    const firstSale = new Map();
    for (const r of popA) { if (!r.customer_id || !r.sold_date) continue; const k = String(r.customer_id); if (!firstSale.has(k) || r.sold_date < firstSale.get(k)) firstSale.set(k, r.sold_date); }
    const _aliveR = (r) => /active/i.test(String(r.subscription_status || ''));
    const _sentR = (r) => /sentricon/i.test(String(r.subscription || ''));
    const _endOf = (r) => { const m = Number(r.agreement_length) || 0; const d = r.sold_date ? new Date(r.sold_date) : null; if (!d || isNaN(d) || m < 12) return null; const e = new Date(d); e.setMonth(e.getMonth() + m); return e; };
    const _renReasonR = (r) => /^renewal\b/i.test(_normCancelReason(r.subscription_cancellation_reason));
    const _yearOf = (r) => { const d = r.sold_date ? new Date(r.sold_date) : null; return d && !isNaN(d) ? String(d.getFullYear()) : '—'; };
    const _typeOf = (r) => { const src = String(r.subscription_source || '').trim(); const m = src.match(/renewal\s*[-–]\s*(.+)$/i) || src.match(/^(.+?)\s+renewal$/i); return m ? m[1].trim() : (src || 'Renewal'); };
    const monthsBetween = (a, b) => (b - a) / (86400000 * 30.4375);
    const mk = () => ({ subs: 0, active: 0, cancelled: 0, arv: 0, arvCxl: 0, ageAt: [], ageNow: [], rows: [], cxlRows: [] });
    const add = (o, r, startDate) => {
      const alive = _aliveR(r);
      const cd = r.subscription_date_canceled ? new Date(r.subscription_date_canceled) : null;
      const cancelled = !!(cd && !isNaN(cd) && !alive);
      const arv = Number(r.annual_recurring_value) || 0;
      o.subs++; o.arv += arv; o.rows.push(r);
      if (cancelled) { o.cancelled++; o.arvCxl += arv; o.cxlRows.push(r); } else o.active++;
      const fs = firstSale.get(String(r.customer_id)); const fsd = fs ? new Date(fs) : null;
      if (fsd && !isNaN(fsd)) { o.ageAt.push(Math.max(0, monthsBetween(fsd, startDate))); o.ageNow.push(Math.max(0, monthsBetween(fsd, cancelled ? cd : now))); }
    };
    const groups = new Map(); const all = mk(); const m2m = mk(); let m2mReached = 0, m2mRenewedAway = 0;
    for (const r of popA) {
      if (!((Number(r.subscription_completed_services) || 0) > 0)) continue;
      if (_sentR(r)) continue;
      if (reportingSourceClass(r.subscription_source) === 'renewal') {
        const sd = r.sold_date ? new Date(r.sold_date) : null; if (!sd || isNaN(sd)) continue;
        const k = grp === 'year' ? _yearOf(r) : _typeOf(r);
        if (!groups.has(k)) groups.set(k, mk());
        add(groups.get(k), r, sd); add(all, r, sd);
        continue;
      }
      const end = _endOf(r); if (!end || end > now) continue;
      const cd = r.subscription_date_canceled ? new Date(r.subscription_date_canceled) : null;
      const cancel = (cd && !_aliveR(r) && !isNaN(cd)) ? cd : null;
      if (cancel && cancel <= end) continue;
      m2mReached++;
      if (cancel && _renReasonR(r)) { m2mRenewedAway++; continue; }
      add(m2m, r, end);
    }
    if (!all.subs && !m2mReached) return null;
    const avg = (xs) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
    const pct = (n, d) => d ? (n / d * 100).toFixed(1) + '%' : '—';
    const mo = (v) => v == null ? '—' : v.toFixed(1) + ' mo';
    const th = (t, right, help) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' }, title: help || '' }, t);
    const td = (t, o = {}) => el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap ' + (o.left ? 'text-left font-semibold' : 'text-right') + (o.bold ? ' font-black' : ''), style: { color: o.color, cursor: o.onclick ? 'pointer' : undefined }, onclick: o.onclick, title: o.title || '' }, t);
    const row = (label, o, strong) => {
      const attr = o.subs ? o.cancelled / o.subs : null;
      return el('tr', { class: 'border-t', style: { borderColor: strong ? 'var(--border-2)' : 'var(--border)', background: strong ? 'var(--card-2)' : undefined, borderTopWidth: strong ? '2px' : undefined } },
        td(label, { left: true, bold: strong, title: 'Click for every account in the row', onclick: o.rows.length ? () => openReportingDrillModal({ chartTitle: 'Renewal Retention · ' + label, sliceLabel: fmt.int(o.rows.length) + ' accounts', rows: o.rows, formatValue: (v) => fmt.usd0(v) }) : undefined }),
        td(fmt.int(o.subs), { bold: strong }), td(fmt.int(o.active)),
        td(fmt.int(o.cancelled), { title: 'Click for the cancels', onclick: o.cxlRows.length ? () => openReportingDrillModal({ chartTitle: 'Renewal Retention · ' + label + ' · cancelled', sliceLabel: fmt.int(o.cxlRows.length) + ' counted cancels of ' + fmt.int(o.subs), rows: o.cxlRows, formatValue: (v) => fmt.usd0(v) }) : undefined }),
        td(pct(o.cancelled, o.subs), { bold: true, color: attr != null && attr >= 0.15 ? '#DC2626' : attr != null && attr < 0.08 ? '#DF643A' : undefined }),
        td(pct(o.active, o.subs)), td(pct(o.arvCxl, o.arv)),
        td(mo(avg(o.ageAt))), td(mo(avg(o.ageNow))));
    };
    const keys = [...groups.keys()].sort((x, y) => grp === 'year' ? String(y).localeCompare(String(x)) : groups.get(y).subs - groups.get(x).subs);
    const btn = (on, l, fn) => el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold transition hover:brightness-95', style: on ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }, onclick: fn }, l);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('div', { class: 'font-display text-lg', title: 'Renewal subscriptions with a completed service, by ' + (grp === 'year' ? 'the year the renewal was sold' : 'renewal type') + ' · same population and cancel rules as this tab · Sentricon excluded. Age at renewal = months as a customer when the renewal was sold; Age today = months as a customer now (or at cancel). Month-to-month = reached contract end and kept going without renewing.' }, 'Renewal Retention' + (office !== 'all' ? ' · ' + officeLabel(office) : ''))),
        el('div', { class: 'flex items-center gap-1' }, btn(grp === 'type', 'By type', () => { state._rtRenewGroup = 'type'; mountApp(); }), btn(grp === 'year', 'By year', () => { state._rtRenewGroup = 'year'; mountApp(); }))),
      el('div', { class: 'scroll-x' },
        el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
          el('thead', {}, el('tr', {},
            th(grp === 'year' ? 'Renewal year' : 'Renewal type'), th('Subs', 1), th('Active', 1), th('Cancelled', 1), th('Attrition %', 1), th('Retention %', 1), th('ARR Attrition %', 1),
            th('Age at renewal', 1, 'Average months as a customer when the renewal was sold'), th('Age today', 1, 'Average months as a customer now (at cancel for cancelled accounts)'))),
          el('tbody', {},
            ...keys.map(k => row(grp === 'year' ? k : 'Renewal - ' + k, groups.get(k))),
            row('All renewals', all, true),
            el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, el('td', { class: 'px-3 pt-3 pb-1 text-[10px] uppercase tracking-widest font-semibold', colspan: '9', style: { color: 'var(--text-subtle)' } }, 'Did not renew · ' + fmt.int(m2mReached) + ' reached contract end · ' + fmt.int(m2mRenewedAway) + ' renewed into a new sub · the rest rode month-to-month')),
            row('Month-to-month', m2m, true)))));
  })();

  // (Renewal Timing card retired per Isaac, Sep 2026.)

  // -- Renewal Outreach queue (per Isaac) -- who to call. Eligible = active,
  // never renewed (source is not Renewal), not Sentricon, real 12/18/24-mo
  // term, and within 2 months of contract end OR already month-to-month.
  // 61-120 days out shows as a planning bucket. Sorted most-overdue first.
  const renewalQueueCard = (() => {
    const MS_D = 86400000;
    const now = new Date();
    const rowsQ = [];
    for (const r of popA) {
      if (!/active/i.test(String(r.subscription_status || ''))) continue;
      if (r.subscription_date_canceled) continue;
      if (/sentricon/i.test(String(r.subscription || ''))) continue;          // never renew Sentricon
      if (reportingSourceClass(r.subscription_source) === 'renewal') continue; // never renew twice
      const m = Number(r.agreement_length) || 0;
      if (m < 12) continue;
      const sd = r.sold_date ? new Date(r.sold_date) : null;
      if (!sd || isNaN(sd)) continue;
      const end = new Date(sd); end.setMonth(end.getMonth() + m);
      const days = Math.round((end - now) / MS_D);   // + = days until term end, - = days past
      if (days > 120) continue;
      rowsQ.push({ r, end, days, bucket: days < 0 ? 'm2m' : days <= 60 ? 'open' : 'soon' });
    }
    if (!rowsQ.length) return null;
    rowsQ.sort((a, b) => a.days - b.days);
    if (!state._rtRenewQ) state._rtRenewQ = { m2m: true, open: true, soon: false };
    const _qf = state._rtRenewQ;
    const shown = rowsQ.filter(x => _qf[x.bucket]);
    const sumArv = (xs) => xs.reduce((t, x) => t + (Number(x.r.annual_recurring_value) || 0), 0);
    const BUCKETS = [
      ['m2m',  'Month-to-month', 'past contract end — renew now', '#DC2626'],
      ['open', 'Window open',    '≤60 days to contract end — eligible', '#DF643A'],
      ['soon', 'Approaching',    '61–120 days out — planning only', 'var(--text-muted)'],
    ];
    const _fmtDt = (d) => (d.getMonth() + 1) + '/' + d.getDate() + '/' + String(d.getFullYear()).slice(2);
    const daysLbl = (x) => x.days < 0
      ? el('span', { class: 'font-bold', style: { color: '#DC2626' } }, 'M2M ' + fmt.int(-x.days) + 'd')
      : el('span', { class: 'font-bold', style: { color: x.days <= 60 ? '#DF643A' : 'var(--text-muted)' } }, 'in ' + fmt.int(x.days) + 'd');
    const thQ = (lab, right) => el('th', { class: (right ? 'text-left' : 'text-left') + ' px-3 py-2 whitespace-nowrap' }, lab);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center justify-between flex-wrap gap-2', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('div', { class: 'font-display text-lg' }, 'Renewal Outreach'),
          el('div', { class: 'text-[11px] text-muted-' },
            'Active accounts at or near contract end · never renewed · no Sentricon · eligible within 60 days of expiry or month-to-month'
            + (office !== 'all' ? ' · ' + officeLabel(office) : '') + '.')),
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          ...BUCKETS.map(([k, lab, desc, color]) => {
            const xs = rowsQ.filter(x => x.bucket === k);
            return el('button', {
              class: 'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 whitespace-nowrap',
              style: _qf[k]
                ? { borderColor: 'var(--accent)', color: 'var(--accent-text)', background: 'var(--accent)' }
                : { borderColor: 'var(--border-2)', color: 'var(--text-muted)', background: 'transparent' },
              title: desc + ' · ' + fmt.usd0(sumArv(xs)) + ' ARR',
              onclick: () => { _qf[k] = !_qf[k]; mountApp(); },
            }, lab + ' · ' + fmt.int(xs.length));
          }),
          el('button', {
            class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer whitespace-nowrap',
            style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
            onclick: () => openReportingDrillModal({
              chartTitle: 'Renewal Outreach queue',
              sliceLabel: fmt.int(shown.length) + ' accounts · ' + fmt.usd0(sumArv(shown)) + ' ARR at stake',
              rows: shown.map(x => x.r), formatValue: (v) => fmt.usd0(v) }),
          }, 'Inspect / export →'))),
      el('div', { class: 'px-4 py-2 text-[11px] text-muted- border-b flex items-center justify-between flex-wrap gap-2', style: { borderColor: 'var(--border)' } },
        el('span', {}, fmt.int(shown.length) + ' in the queue · ' + fmt.usd0(sumArv(shown)) + ' ARR at stake'),
        el('span', {}, 'sorted most overdue first')),
      !shown.length ? el('div', { class: 'p-6 text-center text-xs text-muted-' }, 'Nothing in the selected buckets.') :
      el('div', { class: 'overflow-x-auto', style: { maxHeight: '440px', overflowY: 'auto' } },
        el('table', { class: 'w-full text-xs' },
          el('thead', { class: 'text-[10px] uppercase tracking-wider text-muted-', style: { position: 'sticky', top: 0, zIndex: 1 } }, el('tr', { style: { background: 'var(--card-2)' } },
            thQ('Renewal'), thQ('Customer'), thQ('Phone'), thQ('Office'), thQ('Subscription'), thQ('Source'), thQ('Sold', 1), thQ('Term', 1), thQ('Contract End', 1), thQ('ARV', 1))),
          el('tbody', {}, ...shown.map(x => el('tr', {
            class: 'border-t cursor-pointer transition hover:brightness-95', style: { borderColor: 'var(--border)' },
            onclick: () => openReportingDrillModal({ chartTitle: _custDisplayName(x.r), sliceLabel: 'Renewal ' + (x.days < 0 ? fmt.int(-x.days) + ' days month-to-month' : 'window in ' + fmt.int(x.days) + ' days'), rows: [x.r], formatValue: (v) => fmt.usd0(v) }),
          },
            el('td', { class: 'px-3 py-2 whitespace-nowrap tabular-nums' }, daysLbl(x)),
            el('td', { class: 'px-3 py-2 whitespace-nowrap font-semibold' }, _custDisplayName(x.r),
              el('span', { class: 'text-[10px] font-normal text-muted-' }, x.r.customer_id ? ' #' + x.r.customer_id : '')),
            el('td', { class: 'px-3 py-2 whitespace-nowrap tabular-nums' }, x.r.phone || '—'),
            el('td', { class: 'px-3 py-2 whitespace-nowrap' }, x.r.office_name || '—'),
            el('td', { class: 'px-3 py-2 whitespace-nowrap' }, x.r.subscription || '—'),
            el('td', { class: 'px-3 py-2 whitespace-nowrap' }, x.r.subscription_source || '—'),
            el('td', { class: 'px-3 py-2 text-left whitespace-nowrap tabular-nums' }, x.r.sold_date ? _fmtDt(new Date(x.r.sold_date)) : '—'),
            el('td', { class: 'px-3 py-2 text-left tabular-nums' }, (Number(x.r.agreement_length) || 0) + ' mo'),
            el('td', { class: 'px-3 py-2 text-left whitespace-nowrap tabular-nums font-semibold' }, _fmtDt(x.end)),
            el('td', { class: 'px-3 py-2 text-left tabular-nums' }, fmt.usd0(Number(x.r.annual_recurring_value) || 0))))))));
  })();


  // (Source Quality Ledger folded into Attrition by Source — per Isaac, Sep 2026.)

  // Cancel Hygiene moved to Settings > Admin > Data Integrity (per Isaac).
  // (Renewal Outreach queue retired per Isaac, Sep 2026 — renewalQueueCard stays defined.)
  // The section tabs AND the Office / Metrics bar freeze together under the
  // page header (per Isaac) so both travel down the tab.
  // Attrition Steps is ATTACHED to the Office / Metrics bar (per Isaac): one
  // joined block — tabs, bar, steps header — frozen under the page header.
  // When the steps card is expanded the block stops being sticky (it would
  // be a screen tall), and comes back the moment it is collapsed.
  _profMark('ret:pre-steps');
  const stepsCard = retenMethodCard(popA, _retenEff, groundA, _methodologyInfo);
  _profMark('ret:steps');
  const joined = stepsCard;
  const stepsOpen = state._retenMethodOpen === true;
  // position: sticky cannot work here — <main> is overflow-x:hidden and the
  // content wrapper is overflow-x:auto, so the nearest "scroll container" is
  // a box that never scrolls and the block just sat displaced (overlapping
  // the next card). Same answer as the Indicators toolbar: pin with
  // position: fixed once the block's natural spot scrolls under the page
  // header, and leave a spacer of its height behind so nothing jumps.
  const frozen = el('div', { id: 'retenFrozen', class: 'flex flex-col gap-3', style: { marginTop: '-4px', background: 'var(--bg)', paddingTop: '6px', paddingBottom: '8px' } }, joined);
  const spacer = el('div', { id: 'retenFrozenSpacer', style: { display: 'none' } });
  const _pinTop = () => { try { const h = document.querySelector('header.page-header'); return h ? Math.round(h.getBoundingClientRect().bottom) : 60; } catch (e) { return 60; } };
  const syncPin = () => {
    const f = document.getElementById('retenFrozen'), sp = document.getElementById('retenFrozenSpacer');
    if (!f || !sp || !f.isConnected) return;
    // Phones: the block is a third of the screen — never pin it there.
    const _narrow = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch (e) { return false; } })();
    if (state._retenMethodOpen === true || _narrow) { f.style.position = ''; f.style.top = ''; f.style.left = ''; f.style.width = ''; f.style.zIndex = ''; f.style.paddingTop = '6px'; sp.style.display = 'none'; sp.style.marginTop = ''; return; }
    const pinned = f.style.position === 'fixed';
    const anchor = pinned ? sp : f;
    const natTop = anchor.getBoundingClientRect().top;
    const top = _pinTop();
    if (natTop <= top) {
      if (!pinned) { sp.style.height = f.offsetHeight + 'px'; sp.style.display = 'block'; }
      const r = sp.getBoundingClientRect();
      f.style.position = 'fixed'; f.style.top = top + 'px'; f.style.left = r.left + 'px'; f.style.width = r.width + 'px'; f.style.zIndex = 25;
      f.style.paddingTop = '14px';   // breathing room under the header rule (the tabs were clipping)
      // spacer keeps the block's flow height (marginTop -14 included)
      sp.style.marginTop = '-4px'; sp.style.height = f.offsetHeight + 'px';
    } else if (pinned) {
      f.style.position = ''; f.style.top = ''; f.style.left = ''; f.style.width = ''; f.style.zIndex = ''; f.style.paddingTop = '6px'; sp.style.display = 'none'; sp.style.marginTop = '';
    }
  };
  if (!window._retenPinBound) {
    window._retenPinBound = true;
    window.addEventListener('scroll', () => { try { syncPin(); } catch (e) { /* torn down */ } }, { passive: true });
    window.addEventListener('resize', () => { try { syncPin(); } catch (e) { /* torn down */ } });
  }
  requestAnimationFrame(() => { syncPin(); setTimeout(syncPin, 200); });
  _profMark('ret:pin');
  const attritionByCard = (() => {
    const DIMS = [['source', 'Source'], ['rep', 'Rep'], ['contract', 'Contract Length'], ['type', 'Rep Type']];
    const dim = DIMS.some(d => d[0] === state._rtAttrDim) ? state._rtAttrDim : 'source';
    const card = dim === 'source' ? sourceAttritionCard : _attritionByCard(dim);
    if (!card) return null;
    // Title reads "Attrition Indicators"; the dimension picker sits on the
    // right beside the year picker (per Isaac, Sep 2026). No description line.
    const title = card.querySelector('.font-display');
    if (title) title.textContent = 'Attrition Indicators';
    const dimSel = el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { state._rtAttrDim = e.target.value; mountApp(); },
    }, ...DIMS.map(([v, l]) => el('option', { value: v, selected: dim === v }, l)));
    const right = title && title.parentElement && title.parentElement.nextElementSibling;
    if (right && right.classList.contains('flex')) right.prepend(dimSel); else if (title) title.after(dimSel);
    return card;
  })();
  // Contract Length (12 vs 18 vs 24) rides at the bottom of Retention now
  // (per Isaac, Sep 23) instead of being its own section.
  let contractLen = null;
  try { contractLen = reportingContractLength(); } catch (e) { console.warn('[retention] contract length card skipped', e); }
  return el('div', { class: 'flex flex-col gap-4' }, spacer, frozen, body, _shell('Attrition Indicators', attritionByCard), _shell('Renewal Retention', renewalRetentionCard), contractLen);   // (True Attrition bar + "Who produces the customers that leave" retired per Isaac, Sep 2026)
}

