// ┌─ 90-tech-pay ──────────────────────────────────────────────────────────
// │ Technician pay & operations (per Isaac + COO, Sep 22 2026 — see
// │ docs/TECH_UPSELLS.md). Ports the old in-house platform's screens onto the
// │ app's data:
// │   Reporting → Operations (sub-tabs): Ops Stats · Commissions · Overrides ·
// │     Production Pay · Configuration (admin).
// │   Technicians → Pay: the same Commissions / Production Pay for ONE rep,
// │     plus Overrides when they hold a manager scope.
// │ Structure first: every number here is computed live from `sales` (tech
// │ queue) + the CRM lifecycle stamps, tech-stats, and the tech_pay_ledger /
// │ tech_override_scopes / tech_pay_quarters tables (20260922_add_ons.sql).
// │ Nothing writes pay yet — no pay run, no clawback stamping.
// └────────────────────────────────────────────────────────────────────────

// ── Configuration (Operations → Configuration; stored in adminRules.techPay) ──
const TECH_PAY_DEFAULTS = {
  commission_rate: 0.25,      // rep: % of qualified contract value, paid quarterly
  override_rate: 0.05,        // manager: % of qualified CV across their branches (own sales excluded)
  upfront_advance: 50,        // $ per job, advanced on the pay period it was serviced; netted from the quarter
  production_rate: 0.22,      // Production Pay: qualified production = 80h-capped serviced production × rate
  min_hours: 72,              // qualifier: hours worked in the pay period
  cap_hours: 80,              // production doesn't qualify beyond this
  min_sales: 200,             // qualifier: $ sold in the pay period
  default_hourly: 23.61,      // wage used when a tech has none set ($1,888.80 / 80h on the old platform)
  period_anchor: '2026-09-20',// a Sunday that starts a bi-weekly pay period
  pay_day_offset: 5,          // pay day = period start + 14 + 5 (the Friday after)
  gate_audit: false,          // Passed Audit as a qualifier (old platform: shown, not gated)
};
function techPayCfg() {
  const r = (typeof _adminRules === 'function') ? _adminRules() : null;
  return Object.assign({}, TECH_PAY_DEFAULTS, (r && r.techPay) || {});
}
function setTechPayCfg(patch) {
  const next = Object.assign({}, techPayCfg(), patch);
  _setAdminRule('techPay', next);
}

// ── Tables (best-effort until the migration runs) ──────────────────────────
let _techPayLoadedAt = 0;
async function loadTechPayTables(force) {
  if (DEMO || !supabase || !state.profile) return;
  if (!force && Date.now() - _techPayLoadedAt < 120000) return;
  _techPayLoadedAt = Date.now();
  const q = async (t, order) => { try { let b = supabase.from(t).select('*'); if (order) b = b.order(order, { ascending: false }); const { data, error } = await b; return error ? null : (data || []); } catch (e) { return null; } };
  const [ledger, scopes, quarters] = await Promise.all([q('tech_pay_ledger', 'created_at'), q('tech_override_scopes'), q('tech_pay_quarters')]);
  state.techLedger = ledger; state.techOverrides = scopes; state.techQuarters = quarters;
  state._techPayTablesMissing = ledger == null;
  mountApp();
}

// ── Sale gates (the old platform's four chips) ─────────────────────────────
function techSaleGates(s) {
  const st = String(s.crm_initial_status || '').toLowerCase();
  const serviced = !!s.crm_serviced_at || st === 'completed';
  const cancelled = ['cancelled', 'nsf', 'rejected'].includes(s.audit_status) || st === 'cancelled';
  const active = !cancelled;
  const autopay = s.crm_autopay == null ? null : !!s.crm_autopay;
  const balance = s.crm_balance == null ? null : Number(s.crm_balance) || 0;
  const noBalance = balance == null ? null : balance <= 0;
  const audit = s.crm_audit === 'passed' ? 'Passed Audit' : s.crm_audit === 'failed' ? 'Failed Audit' : null;
  return { serviced, active, autopay, noBalance, balance, audit, cancelled,
    ok: serviced && active && autopay !== false && noBalance !== false && (!techPayCfg().gate_audit || s.crm_audit === 'passed'),
    why: !serviced ? 'Not serviced' : !active ? 'Not active' : autopay === false ? 'No autopay' : noBalance === false ? 'Has balance' : (techPayCfg().gate_audit && s.crm_audit !== 'passed') ? 'Audit' : '' };
}
const techSaleCv = (s) => Number(s.crm_contract_value != null ? s.crm_contract_value : s.revenue_amount) || 0;
const techQuarterOf = (iso) => { const m = Number(String(iso || '').slice(5, 7)); return m ? Math.ceil(m / 3) : null; };
const techYearOf = (iso) => Number(String(iso || '').slice(0, 4)) || null;
function techQuarterSel() {
  const now = new Date();
  if (!state._techPayYear) state._techPayYear = now.getFullYear();
  if (!state._techPayQ) state._techPayQ = Math.ceil((now.getMonth() + 1) / 3);
  return { y: state._techPayYear, q: state._techPayQ };
}
function techQuarterLocked(y, q) { return (state.techQuarters || []).some(r => r.pay_year === y && r.pay_quarter === q && r.locked_at); }
// Technician-queue sales (admins see every rep; reps get their own via RLS).
function techAllSales() { return (state.queueSales && state.queueSales.tech) || []; }
function techSalesIn(y, q, pred) {
  return techAllSales().filter(s => techYearOf(s.sold_date) === y && techQuarterOf(s.sold_date) === q && (!pred || pred(s)));
}
function techRepName(id) { const p = (state.allProfiles || []).find(x => x.id === id); return p ? (p.full_name || p.email || 'Rep') : 'Rep'; }
function techOfficeName(id) { const o = (state.offices || []).find(x => x.id === id); return o ? o.name : ''; }

