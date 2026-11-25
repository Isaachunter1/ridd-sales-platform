// ┌─ reporting/collections.js ────────────────────────────────────────────────
// │ Reporting → Collections (per Isaac, Nov 25 2026): customers with a balance
// │ past due, in buckets by how long it has been owed —
// │   1–7 · 8–14 · 15–30 · 31–60 · 61–90 · 91–120 · 120+ days.
// │ One row per CUSTOMER (FieldRoutes carries the balance and its age on the
// │ customer, so a customer with three plans is still one account owing one
// │ balance). Counted: a responsible balance above $0 and at least 1 day past
// │ due, from the same FieldRoutes snapshot the rest of Reporting reads.
// │ A customer's office is the office of their plan; with plans in two
// │ offices, the first one found. Nothing here is estimated.
// └──────────────────────────────────────────────────────────────────────────
const COLLECTION_BUCKETS = [
  { k: 'b1', t: '1–7', lo: 1, hi: 7 }, { k: 'b2', t: '8–14', lo: 8, hi: 14 }, { k: 'b3', t: '15–30', lo: 15, hi: 30 },
  { k: 'b4', t: '31–60', lo: 31, hi: 60 }, { k: 'b5', t: '61–90', lo: 61, hi: 90 }, { k: 'b6', t: '91–120', lo: 91, hi: 120 },
  { k: 'b7', t: '120+', lo: 121, hi: Infinity }];
