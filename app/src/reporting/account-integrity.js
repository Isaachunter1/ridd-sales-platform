// ┌─ Reporting → Auditing → Account Integrity ──────────────────────────────
// │ (per Isaac, Oct 20 + Oct 27) Customer-record edits and shared contact
// │ details worth an audit look: one-digit phone changes, small email edits,
// │ autopay turned off soon after the sale, the rep's own contact info on a
// │ customer, one phone / email / address / card on unlinked accounts.
// │ Nov 19: read as an anti-fraud review — Cases (per customer, risk-scored),
// │ Reps, Edited by, Linked accounts, All flags.
// │
// │ The browser only RENDERS: the server job account-integrity (server/
// │ services/crm) computes every flag nightly into account_integrity_flags and
// │ its job_runs summary carries the counts and the by-rep tally. Admins only —
// │ the table holds customer names and contact details and RLS returns nothing
// │ to anyone else (developer role included).
// └─────────────────────────────────────────────────────────────────────────
const AI_KINDS = [
  ['red', 'All red flags', 'Everything marked red'],
  ['phone_one_digit', 'Phone · one digit', 'A phone number edited so exactly one digit changed'],
  ['email_small_edit', 'Email · small edit', 'An email edited by 1–2 characters before the @, same provider'],
  ['autopay_off', 'Autopay turned off', 'Autopay switched off by a person within 60 days of the sale (FieldRoutes’ own shut-offs and card swaps are left out)'],
  ['rep_own_contact', 'Rep’s own contact', 'The selling rep’s own phone or email on a customer they sold'],
  ['shared_contact', 'Shared phone / email / address', 'One phone, email or street address on accounts FieldRoutes does not link'],
  ['shared_card', 'Shared card', 'The same card (last four + expiry) on unlinked accounts with different names'],
];

// Auditing tab with its sub-tabs: Audits (the D2D audit report) · Account Integrity (admins).
function reportingAuditingTab() {
  const admin = isAdminRole(state.profile?.role);
  const pane = admin && state._auditPane === 'integrity' ? 'integrity' : 'audits';
  const tabs = admin ? el('div', { class: 'inline-flex rounded-lg border overflow-hidden self-start', style: { borderColor: 'var(--border-2)' } },
    ...[['audits', 'Audits'], ['integrity', 'Account Integrity']].map(([v, l]) => el('button', {
      type: 'button', class: 'px-3 py-1 text-[11px] font-semibold transition',
      style: pane === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)', background: 'var(--card)' },
      onclick: () => { if (pane !== v) { state._auditPane = v; mountApp(); } },
    }, l))) : null;
  if (pane === 'integrity') return el('div', { class: 'flex flex-col gap-4' }, tabs, accountIntegrityView());
  // Marketing data diagnostics live here since Nov 9 (per Isaac — off the Metrics page).
  return el('div', { class: 'flex flex-col gap-4' }, tabs, auditTasksCard(), reportingAuditing(), typeof mkpDiagnosticsCard === 'function' ? mkpDiagnosticsCard() : null);
}

// ── The review view (rebuilt per Isaac, Nov 19 — "a better way to intuitively display all of that … like an
// anti-fraud tab"). 8,000 flat flags were a wall; the same flags now read four ways:
//   Cases            one row per CUSTOMER, signals stacked into a risk score — the review queue
//   Reps             who sold the flagged accounts, as a rate of what they sold (so volume isn't guilt)
//   Edited by        who made the phone / email / autopay edits
//   Linked accounts  the sets of unlinked accounts sharing one card, phone, email or address
//   All flags        the raw list, as before
// Scoring (shown in the ⓘ, nothing hidden): each flag adds its weight; a customer with more than one KIND of
// signal gets +3 per extra kind, because stacked signals are what fraud looks like and a lone amber usually isn't.
const AI_WEIGHT = {
  rep_own_contact: { red: 5, amber: 3 },
  phone_one_digit: { red: 4, amber: 2 },
  email_small_edit: { red: 3, amber: 1 },
  autopay_off: { red: 3, amber: 1 },
  shared_card: { red: 3, amber: 2 },
  shared_contact: { red: 2, amber: 1 },
};
const AI_SHORT = { phone_one_digit: 'Phone 1-digit', email_small_edit: 'Email edit', autopay_off: 'Autopay off', rep_own_contact: 'Rep’s own contact', shared_contact: 'Shared contact', shared_card: 'Shared card' };
const AI_TIER = (s) => s >= 8 ? ['High', '#DC2626'] : s >= 4 ? ['Medium', '#D97706'] : ['Low', '#64748B'];
const _aiW = (f) => ((AI_WEIGHT[f.kind] || {})[f.severity]) || 1;
const _aiNorm = (s) => { s = String(s || '').trim(); const m = s.match(/^([^,]+),\s*(.+)$/); if (m) s = m[2] + ' ' + m[1]; return s.toLowerCase().replace(/\s+/g, ' '); };

