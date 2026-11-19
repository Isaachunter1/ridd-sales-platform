// ┌─ src/21-review-marks.js ───────────────────────────────────────────────
// │ Reviewed check-offs (per Isaac, Oct 15) for the Auditing tasks and the
// │ Marketing "Needs attention" list: tick a task once it has been looked at
// │ and it leaves the list — until something NEW shows up in it (an account
// │ that wasn't there when it was ticked, or a changed count for tasks that
// │ don't list accounts). Shared by every admin: app_settings 'review_marks'
// │ = { taskKey: { ids: [...], sig, at, by } }.
// │ Also: the service-type → contract-length audit (auditing/service-changes.json).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function rvLoad() {
  if (state._reviewMarks !== undefined) return;
  state._reviewMarks = {};
  if (typeof supabase === 'undefined' || !supabase || (typeof DEMO !== 'undefined' && DEMO)) return;
  Promise.resolve(supabase.from('app_settings').select('value').eq('key', 'review_marks').maybeSingle())
    .then(({ data }) => { if (data && data.value && typeof data.value === 'object') { state._reviewMarks = data.value; mountApp(); } }).catch(() => {});
}
function _rvSave() {
  if (typeof supabase === 'undefined' || !supabase || (typeof DEMO !== 'undefined' && DEMO)) return;
  Promise.resolve(supabase.from('app_settings').upsert({ key: 'review_marks', value: state._reviewMarks || {} }, { onConflict: 'key' }))
    .then(({ error }) => { if (error) toast('Couldn’t save the check-off: ' + error.message, 'error'); }).catch(() => {});
}
function rvSet(key, item, on) {
  rvLoad();
  const M = Object.assign({}, state._reviewMarks || {});
  if (on) M[key] = { ids: item.rvIds ? [...new Set(item.rvIds.map(String))].slice(0, 20000) : null, sig: _rvSig(item), at: new Date().toISOString(), by: (state.profile && state.profile.full_name) || '' };
  else delete M[key];
  state._reviewMarks = M; _rvSave(); mountApp();
}
function _rvSig(i) { return i.count != null ? 'n:' + i.count : String(i.text || ''); }
// Per-account check-offs (per Isaac, Nov 16): the boxes live in the task's Review table, one per row. A task leaves
// the Auditing list once every account in it is ticked; a new account brings it back with just what's left.
function rvHasId(key, id) { rvLoad(); const m = (state._reviewMarks || {})[key]; return !!(m && m.ids && m.ids.indexOf(String(id)) >= 0); }
function rvSetId(key, id, on) {
  rvLoad();
  const M = Object.assign({}, state._reviewMarks || {}); const cur = M[key] && M[key].ids ? M[key].ids.map(String) : [];
  const set = new Set(cur); if (on) set.add(String(id)); else set.delete(String(id));
  if (set.size) M[key] = { ids: [...set].slice(0, 20000), sig: null, at: new Date().toISOString(), by: (state.profile && state.profile.full_name) || '' }; else delete M[key];
  state._reviewMarks = M; _rvSave();
}
// Split items into what still needs a look and what's been checked off. A checked task with new accounts comes
// back with just the new ones (count, text and — when it can — its Review list).
function rvApply(items) {
  rvLoad();
  const M = state._reviewMarks || {};
  const active = [], done = [];
  for (const i of items) {
    if (!i || i.sev === 'ok') { if (i) active.push(i); continue; }
    const k = i.rvKey || i.key || i.tag; const m = M[k];
    if (!m) { active.push(i); continue; }
    if (i.rvIds && m.ids) {
      const seen = new Set(m.ids.map(String)); const nw = i.rvIds.map(String).filter(id => !seen.has(id));
      if (!nw.length) { done.push(Object.assign({}, i, { _rvMark: m })); continue; }
      // Some accounts ticked in the Review table, some not (per Isaac, Nov 16): the count is what's left; Review
      // opens the whole list with the ticked rows greyed, so one can be unticked.
      const nDone = i.rvIds.length - nw.length;
      active.push(Object.assign({}, i, { count: nw.length, _rvNew: m, text: i.text + (nDone ? ' · ' + nDone + ' checked off' : '') }));
      continue;
    }
    if (m.sig === _rvSig(i)) done.push(Object.assign({}, i, { _rvMark: m })); else active.push(Object.assign({}, i, { _rvNew: m }));
  }
  return { active, done };
}
function rvBox(i) {
  // Tasks with a Review table are ticked row by row inside it (per Isaac, Nov 16) — no box on the list.
  if (!i || i.sev === 'ok' || (i.rvIds && !i._rvMark)) return el('span', { style: { width: '15px', flexShrink: '0' } });
  const k = i.rvKey || i.key || i.tag;
  return el('input', { type: 'checkbox', checked: !!i._rvMark, title: i._rvMark ? 'Checked off by ' + (i._rvMark.by || 'an admin') + ' ' + fmt.dateShort(String(i._rvMark.at).slice(0, 10)) + ' — untick to bring it back' : 'Reviewed — check it off (it comes back if something new shows up)',
    style: { width: '15px', height: '15px', accentColor: 'var(--accent)', cursor: 'pointer', flexShrink: '0' },
    onclick: (e) => e.stopPropagation(), onchange: (e) => rvSet(k, i, e.target.checked) });
}
// The "checked off" footer line: each one can be unticked to bring it back.
function rvDoneLine(done) {
  if (!done.length) return null;
  return el('div', { class: 'px-4 py-2 border-t text-[11px] flex items-center gap-2 flex-wrap', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } },
    el('span', { style: { fontWeight: 700 } }, '☑ Checked off:'),
    ...done.map(i => el('label', { class: 'inline-flex items-center gap-1 cursor-pointer', title: 'Checked off by ' + (i._rvMark.by || 'an admin') + ' ' + fmt.dateShort(String(i._rvMark.at).slice(0, 10)) + ' — untick to bring it back' },
      rvBox(i), el('span', {}, i.title || i.tag))));
}

