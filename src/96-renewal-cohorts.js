// ┌─ src/96-renewal-cohorts.js ───────────────────────────────────────────────
// │ Retention → "Renewals by cohort" (per Isaac, Oct 13): of the customers
// │ still with us from each start year, how many have renewed, and how many
// │ are under contract today versus month-to-month. Customer level — every
// │ subscription linked by customer_id (semCustomerLives), Sentricon left out.
// │   Renewed  = any Renewal-source plan, a plan the app chained as a renewal,
// │              or a renewal sold under the wrong source (renewalMisSourcedRows)
// │   Under contract = an active plan whose agreement (signed date, else first
// │              service, + its length) has not ended yet
// │   Month-to-month = active, but no plan still inside its agreement
// │   No contract = every active plan is set up with NO agreement (length 0)
// │              in FieldRoutes — on purpose (per Isaac, Oct 14), so pulled
// │              out of month-to-month rather than read as a lapsed renewal
// └────────────────────────────────────────────────────────────────────────
function retenRenewalCohortCard(pop) {
  if (!Array.isArray(pop) || !pop.length || typeof semCustomerLives !== 'function') return null;
  const nowMs = Date.now();
  const sent = (r) => /sentricon/i.test(String(r.subscription || ''));
  const lives = semCustomerLives(pop, { include: (r) => !sent(r) && !/one[\s-]?time/i.test(String(r.subscription || '')) });
  const misIds = new Set((typeof renewalMisSourcedRows === 'function' ? renewalMisSourcedRows(pop) : []).map(m => String(m.id)));
  const isActive = (r) => /active/i.test(String(r.subscription_status || '')) && !r.subscription_date_canceled;
  const termEnd = (r) => { const len = Number(r.agreement_length) || 0; if (len <= 1) return null; const d = new Date(String(r.contract_signed_at || r.initial_service || r.sold_date || '').slice(0, 10) + 'T00:00'); if (isNaN(d)) return null; d.setMonth(d.getMonth() + len); return d.getTime(); };
  const noContract = (r) => r.agreement_length != null && r.agreement_length !== '' && Number(r.agreement_length) === 0;
  const KEYS = ['first', 'renCon', 'renM2M', 'm2m', 'none'];
  const LABEL = { first: 'On first contract', renCon: 'Renewed · under contract', renM2M: 'Renewed · now month-to-month', m2m: 'Month-to-month · never renewed', none: 'No contract (by design)' };
  const COLOR = { first: 'var(--text)', renCon: '#15803D', renM2M: '#B45309', m2m: '#DC2626', none: '#6B7280' };
  const by = new Map();
  for (const c of lives.values()) {
    if (!c.alive || c.start == null) continue;
    const yr = new Date(c.start).getFullYear(); if (!(yr > 2000)) continue;
    const renewed = !!c.firstRenewal || misIds.has(c.id) || c.subs.some(r => r.renewed_into || r.is_renewal_cont);
    const act = c.subs.filter(isActive);
    const under = act.some(r => { const e = termEnd(r); return e != null && e > nowMs; });
    const firstEnded = c.firstContract ? c.firstContract.end <= nowMs : true;
    const k = under ? (renewed ? 'renCon' : 'first') : (act.length && act.every(noContract)) ? 'none' : (renewed ? 'renM2M' : 'm2m');
    const g = by.get(yr) || (by.set(yr, { yr, n: 0, past: 0, pastRen: 0, rows: { first: [], renCon: [], renM2M: [], m2m: [], none: [] }, cnt: { first: 0, renCon: 0, renM2M: 0, m2m: 0, none: 0 } }).get(yr));
    g.n++; g.cnt[k]++; for (const r of (act.length ? act : c.subs)) g.rows[k].push(r);
    if (firstEnded) { g.past++; if (renewed) g.pastRen++; }
  }
  const years = [...by.values()].sort((a, b) => a.yr - b.yr);
  if (!years.length) return null;
  const tot = { yr: 'All', n: 0, past: 0, pastRen: 0, cnt: { first: 0, renCon: 0, renM2M: 0, m2m: 0, none: 0 }, rows: { first: [], renCon: [], renM2M: [], m2m: [], none: [] } };
  years.forEach(g => { tot.n += g.n; tot.past += g.past; tot.pastRen += g.pastRen; KEYS.forEach(k => { tot.cnt[k] += g.cnt[k]; for (const r of g.rows[k]) tot.rows[k].push(r); /* loop, not push(...rows): Safari overflows the call stack */ }); });
  const pct = (a, d) => d ? (a / d * 100).toFixed(1) + '%' : '—';
  const n = (v) => Number(v || 0).toLocaleString();
  const drill = (title, rows) => rows && rows.length ? () => openReportingDrillModal({ chartTitle: 'Renewals by cohort · ' + title, sliceLabel: n(rows.length) + ' subscriptions', rows, formatValue: fmt.usd0 }) : null;
  const bar = (g) => el('div', { style: { display: 'flex', height: '8px', borderRadius: '4px', overflow: 'hidden', minWidth: '120px', background: 'var(--card-2)' } },
    ...KEYS.map(k => el('div', { title: LABEL[k] + ' ' + pct(g.cnt[k], g.n), style: { width: (g.n ? g.cnt[k] / g.n * 100 : 0) + '%', background: k === 'first' ? '#9CA3AF' : k === 'none' ? '#CBD5E1' : COLOR[k] } })));
  const td = (v, sty, fn) => el('td', { class: 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap' + (fn ? ' cursor-pointer hover:underline' : ''), style: sty || {}, onclick: fn || null, title: fn ? 'Click for the accounts' : '' }, v);
  const row = (g, isTot) => el('tr', { class: 'border-t', style: { borderColor: isTot ? 'var(--border-2)' : 'var(--border)', fontWeight: isTot ? '700' : '' } },
    el('td', { class: 'px-2 py-1.5 font-semibold' }, String(g.yr)),
    td(n(g.n)),
    ...KEYS.map(k => td(el('span', {}, n(g.cnt[k]), el('span', { style: { color: 'var(--text-muted)', fontWeight: '400' } }, ' · ' + pct(g.cnt[k], g.n))), { color: COLOR[k] }, drill(g.yr + ' · ' + LABEL[k], g.rows[k]))),
    td(pct(g.cnt.first + g.cnt.renCon, g.n), { fontWeight: '700' }),
    td(pct(g.cnt.renCon + g.cnt.renM2M, g.n)),
    td(g.past ? pct(g.pastRen, g.past) : '—', { color: 'var(--text-muted)' }),
    el('td', { class: 'px-2 py-1.5' }, bar(g)));
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, '🔁 Renewals by cohort'),
      el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Customers still active today, by the year they started (first service). Under contract = an active plan still inside its agreement; month-to-month = active with no agreement running. No contract = every active plan is set up in FieldRoutes with no agreement (length 0) — done on purpose, so they are pulled out of month-to-month. Renewed = they have bought a renewal (Renewal source, a chained renewal, or one sold under the wrong source). Sentricon and one-time services left out. Click a number for the accounts.')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[12px]' },
      el('thead', { class: 'text-[9px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } }, el('tr', {},
        el('th', { class: 'px-2 py-1.5 text-left font-semibold' }, 'Cohort'),
        el('th', { class: 'px-2 py-1.5 text-right font-semibold' }, 'Active customers'),
        ...KEYS.map(k => el('th', { class: 'px-2 py-1.5 text-right font-semibold' }, LABEL[k])),
        el('th', { class: 'px-2 py-1.5 text-right font-semibold' }, 'Under contract'),
        el('th', { class: 'px-2 py-1.5 text-right font-semibold' }, 'Renewed'),
        el('th', { class: 'px-2 py-1.5 text-right font-semibold', title: 'Of the active customers whose first contract has ended, the share who renewed' }, 'Renewed · past 1st term'),
        el('th', {}))),
      el('tbody', {}, ...years.map(g => row(g, false)), row(tot, true)))));
}