// One rep's quarter: gross from qualified sales, deductions from the ledger.
function techCommissionSummary(sales, ledger, rate) {
  const rows = sales.map(s => { const g = techSaleGates(s); const cv = techSaleCv(s); return { s, g, cv, comm: g.ok ? Math.round(cv * rate * 100) / 100 : 0, kind: s.sale_kind === 'upsell' ? 'upsell' : 'personal' }; });
  const sum = (arr, f) => arr.reduce((a, r) => a + f(r), 0);
  const part = (kind) => { const r = kind ? rows.filter(x => x.kind === kind) : rows; return { n: r.length, q: r.filter(x => x.g.ok).length, cv: sum(r, x => x.cv), qcv: sum(r.filter(x => x.g.ok), x => x.cv), comm: sum(r, x => x.comm) }; };
  const L = (kind) => (ledger || []).filter(l => l.kind === kind);
  const lsum = (kind) => L(kind).reduce((a, l) => a + (Number(l.amount) || 0), 0);
  const ded = { advances: lsum('upfront_advance'), clawbacks: lsum('clawback'), reverse: lsum('reverse_clawback'), manual: lsum('manual'),
    nAdvances: L('upfront_advance').length, nClaw: L('clawback').length, nReverse: L('reverse_clawback').length, nManual: L('manual').length };
  const gross = part(null).comm;
  const net = gross - Math.abs(ded.advances) - Math.abs(ded.clawbacks) + Math.abs(ded.reverse) - Math.abs(ded.manual);
  return { rows, total: part(null), personal: part('personal'), upsells: part('upsell'), ded, gross, net };
}

// ── Small UI helpers (self-contained so this file has no render deps) ──────
function _tpChip(ok, label, extra) {
  const on = ok === true, unknown = ok == null;
  return el('span', { class: 'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-wider uppercase', style: unknown ? { background: 'var(--card-2)', color: 'var(--text-subtle)' } : on ? { background: 'rgba(22,163,74,.12)', color: '#16A34A' } : { background: 'rgba(220,38,38,.12)', color: '#DC2626' }, title: unknown ? label + ' — not stamped by the sync yet' : '' },
    unknown ? '·' : on ? '✓' : '✗', ' ', label, extra ? el('span', { class: 'normal-case tracking-normal', style: { color: 'var(--text-subtle)', fontWeight: 600 } }, ' ' + extra) : null);
}
function _tpMoney(n, signed) { const v = Number(n) || 0; return (signed && v > 0 ? '+' : v < 0 ? '−' : '') + fmt.usd0(Math.abs(v)); }
function _tpStat(label, value, sub, color) {
  return el('div', { class: 'card p-4' }, el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-xl font-black tabular-nums', style: color ? { color } : {} }, value), sub ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, sub) : null);
}
function _tpLine(label, sub, value, bold) {
  return el('div', { class: 'flex items-start justify-between gap-3 py-1.5 border-t', style: { borderColor: 'var(--border)' } },
    el('div', {}, el('div', { class: (bold ? 'text-sm font-bold' : 'text-xs font-semibold') }, label), sub ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, sub) : null),
    el('div', { class: (bold ? 'text-sm font-black' : 'text-xs font-semibold') + ' tabular-nums text-right shrink-0' }, value));
}
function _tpSubTabs(items, cur, onPick) {
  return el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...items.map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold transition', style: cur === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => onPick(v) }, l)));
}
function _tpQuarterBar(extra) {
  const { y, q } = techQuarterSel();
  const sel = (val, opts, on) => el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => on(e.target.value) }, ...opts.map(([v, l]) => el('option', { value: String(v), selected: String(v) === String(val) }, l)));
  const yrs = []; for (let i = new Date().getFullYear(); i >= 2025; i--) yrs.push([i, String(i)]);
  const locked = techQuarterLocked(y, q);
  const qEnd = new Date(y, q * 3, 0);
  return el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
    el('div', { class: 'flex items-center gap-2' }, el('span', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Year'), sel(y, yrs, (v) => { state._techPayYear = Number(v); mountApp(); }),
      el('span', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Quarter'), sel(q, [[1, 'Q1'], [2, 'Q2'], [3, 'Q3'], [4, 'Q4']], (v) => { state._techPayQ = Number(v); mountApp(); })),
    extra || null,
    el('div', { class: 'text-[10px] flex-1 text-right', style: { color: 'var(--text-subtle)' } }, (locked ? '🔒 Locked' : '🔓 Open') + ' · quarters lock after ' + (typeof CFG !== 'undefined' && CFG.COMPANY_NAME ? CFG.COMPANY_NAME : 'the') + ' audit (as of ' + qEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ').'));
}

// ── Sales detail table (rep view and manager view share it) ────────────────
function techSalesDetail(rows, opts) {
  opts = opts || {};
  const key = opts.key || 'tp';
  const filt = state['_tpFilter:' + key] || 'all';
  const qtext = (state['_tpSearch:' + key] || '').toLowerCase();
  const shown = rows.filter(r => (filt === 'all' || r.kind === filt) && (!qtext || [r.s.customer_name, r.s.customer_number, r.s.crm_subscription, r.s.service_name, techRepName(r.s.rep_id)].some(x => String(x || '').toLowerCase().includes(qtext))));
  const svcName = (s) => s.crm_subscription || (state.serviceTypes || []).find(t => t.id === s.service_type_id)?.name || s.service_name || '—';
  const pills = [['all', 'All', rows.length], ['personal', 'Personal', rows.filter(r => r.kind === 'personal').length], ['upsell', 'Upsells', rows.filter(r => r.kind === 'upsell').length]];
  const hdr = (t, cls) => el('th', { class: 'text-[9px] uppercase tracking-widest font-semibold py-2 px-2 ' + (cls || 'text-left'), style: { color: 'var(--text-subtle)' } }, t);
  return el('div', { class: 'flex flex-col gap-2' },
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, opts.title || 'Sales detail'),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        el('input', { type: 'search', placeholder: 'Search customer, ID, or subscription', value: state['_tpSearch:' + key] || '', class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '220px' }, oninput: (e) => { state['_tpSearch:' + key] = e.target.value; mountApp(); } }),
        _tpSubTabs(pills.map(([v, l, n]) => [v, l + ' ' + n]), filt, (v) => { state['_tpFilter:' + key] = v; mountApp(); }))),
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'flex items-center justify-between px-3 py-2 text-[11px]', style: { background: 'var(--card-2)' } },
        el('span', { class: 'font-semibold' }, shown.filter(r => r.g.ok).length + ' of ' + shown.length + ' qualified'),
        el('span', {}, el('span', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, (opts.commLabel || 'Comm.') + ' '), el('span', { class: 'font-black tabular-nums' }, fmt.usd0(shown.reduce((a, r) => a + r.comm, 0))))),
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
        el('thead', {}, el('tr', { style: { borderBottom: '1px solid var(--border)' } }, hdr('OK', 'text-center'), hdr('Customer'), hdr('Subscription'), hdr('Sold'), hdr('Contract', 'text-right'), hdr(opts.commLabel || 'Comm.', 'text-right'))),
        el('tbody', {}, ...(shown.length ? shown.map(r => {
          const s = r.s, g = r.g;
          return el('tr', { style: { borderBottom: '1px solid var(--border)' } },
            el('td', { class: 'text-center px-2 py-2' }, el('span', { class: 'inline-flex items-center justify-center rounded-full text-[10px] font-black', style: { width: '20px', height: '20px', background: g.ok ? 'rgba(22,163,74,.15)' : 'rgba(220,38,38,.12)', color: g.ok ? '#16A34A' : '#DC2626' } }, g.ok ? '✓' : '✗')),
            el('td', { class: 'px-2 py-2 min-w-0' },
              el('div', { class: 'flex items-baseline gap-2 flex-wrap' }, el('span', { class: 'font-semibold' }, s.customer_name || '—'), s.customer_number ? el('span', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-subtle)' } }, '#' + s.customer_number) : null,
                opts.showRep ? el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '· ' + techRepName(s.rep_id) + (techOfficeName(s.office_id) ? ' · ' + techOfficeName(s.office_id) : '')) : null),
              el('div', { class: 'flex items-center gap-1 flex-wrap mt-1' }, _tpChip(g.serviced, 'Serviced'), _tpChip(g.active, 'Active'), _tpChip(g.autopay, 'APAY'), _tpChip(g.noBalance, 'No balance', g.balance > 0 ? 'bal ' + fmt.usd0(g.balance) : null),
                g.why ? el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, g.why) : null)),
            el('td', { class: 'px-2 py-2' }, el('div', { class: 'font-semibold' }, svcName(s)), el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, [r.kind === 'upsell' ? 'Upsell' : 'Personal', g.audit].filter(Boolean).join(' · '))),
            el('td', { class: 'px-2 py-2 tabular-nums whitespace-nowrap' }, s.sold_date ? new Date(s.sold_date + 'T00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: '2-digit' }) : '—'),
            el('td', { class: 'px-2 py-2 tabular-nums text-right' }, fmt.usd0(r.cv)),
            el('td', { class: 'px-2 py-2 tabular-nums text-right font-black' }, el('div', {}, fmt.usd0(r.comm)), el('div', { class: 'text-[9px] font-semibold', style: { color: 'var(--text-subtle)' } }, r.comm ? Math.round((opts.rate || techPayCfg().commission_rate) * 100) + '% of CV' : '')));
        }) : [el('tr', {}, el('td', { colspan: 6, class: 'px-3 py-6 text-center text-muted-' }, 'No technician sales in this quarter' + (qtext ? ' match that search' : '') + '.'))]))))));
}

