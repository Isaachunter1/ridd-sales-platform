// ┌─ src/85-exceptions.js ───────────────────────────────────────────────────────
// │ Manager exception feed (AUDIT P3-3): one card, the handful of things that
// │ need a manager's eyes today, each row deep-linking to the page that
// │ explains it. Read-only — it derives from data other cards already show.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────

// Who gets the feed: admins (whole company), partners / team leads (their
// teams), office leads (their office). Everyone else → null (no card).
function exceptionFeedScope() {
  const r = state.profile?.role;
  if (isAdminRole(r)) return { kind: 'all', teams: null };
  if (typeof isPartnerRole === 'function' && isPartnerRole(r) && typeof myReachTeams === 'function') {
    const t = myReachTeams(); return t && t.size ? { kind: 'teams', teams: t } : null;
  }
  if (typeof isOfficeLeadRole === 'function' && isOfficeLeadRole(r)) return { kind: 'office', teams: null };
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
  const go = (view, patch, sub) => () => {
    Object.assign(state, patch || {});
    if (sub) state.reportingSubTab = sub;
    state.view = view;
    try { history.replaceState(null, '', VIEW_TO_HASH[view] || '#' + view); } catch (e) { /* noop */ }
    mountApp();
    try { window.scrollTo({ top: 0 }); } catch (e) { /* noop */ }
  };

  // 1. Data health — anything a sync reported broken in the last 3 hours.
  const bad = (typeof healthWorst === 'function') ? healthWorst() : [];
  for (const h of bad) items.push({ sev: 'red', tag: 'Data', text: h.label + ': ' + (h.msg || 'not healthy'), action: 'Details', onClick: () => openHealthSheet() });

  // 2. Quiet reps — D2D reps who sold in the last 14 days but nothing in
  // the last 3 (today + 2 prior). Active reps who went silent, not the
  // whole roster.
  if (scope.kind !== 'office') {
    const raw = state._indicatorRawSales || [];
    const byRep = new Map();
    for (const s of raw) {
      if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
      const dt = (typeof dateSoldToIso === 'function' && dateSoldToIso(s.dateSold)) || '';
      if (!dt || dt < d14 || dt > todayIso) continue;
      const nm = (typeof getCanonicalRepName === 'function' ? getCanonicalRepName(s.rep) : s.rep) || '';
      if (!nm) continue;
      const t = teamOf(nm); if (!inScopeTeam(t)) continue;
      const g = byRep.get(nm) || { n14: 0, n3: 0, team: t };
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
        action: 'Daily Pulse', onClick: go('reporting', { _rtPulseSpan: 7 }, 'overview') });
    }

    // 4. Failed audits in the last 30 days (D2D), by rep.
    const failed = new Map();
    for (const r of subs) {
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
        action: 'Auditing', onClick: go('reporting', null, 'auditing') });
    }

    // 5. Aging pending — sold 14+ days ago, never serviced, not cancelled.
    let aging = 0, agingArr = 0;
    for (const r of subs) {
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
      action: 'Retention', onClick: go('reporting', null, 'waterfall') });
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
    el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: !items.length ? '#16A34A' : reds ? '#DC2626' : '#D97706' } }),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'Needs attention'),
    el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, !items.length ? 'Nothing flagged — data, reps, attrition, audits and pending accounts all look normal.' : items.length + ' item' + (items.length === 1 ? '' : 's') + (open ? '' : ' · ' + items.slice(0, 2).map(i => i.tag).join(', ') + (items.length > 2 ? '…' : ''))),
    el('span', { class: 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, open ? '▴' : '▾'));
  const rows = open && items.length ? el('div', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...items.map(i => el('div', { class: 'flex items-start gap-3 px-4 py-2 border-t text-xs', style: { borderColor: 'var(--border)' } },
    el('span', { class: 'text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded shrink-0 mt-0.5', style: { background: i.sev === 'red' ? 'rgba(220,38,38,.12)' : 'rgba(217,119,6,.14)', color: i.sev === 'red' ? '#DC2626' : '#B45309', minWidth: '58px', textAlign: 'center' } }, i.tag),
    el('span', { class: 'flex-1 min-w-0', style: { overflowWrap: 'anywhere' } }, i.text),
    el('button', { class: 'text-[11px] font-bold whitespace-nowrap shrink-0', style: { color: 'var(--accent)' }, onclick: i.onClick }, i.action + ' →')))) : null;
  return el('div', { class: 'card overflow-hidden' }, head, rows);
}