function _collectionsCustomers() {
  const rows = state.reportingSubscriptions || [];
  if (_collectionsCustomers._m && _collectionsCustomers._m.src === rows) return _collectionsCustomers._m.v;
  const by = new Map();
  for (const r of rows) {
    const id = String(r.customer_id == null ? '' : r.customer_id); if (!id) continue;
    const days = Number(r.days_past_due) || 0, bal = Number(r.responsible_balance) || 0;
    const active = /active/i.test(String(r.subscription_status || '')) && !r.subscription_date_canceled;
    let c = by.get(id);
    if (!c) { c = { id, row: r, days: 0, bal: 0, active: false, office: String(r.office_name || '').trim() || 'No office', plans: 0 }; by.set(id, c); }
    c.plans++; if (days > c.days) c.days = days; if (bal > c.bal) c.bal = bal; if (active) { c.active = true; c.row = r; }
  }
  const v = [...by.values()].filter(c => c.days >= 1 && c.bal > 0);
  for (const c of v) c.bucket = (COLLECTION_BUCKETS.find(b => c.days >= b.lo && c.days <= b.hi) || COLLECTION_BUCKETS[COLLECTION_BUCKETS.length - 1]).k;
  _collectionsCustomers._m = { src: rows, v };
  return v;
}
function reportingCollectionsView() {
  const muted = { color: 'var(--text-muted)' };
  if (!(state.reportingSubscriptions || []).length) return el('div', { class: 'card p-6 text-sm flex items-center gap-2', style: muted }, el('span', { class: 'spinner', style: { width: '14px', height: '14px' } }), 'Loading accounts from FieldRoutes…');
  const S = state._collections || (state._collections = { who: 'all', show: 'cust' });
  const all = _collectionsCustomers();
  const list = S.who === 'active' ? all.filter(c => c.active) : S.who === 'cancelled' ? all.filter(c => !c.active) : all;
  const usd = (v) => fmt.usd0(v || 0), int = (v) => fmt.int(v || 0);
  const tc = (o) => typeof _titleCaseWords === 'function' ? _titleCaseWords(o) : o;
  const sumBal = (a) => a.reduce((t, c) => t + c.bal, 0);
  const inB = (a, k) => a.filter(c => c.bucket === k);
  const open = (title, a) => () => { if (!a.length || typeof openReportingDrillModal !== 'function') return;
    const rows = a.slice().sort((x, y) => y.days - x.days || y.bal - x.bal).map(c => Object.assign({}, c.row, { days_past_due: c.days, responsible_balance: c.bal }));
    openReportingDrillModal({ chartTitle: 'Collections · ' + title, sliceLabel: int(a.length) + ' customer' + (a.length === 1 ? '' : 's') + ' · ' + usd(sumBal(a)) + ' past due', rows, formatValue: fmt.usd0 }); };
  const seg = (opts, cur, set) => el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, ...opts.map(([k, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap', style: cur === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { set(k); mountApp(); } }, l)));
  const total = sumBal(list);
  // Bucket tiles: customers, dollars, share of the dollars past due.
  const tone = ['#2F5D62', '#2F5D62', '#B45309', '#B45309', '#DC2626', '#DC2626', '#991B1B'];
  const tiles = el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' } },
    ...COLLECTION_BUCKETS.map((b, i) => { const a = inB(list, b.k), v = sumBal(a);
      return el('div', { class: 'card p-3 flex flex-col gap-0.5' + (a.length ? ' cursor-pointer' : ''), title: a.length ? 'Click for the customers' : '', style: { borderTop: '3px solid ' + tone[i] }, onclick: open(b.t + ' days past due', a) },
        el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: muted }, b.t + ' days'),
        el('div', { class: 'text-2xl font-black tabular-nums' }, int(a.length)),
        el('div', { class: 'text-[12px] font-semibold tabular-nums' }, usd(v)),
        el('div', { class: 'text-[10px] tabular-nums', style: muted }, total > 0 ? Math.round(v / total * 100) + '% of the balance' : '')); }));
  // By office: one row an office, a column a bucket.
  const offices = [...new Set(list.map(c => c.office))].sort((a, b) => sumBal(list.filter(c => c.office === b)) - sumBal(list.filter(c => c.office === a)));
  const cellV = (a) => S.show === 'usd' ? (a.length ? usd(sumBal(a)) : '—') : (a.length ? int(a.length) : '—');
  const th = (t, right) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const td = (a, title, strong, band) => el('td', { class: 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap' + (a.length ? ' cursor-pointer' : ''), style: { fontWeight: strong ? '800' : undefined, color: a.length ? undefined : 'var(--text-subtle)', background: band ? 'var(--card-2)' : undefined }, onclick: open(title, a) }, cellV(a));
  const table = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('h3', { class: 'text-base font-bold' }, 'Past due by office'),
      el('span', { class: 'ml-auto' }), seg([['cust', 'Customers'], ['usd', 'Balance']], S.show, (k) => { S.show = k; })),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Office'), ...COLLECTION_BUCKETS.map(b => th(b.t + ' days', true)), th('Total', true))),
      el('tbody', {},
        ...offices.map(o => { const a = list.filter(c => c.office === o);
          return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            el('td', { class: 'px-3 py-1.5 font-semibold whitespace-nowrap' }, tc(o)),
            ...COLLECTION_BUCKETS.map(b => td(inB(a, b.k), tc(o) + ' · ' + b.t + ' days')), td(a, tc(o) + ' · all past due', true, true)); }),
        el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } },
          el('td', { class: 'px-3 py-1.5 font-black' }, 'RIDD'),
          ...COLLECTION_BUCKETS.map(b => td(inB(list, b.k), 'RIDD · ' + b.t + ' days', true, true)), td(list, 'RIDD · all past due', true, true))))));
  const head = el('div', { class: 'card px-5 py-3 flex items-center gap-x-4 gap-y-2 flex-wrap' },
    el('div', {}, el('h3', { class: 'text-base font-bold' }, 'Collections'),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, int(list.length) + ' customers past due · ' + usd(total) + ' owed · ' + int(all.filter(c => c.active).length) + ' of all ' + int(all.length) + ' still have an active plan')),
    el('span', { class: 'ml-auto' }),
    seg([['all', 'Everyone'], ['active', 'Active plan'], ['cancelled', 'No active plan']], S.who, (k) => { S.who = k; }));
  return el('div', { class: 'flex flex-col gap-4' }, head, tiles, table);
}