// ── Deduction breakdown (ledger-driven) ────────────────────────────────────
function techDeductionBreakdown(ledger, key) {
  const groups = [['upfront_advance', 'Already paid', 'jobs'], ['clawback', 'Clawbacks', 'jobs'], ['reverse_clawback', 'Reverse clawbacks', 'jobs'], ['manual', 'Manual deductions', 'items']];
  const open = state['_tpDedOpen:' + key] || {};
  return el('div', { class: 'flex flex-col gap-2' },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Deduction breakdown'),
    ...groups.map(([kind, label, unit]) => {
      const rows = (ledger || []).filter(l => l.kind === kind);
      const tot = rows.reduce((a, l) => a + (Number(l.amount) || 0), 0);
      const isOpen = !!open[kind];
      return el('div', { class: 'card overflow-hidden' },
        el('button', { class: 'w-full flex items-center justify-between px-3 py-2 text-left', onclick: () => { open[kind] = !isOpen; state['_tpDedOpen:' + key] = open; mountApp(); } },
          el('span', { class: 'text-xs font-bold' }, (isOpen ? '▾ ' : '▸ ') + label), el('span', { class: 'text-xs font-semibold tabular-nums' }, _tpMoney(tot, true) + ' (' + rows.length + ' ' + unit + ')')),
        isOpen ? (rows.length ? el('div', { class: 'px-3 pb-2' }, ...rows.map(l => el('div', { class: 'flex items-center justify-between gap-2 py-1 border-t text-[11px]', style: { borderColor: 'var(--border)' } },
          el('span', {}, (l.reason || kind.replace(/_/g, ' ')) + (l.sale_id ? ' · sale #' + l.sale_id : '') + (l.contract_value ? ' · CV ' + fmt.usd0(l.contract_value) : '')), el('span', { class: 'tabular-nums font-semibold' }, _tpMoney(l.amount, true)))))
          : el('div', { class: 'px-3 pb-3 text-[11px]', style: { color: 'var(--text-subtle)' } }, state._techPayTablesMissing ? 'The pay ledger table isn’t set up yet (run migrations/20260922_add_ons.sql).' : 'Nothing recorded for this quarter yet — rows appear here when a pay run writes them.')) : null);
    }));
}