// Loads the latest run's summary + EVERY flag once (one PostgREST read per 1,000); filtering happens here.
function _aiLoad() {
  const C = state._aiCache || (state._aiCache = {});
  if (C.key === 'all' && (C.loading || C.rows)) return;
  Object.assign(C, { key: 'all', loading: true, rows: null, error: null, derived: null });
  (async () => {
    try {
      if (typeof DEMO !== 'undefined' && DEMO) { Object.assign(C, { loading: false, rows: [], run: null }); return; }
      const run = await supabase.from('job_runs').select('finished_at, summary').eq('job', 'account-integrity').eq('status', 'ok').order('started_at', { ascending: false }).limit(1);
      const rows = [];
      for (let from = 0; from < 50000; from += 1000) {
        const { data, error } = await supabase.from('account_integrity_flags').select('*').order('id').range(from, from + 999);
        if (error) throw error;
        rows.push(...(data || []));
        if (!data || data.length < 1000) break;
      }
      Object.assign(C, { loading: false, rows, run: (run.data && run.data[0]) || null });
    } catch (e) {
      Object.assign(C, { loading: false, rows: [], error: /account_integrity_flags|does not exist|schema cache/i.test(String(e && e.message)) ? 'The table isn’t set up yet — run db/migrations/20261027_account_integrity_flags.sql in Supabase.' : String((e && e.message) || e) });
    }
    if (state.view === 'reporting') mountApp();
  })();
}

// Everything the views need, built once per load: cases by customer, reps (with what they sold in 12 months
// from the reporting book, when it's loaded), editors, linked-account groups.
function _aiDerive(rows) {
  const cases = new Map(), reps = new Map(), eds = new Map(), groups = new Map();
  for (const f of rows) {
    const id = String(f.customer_id);
    const c = cases.get(id) || (cases.set(id, { id, name: f.customer_name, office: f.office, rep: f.rep_name, flags: [], kinds: new Set(), red: 0, score: 0, last: '' }).get(id));
    c.flags.push(f); c.kinds.add(f.kind); if (f.severity === 'red') c.red++;
    c.score += _aiW(f);
    const t = String(f.changed_at || f.sold_on || ''); if (t > c.last) c.last = t;
    if (!c.rep && f.rep_name) c.rep = f.rep_name; if (!c.office && f.office) c.office = f.office;
    if (f.changed_by && /phone_one_digit|email_small_edit|autopay_off/.test(f.kind)) {
      const e = eds.get(f.changed_by) || (eds.set(f.changed_by, { name: f.changed_by, n: 0, red: 0, by: {}, cust: new Set(), reps: new Set() }).get(f.changed_by));
      e.n++; if (f.severity === 'red') e.red++; e.by[f.kind] = (e.by[f.kind] || 0) + 1; e.cust.add(id); if (f.rep_name) e.reps.add(f.rep_name);
    }
    if (f.group_key) {
      const g = groups.get(f.group_key) || (groups.set(f.group_key, { key: f.group_key, kind: f.kind, red: false, ids: new Set(), reps: new Set(), names: new Set(), offices: new Set(), detail: f.detail, flags: [] }).get(f.group_key));
      g.ids.add(id); (f.related_customer_ids || []).forEach(x => g.ids.add(String(x)));
      if (f.rep_name) g.reps.add(f.rep_name); if (f.customer_name) g.names.add(String(f.customer_name).toLowerCase()); if (f.office) g.offices.add(f.office);
      if (f.severity === 'red') g.red = true; g.flags.push(f);
    }
  }
  for (const c of cases.values()) { c.score += 3 * Math.max(0, c.kinds.size - 1); }
  for (const c of cases.values()) {
    if (!c.rep) continue;
    const r = reps.get(c.rep) || (reps.set(c.rep, { name: c.rep, office: c.office, cust: 0, high: 0, red: 0, score: 0, by: {} }).get(c.rep));
    r.cust++; r.score += c.score; if (c.red) r.red++; if (c.score >= 8) r.high++;
    for (const k of c.kinds) r.by[k] = (r.by[k] || 0) + 1;
  }
  // What each rep sold in the last 12 months — the denominator, so a big seller isn't the "riskiest" by volume.
  const subs = state.reportingSubscriptions || [];
  if (subs.length) {
    const cut = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
    const sold = new Map();
    for (const s of subs) { if (!s.sold_by || String(s.sold_date || '') < cut) continue; const k = _aiNorm(s.sold_by); (sold.get(k) || sold.set(k, new Set()).get(k)).add(s.customer_id); }
    for (const r of reps.values()) { const s = sold.get(_aiNorm(r.name)); r.sold = s ? s.size : null; }
  }
  return { cases: [...cases.values()], reps: [...reps.values()], eds: [...eds.values()], groups: [...groups.values()] };
}

