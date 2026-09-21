// ┌─ src/85-exceptions.js ───────────────────────────────────────────────────────
// │ Manager exception feed (AUDIT P3-3): one card, the handful of things that
// │ need a manager's eyes today, each row deep-linking to the page that
// │ explains it. Read-only — it derives from data other cards already show.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────

// Who gets the feed (per Isaac, Sep 2026): the Admin - Owner only, on the
// Reporting tab. Nobody else sees these notifications.
function exceptionFeedScope() {
  if (typeof isOwnerUser === 'function' && isOwnerUser()) return { kind: 'all', teams: null };
  return null;
}

// Build the items. Pure over state; cheap enough to run on every mount
// (a few passes over the raw sales + subscription arrays).
function exceptionFeedItems(scope) {
  const items = [];
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const back = (n) => { const d = new Date(today); d.setDate(d.getDate() - n); return iso(d); };
  const todayIso = iso(today), d3 = back(2), d7 = back(6), d14 = back(13), d30 = back(29), d35 = back(34);
  const teamOf = (name) => (typeof getRepTeam === 'function' && getRepTeam(name)) || '';
  const inScopeTeam = (t) => !scope.teams || scope.teams.has(t);
  const _adm = isAdminRole(state.profile?.role);
  const go = (view, patch, sub) => () => {
    // Reporting is admin-only (ADMIN_ONLY_VIEWS); leads and partners get
    // the closest page they can open instead of a bounce.
    if (view === 'reporting' && !_adm) { view = 'indicators'; sub = null; }
    Object.assign(state, patch || {});
    if (sub) state.reportingSubTab = sub;
    state.view = view;
    try { history.replaceState(null, '', VIEW_TO_HASH[view] || '#' + view); } catch (e) { /* noop */ }
    mountApp();
    try { window.scrollTo({ top: 0 }); } catch (e) { /* noop */ }
  };

  // Which checks feed the card (per Isaac, Sep 2026): quiet reps, failed
  // audits and aging pending are retired — the card is being repurposed on
  // the Marketing tab. Data health and attrition spikes stay for now.
  const ON = new Set(['data', 'attrition']);
  // 1. Data health — anything a sync reported broken in the last 3 hours.
  const bad = (typeof healthWorst === 'function') ? healthWorst() : [];
  if (ON.has('data')) for (const h of bad) items.push({ sev: 'red', tag: 'Data', text: h.label + ': ' + (h.msg || 'not healthy'), action: 'Details', onClick: () => openHealthSheet() });

  // 2. Quiet reps — D2D reps who sold in the last 14 days but nothing in
  // the last 3 (today + 2 prior). Active reps who went silent, not the
  // whole roster.
  if (ON.has('reps')) {
    // Office leads get the same test over Office Staff sellers; D2D scopes
    // over Sales Reps.
    const wantDept = scope.kind === 'office' ? 'office' : 'd2d';
    const raw = state._indicatorRawSales || [];
    const byRep = new Map();
    for (const s of raw) {
      if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== wantDept) continue;
      const dt = (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '';
      if (!dt || dt < d14 || dt > todayIso) continue;
      const nm = (typeof getCanonicalRepName === 'function' ? getCanonicalRepName(s.rep) : s.rep) || '';
      if (!nm) continue;
      const t = teamOf(nm); if (wantDept === 'd2d' && !inScopeTeam(t)) continue;
      const g = byRep.get(nm) || { n14: 0, n3: 0, team: wantDept === 'd2d' ? t : '' };
      g.n14++; if (dt >= d3) g.n3++;
      byRep.set(nm, g);
    }
    const quiet = [...byRep.entries()].filter(([, g]) => g.n14 >= 2 && g.n3 === 0).sort((a, b) => b[1].n14 - a[1].n14);
    if (quiet.length) {
      const names = quiet.slice(0, 6).map(([n, g]) => (typeof flipLastFirst === 'function' ? flipLastFirst(n) : n) + (g.team ? ' (' + g.team + ')' : ''));
      items.push({ sev: 'amber', tag: 'Reps', text: quiet.length + ' rep' + (quiet.length === 1 ? '' : 's') + ' with no sale in 3 days: ' + names.join(', ') + (quiet.length > 6 ? ' +' + (quiet.length - 6) + ' more' : ''),
        action: 'Leaderboard', onClick: go('indicators') });
    }
  }

  // 3–5 need the reporting snapshot.
  const subs = state.reportingSubscriptions || [];
  if (subs.length) {
    const rf = (typeof reportingFilters === 'function') ? reportingFilters() : null;
    const isReal = rf && rf.isRealCancel ? rf.isRealCancel : () => true;
    const arr = (r) => Number(r.annual_recurring_value) || 0;
    const repOf = (r) => (typeof getCanonicalRepName === 'function' ? getCanonicalRepName((r.sold_by || '').trim()) : r.sold_by) || '';
    const rowIn = (r) => scope.kind === 'teams' ? inScopeTeam(teamOf(repOf(r))) : true;
    const groupOf = (r) => scope.kind === 'teams' ? (teamOf(repOf(r)) || 'No team') : ((r.office_name || '').trim() || 'Unassigned');

    // 3. Attrition spike — churned ARR in the last 7 days vs the average of
    // the 4 weeks before, per team (partners) or office (admins).
    const cur = new Map(), prev = new Map();
    for (const r of subs) {
      const cd = String(r.subscription_date_canceled || '').slice(0, 10);
      if (!cd || cd < d35 || cd > todayIso || !isReal(r) || !rowIn(r)) continue;
      const k = groupOf(r), m = cd >= d7 ? cur : prev;
      m.set(k, (m.get(k) || 0) + arr(r));
    }
    const spikes = [];
    for (const [k, v] of cur) { const base = (prev.get(k) || 0) / 4; if (v >= 500 && v > base * 1.5) spikes.push([k, v, base]); }
    spikes.sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]));
    for (const [k, v, base] of spikes.slice(0, 4)) {
      items.push({ sev: 'red', tag: 'Attrition', text: k + ': ' + fmt.usd0(v) + ' ARR churned in 7 days' + (base ? ' vs ' + fmt.usd0(base) + '/wk average' : ' (none in the prior 4 weeks)'),
        action: _adm ? 'Daily Pulse' : 'Indicators', onClick: go('reporting', { _rtPulseSpan: 7 }, 'overview') });
    }

    // 4. Failed audits in the last 30 days (D2D), by rep.
    const failed = new Map();
    if (ON.has('audits')) for (const r of subs) {
      if ((r.subscription_source || '').trim() !== 'Door to Door') continue;
      if (typeof _auditStatusOf !== 'function' || _auditStatusOf(r.customer_flags) !== 'failed') continue;
      const sd = String(r.sold_date || '').slice(0, 10);
      if (!sd || sd < d30 || !rowIn(r)) continue;
      const nm = repOf(r) || 'Unknown';
      failed.set(nm, (failed.get(nm) || 0) + 1);
    }
    if (failed.size) {
      const list = [...failed.entries()].sort((a, b) => b[1] - a[1]);
      const n = list.reduce((a, [, c]) => a + c, 0);
      items.push({ sev: 'amber', tag: 'Audits', text: n + ' failed audit' + (n === 1 ? '' : 's') + ' in 30 days: ' + list.slice(0, 5).map(([k, c]) => (typeof flipLastFirst === 'function' ? flipLastFirst(k) : k) + ' (' + c + ')').join(', ') + (list.length > 5 ? ' +' + (list.length - 5) + ' more' : ''),
        action: _adm ? 'Auditing' : 'Sales queue', onClick: _adm ? go('reporting', null, 'auditing') : go(scope.kind === 'office' ? 'sales' : 'd2d_sales', { _salesQueueFilter: 'backend' }) });
    }

    // 5. Aging pending — sold 14+ days ago, never serviced, not cancelled.
    let aging = 0, agingArr = 0;
    if (ON.has('pending')) for (const r of subs) {
      if (r.subscription_date_canceled) continue;
      const sd = String(r.sold_date || '').slice(0, 10);
      if (!sd || sd > d14) continue;
      const done = String(r.initial_status || '').toLowerCase() === 'completed' || !!r.initial_serviced_date;
      if (done) continue;
      const st = String(r.subscription_status || '').toLowerCase();
      if (st && st !== 'active' && st !== 'pending') continue;
      if (!rowIn(r)) continue;
      aging++; agingArr += arr(r);
    }
    if (aging) items.push({ sev: 'amber', tag: 'Pending', text: aging + ' account' + (aging === 1 ? '' : 's') + ' sold 14+ days ago still waiting on the first service (' + fmt.usd0(agingArr) + ' ARR)',
      action: _adm ? 'Retention' : 'Indicators', onClick: go('reporting', null, 'waterfall') });
  }
  return items;
}