// ── Commissions (one rep) ──────────────────────────────────────────────────
function techCommissionsView(repId, opts) {
  opts = opts || {};
  loadTechPayTables();
  const { y, q } = techQuarterSel();
  const cfg = techPayCfg(); const rate = cfg.commission_rate;
  const isAdmin = isAdminRole(state.profile?.role);
  // Rep picker (managers / admins): everyone with a tech-queue sale in the quarter.
  const reps = [...new Set(techSalesIn(y, q).map(s => s.rep_id).filter(Boolean))].map(id => [id, techRepName(id)]).sort((a, b) => a[1].localeCompare(b[1]));
  const pick = repId || state._tpRep || (reps[0] && reps[0][0]) || null;
  const repSel = (isAdmin && !repId) ? el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { state._tpRep = e.target.value; mountApp(); } },
    ...(reps.length ? reps : [['', 'No technician sales this quarter']]).map(([v, l]) => el('option', { value: v, selected: v === pick }, l))) : null;
  const sales = pick ? techSalesIn(y, q, s => s.rep_id === pick) : [];
  const ledger = (state.techLedger || []).filter(l => l.profile_id === pick && l.pay_year === y && l.pay_quarter === q && !String(l.kind).startsWith('override'));
  const S = techCommissionSummary(sales, ledger, rate);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'].slice((q - 1) * 3, q * 3).join(' · ');
  const vol = (label, p) => _tpLine(label, p.q + ' of ' + p.n + ' qualified', el('div', {}, el('div', {}, fmt.usd0(p.qcv)), el('div', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-subtle)' } }, fmt.usd0(p.cv) + ' total')));
  return el('div', { class: 'flex flex-col gap-4' },
    _tpQuarterBar(repSel),
    el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
      el('h3', { class: 'text-base font-black' }, pick ? techRepName(pick) : 'Technician'),
      el('span', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, 'Q' + q + ' ' + y + ' · ' + months)),
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-3 gap-4 items-start' },
      el('div', { class: 'card p-4' },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Q' + q + ' ' + y + ' · ' + Math.round(rate * 100) + '% commission'),
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold mt-2', style: { color: 'var(--text-subtle)' } }, 'Expected net payout'),
        el('div', { class: 'text-3xl font-black tabular-nums mb-2' }, fmt.usd0(S.net)),
        _tpLine('Gross commission', null, fmt.usd0(S.gross)),
        _tpLine('Upfront advances already paid', null, _tpMoney(-Math.abs(S.ded.advances), true)),
        _tpLine('Clawbacks', null, _tpMoney(-Math.abs(S.ded.clawbacks), true)),
        _tpLine('Reverse clawbacks', null, _tpMoney(Math.abs(S.ded.reverse), true)),
        _tpLine('Manual deductions', null, _tpMoney(-Math.abs(S.ded.manual), true)),
        _tpLine('Net payout', null, fmt.usd0(S.net), true)),
      el('div', { class: 'card p-4' },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold mb-1', style: { color: 'var(--text-subtle)' } }, 'Sales volume'),
        vol('Total', S.total), vol('Personal', S.personal), vol('Upsells', S.upsells)),
      el('div', { class: 'card p-4' },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold mb-1', style: { color: 'var(--text-subtle)' } }, 'Deductions'),
        _tpLine('Already paid', fmt.usd0(cfg.upfront_advance) + ' upfront advances on this quarter’s sales', _tpMoney(-Math.abs(S.ded.advances), true)),
        _tpLine('Clawbacks', S.ded.nClaw + ' items', _tpMoney(-Math.abs(S.ded.clawbacks), true)),
        _tpLine('Reverse clawbacks', S.ded.nReverse + ' re-qualified', _tpMoney(Math.abs(S.ded.reverse), true)),
        _tpLine('Manual deductions', S.ded.nManual + ' item' + (S.ded.nManual === 1 ? '' : 's'), _tpMoney(-Math.abs(S.ded.manual), true)))),
    techDeductionBreakdown(ledger, 'rep'),
    techSalesDetail(S.rows, { key: 'rep', rate }));
}

