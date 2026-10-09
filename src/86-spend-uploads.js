// ┌─ src/86-spend-uploads.js ────────────────────────────────────────────────
// │ Spend report uploads (per Isaac, Oct 2) — Reporting → Marketing → Spend
// │ entry. Drop any provider's spend report (CSV / Excel, one or many); pick
// │ the channel, the amount column, the date column (or one month for the
// │ whole file) and — when the report has one — the column that says WHERE
// │ the money went (office, market, campaign, ZIP…). Each location value is
// │ mapped to an office once and remembered; spend with no location is split
// │ across offices by that channel's leads for the month. The result lands
// │ in the same branch × channel sheet the controller books from
// │ (marketing.spend[ym][channel][BRANCH]). Uploads are kept as a list so one
// │ can be removed and the sheet recomputed.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const SPU_SPLIT = '__split', SPU_SKIP = '__skip';
function _spuStore() {
  const m = _mktgStore();
  m.spendUploads = Array.isArray(m.spendUploads) ? m.spendUploads : [];   // [{ id, fileName, channel, at, by, total, n, cells: { ym: { BRANCH: amt } } }]
  m.spendLocMap = (m.spendLocMap && typeof m.spendLocMap === 'object') ? m.spendLocMap : {};   // { 'location value' (lowercase): BRANCH | SPU_SPLIT | SPU_SKIP }
  // Remembered mappings (per Isaac, Oct 9): a provider/vendor value → channel, and each report LAYOUT (its column
  // headers) → the columns, channel and default office picked last time — so the next file of the same kind maps itself.
  m.spendProvMap = (m.spendProvMap && typeof m.spendProvMap === 'object') ? m.spendProvMap : {};   // { 'vendor value' (lowercase): channel | SPU_SKIP }
  m.spendTemplates = (m.spendTemplates && typeof m.spendTemplates === 'object') ? m.spendTemplates : {};   // { headerSig: { cols, channel, noLoc, from, at } }
  return m;
}
const _spuNum = (v) => { if (typeof v === 'number') return isFinite(v) ? v : 0; const s = String(v == null ? '' : v).trim(); if (!s) return 0; const neg = /^\(.*\)$/.test(s) || /^-/.test(s); const n = parseFloat(s.replace(/[^0-9.]/g, '')); return isFinite(n) ? (neg ? -n : n) : 0; };
const _spuKey = (v) => String(v == null ? '' : v).trim().toLowerCase();
const _spuSig = (headers) => (headers || []).map(h => String(h).trim().toLowerCase()).filter(h => h && !/^__empty/.test(h)).sort().join('|');
// A provider/vendor value → channel: this file's pick, else remembered, else a channel name inside the value.
function _spuChanOf(val, P, m) {
  const k = _spuKey(val); if (!k) return '';
  return (P.provMap && P.provMap[k]) || m.spendProvMap[k] || (typeof _attrGuessProvider === 'function' ? _attrGuessProvider(val, m.channels) : '') || '';
}
function _spuGuessCols(headers, rows) {
  const pick = (res) => { for (const re of res) { const h = headers.find(x => re.test(String(x))); if (h) return h; } return ''; };
  const numeric = (h) => { let n = 0, k = 0; for (const r of rows.slice(0, 40)) { if (r[h] === '' || r[h] == null) continue; k++; if (_spuNum(r[h]) !== 0 || /^[\s$]*0/.test(String(r[h]))) n++; } return k > 0 && n / k >= 0.7; };
  let amount = '';
  for (const re of [/spend/i, /cost/i, /amount/i, /charge/i, /billed|invoice/i, /total/i, /price|fee/i]) { const h = headers.find(x => re.test(String(x)) && !/per|cpl|cpc|cpm|avg|rate|%/i.test(String(x)) && numeric(x)); if (h) { amount = h; break; } }
  return { amount, date: pick([/^date$/i, /date|day/i, /month|period/i, /created|time/i]), loc: pick([/office|branch/i, /location|market|territory|region/i, /campaign/i, /account/i, /city/i, /zip|postal/i, /state/i]), prov: pick([/vendor|payee|provider|publisher|platform/i]) };
}
// A location value → office: remembered choice, else an office name inside the
// value ("FB | Detroit | RPS" → DETROIT), else a ZIP's office, else split.
function _spuAutoOffice(val, branches, m) {
  const k = _spuKey(val); if (!k) return SPU_SPLIT;
  if (m.spendLocMap[k]) return m.spendLocMap[k];
  const flat = k.replace(/[^a-z0-9]/g, '');
  let best = '';
  for (const b of branches) { const bk = String(b).toLowerCase().replace(/[^a-z0-9]/g, ''); if (bk.length >= 3 && flat.includes(bk) && bk.length > best.replace(/[^a-z0-9]/gi, '').length) best = b; }
  if (best) return best;
  const z = /^\D*(\d{5})(?:-\d{4})?\D*$/.exec(String(val));
  if (z && typeof _ghlZipOffice === 'function') { const o = _ghlZipOffice().get(z[1]); if (o && branches.includes(o)) return o; }
  return SPU_SPLIT;
}
// Office weights for one channel-month: that channel's GoHighLevel leads by
// office, else its FieldRoutes sales, else all new sales.
function _spuWeights(channel, ym, branches) {
  const ok = new Set(branches), w = {}; let how = '';
  const G = (typeof ghlLeads === 'function') ? ghlLeads() : null;
  if (G && G.leads) for (const l of G.leads) if (l.prov === channel && l.office && ok.has(l.office) && String(l.d).slice(0, 7) === ym) w[l.office] = (w[l.office] || 0) + 1;
  if (Object.keys(w).length) how = 'leads';
  else {
    const subs = state.reportingSubscriptions || [], all = {};
    for (const r of subs) {
      if (String(r.sold_date || '').slice(0, 7) !== ym) continue;
      const o = String(r.office_name || '').toUpperCase(); if (!ok.has(o)) continue;
      const src = reportingSourceOf(r);
      if (typeof reportingSourceClass === 'function' && reportingSourceClass(src) !== 'new') continue;
      all[o] = (all[o] || 0) + 1;
      if (src === channel || (typeof reportingProviderOf === 'function' && reportingProviderOf(src) === channel)) w[o] = (w[o] || 0) + 1;
    }
    if (Object.keys(w).length) how = 'sales'; else if (Object.keys(all).length) { Object.assign(w, all); how = 'all sales'; }
  }
  return { w, how };
}
function _spuSplit(amount, w) {
  const ks = Object.keys(w), tot = ks.reduce((t, k) => t + w[k], 0); if (!tot) return null;
  const out = {}; let used = 0, big = ks[0];
  for (const k of ks) { out[k] = Math.round(amount * w[k] / tot * 100) / 100; used += out[k]; if (w[k] > w[big]) big = k; }
  out[big] = Math.round((out[big] + amount - used) * 100) / 100;
  return out;
}
// Turn one pending file into { cells, total, months, unalloc, skipped, locs }.
function _spuCompute(P, branches, m) {
  const cells = {}, raw = {};   // raw[ym] = { located: {B: amt}, split: amt }
  const locs = new Map();       // location value → { amt, n }
  let skipped = 0, noDate = 0, n = 0, outside = 0, outsideN = 0;
  for (const r of P.rows) {
    const amt = _spuNum(r[P.cols.amount]); if (!amt) continue;
    const first = String(r[P.headers[0]] == null ? '' : r[P.headers[0]]);
    if (/^\s*(grand\s+)?totals?\b/i.test(first)) continue;   // a totals row would double the file
    // The month picked for the upload (per Isaac, Oct 9): with a date column only that month's rows count (a
    // report covering several months contributes just its September rows); rows with no date, or a file with
    // no date column, go to the picked month.
    const dYm = P.cols.date ? String(_attrDate(r[P.cols.date]) || '').slice(0, 7) : '';
    let ym = '';
    if (P.forceMonth) { if (dYm && dYm !== P.forceMonth) { outside += amt; outsideN++; continue; } ym = P.forceMonth; }
    else ym = dYm;
    if (!ym) { if (P.month) ym = P.month; else { noDate += amt; continue; } }
    n++;
    const R = raw[ym] = raw[ym] || { located: {}, split: 0 };
    if (!P.cols.loc) { const d = P.noLoc || SPU_SPLIT; if (d === SPU_SPLIT) R.split += amt; else R.located[d] = (R.located[d] || 0) + amt; continue; }
    const val = String(r[P.cols.loc] == null ? '' : r[P.cols.loc]).trim();
    const L = locs.get(val) || { amt: 0, n: 0 }; L.amt += amt; L.n++; locs.set(val, L);
    const to = (P.locMap && P.locMap[_spuKey(val)]) || _spuAutoOffice(val, branches, m);
    if (to === SPU_SKIP) skipped += amt; else if (to === SPU_SPLIT) R.split += amt; else R.located[to] = (R.located[to] || 0) + amt;
  }
  let total = 0, unalloc = 0; const hows = new Set();
  for (const ym of Object.keys(raw)) {
    const c = cells[ym] = Object.assign({}, raw[ym].located);
    if (raw[ym].split) {
      const W = _spuWeights(P.channel, ym, branches), parts = _spuSplit(raw[ym].split, W.w);
      if (parts) { hows.add(W.how); for (const b in parts) c[b] = (c[b] || 0) + parts[b]; } else unalloc += raw[ym].split;
    }
    for (const b in c) { c[b] = Math.round(c[b] * 100) / 100; total += c[b]; }
    if (!Object.keys(c).length) delete cells[ym];
  }
  return { cells, total: Math.round(total * 100) / 100, months: Object.keys(cells).sort(), unalloc, skipped, noDate, outside, outsideN, locs, n, hows: [...hows] };
}
// One file → one result per channel. With a provider column, each row goes to the channel its value maps to.
function _spuComputeAll(P, branches, m) {
  if (!P.cols.prov) return { groups: P.channel ? [{ ch: P.channel, C: _spuCompute(P, branches, m) }] : [], unmapped: new Map(), provs: new Map() };
  const by = new Map(), unmapped = new Map(), provs = new Map();
  for (const r of P.rows) {
    const amt = _spuNum(r[P.cols.amount]); if (!amt) continue;
    const val = String(r[P.cols.prov] == null ? '' : r[P.cols.prov]).trim();
    const pv = provs.get(val) || { amt: 0, n: 0 }; pv.amt += amt; pv.n++; provs.set(val, pv);
    const ch = _spuChanOf(val, P, m);
    if (ch === SPU_SKIP) continue;
    if (!ch) { unmapped.set(val, (unmapped.get(val) || 0) + amt); continue; }
    (by.get(ch) || by.set(ch, []).get(ch)).push(r);
  }
  return { groups: [...by.entries()].map(([ch, rows]) => ({ ch, C: _spuCompute(Object.assign({}, P, { channel: ch, rows }), branches, m) })), unmapped, provs };
}
// Rebuild the controller sheet for one channel's months from every upload of that channel.
function _spuRebuild(m, channel, yms) {
  for (const ym of yms) {
    const sum = {};
    for (const u of m.spendUploads) if (u.channel === channel && u.cells && u.cells[ym]) for (const b in u.cells[ym]) sum[b] = Math.round(((sum[b] || 0) + Number(u.cells[ym][b] || 0)) * 100) / 100;
    m.spend[ym] = m.spend[ym] || {};
    if (Object.keys(sum).length) m.spend[ym][channel] = sum; else delete m.spend[ym][channel];
  }
}
async function _spuUpload(files) {
  const list = Array.from(files || []); if (!list.length) return;
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const m = _spuStore();
  const preset = state._spuPreset || null; state._spuPreset = null;   // set by an Upload button on the checklist
  state._spendPending = state._spendPending || [];
  for (const file of list) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      let any = false;
      for (const sheet of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '', raw: true });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]);
        const cols = _spuGuessCols(headers, rows);
        // Seen this layout before → use the columns / channel / default office picked last time.
        const T = m.spendTemplates[_spuSig(headers)];
        if (T && T.cols) for (const c of ['amount', 'date', 'loc', 'prov']) if (T.cols[c] === '' || headers.includes(T.cols[c])) cols[c] = T.cols[c] || '';
        if (!cols.amount && wb.SheetNames.length > 1) continue;   // a tab with no money column in a multi-tab workbook is not a spend sheet
        any = true;
        state._spendPending.push({ key: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), fileName: wb.SheetNames.length > 1 ? file.name + ' · ' + sheet : file.name,
          headers, rows, cols, channel: (preset && preset.channel) || (T && T.channel) || _attrGuessProvider(file.name + ' ' + sheet, m.channels) || '', month: state._mktEntryMonth || '', forceMonth: (preset && preset.month) || '', noLoc: (T && T.noLoc) || SPU_SPLIT, locMap: {}, provMap: {}, recognized: T ? (T.from || 'an earlier report') : '' });
        if (preset && preset.channel) cols.prov = '';   // uploaded from a provider's checklist row: the whole file is that provider
      }
      if (!any) toast('No spend rows found in ' + file.name, 'error');
    } catch (e) { toast('Could not read ' + file.name + ': ' + (e.message || e), 'error'); }
  }
  mountApp();
}
function _spuCommit(P, branches) {
  const m = _spuStore();
  const A = _spuComputeAll(P, branches, m);
  if (!P.cols.prov && !P.channel) { toast('Pick the channel for ' + P.fileName, 'error'); return; }
  if (A.unmapped.size) { toast('Pick a channel (or Skip) for every provider in ' + P.fileName, 'error'); return; }
  const groups = A.groups.filter(g => g.C.months.length);
  if (!groups.length) { toast('Nothing to add — check the amount and date columns', 'error'); return; }
  // Remember everything picked here for the next file.
  m.spendLocMeta = (m.spendLocMeta && typeof m.spendLocMeta === 'object') ? m.spendLocMeta : {};   // { key: { ch, col } } — which provider / column an ID came from (Configurations list)
  for (const k in (P.locMap || {})) { m.spendLocMap[k] = P.locMap[k]; m.spendLocMeta[k] = { ch: P.cols.prov ? 'Several providers' : P.channel, col: P.cols.loc || '' }; }
  for (const k in (P.provMap || {})) m.spendProvMap[k] = P.provMap[k];
  if (P.cols.prov) for (const [val] of A.provs) { const k = _spuKey(val), ch = _spuChanOf(val, P, m); if (k && ch && !m.spendProvMap[k]) m.spendProvMap[k] = ch; }
  m.spendTemplates[_spuSig(P.headers)] = { cols: Object.assign({}, P.cols), channel: P.cols.prov ? '' : P.channel, noLoc: P.noLoc, from: P.fileName, at: new Date().toISOString() };
  let total = 0;
  for (const g of groups) {
    m.spendUploads.push({ id: P.key + (groups.length > 1 ? '|' + g.ch : ''), fileName: P.fileName + (groups.length > 1 ? ' · ' + g.ch : ''), channel: g.ch, at: new Date().toISOString(), by: (state.profile && state.profile.full_name) || '', total: g.C.total, n: g.C.n, cells: g.C.cells });
    _spuRebuild(m, g.ch, g.C.months); total += g.C.total;
  }
  state._spendPending = (state._spendPending || []).filter(x => x !== P);
  _mktgSave();
  toast('Added ' + fmt.usd0(total) + ' of spend' + (groups.length > 1 ? ' across ' + groups.length + ' channels' : ' to ' + groups[0].ch) + ' · mapping remembered for the next ' + (groups.length > 1 ? 'report like this' : groups[0].ch + ' report'), 'success');
  mountApp();
}
function _spuForget(kind, key) {
  const m = _spuStore();
  const map = kind === 'loc' ? m.spendLocMap : kind === 'prov' ? m.spendProvMap : m.spendTemplates;
  delete map[key]; _mktgSave(); mountApp();
}
function _spuRemove(id) {
  const m = _spuStore();
  const u = m.spendUploads.find(x => x.id === id); if (!u) return;
  m.spendUploads = m.spendUploads.filter(x => x.id !== id);
  _spuRebuild(m, u.channel, Object.keys(u.cells || {}));
  _mktgSave(); toast('Removed ' + u.fileName, 'success'); mountApp();
}
// The card at the top of Spend entry.
function mktgSpendUploadCard(B, year) {
  const m = _spuStore(), branches = B.all;
  const muted = { color: 'var(--text-muted)' };
  const selCls = 'rounded-lg border px-2 py-1 text-[11px]';
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '220px' };
  const sel = (val, opts, on) => el('select', { class: selCls, style: selSt, onchange: (e) => { on(e.target.value); mountApp(); } }, ...opts.map(([v, t]) => el('option', { value: v, selected: v === val }, t)));
  const officeOpts = [[SPU_SPLIT, 'Split by leads'], ...branches.map(b => [b, _mktgTC(b)]), [SPU_SKIP, 'Skip (not spend)']];
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.csv,.xlsx,.xls,.tsv', class: 'hidden', onchange: (e) => { _spuUpload(e.target.files); e.target.value = ''; } });
  const head = el('div', { class: 'px-5 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
    el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Upload spend reports'),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Drop any spend report (CSV or Excel, one or many). Map it once — the columns, the provider and the branch — and the app remembers: the next report with the same layout, provider names or locations fills itself in.')),
    el('label', { class: 'ml-auto rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer', style: { background: 'var(--accent)', color: 'var(--accent-text)' } }, '↑ Choose files', fileIn));
  const pending = (state._spendPending || []).map(P => {
    const A = _spuComputeAll(P, branches, m);
    // Locations are listed across the whole file (whatever channel each row goes to).
    const C = _spuCompute(Object.assign({}, P, { channel: P.channel || (A.groups[0] && A.groups[0].ch) || '' }), branches, m);
    const groups = A.groups.filter(g => g.C.months.length);
    const total = groups.reduce((t, g) => t + g.C.total, 0);
    const months = [...new Set(groups.flatMap(g => g.C.months))].sort();
    const unalloc = groups.reduce((t, g) => t + g.C.unalloc, 0);
    const unmappedAmt = [...A.unmapped.values()].reduce((t, v) => t + v, 0);
    // Column options read like the spreadsheet: letter · header · a few sample values (per Isaac, Oct 9 — "column D").
    const _letter = (i) => { let t = ''; i++; while (i > 0) { const r2 = (i - 1) % 26; t = String.fromCharCode(65 + r2) + t; i = Math.floor((i - 1) / 26); } return t; };
    const _sample = (h) => { const seen = []; for (const r of P.rows) { const v = String(r[h] == null ? '' : r[h]).trim(); if (v && !seen.includes(v)) seen.push(v); if (seen.length >= 3) break; } return seen.map(v => v.length > 14 ? v.slice(0, 13) + '…' : v).join(', '); };
    const colOpts = (none) => [['', none], ...P.headers.map((h, i) => [h, _letter(i) + ' · ' + (/^__EMPTY/.test(h) ? '(no header)' : h) + (_sample(h) ? '  (e.g. ' + _sample(h) + ')' : '')])];
    const overlap = m.spendUploads.filter(u => groups.some(g => g.ch === u.channel && g.C.months.some(ym => u.cells && u.cells[ym])));
    const locRows = P.cols.loc ? [...C.locs.entries()].sort((x, y) => y[1].amt - x[1].amt) : [];
    const shownLocs = locRows.slice(0, 80);
    const provRows = P.cols.prov ? [...A.provs.entries()].sort((x, y) => y[1].amt - x[1].amt) : [];
    const chanOpts = [['', 'Pick a channel…'], ...m.channels.map(c => [c, c]), [SPU_SKIP, 'Skip (not marketing spend)']];
    const ready = groups.length && !unalloc && !unmappedAmt && (P.cols.prov || P.channel);
    const grid = (rows) => el('div', { class: 'grid gap-x-4 gap-y-1', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' } }, ...rows);
    const lab = (t) => el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: muted }, t);
    return el('div', { class: 'px-5 py-4 border-b flex flex-col gap-3', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex items-center gap-2 flex-wrap text-[11px]' },
        el('span', { class: 'font-bold text-xs' }, P.fileName), el('span', { style: muted }, P.rows.length.toLocaleString() + ' rows'),
        P.recognized ? el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] font-bold', style: { background: 'rgba(95,108,91,.16)', color: '#5F6C5B' } }, '✓ Recognized — same layout as ' + P.recognized + '; columns and mapping filled in') : null),
      el('div', { class: 'flex items-center gap-3 flex-wrap text-[11px]' },
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Amount'), sel(P.cols.amount, colOpts('Pick a column…'), (v) => { P.cols.amount = v; })),
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Date'), sel(P.cols.date, colOpts('No date column'), (v) => { P.cols.date = v; })),
        // The month this upload is for (per Isaac, Oct 9): pick one and the whole file books to it; or keep the file's own dates.
        (() => { const now = new Date(); const opts = []; for (let i = 0; i < 18; i++) { const d = new Date(now.getFullYear(), now.getMonth() - i, 1); opts.push([_mktgYm(d.getFullYear(), d.getMonth()), MKTG_MONTHS[d.getMonth()] + ' ' + d.getFullYear()]); }
          return el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Month'),
            sel(P.forceMonth || '', [['', P.cols.date ? 'Every month in the file' : 'Pick a month…'], ...opts], (v) => { P.forceMonth = v; })); })(),
        (P.cols.date && !P.forceMonth && C.noDate) ? el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Rows with no date go to'),
          sel(P.month, [['', 'Pick a month…'], ...[year - 1, year].flatMap(y => MKTG_MONTHS.map((mn, i) => [_mktgYm(y, i), mn + ' ' + y]))], (v) => { P.month = v; })) : null,
        el('label', { class: 'inline-flex items-center gap-1.5', title: 'A column naming the provider / vendor on each row (QuickBooks payee, an aggregator report…). Leave it off when the whole file is one provider.' },
          el('span', { class: 'font-semibold' }, 'Provider'), sel(P.cols.prov || '', colOpts('Whole file is one provider'), (v) => { P.cols.prov = v; P.provMap = {}; })),
        !P.cols.prov ? el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Channel'), sel(P.channel, [['', 'Pick a channel…'], ...m.channels.map(c => [c, c])], (v) => { P.channel = v; })) : null,
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold', title: 'The column that says which branch / location each row belongs to — a branch ID, office name, market, campaign or ZIP. Each value in it is mapped to a branch below, once.' }, 'Branch column'), sel(P.cols.loc, colOpts('No branch / location column'), (v) => { P.cols.loc = v; P.locMap = {}; })),
        !P.cols.loc ? el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Goes to'), sel(P.noLoc, officeOpts.filter(o => o[0] !== SPU_SKIP), (v) => { P.noLoc = v; })) : null),
      provRows.length ? el('div', { class: 'flex flex-col gap-1' },
        lab('Provider → channel (' + provRows.length + ') · remembered for next time'),
        grid(provRows.slice(0, 80).map(([val, L]) => { const k = _spuKey(val), cur = _spuChanOf(val, P, m);
          return el('div', { class: 'flex items-center gap-2 text-[11px]' },
            el('span', { class: 'truncate', style: { flex: '1', minWidth: '0', color: cur ? undefined : '#DC2626', fontWeight: cur ? undefined : '600' }, title: val }, val || '(blank)'),
            el('span', { class: 'tabular-nums', style: muted }, fmt.usd0(L.amt)),
            sel(cur, chanOpts, (v) => { P.provMap = P.provMap || {}; P.provMap[k] = v; })); }))) : null,
      locRows.length ? el('div', { class: 'flex flex-col gap-1' },
        lab(String(P.cols.loc) + ' → branch (' + locRows.length + ' value' + (locRows.length === 1 ? '' : 's') + ') · pick a branch for each · remembered for next time'),
        grid(shownLocs.map(([val, L]) => {
          const k = _spuKey(val), cur = (P.locMap && P.locMap[k]) || _spuAutoOffice(val, branches, m);
          return el('div', { class: 'flex items-center gap-2 text-[11px]' },
            el('span', { class: 'truncate', style: { flex: '1', minWidth: '0' }, title: val }, val || '(blank)'),
            el('span', { class: 'tabular-nums', style: muted }, fmt.usd0(L.amt)),
            sel(cur, officeOpts, (v) => { P.locMap = P.locMap || {}; P.locMap[k] = v; }));
        })),
        locRows.length > shownLocs.length ? el('div', { class: 'text-[11px]', style: muted }, '+ ' + (locRows.length - shownLocs.length) + ' smaller locations mapped automatically (office name or ZIP in the value, else split by leads).') : null) : null,
      el('div', { class: 'flex items-center gap-3 flex-wrap text-[11px]' },
        el('span', { class: 'font-semibold' }, months.length ? fmt.usd0(total) + ' · ' + months.map(reportingMonthLbl).join(', ') : 'Nothing to add yet'),
        groups.length > 1 ? el('span', { style: muted }, groups.map(g => g.ch + ' ' + fmt.usd0(g.C.total)).join(' · ')) : (months.length ? el('span', { style: muted }, Object.entries(C.months.reduce((o, ym) => { for (const bb in C.cells[ym]) o[bb] = (o[bb] || 0) + C.cells[ym][bb]; return o; }, {})).sort((x, y) => y[1] - x[1]).slice(0, 6).map(([bb, v]) => _mktgTC(bb) + ' ' + fmt.usd0(v)).join(' · ')) : null),
        unmappedAmt ? el('span', { style: { color: '#DC2626', fontWeight: '600' } }, fmt.usd0(unmappedAmt) + ' from ' + A.unmapped.size + ' provider' + (A.unmapped.size === 1 ? '' : 's') + ' with no channel yet — pick one (or Skip) above') : null,
        unalloc ? el('span', { style: { color: '#DC2626', fontWeight: '600' } }, fmt.usd0(unalloc) + ' could not be split (no leads or sales that month) — pick a branch') : null,
        (C.noDate && !P.month && !P.forceMonth) ? el('span', { style: { color: '#DC2626', fontWeight: '600' } }, fmt.usd0(C.noDate) + ' has no date — pick the month above') : null,
        C.skipped ? el('span', { style: muted }, fmt.usd0(C.skipped) + ' skipped') : null,
        C.outside ? el('span', { style: muted }, fmt.int(C.outsideN) + ' row' + (C.outsideN === 1 ? '' : 's') + ' dated outside ' + reportingMonthLbl(P.forceMonth) + ' left out (' + fmt.usd0(C.outside) + ')') : null,
        overlap.length ? el('span', { style: { color: '#B45309', fontWeight: '600' } }, 'Already have ' + overlap.length + ' upload' + (overlap.length === 1 ? '' : 's') + ' for these channels and months — this ADDS to them. Remove the old one below if this replaces it.') : null,
        el('span', { class: 'ml-auto inline-flex gap-2' },
          el('button', { class: 'rounded-lg border px-2.5 py-1 font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._spendPending = state._spendPending.filter(x => x !== P); mountApp(); } }, 'Discard'),
          el('button', { class: 'rounded-lg px-3 py-1 font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)', opacity: ready ? '1' : '.5' },
            onclick: () => { if (unalloc) { toast('Pick a branch for the spend that could not be split', 'error'); return; } _spuCommit(P, branches); } }, 'Add to sheet'))));
  });
  // What the app has learned (per Isaac, Oct 9): every remembered pick, with Forget.
  const memo = (() => {
    const T = Object.entries(m.spendTemplates), PV = Object.entries(m.spendProvMap), LC = Object.entries(m.spendLocMap);
    if (!T.length && !PV.length && !LC.length) return null;
    const lbl = (v) => v === SPU_SKIP ? 'Skip' : v === SPU_SPLIT ? 'Split by leads' : (branches.includes(v) ? _mktgTC(v) : v);
    const row = (a2, b2, kind, key) => el('div', { class: 'flex items-center gap-2 text-[11px] py-0.5' },
      el('span', { class: 'truncate', style: { flex: '1', minWidth: '0' }, title: a2 }, a2), el('span', { class: 'font-semibold truncate', style: { maxWidth: '45%' } }, b2),
      el('button', { class: 'underline shrink-0', style: { color: 'var(--text-muted)' }, title: 'Forget this mapping', onclick: () => _spuForget(kind, key) }, 'Forget'));
    const sect = (title, rows) => rows.length ? el('div', { class: 'flex flex-col' }, el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-1', style: muted }, title), ...rows) : null;
    return el('details', { class: 'px-5 py-3 border-t', style: { borderColor: 'var(--border)' } },
      el('summary', { class: 'text-[11px] font-semibold cursor-pointer' }, 'Remembered mappings · ' + T.length + ' report layout' + (T.length === 1 ? '' : 's') + ' · ' + PV.length + ' provider' + (PV.length === 1 ? '' : 's') + ' · ' + LC.length + ' location' + (LC.length === 1 ? '' : 's')),
      el('div', { class: 'grid gap-4 mt-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } },
        sect('Report layouts', T.map(([k, t]) => row(t.from || 'Report', [t.channel || (t.cols && t.cols.prov ? 'by ' + t.cols.prov : ''), t.cols && t.cols.amount].filter(Boolean).join(' · '), 'tpl', k))),
        sect('Provider → channel', PV.sort().map(([k, v]) => row(k, lbl(v), 'prov', k))),
        sect('Location → branch', LC.sort().map(([k, v]) => row(k, lbl(v), 'loc', k)))));
  })();
  const ups = m.spendUploads.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const list = ups.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
    el('thead', {}, el('tr', {}, ...['Report', 'Channel', 'Months', 'Spend', 'Offices', 'Added', ''].map(h => el('th', { class: 'px-3 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, h)))),
    el('tbody', {}, ...ups.map(u => {
      const yms = Object.keys(u.cells || {}).sort(), offs = new Set(); for (const ym of yms) for (const b in u.cells[ym]) offs.add(b);
      return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-3 py-1.5' }, u.fileName), el('td', { class: 'px-3 py-1.5 font-semibold whitespace-nowrap' }, u.channel),
        el('td', { class: 'px-3 py-1.5 whitespace-nowrap' }, yms.length > 2 ? reportingMonthLbl(yms[0]) + ' – ' + reportingMonthLbl(yms[yms.length - 1]) : yms.map(reportingMonthLbl).join(', ')),
        el('td', { class: 'px-3 py-1.5 tabular-nums font-semibold' }, fmt.usd0(u.total)), el('td', { class: 'px-3 py-1.5 tabular-nums' }, String(offs.size)),
        el('td', { class: 'px-3 py-1.5 whitespace-nowrap', style: muted }, new Date(u.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) + (u.by ? ' · ' + u.by : '')),
        el('td', { class: 'px-3 py-1.5 text-right' }, el('button', { class: 'underline', style: { color: '#DC2626', minHeight: '24px' }, title: 'Remove this report and take its spend back out of the sheet', onclick: () => _spuRemove(u.id) }, 'Remove')));
    })))) : null;
  return el('div', { class: 'card overflow-hidden' }, head, ...pending, list, memo,
    el('div', { class: 'px-5 py-2 text-[11px]', style: muted }, 'A channel-month covered by uploaded reports is set from the reports (it replaces numbers typed into the sheet for that channel and month).'));
}

// ── Spend checklist (per Isaac, Oct 9) ───────────────────────────────────
// Every provider sending leads in GoHighLevel that month (plus any provider
// with spend), so none gets forgotten. Each one is: from the ad platforms
// (Facebook / Google — automatic), uploaded, entered and split evenly across
// the branches, or checked off as no spend this month. Same month as the
// Controller allocation below.
const SPU_SKIP_PROVS = /^(organic|referral|unknown|direct|door to door|current customer|pestbooker|click-to-buy|gbp|google business( profile)?|main office( number)?|phone|website)$/i;   // free channels: nothing to pay
function _spuEven(ch, ym, amount, branches) {
  const m = _spuStore(); if (!(amount > 0)) return; if (!branches.length) { toast('No branches loaded yet — try again once the sales data has loaded', 'error'); return; }
  const cells = {}; const per = Math.floor(amount / branches.length * 100) / 100; let used = 0;
  for (const b of branches) { cells[b] = per; used += per; }
  cells[branches[0]] = Math.round((cells[branches[0]] + amount - used) * 100) / 100;
  m.spendUploads.push({ id: 'even-' + ch + '-' + ym + '-' + Date.now().toString(36), fileName: 'Entered · split evenly across ' + branches.length + ' branches', channel: ch, at: new Date().toISOString(), by: (state.profile && state.profile.full_name) || '', total: Math.round(amount * 100) / 100, n: 1, cells: { [ym]: cells } });
  _spuRebuild(m, ch, [ym]); _mktgSave(); toast(fmt.usd0(amount) + ' of ' + ch + ' split evenly across ' + branches.length + ' branches', 'success'); mountApp();
}
function mktgSpendChecklist() {
  const m = _spuStore();
  m.spendCheck = (m.spendCheck && typeof m.spendCheck === 'object') ? m.spendCheck : {};   // { ym: { provider: 'none' } }
  const ym = (typeof _mktgCtrlMonth === 'function') ? _mktgCtrlMonth().ym : state._mktCtrlMonth;
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const BL = _mktgBranchList(Number(ym.slice(0, 4)));
  const muted = { color: 'var(--text-muted)' };
  // Providers: GoHighLevel leads that month (credited provider), plus anything already carrying spend.
  const leads = new Map();
  const G = (typeof ghlLeads === 'function') ? ghlLeads() : null;
  if (G && G.leads) for (const l of G.leads) { if (String(l.d).slice(0, 7) !== ym) continue; const p = l.prov; if (!p || p === GHL_NOT_LEAD || SPU_SKIP_PROVS.test(p)) continue; leads.set(p, (leads.get(p) || 0) + 1); }
  const spendOf = (p) => { const c = (m.spend[ym] || {})[p] || {}; return Object.values(c).reduce((t, v) => t + (Number(v) || 0), 0); };
  const AD = (typeof _mktgAdSpendMonth === 'function') ? _mktgAdSpendMonth(ym, BL.all) : { has: new Set() };
  const provs = new Set([...leads.keys(), ...Object.keys(m.spend[ym] || {}).filter(p => spendOf(p) > 0), ...AD.has]);
  const checks = m.spendCheck[ym] || {};
  const rows = [...provs].map(p => {
    const auto = AD.has.has(p) || (typeof AD_PROVIDERS !== 'undefined' && AD_PROVIDERS.includes(p));
    const amt = spendOf(p);
    const st = auto ? 'auto' : amt > 0 ? 'done' : checks[p] === 'none' ? 'none' : 'todo';
    return { p, n: leads.get(p) || 0, auto, amt, st };
  }).sort((a, b) => ({ todo: 0, done: 1, none: 2, auto: 3 }[a.st] - { todo: 0, done: 1, none: 2, auto: 3 }[b.st]) || b.n - a.n);
  const todo = rows.filter(r => r.st === 'todo').length;
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.csv,.xlsx,.xls,.tsv', class: 'hidden', onchange: (e) => { _spuUpload(e.target.files); e.target.value = ''; } });
  const upload = (p) => { state._spuPreset = { channel: p, month: ym }; fileIn.click(); };
  const pill = (t, bg, fg) => el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] font-bold whitespace-nowrap', style: { background: bg, color: fg } }, t);
  const stPill = (r) => r.st === 'auto' ? pill('Automatic · ad platform', 'rgba(42,120,194,.12)', '#2A78C2') : r.st === 'done' ? pill('✓ ' + fmt.usd0(r.amt), 'rgba(95,108,91,.16)', '#5F6C5B') : r.st === 'none' ? pill('✓ No spend', 'var(--card-2)', 'var(--text-muted)') : pill('To do', 'rgba(220,38,38,.10)', '#B91C1C');
  const btn = (t, on, primary) => el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap' + (primary ? '' : ' border'), style: primary ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: on }, t);
  const setNone = (p, on) => { m.spendCheck[ym] = m.spendCheck[ym] || {}; if (on) m.spendCheck[ym][p] = 'none'; else delete m.spendCheck[ym][p]; _mktgSave(); mountApp(); };
  const evenKey = '_spuEvenOpen';
  const actions = (r) => {
    if (r.st === 'auto') return el('span', { class: 'text-[11px]', style: muted }, 'Pulled from the platform — map any unassigned campaigns in the table below');
    if (r.st === 'none') return btn('Undo', () => setNone(r.p, false));
    if (state[evenKey] === r.p) {
      const inp = el('input', { type: 'number', min: '0', step: '0.01', placeholder: 'Total for the month', class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', width: '150px' } });
      return el('span', { class: 'inline-flex items-center gap-2 flex-wrap' }, inp,
        // Which branches share it (per Isaac, Oct 9): all by default, or pick some.
        spuBranchPicker(BL.all, (m.spendEvenBranches && m.spendEvenBranches[r.p]) || BL.all, (picked) => { const v = parseFloat(inp.value); if (!(v > 0)) { toast('Enter the amount first', 'error'); return; } m.spendEvenBranches = m.spendEvenBranches || {}; m.spendEvenBranches[r.p] = picked; state[evenKey] = null; _spuEven(r.p, ym, v, picked); }, { save: 'Split evenly' }),
        btn('Cancel', () => { state[evenKey] = null; mountApp(); }));
    }
    return el('span', { class: 'inline-flex items-center gap-2 flex-wrap' },
      btn(r.st === 'done' ? 'Upload more' : 'Upload breakout', () => upload(r.p), r.st !== 'done'),
      btn('Enter & split evenly', () => { state[evenKey] = r.p; mountApp(); }),
      r.st === 'todo' ? btn('No spend', () => setNone(r.p, true)) : null);
  };
  const th = (t) => el('th', { class: 'px-4 py-2 text-left text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  return el('div', { class: 'card overflow-hidden' }, fileIn,
    el('div', { class: 'px-5 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Spend checklist · ' + reportingMonthLbl(ym)),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Every provider that sent leads into GoHighLevel this month, plus anything already carrying spend. Upload a provider’s breakout by location, enter one total to split evenly across the branches, or mark No spend. Change the month in the Controller allocation below.')),
      el('span', { class: 'ml-auto' }, todo ? pill(todo + ' to do', 'rgba(220,38,38,.10)', '#B91C1C') : pill('✓ All providers covered', 'rgba(95,108,91,.16)', '#5F6C5B'))),
    rows.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Provider'), th('GHL leads'), th('Status'), th(''))),
      el('tbody', {}, ...rows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-4 py-2 font-semibold whitespace-nowrap' }, r.p),
        el('td', { class: 'px-4 py-2 tabular-nums', style: muted }, r.n ? fmt.int(r.n) : '—'),
        el('td', { class: 'px-4 py-2' }, stPill(r)),
        el('td', { class: 'px-4 py-2' }, actions(r)))))))
      : el('div', { class: 'px-5 py-4 text-[11px]', style: muted }, G ? 'No paid providers with leads in GoHighLevel this month.' : 'Loading GoHighLevel leads…'));
}

// Branch picker (per Isaac, Oct 9 — "sometimes it's not across ALL locations"): a button that opens a checklist of
// branches with All / None; Save hands back the picked ones. Used to split a campaign or a provider total evenly.
function spuBranchPicker(branches, selected, onSave, opts) {
  opts = opts || {};
  const wrap = el('span', { class: 'relative inline-block' });
  const picked = new Set(selected || []);
  const label = () => picked.size === 0 ? (opts.empty || 'Pick branches…') : picked.size === branches.length ? 'All ' + branches.length + ' branches' : picked.size === 1 ? _mktgTC([...picked][0]) : picked.size + ' branches';
  // The panel floats over the page (fixed, on <body>) so a table's scroll box can't clip it and the page still
  // scrolls with it open (per Isaac, Oct 9); it follows its button and opens upward when there's no room below.
  const panel = el('div', { class: 'card p-2 flex flex-col gap-1', style: { position: 'fixed', zIndex: '80', minWidth: '220px', overflowY: 'auto', display: 'none', boxShadow: 'var(--shadow-lg)' } });
  const place = () => {
    if (!wrap.isConnected) { close(); return; }
    const r = btn.getBoundingClientRect(), vh = window.innerHeight, vw = window.innerWidth;
    const below = vh - r.bottom - 12, above = r.top - 12, up = below < 260 && above > below;
    panel.style.maxHeight = Math.max(160, Math.min(360, up ? above : below)) + 'px';
    panel.style.left = Math.max(8, Math.min(r.right - 220, vw - 232)) + 'px';
    if (up) { panel.style.top = ''; panel.style.bottom = (vh - r.top + 4) + 'px'; } else { panel.style.bottom = ''; panel.style.top = (r.bottom + 4) + 'px'; }
  };
  const onMove = () => place();
  const close = () => { panel.style.display = 'none'; panel.remove(); window.removeEventListener('scroll', onMove, true); window.removeEventListener('resize', onMove); };
  const open = () => { paint(); document.body.append(panel); panel.style.display = 'flex'; place(); window.addEventListener('scroll', onMove, true); window.addEventListener('resize', onMove); };
  const btn = el('button', { class: 'rounded-lg border px-2 py-0.5 text-[11px] whitespace-nowrap', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onclick: (e) => { e.stopPropagation(); if (panel.style.display === 'none') open(); else close(); } }, label() + ' \u25BE');
  const paint = () => {
    const mini = (t, on) => el('button', { class: 'text-[10px] font-semibold underline', style: { color: 'var(--accent)' }, onclick: (e) => { e.stopPropagation(); on(); paint(); } }, t);
    panel.replaceChildren(
      el('div', { class: 'flex items-center gap-3 px-1 pb-1 border-b', style: { borderColor: 'var(--border)' } }, mini('All', () => branches.forEach(b => picked.add(b))), mini('None', () => picked.clear()),
        el('span', { class: 'ml-auto text-[10px]', style: { color: 'var(--text-muted)' } }, picked.size + ' picked')),
      ...branches.map(b => el('label', { class: 'flex items-center gap-2 px-1 py-0.5 text-[11px] cursor-pointer' },
        el('input', { type: 'checkbox', checked: picked.has(b), onchange: (e) => { if (e.target.checked) picked.add(b); else picked.delete(b); const n = panel.querySelector('.ml-auto'); if (n) n.textContent = picked.size + ' picked'; } }), _mktgTC(b))),
      el('button', { class: 'mt-1 rounded-lg px-2 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: (e) => { e.stopPropagation(); if (!picked.size) { toast('Pick at least one branch', 'error'); return; } close(); onSave([...picked].sort()); } }, opts.save || 'Save · split evenly'));
  };
  document.addEventListener('mousedown', function closer(ev) { if (!wrap.isConnected) { document.removeEventListener('mousedown', closer); close(); return; } if (!wrap.contains(ev.target) && !panel.contains(ev.target)) close(); });
  wrap.append(btn);
  return wrap;
}

// ── Configurations → Provider IDs → branch (per Isaac, Oct 9) ─────────────
// One place to look up (and fix) every ID the app maps to a branch: Google LSA
// and Google Ads / Facebook campaigns and accounts (set on Spend → Needs a
// branch, or Ad accounts), and the branch / location IDs from uploaded provider
// reports such as Angi. IDs can be added here ahead of a report too.
function reportingProviderIdsPanel() {
  const m = _spuStore();
  m.spendLocMeta = (m.spendLocMeta && typeof m.spendLocMeta === 'object') ? m.spendLocMeta : {};
  const y = new Date().getFullYear();
  const branches = _mktgBranchList(y).all;
  const admin = isAdminRole(state.profile?.role);
  const muted = { color: 'var(--text-muted)' };
  const q = String(state._provIdQ || '').trim().toLowerCase();
  const rows = [];
  const camp = (typeof adCampaignOfficeMap === 'function') ? adCampaignOfficeMap() : {};
  for (const k in camp) { const [plat, acct, ...rest] = k.split('|'); const c = rest.join('|'); const v = camp[k];
    rows.push({ kind: 'camp', key: k, prov: plat === 'facebook' ? 'Facebook' : /^LocalServicesCampaign/i.test(c) ? 'Google Local Services' : 'Google Ads', id: acct, detail: /^LocalServicesCampaign/i.test(c) ? 'LSA account' : c, to: v === '' ? [] : Array.isArray(v) ? v : [v] }); }
  const acc = (typeof adAccountOfficeMap === 'function') ? adAccountOfficeMap() : {};
  for (const k in acc) { const [plat, acctId, prov] = k.split('|'); const v = acc[k];
    rows.push({ kind: 'acct', key: k, prov: prov || (plat === 'facebook' ? 'Facebook' : 'Google'), id: acctId, detail: 'Whole account', to: v === '' ? [] : Array.isArray(v) ? v : [v] }); }
  for (const k in m.spendLocMap) { const meta = m.spendLocMeta[k] || {}; const v = m.spendLocMap[k];
    rows.push({ kind: 'loc', key: k, prov: meta.ch || 'Uploaded reports', id: k, detail: meta.col ? 'column “' + meta.col + '”' : 'report location', to: v === SPU_SPLIT ? ['split'] : v === SPU_SKIP ? ['skip'] : [v] }); }
  const shown = rows.filter(r => !q || (r.prov + ' ' + r.id + ' ' + r.detail + ' ' + r.to.join(' ')).toLowerCase().includes(q));
  const byProv = new Map(); for (const r of shown) (byProv.get(r.prov) || byProv.set(r.prov, []).get(r.prov)).push(r);
  const lbl = (t) => t === 'split' ? 'Split by leads' : t === 'skip' ? 'Skip (not spend)' : _mktgTC(t);
  const save = (r, picked) => {
    if (r.kind === 'camp') setAdCampaignOffice(r.key, picked.length === 1 ? picked[0] : picked);
    else if (r.kind === 'acct') setAdAccountOffice(r.key, picked);
    else { m.spendLocMap[r.key] = picked[0]; _mktgSave(); }
    mountApp();
  };
  const remove = (r) => { if (r.kind === 'camp') setAdCampaignOffice(r.key, null); else if (r.kind === 'acct') setAdAccountOffice(r.key, null); else { delete m.spendLocMap[r.key]; delete m.spendLocMeta[r.key]; _mktgSave(); } mountApp(); };
  // Add an ID ahead of a report (e.g. a new Angi branch ID).
  const provs = [...new Set([...(m.channels || []), ...rows.filter(r => r.kind === 'loc').map(r => r.prov)])].filter(p => !/^Several|^Uploaded/.test(p)).sort();
  const addId = el('input', { type: 'text', placeholder: 'ID (e.g. Angi branch ID)', class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', width: '170px' } });
  const addProv = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } }, ...provs.map(p => el('option', { value: p }, p)));
  const addBr = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } }, el('option', { value: '' }, 'Branch…'), ...branches.map(b => el('option', { value: b }, _mktgTC(b))));
  const addRow = admin ? el('div', { class: 'flex items-center gap-2 flex-wrap mb-3' },
    el('span', { class: 'text-[11px] font-semibold' }, 'Add an ID'), addProv, addId, addBr,
    el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => {
      const k = _spuKey(addId.value); if (!k || !addBr.value) { toast('Enter the ID and pick a branch', 'error'); return; }
      m.spendLocMap[k] = addBr.value; m.spendLocMeta[k] = { ch: addProv.value, col: '' }; _mktgSave(); toast('Saved ' + addId.value.trim() + ' → ' + _mktgTC(addBr.value), 'success'); mountApp(); } }, 'Save')) : null;
  const search = el('input', { type: 'search', placeholder: 'Search an ID, provider or branch…', value: state._provIdQ || '', class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', width: '260px' },
    oninput: (e) => { state._provIdQ = e.target.value; clearTimeout(state._provIdT); state._provIdT = setTimeout(() => { mountApp(); const i = document.querySelector('#cfg-provids input[type=search]'); if (i) { i.focus(); const n = i.value.length; try { i.setSelectionRange(n, n); } catch (err) { /* */ } } }, 250); } });
  return el('div', { id: 'cfg-provids', class: 'flex flex-col gap-3' },
    el('div', { class: 'text-[11px]', style: muted }, 'Every provider ID the app sends to a branch: Google LSA and Google Ads / Facebook campaigns and accounts (set on Marketing → Spend), and the branch / location IDs from uploaded reports like Angi. Saved for every admin. Change a branch here, remove a wrong one, or add an ID before its first report.'),
    el('div', { class: 'flex items-center gap-3 flex-wrap' }, search, el('span', { class: 'text-[11px]', style: muted }, fmt.int(rows.length) + ' IDs saved')),
    addRow,
    shown.length ? el('div', { class: 'flex flex-col gap-4' }, ...[...byProv.entries()].sort((a2, b2) => a2[0].localeCompare(b2[0])).map(([prov, list]) => el('div', {},
      el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1' }, prov + ' · ' + list.length),
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]', style: { borderCollapse: 'collapse' } },
        el('tbody', {}, ...list.sort((a2, b2) => String(a2.id).localeCompare(String(b2.id))).map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-2 py-1 font-semibold tabular-nums whitespace-nowrap' }, r.id),
          el('td', { class: 'px-2 py-1', style: Object.assign({ maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, muted), title: r.detail }, r.detail),
          el('td', { class: 'px-2 py-1' }, admin && !(r.kind === 'loc' && (r.to[0] === 'split' || r.to[0] === 'skip')) ? spuBranchPicker(branches, r.to, (picked) => save(r, r.kind === 'loc' ? picked.slice(0, 1) : picked), { save: r.kind === 'loc' ? 'Save (first branch)' : 'Save · split evenly' }) : el('span', { class: 'font-semibold' }, r.to.length ? r.to.map(lbl).join(' + ') : 'Company-wide')),
          admin ? el('td', { class: 'px-2 py-1 text-right' }, el('button', { class: 'underline', style: muted, onclick: () => remove(r) }, 'Remove')) : null)))))))) 
      : el('div', { class: 'text-[11px] py-2', style: muted }, q ? 'Nothing matches.' : 'No IDs saved yet.'));
}