// The card. Collapsed to one line by default (per the product constraint —
// it must not push the dashboard down); tap to expand. Remembers the
// choice for the session.
function exceptionFeedCard() {
  const scope = exceptionFeedScope();
  if (!scope) return null;
  let items;
  try { items = exceptionFeedItems(scope); } catch (e) { console.warn('exception feed', e); return null; }
  const open = state._excOpen === true;
  const reds = items.filter(i => i.sev === 'red').length;
  const head = el('button', { class: 'w-full flex items-center gap-2 px-4 py-2.5 text-left', onclick: () => { state._excOpen = !open; mountApp(); } },
    el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: !items.length ? 'var(--ok)' : reds ? '#DC2626' : '#D97706' } }),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'Needs attention'),
    el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, !items.length ? 'Nothing flagged — data feeds and attrition look normal.' : items.length + ' item' + (items.length === 1 ? '' : 's') + (open ? '' : ' · ' + items.slice(0, 2).map(i => i.tag).join(', ') + (items.length > 2 ? '…' : ''))),
    el('span', { class: 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, open ? '▴' : '▾'));
  const rows = open && items.length ? el('div', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...items.map(i => el('div', { class: 'flex items-start gap-3 px-4 py-2 border-t text-xs', style: { borderColor: 'var(--border)' } },
    el('span', { class: 'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5', style: { background: i.sev === 'red' ? 'rgba(220,38,38,.12)' : 'rgba(217,119,6,.14)', color: i.sev === 'red' ? '#DC2626' : '#B45309', minWidth: '58px', textAlign: 'center' } }, i.tag),
    el('span', { class: 'flex-1 min-w-0', style: { overflowWrap: 'anywhere' } }, i.text),
    el('button', { class: 'text-[11px] font-bold whitespace-nowrap shrink-0', style: { color: 'var(--accent)' }, onclick: i.onClick }, i.action + ' →')))) : null;
  return el('div', { class: 'card overflow-hidden' }, head, rows);
}