// ── Overrides (managers) ───────────────────────────────────────────────────
function techOverrideScopesFor(profileId) { return (state.techOverrides || []).filter(o => o.profile_id === profileId && o.active !== false); }
function techOverridesView(managerId) {
  loadTechPayTables();
  const { y, q } = techQuarterSel();
  const cfg = techPayCfg();
  const isAdmin = isAdminRole(state.profile?.role);
  const managers = [...new Set((state.techOverrides || []).map(o => o.profile_id))].map(id => [id, techRepName(id)]).sort((a, b) => a[1].localeCompare(b[1]));
  const pick = managerId || state._tpMgr || (managers[0] && managers[0][0]) || null;
  const mgrSel = (isAdmin && !managerId) ? el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { state._tpMgr = e.target.value; mountApp(); } },
    ...(managers.length ? managers : [['', 'No override scopes yet — add one under Configuration']]).map(([v, l]) => el('option', { value: v, selected: v === pick }, l))) : null;
  const scopes = pick ? techOverrideScopesFor(pick) : [];
  const rate = scopes.length ? Number(scopes[0].rate) || cfg.override_rate : cfg.override_rate;
  const offices = [...new Set(scopes.flatMap(o => o.office_ids || []))];
  const branchSel = state._tpBranch || 'all';
  const inScope = (s) => s.rep_id !== pick && (!offices.length || offices.includes(s.office_id)) && (branchSel === 'all' || String(s.office_id) === String(branchSel));
  const sales = pick ? techSalesIn(y, q, inScope) : [];
  const ledger = (state.techLedger || []).filter(l => l.profile_id === pick && l.pay_year === y && l.pay_quarter === q && String(l.kind).startsWith('override'));
  const mapKind = { override_commission: 'commission', override_clawback: 'clawback', override_reverse: 'reverse_clawback' };
  const S = techCommissionSummary(sales, ledger.map(l => ({ ...l, kind: mapKind[l.kind] || l.kind })), rate);
  const branchOpts = [['all', 'All branches'], ...offices.map(id => [id, techOfficeName(id) || ('Office ' + id)])];
  const bSel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { state._tpBranch = e.target.value; mountApp(); } }, ...branchOpts.map(([v, l]) => el('option', { value: String(v), selected: String(v) === String(branchSel) }, l)));
  // By branch / by rep rollups.
  const byBranch = new Map(), byRep = new Map();
  S.rows.forEach(r => {
    const b = r.s.office_id || 0; const bb = byBranch.get(b) || { n: 0, q: 0, cv: 0, qcv: 0, gross: 0, reps: new Set() }; bb.n++; if (r.g.ok) bb.q++; bb.cv += r.cv; if (r.g.ok) bb.qcv += r.cv; bb.gross += r.comm; bb.reps.add(r.s.rep_id); byBranch.set(b, bb);
    const rr = byRep.get(r.s.rep_id) || { n: 0, q: 0, cv: 0, qcv: 0, gross: 0 }; rr.n++; if (r.g.ok) rr.q++; rr.cv += r.cv; if (r.g.ok) rr.qcv += r.cv; rr.gross += r.comm; byRep.set(r.s.rep_id, rr);
  });
  const hdr = (t, cls) => el('th', { class: 'text-[9px] uppercase tracking-widest font-semibold py-2 px-2 ' + (cls || 'text-left'), style: { color: 'var(--text-subtle)' } }, t);
  const cell = (v, cls) => el('td', { class: 'px-2 py-2 tabular-nums ' + (cls || '') }, v);
  const two = (a, b) => el('div', {}, el('div', { class: 'font-semibold' }, a), el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, b));
  const branchTbl = el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
    el('thead', {}, el('tr', { style: { borderBottom: '1px solid var(--border)' } }, hdr('Branch'), hdr('Sales', 'text-right'), hdr('Qualified CV', 'text-right'), hdr('Gross', 'text-right'), hdr('Net', 'text-right'))),
    el('tbody', {}, ...([...byBranch.entries()].sort((a, b) => b[1].gross - a[1].gross).map(([oid, b]) => el('tr', { style: { borderBottom: '1px solid var(--border)' } },
      cell(two(techOfficeName(oid) || 'Unassigned', b.reps.size + ' reps')), cell(two(b.n, b.q + ' qualified'), 'text-right'), cell(two(fmt.usd0(b.qcv), fmt.usd0(b.cv) + ' sold'), 'text-right'), cell(two(fmt.usd0(b.gross), 'at ' + Math.round(rate * 100) + '%'), 'text-right'), cell(el('span', { class: 'font-black' }, fmt.usd0(b.gross)), 'text-right')))),
      ...(byBranch.size ? [] : [el('tr', {}, el('td', { colspan: 5, class: 'px-3 py-6 text-center text-muted-' }, pick ? 'No sales in this manager’s scope for the quarter.' : 'Pick a manager, or add an override scope under Configuration.'))])))));
  const repTbl = el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
    el('thead', {}, el('tr', { style: { borderBottom: '1px solid var(--border)' } }, hdr('Rep'), hdr('Sales', 'text-right'), hdr('Qualified CV', 'text-right'), hdr('Rep payout', 'text-right'), hdr('Your gross', 'text-right'))),
    el('tbody', {}, ...[...byRep.entries()].sort((a, b) => b[1].gross - a[1].gross).map(([rid, r]) => el('tr', { style: { borderBottom: '1px solid var(--border)' } },
      cell(two(techRepName(rid), '')), cell(two(r.n, r.q + ' qualified'), 'text-right'), cell(two(fmt.usd0(r.qcv), fmt.usd0(r.cv) + ' sold'), 'text-right'), cell(fmt.usd0(r.qcv * cfg.commission_rate), 'text-right'), cell(el('span', { class: 'font-black' }, fmt.usd0(r.gross)), 'text-right')))))));
  return el('div', { class: 'flex flex-col gap-4' },
    _tpQuarterBar(el('div', { class: 'flex items-center gap-2' }, mgrSel, bSel)),
    el('div', {}, el('h3', { class: 'text-base font-black' }, pick ? techRepName(pick) : 'Manager'),
      el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, Math.round(rate * 100) + '% override on qualified sales across ' + (offices.length || 'all') + ' branch' + (offices.length === 1 ? '' : 'es') + ' · ' + (scopes[0] && scopes[0].label || 'Technician Sales') + ' · your own sales are excluded')),
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-3 gap-4 items-start' },
      el('div', { class: 'card p-4' },
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Q' + q + ' ' + y + ' · ' + Math.round(rate * 100) + '% override'),
        el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold mt-2', style: { color: 'var(--text-subtle)' } }, 'Expected net payout'),
        el('div', { class: 'text-3xl font-black tabular-nums mb-2' }, fmt.usd0(S.net)),
        _tpLine('Qualified contract value', null, fmt.usd0(S.total.qcv)), _tpLine('Gross commission (' + Math.round(rate * 100) + '%)', null, fmt.usd0(S.gross)),
        _tpLine('Clawbacks', null, _tpMoney(-Math.abs(S.ded.clawbacks), true)), _tpLine('Reverse clawbacks', null, _tpMoney(Math.abs(S.ded.reverse), true)), _tpLine('Net payout', null, fmt.usd0(S.net), true)),
      el('div', { class: 'card p-4' }, el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold mb-1', style: { color: 'var(--text-subtle)' } }, 'Sales volume'),
        ...[['Total', S.total], ['Personal', S.personal], ['Upsells', S.upsells]].map(([l, p]) => _tpLine(l, p.q + ' of ' + p.n + ' qualified', el('div', {}, el('div', {}, fmt.usd0(p.qcv)), el('div', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-subtle)' } }, fmt.usd0(p.cv) + ' total'))))),
      el('div', { class: 'card p-4' }, el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold mb-1', style: { color: 'var(--text-subtle)' } }, 'Deductions'),
        _tpLine('Clawbacks', S.ded.nClaw + ' items', _tpMoney(-Math.abs(S.ded.clawbacks), true)), _tpLine('Reverse clawbacks', S.ded.nReverse + ' re-qualified', _tpMoney(Math.abs(S.ded.reverse), true)),
        el('div', { class: 'text-[10px] mt-2', style: { color: 'var(--text-subtle)' } }, 'Each adjustment is ' + Math.round(rate * 100) + '% of the job’s contract value, in the direction of what happened.'))),
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
      _tpStat('Sales in scope', S.total.n, S.total.q + ' qualified · ' + (S.total.n ? Math.round(S.total.q / S.total.n * 100) : 0) + '%'),
      _tpStat('Sold contract value', fmt.usd0(S.total.cv), fmt.usd0(S.total.qcv) + ' qualified'),
      _tpStat('Reps covered', byRep.size, byBranch.size + ' of ' + (offices.length || byBranch.size) + ' branches active'),
      _tpStat('Clawbacks', S.ded.nClaw, 'All counted')),
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'By branch'), branchTbl,
    el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Branch figures exclude the manager’s own sales, so they won’t tie to a company branch report.'),
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'By rep'), repTbl,
    techDeductionBreakdown(ledger.map(l => ({ ...l, kind: mapKind[l.kind] || l.kind })), 'mgr'),
    techSalesDetail(S.rows, { key: 'mgr', rate, showRep: true, commLabel: 'Override' }));
}