function accountIntegrityView() {
  if (!isAdminRole(state.profile?.role)) return el('div', { class: 'card p-4 text-xs text-muted-' }, 'Account Integrity is for admins.');
  _aiLoad();
  const C = state._aiCache || {};
  const sum = (C.run && C.run.summary) || {};
  const kind = AI_KINDS.some(k => k[0] === state._aiKind) ? state._aiKind : 'red';
  const view = ['cases', 'reps', 'editors', 'linked', 'flags'].includes(state._aiView) ? state._aiView : 'cases';
  const rep = state._aiRep || '', editor = state._aiEditor || '', office = state._aiOffice || '';
  const fmtWhen = (t) => { try { return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const day = (t) => { if (!t) return ''; try { return new Date(String(t).length <= 10 ? t + 'T12:00:00' : t).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }); } catch (e) { return String(t).slice(0, 10); } };
  const muted = { color: 'var(--text-muted)' };
  const set = (k, v) => () => { state[k] = v; state._aiLimit = 0; mountApp(); };
  const chip = (on, label, title, onclick) => el('button', {
    type: 'button', title: title || '', onclick,
    class: 'rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition',
    style: on ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
  }, label);
  const pill = (f) => el('span', { class: 'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold whitespace-nowrap mr-1 mb-1', title: f.detail || '', style: { background: f.severity === 'red' ? 'rgba(220,38,38,.12)' : 'rgba(217,119,6,.12)', color: f.severity === 'red' ? '#B91C1C' : '#B45309' } }, AI_SHORT[f.kind] || f.kind);
  const th = (t, help) => el('th', { class: 'text-left px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', title: help || '', style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
  const td = (v, cls, o = {}) => el('td', { class: 'px-2.5 py-2 align-top ' + (cls || ''), title: o.title || '', onclick: o.onclick, style: Object.assign({ cursor: o.onclick ? 'pointer' : undefined }, o.style || {}) }, v == null || v === '' ? '—' : v);
  const table = (head, body, foot) => el('div', { class: 'card overflow-hidden' }, el('div', { class: 'scroll-x', style: { maxHeight: '72vh', overflowY: 'auto' } }, el('table', { class: 'w-full text-xs' }, el('thead', {}, el('tr', {}, ...head)), el('tbody', {}, ...body)), foot || null));
  const heat = (n, max) => n ? { background: 'rgba(220,38,38,' + (0.06 + 0.34 * Math.min(1, n / Math.max(1, max))).toFixed(2) + ')' } : {};

  // ── Header: freshness, the scoring note, and the filters that apply to every view.
  const D = C.rows && C.rows.length ? (C.derived || (C.derived = _aiDerive(C.rows))) : null;
  const offices = D ? [...new Set(C.rows.map(f => f.office).filter(o => o && !/^Office -/.test(o)))].sort() : [];
  const head = el('div', { class: 'card p-4 flex flex-col gap-3' },
    el('div', { class: 'flex items-start justify-between gap-3 flex-wrap' },
      el('div', {},
        el('div', { class: 'flex items-baseline gap-3 flex-wrap' },
          el('h3', { class: 'text-base font-bold' }, 'Account Integrity'),
          el('span', { class: 'text-[11px] text-muted-' }, C.run ? 'Anti-fraud review · updated ' + fmtWhen(C.run.finished_at) : C.loading ? 'Loading…' : 'Runs nightly — no run yet')),
        el('div', { class: 'text-[11px] mt-1', style: muted }, D ? Number(C.rows.length).toLocaleString() + ' flags on ' + Number(D.cases.length).toLocaleString() + ' customers · ' + Number(D.cases.filter(c => c.score >= 8).length).toLocaleString() + ' high-risk cases' : '')),
      configInfoBtn('Account Integrity', 'Edits from the FieldRoutes change log (last 90 days) and contact details shared across accounts sold in the last year, recomputed nightly. Red = worth a look now; amber = check, often innocent (a typo fix, a family with two properties — link those in FieldRoutes and they drop off). Risk score per customer = the sum of its flags (rep’s own contact 5 red / 3 amber · phone one-digit 4 / 2 · shared card 3 / 2 · email edit 3 / 1 · autopay off 3 / 1 · shared contact 2 / 1) plus 3 for every extra KIND of signal on the same customer. High = 8+, Medium = 4–7, Low = under 4. Rep flag rate = flagged customers ÷ customers the rep sold in the last 12 months.')),
    // Signal tiles: what each check found; click to narrow every view to it.
    el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))', gap: '8px' } },
      ...AI_KINDS.map(([k, l, t]) => {
        const on = kind === k, n = k === 'red' ? sum.red : sum[k];
        const red = D && k !== 'red' ? C.rows.filter(f => f.kind === k && f.severity === 'red').length : null;
        return el('button', { type: 'button', title: t, onclick: set('_aiKind', on && k !== 'red' ? 'red' : k), class: 'rounded-lg border p-2.5 text-left transition',
          style: on ? { borderColor: 'var(--accent)', background: 'var(--card-2)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : { borderColor: 'var(--border-2)', background: 'var(--card)' } },
          el('div', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: muted }, k === 'red' ? 'All red flags' : (AI_SHORT[k] || l)),
          el('div', { class: 'text-lg font-black tabular-nums' }, n != null ? Number(n).toLocaleString() : '—'),
          el('div', { class: 'text-[10px]', style: { color: red ? '#B91C1C' : 'var(--text-subtle)' } }, k === 'red' ? 'every signal' : red != null ? Number(red).toLocaleString() + ' red' : ''));
      })),
    el('div', { class: 'flex flex-wrap items-center gap-1.5' },
      ...[['cases', 'Cases'], ['reps', 'Reps'], ['editors', 'Edited by'], ['linked', 'Linked accounts'], ['flags', 'All flags']].map(([v, l]) => chip(view === v, l, '', set('_aiView', v))),
      el('span', { class: 'mx-1', style: { color: 'var(--border-2)' } }, '|'),
      offices.length ? el('select', { class: 'rounded-full border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { state._aiOffice = e.target.value; state._aiLimit = 0; mountApp(); } },
        el('option', { value: '' }, 'All offices'), ...offices.map(o => el('option', { value: o, selected: office === o }, o))) : null,
      rep ? chip(true, '× Rep: ' + rep, 'Clear', set('_aiRep', '')) : null,
      editor ? chip(true, '× Edited by: ' + editor, 'Clear', set('_aiEditor', '')) : null));

  if (C.loading && !C.rows) return el('div', { class: 'flex flex-col gap-4' }, head, el('div', { class: 'card p-6 text-center text-xs text-muted-' }, 'Loading flags…'));
  if (C.error) return el('div', { class: 'flex flex-col gap-4' }, head, el('div', { class: 'card p-4 text-xs', style: { color: '#B91C1C' } }, C.error));
  if (!D) return el('div', { class: 'flex flex-col gap-4' }, head, el('div', { class: 'card p-6 text-center text-xs text-muted-' }, C.run ? 'Nothing flagged.' : 'No flags yet — they appear after the first nightly run.'));

  // The filters, applied the same way everywhere.
  const fOk = (f) => (kind === 'red' ? f.severity === 'red' : f.kind === kind) && (!office || f.office === office) && (!rep || f.rep_name === rep) && (!editor || f.changed_by === editor);
  const limit = state._aiLimit || 200;
  const more = (n) => n > limit ? el('div', { class: 'px-3 py-2 text-[11px]' }, el('button', { type: 'button', class: 'font-semibold', style: { color: 'var(--accent)' }, onclick: () => { state._aiLimit = limit + 300; mountApp(); } }, 'Show more'), el('span', { style: muted }, ' · showing ' + limit.toLocaleString() + ' of ' + n.toLocaleString())) : null;
  const open = state._aiOpen || (state._aiOpen = new Set());
  const flagRows = (fs) => fs.map(f => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } },
    td(''), td(pill(f)), td(f.detail, '', { style: { color: 'var(--text)' } }),
    td(f.old_value || f.new_value ? el('span', { class: 'tabular-nums', style: { overflowWrap: 'anywhere' } }, (f.old_value || '—') + ' → ' + (f.new_value || '—')) : (f.related_customer_ids && f.related_customer_ids.length ? 'also #' + f.related_customer_ids.slice(0, 6).join(', #') + (f.related_customer_ids.length > 6 ? ' +' + (f.related_customer_ids.length - 6) : '') : null)),
    td(f.changed_by ? 'by ' + f.changed_by : '', 'whitespace-nowrap'), td(day(f.changed_at) || (f.sold_on ? 'sold ' + day(f.sold_on) : ''), 'whitespace-nowrap tabular-nums'), td('')));

  let body;
  if (view === 'cases') {
    // A case shows when ANY of its flags passes the filters; its score and pills still count every flag it has.
    const list = D.cases.filter(c => c.flags.some(fOk)).sort((a, b) => b.score - a.score || b.kinds.size - a.kinds.size || String(b.last).localeCompare(String(a.last)));
    body = table([th('Risk', 'Score = flag weights + 3 per extra kind of signal'), th('Customer'), th('Signals'), th('Sold by'), th('Office'), th('Latest'), th('')],
      list.slice(0, limit).flatMap(c => {
        const [tier, col] = AI_TIER(c.score), isOpen = open.has(c.id);
        const toggle = () => { isOpen ? open.delete(c.id) : open.add(c.id); mountApp(); };
        return [el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', cursor: 'pointer' }, onclick: toggle },
          td(el('div', { class: 'flex items-center gap-2' }, el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: col } }), el('span', { class: 'font-black tabular-nums' }, String(c.score)), el('span', { class: 'text-[10px] font-semibold', style: { color: col } }, tier)), 'whitespace-nowrap'),
          td(el('div', {}, el('div', { class: 'font-semibold' }, c.name || '—'), el('div', { class: 'text-[10px] tabular-nums text-muted-' }, '#' + c.id + ' · ' + c.flags.length + ' flag' + (c.flags.length === 1 ? '' : 's')))),
          td(el('div', { class: 'flex flex-wrap' }, ...[...c.kinds].map(k => pill(c.flags.find(f => f.kind === k && f.severity === 'red') || c.flags.find(f => f.kind === k))))),
          td(c.rep, 'whitespace-nowrap'), td(c.office, 'whitespace-nowrap'), td(day(c.last), 'whitespace-nowrap tabular-nums'),
          td(isOpen ? '▴' : '▾', 'text-muted-'))].concat(isOpen ? flagRows(c.flags) : []);
      }), more(list.length));
  } else if (view === 'reps') {
    // Per rep: flagged customers among what they sold. Sorted by high-risk cases, then flag rate.
    const keep = D.cases.filter(c => c.flags.some(fOk));
    const by = new Map(), R0 = new Map(D.reps.map(r => [r.name, r]));
    for (const c of keep) { if (!c.rep) continue; const r0 = R0.get(c.rep); const r = by.get(c.rep) || (by.set(c.rep, { name: c.rep, office: c.office, sold: r0 ? r0.sold : null, cust: 0, high: 0, red: 0, by: {} }).get(c.rep)); r.cust++; if (c.score >= 8) r.high++; if (c.red) r.red++; for (const k of c.kinds) r.by[k] = (r.by[k] || 0) + 1; }
    const list = [...by.values()].sort((a, b) => b.high - a.high || (b.sold ? b.cust / b.sold : 0) - (a.sold ? a.cust / a.sold : 0) || b.cust - a.cust);
    const ks = Object.keys(AI_SHORT); const mx = Object.fromEntries(ks.map(k => [k, Math.max(0, ...list.map(r => r.by[k] || 0))]));
    body = table([th('Rep'), th('Office'), th('Sold (12 mo)', 'Customers the rep sold in the last 12 months'), th('Flagged', 'Customers with a flag'), th('Flag rate', 'Flagged ÷ sold'), th('High-risk', 'Cases scoring 8+'), ...ks.map(k => th(AI_SHORT[k], 'Customers with this signal'))],
      list.slice(0, limit).map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', cursor: 'pointer' }, title: 'Open this rep’s cases', onclick: () => { state._aiRep = r.name; state._aiView = 'cases'; state._aiLimit = 0; mountApp(); } },
        td(r.name, 'font-semibold whitespace-nowrap'), td(r.office, 'whitespace-nowrap'), td(r.sold != null ? r.sold.toLocaleString() : '—', 'tabular-nums'),
        td(r.cust.toLocaleString(), 'tabular-nums font-semibold'),
        td(r.sold ? (r.cust / r.sold * 100).toFixed(1) + '%' : '—', 'tabular-nums font-black', { title: r.sold && r.sold < 20 ? 'Under 20 sales in 12 months — flags on older accounts can push this past 100%' : '', style: { color: r.sold >= 20 && r.cust / r.sold >= 0.25 ? '#B91C1C' : r.sold && r.sold < 20 ? 'var(--text-subtle)' : undefined } }),
        td(r.high ? r.high.toLocaleString() : '—', 'tabular-nums font-black', { style: { color: r.high ? '#B91C1C' : undefined } }),
        ...ks.map(k => td(r.by[k] ? r.by[k].toLocaleString() : '', 'tabular-nums text-center', { style: heat(r.by[k], mx[k]) })))), more(list.length));
  } else if (view === 'editors') {
    // Who made the edits behind the change-log flags (phone, email, autopay).
    const fs = C.rows.filter(f => f.changed_by && /phone_one_digit|email_small_edit|autopay_off/.test(f.kind) && fOk(Object.assign({}, f, { severity: kind === 'red' ? f.severity : f.severity })) );
    const by = new Map();
    for (const f of fs) { const e = by.get(f.changed_by) || (by.set(f.changed_by, { name: f.changed_by, n: 0, red: 0, by: {}, cust: new Set(), reps: new Set() }).get(f.changed_by)); e.n++; if (f.severity === 'red') e.red++; e.by[f.kind] = (e.by[f.kind] || 0) + 1; e.cust.add(String(f.customer_id)); if (f.rep_name) e.reps.add(f.rep_name); }
    const list = [...by.values()].sort((a, b) => b.red - a.red || b.n - a.n);
    const ks = ['phone_one_digit', 'email_small_edit', 'autopay_off']; const mx = Object.fromEntries(ks.map(k => [k, Math.max(0, ...list.map(r => r.by[k] || 0))]));
    body = list.length ? table([th('Edited by'), th('Edits'), th('Red'), th('Customers'), th('Reps’ accounts', 'Distinct selling reps whose customers were edited'), ...ks.map(k => th(AI_SHORT[k]))],
      list.slice(0, limit).map(e => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', cursor: 'pointer' }, title: 'Open the cases this person edited', onclick: () => { state._aiEditor = e.name; state._aiView = 'cases'; state._aiLimit = 0; mountApp(); } },
        td(e.name, 'font-semibold whitespace-nowrap'), td(e.n.toLocaleString(), 'tabular-nums'), td(e.red ? e.red.toLocaleString() : '—', 'tabular-nums font-black', { style: { color: e.red ? '#B91C1C' : undefined } }),
        td(e.cust.size.toLocaleString(), 'tabular-nums'), td(e.reps.size.toLocaleString(), 'tabular-nums'),
        ...ks.map(k => td(e.by[k] ? e.by[k].toLocaleString() : '', 'tabular-nums text-center', { style: heat(e.by[k], mx[k]) })))), more(list.length))
      : el('div', { class: 'card p-6 text-center text-xs text-muted-' }, 'No edits under these filters — Edited by covers the phone, email and autopay checks.');
  } else if (view === 'linked') {
    // Sets of unlinked accounts sharing one detail. Biggest sets and sets sold by ONE rep first — a rep selling
    // several "different" customers on one card is the pattern to look at; a family across reps usually isn't.
    const list = D.groups.filter(g => g.flags.some(fOk)).sort((a, b) => (b.red - a.red) || (a.reps.size === 1 && b.reps.size !== 1 ? -1 : b.reps.size === 1 && a.reps.size !== 1 ? 1 : 0) || b.ids.size - a.ids.size);
    body = list.length ? table([th('Shared'), th('Accounts'), th('Names', 'Distinct customer names on the set'), th('Sold by'), th('Office'), th('What'), th('')],
      list.slice(0, limit).flatMap(g => {
        const isOpen = open.has('g:' + g.key); const toggle = () => { isOpen ? open.delete('g:' + g.key) : open.add('g:' + g.key); mountApp(); };
        const oneRep = g.reps.size === 1;
        return [el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', cursor: 'pointer' }, onclick: toggle },
          td(pill(g.flags.find(f => f.severity === 'red') || g.flags[0])), td(g.ids.size.toLocaleString(), 'tabular-nums font-black'), td(g.names.size.toLocaleString(), 'tabular-nums'),
          td(oneRep ? el('span', { class: 'font-semibold', style: { color: '#B91C1C' } }, [...g.reps][0] + ' (all)') : g.reps.size + ' reps', 'whitespace-nowrap'),
          td([...g.offices].join(', '), 'whitespace-nowrap'), td(g.detail), td(isOpen ? '▴' : '▾', 'text-muted-'))].concat(isOpen ? flagRows(g.flags) : []);
      }), more(list.length))
      : el('div', { class: 'card p-6 text-center text-xs text-muted-' }, 'No linked accounts under these filters — this view covers shared card and shared phone / email / address.');
  } else {
    const list = C.rows.filter(fOk).sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'red' ? -1 : 1) || String(b.changed_at || '').localeCompare(String(a.changed_at || '')));
    const dot = (sev) => el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: sev === 'red' ? '#DC2626' : '#D97706' } });
    body = table([th(''), th('Customer'), th('Office'), th('Sold by'), th('What happened'), th('Change'), th('Changed by'), th('When')],
      list.slice(0, limit).map(f => el('tr', { class: 'border-t border-' },
        td(dot(f.severity)),
        td(el('div', {}, el('div', { class: 'font-semibold' }, f.customer_name || '—'), el('div', { class: 'text-[10px] tabular-nums text-muted-' }, '#' + f.customer_id + (f.related_customer_ids && f.related_customer_ids.length ? ' · also #' + f.related_customer_ids.slice(0, 4).join(', #') + (f.related_customer_ids.length > 4 ? ' +' + (f.related_customer_ids.length - 4) : '') : '')))),
        td(f.office, 'whitespace-nowrap'), td(f.rep_name, 'whitespace-nowrap'), td(f.detail),
        td(f.old_value || f.new_value ? el('span', { class: 'tabular-nums', style: { overflowWrap: 'anywhere' } }, (f.old_value || '—') + ' → ' + (f.new_value || '—')) : null),
        td(f.changed_by, 'whitespace-nowrap'), td(day(f.changed_at) || (f.sold_on ? 'sold ' + day(f.sold_on) : ''), 'whitespace-nowrap tabular-nums'))), more(list.length));
  }
  return el('div', { class: 'flex flex-col gap-4' }, head, body);
}