// ── Rep "today" strip (AUDIT P3-4) ────────────────────────────────────────
// One thin row of chips above a rep's landing page: what's actionable for
// THEM today — competitions running now, sales the auditor bounced back,
// open shifts up for grabs. Nothing to show → nothing rendered.
function repTodayStrip() {
  const me = state.profile; if (!me) return null;
  const r = me.role;
  if (isAdminRole(r) || (typeof isAuditorRole === 'function' && isAuditorRole(r))) return null;
  const grp = (typeof repTypeGroup === 'function') ? repTypeGroup(me) : 'd2d';
  const chips = [];
  const go = (view, patch) => () => { Object.assign(state, patch || {}); state.view = view; try { history.replaceState(null, '', VIEW_TO_HASH[view] || '#' + view); } catch (e) { /* noop */ } mountApp(); };
  const fmtD = fmt.dateMed;
  // Competitions running now for my rep type.
  try {
    const want = grp === 'office' ? 'Office Staff' : grp === 'tech' ? 'Technicians' : 'Sales Reps';
    const sc = compScheduleStore();
    for (const c of compScheduleList()) {
      if (((sc[c.id] && sc[c.id].group) || c.group) !== want) continue;
      const occ = compRunningNow(c.id); if (!occ) continue;
      const name = (sc[c.id] && sc[c.id].name) || c.name;
      const daysLeft = Math.max(0, Math.round((occ.end - new Date().setHours(12, 0, 0, 0)) / 86400000));
      chips.push({ icon: '🏆', text: name + ' · ' + (daysLeft === 0 ? 'ends today' : daysLeft === 1 ? 'ends tomorrow' : 'ends ' + fmtD(occ.end)), onClick: go('nrla', { _compsLanding: false, _compsTabSel: c.id, _compsRepTypeTab: want }) });
    }
  } catch (e) { /* schedule not loaded yet */ }
  // Sales bounced back by the auditor (below minimums / NSF) — mine only.
  try {
    const mine = (state.mySales || []).filter(s => s.rep_id === me.id && (s.audit_status === 'below_minimums' || s.audit_status === 'nsf') && !s.payroll_processed_at);
    if (mine.length) chips.push({ icon: '⚠️', text: mine.length + ' sale' + (mine.length === 1 ? '' : 's') + ' need' + (mine.length === 1 ? 's' : '') + ' a fix (' + [...new Set(mine.map(s => s.audit_status === 'nsf' ? 'NSF' : 'below minimums'))].join(', ') + ')', onClick: go(grp === 'tech' ? 'tech_sales' : grp === 'd2d' ? 'd2d_sales' : 'sales', { _salesQueueFilter: 'upfront' }) });
  } catch (e) { /* noop */ }
  // Open shifts up for grabs (inside sales calendar).
  if (grp === 'office') {
    try {
      const open = (state.shiftSwapRequests || []).filter(x => typeof isOpenReq === 'function' && isOpenReq(x) && x.from_rep_id !== me.id);
      if (open.length) chips.push({ icon: '📅', text: open.length + ' open shift' + (open.length === 1 ? '' : 's') + ' up for grabs', onClick: go('calendar') });
    } catch (e) { /* noop */ }
  }
  if (!chips.length) return null;
  return el('div', { class: 'flex items-center gap-2 flex-wrap' },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Today'),
    ...chips.map(c => el('button', {
      class: 'rounded-full border px-3 py-1 text-[11px] font-semibold transition hover:brightness-95 text-left',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '100%' },
      onclick: c.onClick,
    }, c.icon + ' ' + c.text + ' →')));
}