// ── Production Pay (bi-weekly) ─────────────────────────────────────────────
function techPayPeriodOf(iso, cfg) {
  const anchor = new Date((cfg.period_anchor || TECH_PAY_DEFAULTS.period_anchor) + 'T12:00:00');
  const d = new Date(iso + 'T12:00:00');
  const n = Math.floor((d - anchor) / (14 * 86400000));
  const start = new Date(anchor); start.setDate(anchor.getDate() + n * 14);
  const end = new Date(start); end.setDate(start.getDate() + 13);
  const pay = new Date(end); pay.setDate(end.getDate() + (Number(cfg.pay_day_offset) || 5) + 1);
  const f = (x) => x.toISOString().slice(0, 10);
  return { start: f(start), end: f(end), payDay: f(pay), n };
}
function techProductionPayView(repId) {
  const cfg = techPayCfg();
  if (!state.techStats && typeof refreshTechStatsFromCloud === 'function') refreshTechStatsFromCloud();
  const isAdmin = isAdminRole(state.profile?.role);
  const todayIso = new Date().toISOString().slice(0, 10);
  const off = Number(state._tpPeriodOff) || 0;
  const base = techPayPeriodOf(todayIso, cfg);
  const startD = new Date(base.start + 'T12:00:00'); startD.setDate(startD.getDate() + off * 14);
  const P = techPayPeriodOf(startD.toISOString().slice(0, 10), cfg);
  const ts = state.techStats;
  const sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const me = repId ? techRepName(repId) : null;
  // Per-tech per-day production in the period (route stats), hours = on-site check-in/out minutes.
  const byTech = new Map();
  (ts ? ts.rows : []).forEach(r => {
    if (r.d < P.start || r.d > P.end) return;
    if (me && sig(r.n) !== sig(me)) return;
    const t = byTech.get(sig(r.n)) || { name: String(r.n).replace(/\s+/g, ' ').trim(), office: (ts.officeNames || {})[r.o] || '', days: new Map() };
    const d = t.days.get(r.d) || { prod: 0, mins: 0, done: 0 };
    d.prod += r.prod || 0; d.mins += r.mins || 0; d.done += r.done || 0; t.days.set(r.d, d); byTech.set(sig(r.n), t);
  });
  // Sales in the period (tech queue) for the "Sales ≥ $200" qualifier.
  const salesByRep = new Map();
  techAllSales().forEach(s => { if (s.sold_date >= P.start && s.sold_date <= P.end) salesByRep.set(sig(techRepName(s.rep_id)), (salesByRep.get(sig(techRepName(s.rep_id))) || 0) + techSaleCv(s)); });
  const picks = [...byTech.keys()].sort((a, b) => byTech.get(a).name.localeCompare(byTech.get(b).name));
  const pick = me ? sig(me) : (state._tpProdTech && byTech.has(state._tpProdTech) ? state._tpProdTech : picks[0]);
  const T = pick ? byTech.get(pick) : null;
  const fmtD = (iso) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
  const bar = el('div', { class: 'card p-3 flex items-center gap-3 flex-wrap' },
    el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._tpPeriodOff = off - 1; mountApp(); } }, '‹'),
    el('span', { class: 'text-sm font-black' }, fmtD(P.start) + ' → ' + fmtD(P.end)),
    el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._tpPeriodOff = off + 1; mountApp(); } }, '›'),
    el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, (off === 0 ? 'This pay period' : off === -1 ? 'Last pay period' : '') + ' · pay day ' + fmtD(P.payDay)),
    (isAdmin && !repId) ? el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', marginLeft: 'auto' }, onchange: (e) => { state._tpProdTech = e.target.value; mountApp(); } },
      ...(picks.length ? picks : ['']).map(k => el('option', { value: k, selected: k === pick }, k ? byTech.get(k).name : 'No route stats in this period'))) : null);
  if (!T) return el('div', { class: 'flex flex-col gap-4' }, bar, emptyCard(ts ? 'No route stats for this pay period yet.' : 'Loading route stats…'));
  const days = [...T.days.entries()].sort((a, b) => a[0] < b[0] ? -1 : 1);
  const hours = days.reduce((a, [, d]) => a + d.mins, 0) / 60;
  const prodTotal = days.reduce((a, [, d]) => a + d.prod, 0);
  const cappedHours = Math.min(hours, cfg.cap_hours);
  const cappedProd = hours > cfg.cap_hours ? prodTotal * (cfg.cap_hours / hours) : prodTotal;
  const qp = cappedProd * cfg.production_rate;
  const wage = cfg.default_hourly;   // TODO(pay): per-tech hourly wage (profiles.hourly_wage) — default until wired
  const wages = hours * wage, fullWeek = cfg.cap_hours * wage;
  const sold = salesByRep.get(pick) || 0;
  const qual = [[hours >= cfg.min_hours, 'Worked ' + cfg.min_hours + ' hours'], [qp > wages, 'QP > Wages'], [sold >= cfg.min_sales, 'Sales ≥ ' + fmt.usd0(cfg.min_sales)]];
  const bonus = qual.every(([ok]) => ok) ? Math.max(0, qp - fullWeek) : 0;
  const money2 = (v) => '$' + (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const hdr = (t, cls) => el('th', { class: 'text-[9px] uppercase tracking-widest font-semibold py-2 px-2 ' + (cls || 'text-left'), style: { color: 'var(--text-subtle)' } }, t);
  return el('div', { class: 'flex flex-col gap-4' }, bar,
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between gap-2' }, el('div', { class: 'text-sm font-bold' }, T.name + (T.office ? ' · ' + T.office : '')), el('div', { class: 'text-xs tabular-nums' }, 'Hours on site: ' + hours.toFixed(1) + 'h')),
      el('div', { class: 'h-1.5 rounded-full mt-2 mb-3', style: { background: 'var(--card-2)' } }, el('div', { class: 'h-full rounded-full', style: { width: Math.min(100, hours / cfg.cap_hours * 100) + '%', background: 'var(--accent)' } })),
      el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
        el('div', {}, el('div', { class: 'text-2xl font-black tabular-nums' }, money2(wages + bonus)), el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, 'Expected paycheck · estimated ' + fmtD(P.payDay) + ' · ' + money2(wages) + ' + ' + money2(bonus))),
        el('div', {}, el('div', { class: 'text-2xl font-black tabular-nums' }, money2(wages)), el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, 'Total earned wages · ' + hours.toFixed(1) + 'h × ' + money2(wage) + '/h'), el('div', { class: 'text-[10px] italic', style: { color: 'var(--text-subtle)' } }, 'Hours are route check-in/out time from FieldRoutes until payroll hours are connected; estimates exclude PTO.'))),
      el('div', { class: 'grid grid-cols-3 gap-4 mt-4' },
        el('div', {}, el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Current bonus'), el('div', { class: 'text-lg font-black tabular-nums' }, money2(bonus))),
        el('div', {}, el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Qualified production'), el('div', { class: 'text-lg font-black tabular-nums' }, money2(qp))),
        el('div', {}, el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Total sales'), el('div', { class: 'text-lg font-black tabular-nums' }, money2(sold)))),
      el('div', { class: 'mt-3 text-[11px] font-semibold' }, 'Qualifiers:'),
      ...qual.map(([ok, l]) => el('div', { class: 'text-xs flex items-center gap-2 mt-1' }, el('span', { style: { color: ok ? '#16A34A' : '#DC2626' } }, ok ? '✓' : '✗'), l)),
      el('details', { class: 'mt-3' }, el('summary', { class: 'text-xs font-bold cursor-pointer' }, 'How do bonuses work?'),
        el('div', { class: 'text-xs mt-2 flex flex-col gap-1' },
          el('div', {}, 'Bonuses are earned when you’ve worked at least ' + cfg.min_hours + ' hours and your qualified production exceeds your wages.'),
          el('div', { class: 'font-bold mt-1' }, 'Bonus = (Qualified Production) − (' + cfg.cap_hours + 'h workweek pay)'),
          el('div', {}, 'Production doesn’t qualify beyond ' + cfg.cap_hours + ' hours in a pay period. Your ' + cfg.cap_hours + 'h serviced production: ' + money2(cappedProd) + '.'),
          el('div', {}, 'Qualified production = ' + money2(cappedProd) + ' × ' + Math.round(cfg.production_rate * 100) + '% = ' + money2(qp) + '.'),
          el('div', {}, 'Production bonus = ' + money2(qp) + ' − ' + money2(fullWeek) + ' = ' + money2(Math.max(0, qp - fullWeek)) + (qual.every(([ok]) => ok) ? '' : ' (not earned — a qualifier is missing)') + '.')))),
    el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
      el('thead', {}, el('tr', { style: { borderBottom: '1px solid var(--border)' } }, hdr('Date'), hdr('Qualified production', 'text-right'), hdr('Rate', 'text-right'), hdr('Total production', 'text-right'), hdr('Hours', 'text-right'))),
      el('tbody', {}, ...days.map(([d, x]) => el('tr', { style: { borderBottom: '1px solid var(--border)' } }, el('td', { class: 'px-2 py-2' }, fmtD(d)), el('td', { class: 'px-2 py-2 tabular-nums text-right' }, money2(x.prod * cfg.production_rate)), el('td', { class: 'px-2 py-2 tabular-nums text-right' }, (cfg.production_rate * 100).toFixed(1) + '%'), el('td', { class: 'px-2 py-2 tabular-nums text-right' }, money2(x.prod)), el('td', { class: 'px-2 py-2 tabular-nums text-right' }, (x.mins / 60).toFixed(1)))),
        el('tr', { style: { background: 'var(--card-2)' } }, el('td', { class: 'px-2 py-2 font-bold' }, 'Sum'), el('td', { class: 'px-2 py-2 tabular-nums text-right font-bold' }, money2(prodTotal * cfg.production_rate)), el('td', {}), el('td', { class: 'px-2 py-2 tabular-nums text-right font-bold' }, money2(prodTotal)), el('td', { class: 'px-2 py-2 tabular-nums text-right font-bold' }, hours.toFixed(1))))))));
}