// ── Service type changed → contract length (per Isaac, Oct 15) ────────────────
// Changing a plan's service in FieldRoutes often changes its agreement length too, so a rep can be paid on a
// term the account no longer has. The RevHawk sync publishes every service-type change from the change log
// (auditing/service-changes.json, every 6 hours); this compares it to the term each app sale was paid on.
function _svcChgLoad() {
  if (state._svcChg !== undefined) return;
  state._svcChg = null;
  if (typeof supabase === 'undefined' || !supabase || (typeof DEMO !== 'undefined' && DEMO)) { state._svcChg = { rows: [] }; return; }
  Promise.resolve(supabase.storage.from('reporting').download('auditing/service-changes.json?t=' + Date.now()))
    .then(async ({ data, error }) => { if (error || !data) { state._svcChg = { missing: true, rows: [] }; } else { const j = JSON.parse(await data.text());
      const c = j.cols || []; state._svcChg = { at: j.at, since: j.changelog_since, rows: (j.rows || []).map(r => Object.fromEntries(c.map((k, i) => [k, r[i]]))) }; } mountApp(); })
    .catch(e => { state._svcChg = { error: String(e.message || e), rows: [] }; mountApp(); });
}
function serviceChangeAuditItem() {
  _svcChgLoad();
  const D = state._svcChg;
  const sales = new Map(); for (const s of (state.allSales || [])) if (s.crm_subscription_id != null && s.sale_kind !== 'upsell') sales.set(String(s.crm_subscription_id), s);
  const bySid = new Map(); for (const r of ((D && D.rows) || [])) { const k = String(r.sid); (bySid.get(k) || bySid.set(k, []).get(k)).push(r); }
  const H = (iso) => Date.parse(String(iso || '').replace(' ', 'T'));
  const out = [];
  for (const [sid, list] of bySid) {
    list.sort((a, b) => String(b.at).localeCompare(String(a.at)));
    const last = list[0], sale = sales.get(sid);
    const paidM = sale ? Number(sale.contract_months) || 0 : 0, cur = Number(last.curLen) || 0;
    const afterSale = sale ? list.filter(r => String(r.at).slice(0, 10) >= String(sale.sold_date || '').slice(0, 10)) : [];
    const moved = list.filter(r => r.lenOld != null && r.lenNew != null && r.lenOld !== r.lenNew && (H(r.at) - H(r.added)) > 86400000);
    const chain = (rs) => rs.slice().reverse().map(r => (r.oldSvc || '?') + ' → ' + (r.newSvc || '?') + (r.lenOld != null && r.lenNew != null && r.lenOld !== r.lenNew ? ' (' + r.lenOld + ' → ' + r.lenNew + ' mo)' : '') + ' on ' + String(r.at).slice(0, 10)).join('; ');
    if (sale && afterSale.length && paidM > 1 && cur > 0 && paidM !== cur && String(last.status).toLowerCase() === 'active') {
      out.push({ sid, sev: 'red', last, sale, paidM, cur, text: 'Paid as ' + paidM + ' mo, FieldRoutes now ' + cur + ' mo after ' + chain(afterSale) + (sale.payroll_processed_at ? ' — already paid, likely ' + (paidM > cur ? 'over' : 'under') + 'paid' : ' — not paid yet, fix the term before payroll') });
    }
    // (The amber "contract length moved with the service" rows — 2,231 on Nov 19 — are gone, per Isaac's audit review:
    // a service change that resets the term is normal, not an error. Only a sale PAID on a term the plan no longer
    // has is a task.)
    void moved;
  }
  out.sort((a, b) => (a.sev === b.sev ? 0 : a.sev === 'red' ? -1 : 1) || String(b.last.at).localeCompare(String(a.last.at)));
  const reds = out.filter(x => x.sev === 'red').length;
  const status = !D ? 'checking…' : D.missing || D.error ? 'waiting on the first change-log pull (the RevHawk sync builds it every 6 hours)'
    : !out.length ? 'All clear — no service change left a plan on a different contract length.'
    : out.length + ' sale' + (out.length === 1 ? '' : 's') + ' paid on a term the plan no longer has after a service change — fix the term (or the pay) before payroll' + (D.since ? ' (change log since ' + fmt.dateShort(String(D.since).slice(0, 10)) + ')' : '');
  const detail = el('div', { class: 'border-t', style: { borderColor: 'var(--border)' } }, ...out.slice(0, 600).map((x, i) =>
    el('div', { class: 'flex items-center gap-3 px-4 py-2 border-t text-xs', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'text-[10px] font-bold tabular-nums shrink-0', style: { color: 'var(--text-subtle)', width: '22px', textAlign: 'right' } }, (i + 1) + '.'),
      el('span', { class: 'font-semibold shrink-0', style: { minWidth: '70px' } }, '#' + x.last.cust),
      el('span', { class: 'shrink-0', style: { minWidth: '170px', color: 'var(--text-muted)' } }, (x.last.curSvc || '') + ' · sub ' + x.sid),
      el('span', { class: 'shrink-0 font-semibold', style: { minWidth: '120px' } }, x.sale ? ((state.allProfiles || []).find(p => p.id === x.sale.rep_id) || {}).full_name || x.sale.crm_seller_name || 'Unlinked' : 'not an app sale'),
      el('span', { class: 'flex-1 min-w-0', style: { color: x.sev === 'red' ? '#DC2626' : 'var(--text-muted)' } }, x.text))));
  return { key: 'svcchg', tag: 'Term', title: 'Service changed, contract length off', sev: !D || !Array.isArray(D.rows) ? 'amber' : reds ? 'red' : out.length ? 'amber' : 'ok',
    count: D && Array.isArray(D.rows) && !D.missing ? out.length : null, text: status, detail: out.length ? detail : undefined,
    rvIds: out.map(x => x.sid + '|' + x.last.at + '|' + x.paidM + '|' + x.cur) };
}
