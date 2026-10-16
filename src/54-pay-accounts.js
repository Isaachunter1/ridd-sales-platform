// ┌─ src/54-pay-accounts.js ─────────────────────────────────────────────────
// │ Pay tab → "Accounts sold this year" (per Isaac, Oct 16): a running YTD ledger
// │ of every account the rep sold and where each one stands today. Display only —
// │ no payout math reads it.
// │
// │   Peak revenue       = what the account was worth when THIS rep sold it: the
// │                        logged sale's value. (Accounts sold before the app logged
// │                        sales fall back to FieldRoutes' value, marked "no sale
// │                        record" — those can include old in-plan upsells.)
// │   Attributed revenue = what is still this rep's today: the base plan, capped at
// │                        the value they sold it for (anything added to the plan
// │                        later by someone else isn't theirs), $0 once cancelled —
// │                        plus each add-on credited to them while it's still on.
// │   Account now        = the whole account in FieldRoutes today, for reference:
// │                        the gap to Attributed is other people's work on it.
// │ Base plans come from the FieldRoutes snapshot (sold by the rep's FieldRoutes ID,
// │ inside their Office Staff dates when they have a role history); add-ons from the
// │ add-ons table (credited to the rep). Part of the app.js bundle.
// └────────────────────────────────────────────────────────────────────────
function payAccountsLedger(prof, year) {
  if (!prof) return null;
  const repId = prof.id, Y = String(year || new Date().getFullYear());
  if (typeof _loadSubRevenue === 'function') _loadSubRevenue(repId);
  const subRev = (state._subRev || {})[repId];
  const revBySub = new Map(Array.isArray(subRev) ? subRev.map(r => [String(r.subscription_id), r]) : []);
  const snap = state.reportingSubscriptions || [];
  const emp = String(prof.fieldroutes_employee_id || '').trim();
  const master = emp && typeof frResolveEmpId === 'function' ? frResolveEmpId(emp) : emp;
  const isMe = (id) => { const t = String(id == null ? '' : id).trim(); if (!t || !emp) return false; return t === emp || (typeof frResolveEmpId === 'function' && frResolveEmpId(t) === master); };
  // Office Staff dates (role history): only accounts sold while they were Office Staff.
  const hist = typeof roleHistoryClean === 'function' ? roleHistoryClean(prof.role_history) : [];
  const inOfficeRole = (d) => { if (!hist.length) return true; let cur = null; for (const h of hist) if (h.start <= d) cur = h.role; return cur == null || cur === 'Office Staff'; };
  const sales = ((isAdminRole(state.profile?.role) ? state.allSales : state.mySales) || []).filter(s => s.rep_id === repId);
  const saleBySub = new Map(sales.filter(s => s.crm_subscription_id != null && s.sale_kind !== 'upsell').map(s => [String(s.crm_subscription_id), s]));
  const num = (v) => Number(v) || 0;
  const rows = [];
  const seen = new Set();
  // Base plans.
  for (const r of snap) {
    const d = String(r.sold_date || '').slice(0, 10);
    if (d.slice(0, 4) !== Y || !isMe(r.sold_by_id) || !inOfficeRole(d)) continue;
    const sid = String(r.subscription_id); seen.add(sid);
    const s = saleBySub.get(sid) || null;
    const whole = num(r.subscription_contract_value);
    const rev = revBySub.get(sid);
    const baseNow = rev && rev.base_value != null ? num(rev.base_value) : whole;
    const peak = s ? num(s.revenue_amount) : whole;
    const cancelled = !!String(r.subscription_date_canceled || '').trim() || !/^\s*active\s*$/i.test(String(r.subscription_status || ''));
    const ist = String(r.initial_status || '').toLowerCase();
    const status = cancelled ? (r.subscription_date_canceled ? 'Cancelled ' + fmt.dateShort(String(r.subscription_date_canceled).slice(0, 10)) : (r.subscription_status || 'Inactive'))
      : (r.initial_serviced_date || ist === 'completed') ? 'Active' : ist === 'pending' ? 'Active · initial booked' : 'Active · no initial yet';
    rows.push({ kind: 'base', d, cust: r.customer_id, sid, plan: r.subscription || '', status, cancelled, peak, attributed: cancelled ? 0 : Math.min(baseNow, peak), whole: cancelled ? 0 : whole, noRecord: !s });
  }
  // Logged sales the snapshot doesn't have yet (sold in the last sync window).
  for (const s of sales) {
    if (s.sale_kind === 'upsell' || String(s.sold_date || '').slice(0, 4) !== Y) continue;
    const sid = s.crm_subscription_id != null ? String(s.crm_subscription_id) : 'app-' + s.id;
    if (seen.has(sid)) continue;
    if (s.queue_type && s.queue_type !== 'office') continue;
    if (typeof isNonCommSale === 'function' && isNonCommSale(s)) continue;
    seen.add(sid);
    rows.push({ kind: 'base', d: String(s.sold_date).slice(0, 10), cust: s.customer_number, sid, plan: s.crm_subscription || '', status: 'Sold · waiting on FieldRoutes', cancelled: false, peak: num(s.revenue_amount), attributed: num(s.revenue_amount), whole: null, noRecord: false });
  }
  // Add-ons credited to this rep.
  for (const a of (Array.isArray(state.addOns) ? state.addOns : [])) {
    if (a.credited_profile_id !== repId || String(a.added_at || '').slice(0, 4) !== Y) continue;
    const sale = a.sale_id != null ? sales.find(s => s.id === a.sale_id) : sales.find(s => s.add_on_id === a.id);
    const rev = revBySub.get(String(a.subscription_id));
    const line = rev && Array.isArray(rev.lines) ? rev.lines.find(l => l.kind === 'addon' && l.credited_profile_id === repId && String(l.name || '').trim().toLowerCase() === String(a.service_name || '').trim().toLowerCase()) : null;
    const peak = sale ? num(sale.revenue_amount) : line ? num(line.value) : num(a.recurring_amount);
    const off = !!a.removed_at;
    rows.push({ kind: 'addon', d: String(a.added_at).slice(0, 10), cust: a.customer_id, sid: String(a.subscription_id), plan: (a.service_name || 'Add-on') + (a.base_service ? ' on ' + a.base_service : ''),
      status: off ? (a.removed_reason === 'subscription_cancelled' ? 'Cancelled ' : 'Removed ') + fmt.dateShort(String(a.removed_at).slice(0, 10)) : 'Active', cancelled: off, peak, attributed: off ? 0 : Math.min(line ? num(line.value) : peak, peak), whole: null, noRecord: !sale });
  }
  rows.sort((a, b) => (b.d || '').localeCompare(a.d || ''));
  const base = rows.filter(r => r.kind === 'base'), adds = rows.filter(r => r.kind === 'addon');
  const sum = (l, k) => l.reduce((t, r) => t + (r[k] || 0), 0);
  const peak = sum(rows, 'peak'), attr = sum(rows, 'attributed');
  const lost = sum(rows.filter(r => r.cancelled), 'peak');
  const noRec = base.filter(r => r.noRecord).length;
  const F = state._payAcctFilter || 'all';
  const shownAll = rows.filter(r => F === 'all' || (F === 'active' ? !r.cancelled : F === 'cancelled' ? r.cancelled : r.kind === 'addon'));
  const shown = shownAll.slice(0, state._payAcctMore ? 5000 : 40);
  const money = (v) => v == null ? '—' : fmt.usd0(v);
  const tile = (label, value, sub, color, tip) => el('div', { class: 'card px-4 py-3', title: tip || '' },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold text-muted-' }, label),
    el('div', { class: 'text-xl font-black tabular-nums', style: color ? { color } : {} }, value),
    el('div', { class: 'text-[10px] text-muted-' }, sub));
  const th = (t, r) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)' } }, t);
  const td = (v, st, r) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: st || {} }, v == null || v === '' ? '—' : v);
  const csv = () => { const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const L = [['Sold', 'Customer', 'Subscription', 'Type', 'Plan', 'Status', 'Peak revenue', 'Attributed revenue', 'Account now', 'Peak source'].join(',')];
    for (const r of rows) L.push([r.d, r.cust, r.sid, r.kind === 'addon' ? 'Add-on' : 'Base plan', r.plan, r.status, r.peak.toFixed(2), r.attributed.toFixed(2), r.whole == null ? '' : r.whole.toFixed(2), r.noRecord ? 'FieldRoutes value (no sale record)' : 'logged sale'].map(esc).join(','));
    const url = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv' })); const a = el('a', { href: url, download: 'ridd-accounts-' + Y + '-' + String(prof.full_name || 'rep').replace(/\W+/g, '-').toLowerCase() + '.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  const chip = (k, l) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold', style: F === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._payAcctFilter = k; mountApp(); } }, l);
  if (!snap.length && !rows.length) return el('div', { class: 'card p-4 text-[11px] text-muted-' }, 'Accounts sold this year: waiting on the FieldRoutes snapshot.');
  return el('div', { class: 'flex flex-col gap-3' },
    el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
      tile('Accounts sold · ' + Y, fmt.int(base.length), fmt.int(base.filter(r => !r.cancelled).length) + ' active · ' + fmt.int(base.filter(r => r.cancelled).length) + ' cancelled' + (adds.length ? ' · ' + adds.length + ' add-on' + (adds.length === 1 ? '' : 's') : '')),
      tile('Peak revenue', money(peak), 'what they were worth when sold', undefined, 'Each account at the value this rep sold it for (the logged sale), plus add-ons credited to them at the value they were added.' + (noRec ? ' ' + noRec + ' account' + (noRec === 1 ? '' : 's') + ' sold before the app logged sales use FieldRoutes’ value.' : '')),
      tile('Attributed revenue', money(attr), 'still theirs today', 'var(--accent)', 'Base plans still active, each capped at the value this rep sold it for (upsells others added don’t count), plus their add-ons still on. Cancelled accounts are $0.'),
      tile('Retained', peak ? Math.round(attr / peak * 100) + '%' : '—', 'attributed ÷ peak', peak && attr / peak < 0.8 ? '#B91C1C' : undefined),
      tile('Lost to cancels', money(lost), fmt.int(rows.filter(r => r.cancelled).length) + ' cancelled / removed', lost ? '#A9441F' : undefined)),
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('h3', { class: 'text-sm font-bold' }, 'Accounts sold · ' + Y),
        el('span', { class: 'text-[11px] text-muted-' }, 'Peak = value when sold · Attributed = what’s still theirs today · Account now = the whole account in FieldRoutes (others’ add-ons and upsells included)'),
        el('div', { class: 'ml-auto inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, chip('all', 'All'), chip('active', 'Active'), chip('cancelled', 'Cancelled'), chip('addon', 'Add-ons')),
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: csv }, '⬇ CSV')),
      shown.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
        el('thead', {}, el('tr', {}, th('Sold'), th('Customer'), th('Plan'), th('Status'), th('Peak', true), th('Attributed', true), th('Account now', true))),
        el('tbody', {}, ...shown.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(fmt.dateShort(r.d)), td('#' + (r.cust || '—')),
          td(r.kind === 'addon' ? el('span', {}, el('span', { class: 'rounded px-1 mr-1 text-[9px] font-bold', style: { background: 'rgba(95,108,91,.16)', color: '#5F6C5B' } }, 'ADD-ON'), r.plan) : r.plan, { fontWeight: '600' }),
          td(r.status, { color: r.cancelled ? '#A9441F' : 'var(--text-muted)' }),
          td(money(r.peak) + (r.noRecord && r.kind === 'base' ? '*' : ''), { color: r.noRecord ? 'var(--text-muted)' : undefined }, true),
          td(money(r.attributed), { fontWeight: '700', color: r.attributed ? 'var(--accent)' : 'var(--text-muted)' }, true),
          td(r.whole == null ? '—' : money(r.whole) + (r.whole > r.attributed + 1 && !r.cancelled ? ' (+' + fmt.usd0(r.whole - r.attributed) + ' added since)' : ''), { color: 'var(--text-muted)' }, true)))))) :
        el('div', { class: 'px-4 py-6 text-[11px] text-center text-muted-' }, 'No accounts ' + (F === 'all' ? 'sold' : 'here') + ' in ' + Y + ' yet.'),
      noRec ? el('div', { class: 'px-4 py-2 text-[10px] border-t text-muted-', style: { borderColor: 'var(--border)' } }, '* sold before the app logged sales: Peak is FieldRoutes’ value, which can include upsells added to the plan later.') : null,
      shownAll.length > shown.length ? el('button', { class: 'w-full px-4 py-2 text-[11px] font-semibold border-t', style: { borderColor: 'var(--border)', color: 'var(--accent)' }, onclick: () => { state._payAcctMore = true; mountApp(); } }, 'Show all ' + shownAll.length) : null));
}