// ── Configuration (admin) ──────────────────────────────────────────────────
function techPayConfigView() {
  if (!isAdminRole(state.profile?.role)) return emptyCard('Admins only.');
  loadTechPayTables();
  const cfg = techPayCfg();
  const num = (key, opts) => el('input', { type: 'number', step: opts.step || 1, min: 0, value: opts.pct ? Math.round(cfg[key] * 10000) / 100 : cfg[key], class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '90px' },
    onchange: (e) => { const v = Number(e.target.value); if (isNaN(v)) return; setTechPayCfg({ [key]: opts.pct ? v / 100 : v }); toast('Saved', 'success'); mountApp(); } });
  const row = (label, ctl, tip) => el('div', { class: 'flex items-center justify-between gap-3 py-2 border-t', style: { borderColor: 'var(--border)' } }, el('div', {}, el('div', { class: 'text-xs font-semibold' }, label), tip ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, tip) : null), ctl);
  const sw = (key) => el('input', { type: 'checkbox', checked: !!cfg[key], onchange: () => { setTechPayCfg({ [key]: !cfg[key] }); mountApp(); } });
  // Override scopes editor (tech_override_scopes).
  const scopes = state.techOverrides || [];
  const people = (state.allProfiles || []).filter(p => p.full_name).sort((a, b) => a.full_name.localeCompare(b.full_name));
  const offices = (state.offices || []).slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  const saveScope = async (row) => {
    try { const { error } = await supabase.from('tech_override_scopes').upsert(row).select(); if (error) throw error; toast('Override scope saved', 'success'); loadTechPayTables(true); }
    catch (e) { toast('Could not save — ' + (e.message || e), 'error'); }
  };
  const newScope = () => saveScope({ profile_id: state._tpNewMgr || (people[0] && people[0].id), rate: cfg.override_rate, office_ids: [], seller_roles: ['technician'], label: 'Technician Sales', active: true });
  const scopeRows = scopes.map(o => el('div', { class: 'flex items-center gap-2 flex-wrap py-2 border-t', style: { borderColor: 'var(--border)' } },
    el('span', { class: 'text-xs font-semibold', style: { minWidth: '140px' } }, techRepName(o.profile_id)),
    el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'rate'), el('input', { type: 'number', step: 0.5, value: Math.round(Number(o.rate) * 10000) / 100, class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '64px' }, onchange: (e) => saveScope({ ...o, rate: Number(e.target.value) / 100 }) }), el('span', { class: 'text-[10px]' }, '%'),
    el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'branches'),
    ...offices.map(of => el('label', { class: 'text-[10px] inline-flex items-center gap-1' }, el('input', { type: 'checkbox', checked: (o.office_ids || []).includes(of.id), onchange: (e) => saveScope({ ...o, office_ids: e.target.checked ? [...(o.office_ids || []), of.id] : (o.office_ids || []).filter(x => x !== of.id) }) }), of.name)),
    el('label', { class: 'text-[10px] inline-flex items-center gap-1', style: { marginLeft: 'auto' } }, el('input', { type: 'checkbox', checked: o.active !== false, onchange: (e) => saveScope({ ...o, active: e.target.checked }) }), 'active')));
  // Quarter lock.
  const { y, q } = techQuarterSel();
  const locked = techQuarterLocked(y, q);
  const toggleLock = async () => {
    if (!confirm((locked ? 'Unlock' : 'Lock') + ' Q' + q + ' ' + y + ' technician pay?')) return;
    try { const { error } = await supabase.from('tech_pay_quarters').upsert({ pay_year: y, pay_quarter: q, locked_at: locked ? null : new Date().toISOString(), locked_by: locked ? null : state.profile.id }); if (error) throw error; toast((locked ? 'Unlocked' : 'Locked') + ' Q' + q + ' ' + y, 'success'); loadTechPayTables(true); }
    catch (e) { toast('Could not update — ' + (e.message || e), 'error'); }
  };
  return el('div', { class: 'flex flex-col gap-4' },
    state._techPayTablesMissing ? el('div', { class: 'card p-3 text-[11px]', style: { background: 'rgba(223,100,58,.08)' } }, 'The technician pay tables aren’t in the database yet — run migrations/20260922_add_ons.sql. Rates below still save (app settings).') : null,
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-2 gap-4 items-start' },
      el('div', { class: 'card p-4' }, el('h3', { class: 'text-sm font-bold mb-1' }, 'Sales commissions'),
        row('Commission rate', el('div', { class: 'flex items-center gap-1' }, num('commission_rate', { pct: true, step: 0.5 }), el('span', { class: 'text-[11px]' }, '%')), 'Of qualified contract value; paid quarterly after the audit.'),
        row('Upfront advance per job', el('div', { class: 'flex items-center gap-1' }, el('span', { class: 'text-[11px]' }, '$'), num('upfront_advance', {})), 'Paid on the pay period the job is serviced; netted out of the quarter.'),
        row('Qualification', el('span', { class: 'text-[11px] font-semibold' }, 'Serviced · Active · Autopay · No balance'), 'The four chips on every sale. All four must hold at the pay run.'),
        row('Passed Audit also required', sw('gate_audit'), 'Off = audit shown on the row but not a gate (old platform behaviour).')),
      el('div', { class: 'card p-4' }, el('h3', { class: 'text-sm font-bold mb-1' }, 'Production pay'),
        row('Production rate', el('div', { class: 'flex items-center gap-1' }, num('production_rate', { pct: true, step: 0.5 }), el('span', { class: 'text-[11px]' }, '%')), 'Qualified production = capped serviced production × rate.'),
        row('Hours cap / minimum', el('div', { class: 'flex items-center gap-1' }, num('cap_hours', {}), el('span', { class: 'text-[11px]' }, '/'), num('min_hours', {})), 'Production stops qualifying past the cap; the minimum is a qualifier.'),
        row('Sales minimum', el('div', { class: 'flex items-center gap-1' }, el('span', { class: 'text-[11px]' }, '$'), num('min_sales', {})), 'Sold in the pay period.'),
        row('Default hourly wage', el('div', { class: 'flex items-center gap-1' }, el('span', { class: 'text-[11px]' }, '$'), num('default_hourly', { step: 0.01 })), 'Used until per-tech wages are connected.'),
        row('Pay period anchor', el('input', { type: 'date', value: cfg.period_anchor, class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { if (e.target.value) { setTechPayCfg({ period_anchor: e.target.value }); mountApp(); } } }), 'A Sunday that starts a bi-weekly period; pay day is the Friday after it ends.'))),
    el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between gap-2 flex-wrap mb-1' }, el('h3', { class: 'text-sm font-bold' }, 'Manager overrides'),
        el('div', { class: 'flex items-center gap-2' },
          el('select', { class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { state._tpNewMgr = e.target.value; } }, ...people.map(p => el('option', { value: p.id, selected: p.id === state._tpNewMgr }, p.full_name))),
          el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: newScope }, '+ Add scope'))),
      el('div', { class: 'text-[10px] mb-2', style: { color: 'var(--text-subtle)' } }, 'Who earns an override on whose sales: a rate over a set of branches (none = every branch), technician sales only, the manager’s own sales excluded.'),
      ...(scopeRows.length ? scopeRows : [el('div', { class: 'text-[11px] py-2', style: { color: 'var(--text-subtle)' } }, 'No override scopes yet.')])),
    el('div', { class: 'card p-4 flex items-center justify-between gap-2 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Quarter lock · Q' + q + ' ' + y), el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, locked ? 'Locked — commissions and overrides for this quarter are frozen for reps.' : 'Open — numbers keep moving as the CRM stamps change.')),
      el('div', { class: 'flex items-center gap-2' }, _tpQuarterBar(), el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)' }, onclick: toggleLock }, locked ? 'Unlock' : 'Lock quarter'))));
}

