// ┌─ Marketing → Lead → opportunity monitor (per Isaac, Nov 19) ──────────────
// │ Every inbound contact in GoHighLevel should get an opportunity. In Nov 2026
// │ Google Local Services calls stopped getting them around Oct 29 and Google Ads
// │ around Nov 6 (73% → 6%, 93% → 8%) and nobody saw it for three weeks. This card
// │ checks it every day: per source group, every new contact splits into Opportunity
// │ (an opportunity on the same phone / email within 5 days) or Contact only — the two
// │ add to 100% (per Isaac, Nov 19). Contact only is expected for current customers
// │ (they're kept out of the sales pipeline) and a miss for everyone else. Last 7 days
// │ against the 28 days before; the alarm reads non-customers only. Red when a source that normally gets
// │ opportunities falls under half its usual rate.
// └────────────────────────────────────────────────────────────────────────────
function _lomData() {
  const G = state._ghl; if (!G || !G.rows || !G.opps) return null;
  const M = _lomData._m; if (M && M.rows === G.rows && M.opps === G.opps && M.subs === state.reportingSubscriptions) return M.out;
  const lab = G.labels || [];
  const grpOf = new Map();
  // Every lead source (per Isaac, Nov 19): grouped the way the rest of Marketing groups them — the GoHighLevel label's
  // provider (Settings → Configurations → GoHighLevel sources). Labels that aren't a new lead (door to door, CRM
  // workflows) stay out; a label nothing maps goes under one Unmapped row
  // (not every raw label: Premiere League, Loyalty, null…); Local Presence is a callback number, not a source (per Isaac, Nov 23).
  const gOf = (i) => { if (i == null || i < 0) return null; if (grpOf.has(i)) return grpOf.get(i); const l = String(lab[i] || '').trim(); let g = l && !/^null$/i.test(l) && !(typeof MKP_NOT_A_SOURCE !== 'undefined' && MKP_NOT_A_SOURCE.test(l)) ? (typeof ghlProviderOf === 'function' ? ghlProviderOf(l) : '') || 'Unmapped' : null; if (g === (typeof GHL_NOT_LEAD !== 'undefined' ? GHL_NOT_LEAD : '__')) g = null; grpOf.set(i, g); return g; };
  const byP = new Map(), byE = new Map();
  for (const o of G.opps) { if (!o || !o[0]) continue; if (o[2]) (byP.get(o[2]) || byP.set(o[2], []).get(o[2])).push(o[0]); if (o[3]) (byE.get(o[3]) || byE.set(o[3], []).get(o[3])).push(o[0]); }
  const day = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const last = G.rows.reduce((a, r) => r[0] > a ? r[0] : a, '');
  // Windows end 2 days before the newest contact so a contact has had time to get its opportunity.
  const end = day(last, -2), curFrom = day(end, -6), prevFrom = day(curFrom, -28), prevTo = day(curFrom, -1);
  // Per window: [non-customer contacts, …with an opportunity] (the alarm) and the full split
  // all = [contacts, opportunity, contact only · current customer, contact only · not a customer].
  const S = {}; const sOf = (g) => S[g] || (S[g] = { cur: [0, 0], prev: [0, 0], all: [0, 0, 0, 0], pall: [0, 0, 0, 0], days: {} });
  const missed = [];   // non-customer contacts with no opportunity — the export for Pest AI
  for (const r of G.rows) {
    const d = r[0]; if (!d || d < prevFrom || d > end) continue;
    const g = gOf(r[1]); if (!g) continue;
    const cust = !!(r[4] && typeof ghlIsCurrentCustomer === 'function' && ghlIsCurrentCustomer(r[4], d));
    const hi = day(d, 5), lo = day(d, -1);
    const has = [].concat((r[4] && byP.get(r[4])) || [], (r[5] && byE.get(r[5])) || []).some(x => x >= lo && x <= hi);
    const X = sOf(g);
    const A = d >= curFrom ? X.all : X.pall; A[0]++; if (has) A[1]++; else if (cust) A[2]++; else A[3]++;
    if (!has && !cust) missed.push({ d, t: r[7] || '', g, label: String(lab[r[1]] || ''), p: r[4] || '', e: r[5] || '' });
    if (cust) continue;
    const b = d >= curFrom ? X.cur : X.prev; b[0]++; if (has) b[1]++;
  }
  const rows = Object.keys(S).map((g) => {
    const s = S[g], cr = s.cur[0] ? s.cur[1] / s.cur[0] : null, pr = s.prev[0] ? s.prev[1] / s.prev[0] : null;
    // Red: normally ≥ 50% get one, at least 5 contacts this week, and the rate fell under half of usual.
    const broken = pr != null && pr >= 0.5 && s.cur[0] >= 5 && cr != null && cr < pr * 0.5;
    const soft = !broken && pr != null && pr >= 0.5 && s.cur[0] >= 5 && cr != null && cr < pr - 0.2;
    // Contacts dried up (PestBooker went from ~45 a week to 0 in Nov 2026): under a quarter of its usual weekly volume.
    const wk = s.prev[0] / 4, dry = wk >= 10 && s.cur[0] < wk * 0.25;
    return { g, cur: s.cur, prev: s.prev, all: s.all, pall: s.pall, cr, pr, broken: broken || dry, dry, soft, days: s.days };
  }).filter(r => r.all[0] || r.pall[0]).sort((a, b) => (b.broken - a.broken) || (b.soft - a.soft) || (b.all[0] + b.pall[0] / 4) - (a.all[0] + a.pall[0] / 4));
  missed.sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t));
  const out = { rows, end, curFrom, prevFrom, prevTo, missed };
  _lomData._m = { rows: G.rows, opps: G.opps, subs: state.reportingSubscriptions, out };
  return out;
}
function leadOppMonitorCard() {
  const D = _lomData(); if (!D || !D.rows.length) return null;
  const bad = D.rows.filter(r => r.broken).length, soft = D.rows.filter(r => r.soft).length;
  const open = state._lomOpen === true;   // starts closed (per Isaac, Nov 23) — the header line still says when a source is off
  const pct = (v) => v == null ? '—' : Math.round(v * 100) + '%';
  const fmtD = (d) => { const [y, m, dd] = d.split('-'); return Number(m) + '/' + Number(dd); };
  const dot = (c) => el('span', { class: 'inline-block rounded-full shrink-0', style: { width: '8px', height: '8px', background: c } });
  const head = el('button', { type: 'button', class: 'w-full flex items-center gap-2 px-4 py-2.5 text-left', onclick: () => { state._lomOpen = !open; mountApp(); } },
    dot(bad ? '#DC2626' : soft ? '#D97706' : 'var(--ok)'),
    el('span', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'Lead → opportunity'),
    el('span', { class: 'text-[11px]', style: { color: bad ? '#B91C1C' : 'var(--text-muted)' } },
      bad ? bad + ' source' + (bad === 1 ? '' : 's') + ' off: ' + D.rows.filter(r => r.broken).map(r => r.dry ? r.g + ' ' + r.cur[0] + ' contacts (usually ~' + Math.round(r.prev[0] / 4) + '/wk)' : r.g + ' ' + pct(r.cr) + ' get an opportunity (usually ' + pct(r.pr) + ')').join(' · ')
        : soft ? soft + ' source' + (soft === 1 ? '' : 's') + ' below usual' : 'Every source is creating opportunities as usual'),
    el('span', { class: 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, open ? '▴' : '▾'));
  if (!open) return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-oppmon' }, head);
  const th = (t, title) => el('th', { class: 'px-3 py-1.5 text-[10px] uppercase tracking-wider font-semibold text-left whitespace-nowrap', title: title || '', style: { color: 'var(--text-muted)' } }, t);
  const td = (v, o = {}) => el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap' + (o.b ? ' font-black' : ''), style: { color: o.c } }, v);
  return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-oppmon' }, head,
    el('div', { class: 'scroll-x border-t', style: { borderColor: 'var(--border)' } },
      el('table', { class: 'w-full text-xs' },
        el('thead', {}, el('tr', {}, th('Source'), th('Contacts', fmtD(D.curFrom) + '–' + fmtD(D.end) + ' — every new contact'), th('Opportunity', 'Got an opportunity within 5 days'), th('Contact only', 'No opportunity — current customers (expected) and everyone else (missed)'), th('Usual', 'Opportunity share ' + fmtD(D.prevFrom) + '–' + fmtD(D.prevTo) + ', the 28 days before'))),
        el('tbody', {}, ...D.rows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          td(el('span', { class: 'inline-flex items-center gap-2' }, dot(r.broken ? '#DC2626' : r.soft ? '#D97706' : r.pr != null && r.pr < 0.5 ? 'var(--border-2)' : 'var(--ok)'), el('span', { class: 'font-semibold' }, r.g))),
          td(r.all[0].toLocaleString()),
          td(pct(r.all[0] ? r.all[1] / r.all[0] : null) + ' · ' + r.all[1], { b: true, c: r.broken ? '#B91C1C' : r.soft ? '#B45309' : undefined }),
          td(el('span', {}, pct(r.all[0] ? (r.all[2] + r.all[3]) / r.all[0] : null) + ' · ', el('span', { title: 'Current customers — expected' }, r.all[2] + ' customer' + (r.all[2] === 1 ? '' : 's')), ' · ', el('span', { title: 'Not a customer — should have an opportunity', style: { color: r.all[3] ? '#B91C1C' : undefined, fontWeight: r.all[3] ? '700' : undefined } }, r.all[3] + ' missed'))),
          td(pct(r.pall[0] ? r.pall[1] / r.pall[0] : null), { c: 'var(--text-muted)' }))))),
      el('div', { class: 'px-3 pt-2 flex items-center gap-2 flex-wrap' },
        el('button', { type: 'button', class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          title: 'Every contact since ' + fmtD(D.prevFrom) + ' that isn\u2019t a current customer and has no opportunity — send it to Pest AI to reconcile',
          onclick: () => _reportingCsvDownload('contacts-without-opportunity-' + D.end + '.csv', ['Date', 'Time (UTC)', 'Source (GoHighLevel)', 'Channel', 'Phone', 'Email', 'Week'],
            D.missed.map(m => [m.d, m.t, m.label, m.g, m.p, m.e, m.d >= D.curFrom ? 'last 7 days' : 'prior 28 days'])) }, '\u2b07 Export contacts with no opportunity (' + D.missed.length.toLocaleString() + ')'),
        el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, fmtD(D.prevFrom) + '–' + fmtD(D.end) + ' · current customers left out · for Pest AI to reconcile')),
      el('div', { class: 'px-3 py-2 text-[10px]', style: { color: 'var(--text-subtle)' } }, 'GoHighLevel contacts by source. Opportunity + Contact only = 100% of contacts. Contact only splits into current customers (kept out of the pipeline on purpose) and missed — anyone else with no opportunity. An opportunity counts when the same phone or email has one from the day before to 5 days after; the alarm reads non-customers only. The week ends 2 days before the newest contact so each one has had time. Grey dot = a source that rarely gets opportunities anyway.')));
}
