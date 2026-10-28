// ┌─ Reporting → Auditing → Account Integrity ──────────────────────────────
// │ (per Isaac, Oct 20 + Oct 27) Customer-record edits and shared contact
// │ details worth an audit look: one-digit phone changes, small email edits,
// │ autopay turned off soon after the sale, the rep's own contact info on a
// │ customer, one phone / email / address / card on unlinked accounts.
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
  return el('div', { class: 'flex flex-col gap-4' }, tabs, auditTasksCard(), reportingAuditing());
}

// Loads the latest run's summary + the flags for the current filter (one PostgREST read each, paged).
function _aiLoad(key, kind, rep) {
  const C = state._aiCache || (state._aiCache = {});
  if (C.key === key && (C.loading || C.rows)) return;
  Object.assign(C, { key, loading: true, rows: null, error: null });
  (async () => {
    try {
      if (typeof DEMO !== 'undefined' && DEMO) { Object.assign(C, { loading: false, rows: [], run: null }); return; }
      const run = await supabase.from('job_runs').select('finished_at, summary').eq('job', 'account-integrity').eq('status', 'ok').order('started_at', { ascending: false }).limit(1);
      const rows = [];
      for (let from = 0; from < 3000; from += 1000) {
        let q = supabase.from('account_integrity_flags').select('*');
        if (kind === 'red') q = q.eq('severity', 'red'); else q = q.eq('kind', kind);
        if (rep) q = q.eq('rep_name', rep);
        const { data, error } = await q.order('severity', { ascending: false }).order('changed_at', { ascending: false, nullsFirst: false }).order('id').range(from, from + 999);
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

function accountIntegrityView() {
  if (!isAdminRole(state.profile?.role)) return el('div', { class: 'card p-4 text-xs text-muted-' }, 'Account Integrity is for admins.');
  const kind = AI_KINDS.some(k => k[0] === state._aiKind) ? state._aiKind : 'red';
  const rep = state._aiRep || '';
  _aiLoad(kind + '|' + rep, kind, rep);
  const C = state._aiCache || {};
  const sum = (C.run && C.run.summary) || {};
  const fmtWhen = (t) => { try { return new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); } catch (e) { return ''; } };
  const chip = (on, label, n, title, onclick) => el('button', {
    type: 'button', title: title || '', onclick,
    class: 'rounded-full border px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap transition',
    style: on ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', color: 'var(--text)', background: 'var(--card)' },
  }, label, n != null ? el('span', { class: 'ml-1 tabular-nums', style: { opacity: on ? '.85' : '.6' } }, Number(n).toLocaleString()) : null);

  const head = el('div', { class: 'card p-4 flex flex-col gap-3' },
    el('div', { class: 'flex items-baseline gap-3 flex-wrap' },
      el('h3', { class: 'text-base font-bold' }, 'Account Integrity'),
      el('span', { class: 'text-[11px] text-muted-' }, C.run ? 'Updated ' + fmtWhen(C.run.finished_at) + ' · ' + Number(sum.total || 0).toLocaleString() + ' flags · ' + Number(sum.red || 0).toLocaleString() + ' red' : C.loading ? 'Loading…' : 'Runs nightly — no run yet')),
    el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Edits from the FieldRoutes change log (last 90 days) and contact details shared across accounts sold in the last year. Red = worth a look now; amber = check, often innocent (a typo fix, a family with two properties — link those in FieldRoutes and they drop off).'),
    el('div', { class: 'flex flex-wrap gap-1.5' }, ...AI_KINDS.map(([k, l, t]) => chip(kind === k, l, k === 'red' ? sum.red : sum[k], t, () => { state._aiKind = k; mountApp(); }))),
    (sum.topReps && sum.topReps.length) ? el('div', { class: 'flex flex-wrap items-center gap-1.5' },
      el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold mr-1', style: { color: 'var(--text-subtle)' } }, 'By rep'),
      rep ? chip(false, '× ' + rep, null, 'Show every rep', () => { state._aiRep = ''; mountApp(); }) : null,
      ...sum.topReps.map(([name, red, total]) => chip(rep === name, name, null, red + ' red · ' + total + ' total', () => { state._aiRep = rep === name ? '' : name; mountApp(); }))) : null);

  let body;
  if (C.loading && !C.rows) body = el('div', { class: 'card p-6 text-center text-xs text-muted-' }, 'Loading flags…');
  else if (C.error) body = el('div', { class: 'card p-4 text-xs', style: { color: '#B91C1C' } }, C.error);
  else if (!C.rows || !C.rows.length) body = el('div', { class: 'card p-6 text-center text-xs text-muted-' }, C.run ? 'Nothing flagged here.' : 'No flags yet — they appear after the first nightly run.');
  else {
    const th = (t) => el('th', { class: 'text-left px-2.5 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
    const td = (v, cls, title) => el('td', { class: 'px-2.5 py-2 align-top ' + (cls || ''), title: title || '' }, v == null || v === '' ? '—' : v);
    const dot = (sev) => el('span', { class: 'inline-block rounded-full', style: { width: '8px', height: '8px', background: sev === 'red' ? '#DC2626' : '#D97706' } });
    const when = (f) => f.changed_at ? new Date(f.changed_at).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : (f.sold_on ? 'sold ' + f.sold_on : '');
    body = el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'scroll-x', style: { maxHeight: '70vh', overflowY: 'auto' } },
        el('table', { class: 'w-full text-xs' },
          el('thead', {}, el('tr', {}, th(''), th('Customer'), th('Office'), th('Sold by'), th('What happened'), th('Change'), th('Changed by'), th('When'))),
          el('tbody', {}, ...C.rows.map(f => el('tr', { class: 'border-t border-' },
            td(dot(f.severity)),
            td(el('div', {}, el('div', { class: 'font-semibold' }, f.customer_name || '—'), el('div', { class: 'text-[10px] tabular-nums text-muted-' }, '#' + f.customer_id + (f.related_customer_ids && f.related_customer_ids.length ? ' · also #' + f.related_customer_ids.slice(0, 4).join(', #') + (f.related_customer_ids.length > 4 ? ' +' + (f.related_customer_ids.length - 4) : '') : '')))),
            td(f.office, 'whitespace-nowrap'),
            td(f.rep_name, 'whitespace-nowrap'),
            td(f.detail),
            td(f.old_value || f.new_value ? el('span', { class: 'tabular-nums', style: { overflowWrap: 'anywhere' } }, (f.old_value || '—') + ' → ' + (f.new_value || '—')) : null),
            td(f.changed_by, 'whitespace-nowrap'),
            td(when(f), 'whitespace-nowrap tabular-nums'))))),
        C.rows.length >= 3000 ? el('div', { class: 'px-3 py-2 text-[11px] text-muted-' }, 'Showing the first 3,000 — pick a rep or a narrower flag to see the rest.') : null));
  }
  return el('div', { class: 'flex flex-col gap-4' }, head, body);
}