// ── Reporting → Operations hub ─────────────────────────────────────────────
function reportingOpsHub() {
  const SUBS = [['stats', 'Ops stats'], ['commissions', 'Commissions'], ['overrides', 'Overrides'], ['production', 'Production pay'], ['config', 'Configuration']];
  const sub = SUBS.some(([v]) => v === state._opsSub) ? state._opsSub : 'stats';
  const body = sub === 'commissions' ? techCommissionsView(null) : sub === 'overrides' ? techOverridesView(null) : sub === 'production' ? techProductionPayView(null) : sub === 'config' ? techPayConfigView() : reportingOps();
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' }, _tpSubTabs(SUBS, sub, (v) => { state._opsSub = v; mountApp(); }),
      el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, sub === 'stats' ? 'Weekly COO stats by office' : sub === 'commissions' ? 'Quarterly technician commissions (the rep’s Pay tab, for any rep)' : sub === 'overrides' ? 'Manager overrides across their branches' : sub === 'production' ? 'Bi-weekly production bonus' : 'Rates, qualifiers, override scopes, quarter lock')),
    body);
}

// ── Technicians → Pay (what a technician sees) ─────────────────────────────
function viewTechPay() {
  const isAdmin = isAdminRole(state.profile?.role);
  const me = state.profile?.id;
  loadTechPayTables();
  const hasScope = techOverrideScopesFor(me).length > 0;
  const SUBS = [['commissions', 'Sales commissions'], ['production', 'Production pay'], ...(hasScope || isAdmin ? [['overrides', 'Overrides']] : [])];
  const sub = SUBS.some(([v]) => v === state._techPaySub) ? state._techPaySub : 'commissions';
  const body = sub === 'production' ? techProductionPayView(isAdmin ? null : me) : sub === 'overrides' ? techOverridesView(isAdmin ? null : me) : techCommissionsView(isAdmin ? null : me);
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' }, _tpSubTabs(SUBS, sub, (v) => { state._techPaySub = v; mountApp(); })),
    body);
}