// ── Save-attempt loop (AUDIT P3-5) ────────────────────────────────────────
// Off the Daily Pulse churn list: log who called a cancelled account and
// what happened. Rows live in public.save_attempts (append-only; see
// migrations/20260920_save_attempts.sql). Cached per session by customer #.
const SAVE_OUTCOMES = [['saved', 'Saved'], ['callback', 'Call back'], ['no_answer', 'No answer'], ['declined', 'Declined'], ['other', 'Other']];
function saveAttemptsFor(customerIds) {
  // Returns a Map customer_id → [attempts…] from the cache; kicks a fetch
  // for ids not yet loaded and re-renders via the callback when it lands.
  state._saveAttempts = state._saveAttempts || new Map();
  const ids = [...new Set(customerIds.map(String).filter(Boolean))];
  const missing = ids.filter(id => !state._saveAttempts.has(id));
  const out = new Map(ids.map(id => [id, state._saveAttempts.get(id) || []]));
  if (missing.length && typeof supabase !== 'undefined' && supabase && !(typeof DEMO !== 'undefined' && DEMO)) {
    missing.forEach(id => state._saveAttempts.set(id, []));   // mark in flight
    const chunks = []; for (let i = 0; i < missing.length; i += 200) chunks.push(missing.slice(i, i + 200));
    Promise.all(chunks.map(c => supabase.from('save_attempts').select('*').in('customer_id', c).order('attempted_at', { ascending: false })))
      .then(results => {
        let any = false;
        for (const { data, error } of results) {
          if (error) { console.warn('save attempts load failed:', error.message); continue; }
          for (const row of (data || [])) { const k = String(row.customer_id); state._saveAttempts.set(k, [...(state._saveAttempts.get(k) || []), row]); any = true; }
        }
        if (any && typeof state._saveAttemptsOnLoad === 'function') state._saveAttemptsOnLoad();
      });
  }
  return out;
}
function saveAttemptChip(customerId) {
  const list = (state._saveAttempts && state._saveAttempts.get(String(customerId))) || [];
  if (!list.length) return null;
  const last = list[0];
  const lbl = (SAVE_OUTCOMES.find(([v]) => v === last.outcome) || [])[1] || last.outcome;
  const who = ((state.allProfiles || []).find(p => p.id === last.attempted_by) || {}).full_name || '';
  const saved = last.outcome === 'saved';
  return el('span', { class: 'inline-block text-[9px] font-bold px-1.5 py-0.5 rounded whitespace-nowrap', style: { background: saved ? 'rgba(22,163,74,.14)' : 'var(--card-2)', color: saved ? 'var(--ok)' : 'var(--text-muted)' },
    title: list.length + ' attempt' + (list.length === 1 ? '' : 's') + (who ? ' · last by ' + who : '') + (last.note ? ' · ' + last.note : '') }, lbl + (list.length > 1 ? ' ×' + list.length : ''));
}
function openSaveAttemptModal(r, onDone) {
  const _openedAt = performance.now(); let _done = false;
  if (typeof trackModal === 'function') trackModal('save_attempt', 'open');
  const overlay = el('div', { class: 'modal-overlay' });
  const _close = () => { overlay.remove(); if (!_done && typeof trackModal === 'function') { _done = true; trackModal('save_attempt', 'dismiss', _openedAt); } };
  overlay.addEventListener('click', (e) => { if (e.target === overlay) _close(); });
  const name = [(r.first_name || '').trim(), (r.last_name || '').trim()].filter(Boolean).join(' ') || ('Customer #' + r.customer_id);
  const prior = (state._saveAttempts && state._saveAttempts.get(String(r.customer_id))) || [];
  let outcome = 'callback';
  const noteEl = el('textarea', { class: 'w-full rounded-lg border px-2.5 py-1.5 text-xs', rows: '3', placeholder: 'What happened on the call? (optional)', style: { borderColor: 'var(--border-2)', background: 'var(--card)' } });
  const pills = el('div', { class: 'flex gap-1.5 flex-wrap' });
  const drawPills = () => pills.replaceChildren(...SAVE_OUTCOMES.map(([v, l]) => el('button', {
    class: 'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition',
    style: v === outcome ? { background: 'var(--text)', color: 'var(--bg)', borderColor: 'var(--text)' } : { borderColor: 'var(--border-2)' },
    onclick: () => { outcome = v; drawPills(); } }, l)));
  drawPills();
  const submit = async () => {
    const row = { customer_id: String(r.customer_id || ''), subscription_id: r.subscription_id != null ? String(r.subscription_id) : null, office_name: (r.office_name || '').trim() || null,
      cancel_date: String(r.subscription_date_canceled || '').slice(0, 10) || null, outcome, note: noteEl.value.trim() || null, attempted_by: state.profile?.id };
    if (!row.customer_id) { toast('No customer # on this row', 'error'); return; }
    if (typeof supabase === 'undefined' || !supabase || (typeof DEMO !== 'undefined' && DEMO)) { toast('Not connected — attempt not saved', 'error'); return; }
    const { data, error } = await supabase.from('save_attempts').insert(row).select().maybeSingle();
    if (error) { toast('Could not save: ' + error.message, 'error'); return; }
    state._saveAttempts = state._saveAttempts || new Map();
    state._saveAttempts.set(row.customer_id, [data || { ...row, attempted_at: new Date().toISOString() }, ...prior]);
    overlay.remove();
    if (!_done && typeof trackModal === 'function') { _done = true; trackModal('save_attempt', 'done', _openedAt); }
    toast('Save attempt logged', 'success');
    if (typeof onDone === 'function') onDone();
  };
  const fmtWhen = (iso) => { try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); } catch (e) { return ''; } };
  overlay.append(el('div', { class: 'card p-5 flex flex-col gap-3', style: { width: 'min(460px, 94vw)', maxHeight: '88vh', overflowY: 'auto', overflowX: 'hidden' } },
    el('div', { class: 'flex items-start justify-between gap-3' },
      el('div', {}, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Save attempt'),
        el('div', { class: 'text-base font-black' }, name),
        el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, [String(r.subscription || '').trim(), (r.office_name || '').trim(), r.customer_id ? '#' + r.customer_id : ''].filter(Boolean).join(' · '))),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: _close }, '×')),
    (typeof reportingCancelReasonOf === 'function' && reportingCancelReasonOf(r)) ? el('div', { class: 'text-xs' }, el('span', { style: { color: 'var(--text-muted)' } }, 'Cancel reason: '), reportingCancelReasonOf(r)) : null,
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Outcome'),
    pills, noteEl,
    el('button', { class: 'rounded-lg px-3 py-2 text-xs font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: submit }, 'Log attempt'),
    prior.length ? el('div', { class: 'border-t pt-2 flex flex-col gap-1', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Earlier attempts'),
      ...prior.map(a => el('div', { class: 'text-[11px]', style: { overflowWrap: 'anywhere' } },
        el('b', {}, (SAVE_OUTCOMES.find(([v]) => v === a.outcome) || [])[1] || a.outcome), ' · ' + fmtWhen(a.attempted_at) + ' · ' + (((state.allProfiles || []).find(p => p.id === a.attempted_by) || {}).full_name || 'someone') + (a.note ? ' — ' + a.note : '')))) : null));
  document.body.append(overlay);
}
