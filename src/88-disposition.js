// ┌─ src/88-disposition.js ──────────────────────────────────────────────────
// │ Marketing → Disposition (per Isaac, Oct 9). A lead provider (DoLead first)
// │ wants its lead report sent back with what happened to each lead. Upload the
// │ provider's report; every row is matched to:
// │   · FieldRoutes — is there a customer for this contact (phone → email →
// │     last name + ZIP), were they already a customer, and did they buy after
// │     the lead (date, service, status, the source typed on the sale);
// │   · GoHighLevel — the contact, and the latest opportunity's status / stage
// │     / source.
// │ The rows go back out as the provider's own columns plus the disposition
// │ columns (Excel). Problems found on the way are flagged: duplicate leads in
// │ the report, leads that never reached GoHighLevel, sales typed under another
// │ source in FieldRoutes, GoHighLevel opportunities under another provider,
// │ and leads on people who were already customers.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const DISP_SALE_WINDOW = 90;   // a sale counts for the lead when sold from 1 day before to 90 days after it

function _dispMaps() { const R = (typeof _adminRules === 'function') ? _adminRules() : null; return (R && R.dispMaps) || {}; }
function _dispMapKey(provider, headers) { return String(provider || '') + '|' + [...headers].map(h => String(h).trim().toLowerCase()).sort().join('\u0001'); }

async function _dispUpload(files) {
  const list = Array.from(files || []); if (!list.length) return;
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const m = _mktgStore();
  state._dispFiles = state._dispFiles || [];
  for (const file of list) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const provider = _attrGuessProvider(file.name, m.channels) || state._dispProv || '';
      for (const sheet of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '', raw: true });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]);
        const saved = provider ? _dispMaps()[_dispMapKey(provider, headers)] : null;
        state._dispFiles.push({ key: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), provider, fileName: wb.SheetNames.length > 1 ? file.name + ' · ' + sheet : file.name, sheet, headers, rows,
          map: saved ? Object.fromEntries(Object.entries(saved).filter(([, h]) => headers.includes(h))) : _attrGuessMap(headers), remembered: !!saved });
      }
    } catch (e) { toast('Could not read ' + file.name + ': ' + (e.message || e), 'error'); }
  }
  mountApp();
}

// GoHighLevel opportunities by phone / email → [{ d, t, prov, label, status, stage }], newest first.
function _dispOppIndex() {
  const G = state._ghl; if (!G || !G.opps) return null;
  if (_dispOppIndex._m && _dispOppIndex._m.src === G.opps) return _dispOppIndex._m;
  const lab = G.labels || [], stages = G.stages || [], byPhone = new Map(), byEmail = new Map();
  for (const o of G.opps) {
    const label = o[1] >= 0 ? lab[o[1]] : '';
    const pv = label ? ghlProviderOf(label) : '';
    const rec = { d: o[0] || '', t: o[4] || '', label, prov: pv === GHL_NOT_LEAD ? '' : (pv || ''), status: String(o[5] || '').toLowerCase(), stage: (o[6] != null && o[6] >= 0 && stages[o[6]]) || '' };
    if (o[2]) (byPhone.get(o[2]) || byPhone.set(o[2], []).get(o[2])).push(rec);
    if (o[3]) (byEmail.get(o[3]) || byEmail.set(o[3], []).get(o[3])).push(rec);
  }
  const sort = (mp) => { for (const v of mp.values()) v.sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t)); };
  sort(byPhone); sort(byEmail);
  return (_dispOppIndex._m = { src: G.opps, byPhone, byEmail });
}

// One report → rows with the disposition columns and flags.
function _dispRun(F) {
  const idx = _attrCrmIndex(), OI = _dispOppIndex();
  const g = (r, k) => F.map[k] ? r[F.map[k]] : '';
  const prov = F.provider;
  const provOf = (src) => (typeof reportingProviderOf === 'function' ? reportingProviderOf(src) : src) || src;
  const seen = new Map();   // phone/email → first row number (duplicates in the report)
  const out = F.rows.map((r, i) => {
    const phone = _attrDigits(g(r, 'phone')), email = _attrEmail(g(r, 'email'));
    const name = String(g(r, 'name') || [g(r, 'first'), g(r, 'last')].filter(Boolean).join(' ')).trim();
    const last = _attrWord(g(r, 'last') || (name.split(/\s+/).slice(-1)[0] || '')), zip = _attrZip(g(r, 'zip'));
    const date = _attrDate(g(r, 'date'));
    const flags = [];
    // Duplicate inside the report.
    const dupOf = (phone && seen.get('p' + phone)) || (email && seen.get('e' + email));
    if (dupOf) flags.push('Duplicate of row ' + dupOf); else { if (phone) seen.set('p' + phone, i + 2); if (email) seen.set('e' + email, i + 2); }
    // FieldRoutes.
    let custId = null, how = '';
    if (phone && idx.byPhone.has(phone)) { custId = idx.byPhone.get(phone); how = 'phone'; }
    else if (email && idx.byEmail.has(email)) { custId = idx.byEmail.get(email); how = 'email'; }
    else if (last && zip && idx.byNameZip.has(last + '|' + zip)) {
      // Last name + ZIP alone matches family members and neighbours (Laketa vs Crystal Bailey) — the first name has to agree too.
      const f1 = _attrWord(g(r, 'first') || name.split(/\s+/)[0] || ''), cand = idx.byNameZip.get(last + '|' + zip), cf = _attrWord((idx.cust.get(cand) || {}).first || '');
      if (f1 && cf && (f1 === cf || (f1.length >= 3 && cf.length >= 3 && (f1.startsWith(cf) || cf.startsWith(f1))))) { custId = cand; how = 'name + ZIP'; }
    }
    const c = custId ? idx.cust.get(custId) : null;
    let sale = null, existing = false, former = '';
    if (c) {
      const lo = date ? _attrAddDays(date, -1) : '', hi = date ? _attrAddDays(date, DISP_SALE_WINDOW) : '9999';
      const isRen = (s) => typeof reportingSourceClass === 'function' && reportingSourceClass(reportingSourceOf(s)) === 'renewal';
      // Existing customer = a subscription sold before the lead that was still active on the lead date
      // (active now, or cancelled on/after the lead date). A past customer with nothing active is a real lead.
      const before = date ? c.subs.filter(s => { const sd = String(s.sold_date || '').slice(0, 10); return sd && sd < lo; }) : [];
      const activeOn = (s) => { const cx = String(s.subscription_date_canceled || '').slice(0, 10); return cx ? cx >= date : /active/i.test(String(s.subscription_status || '')) && !/inactive/i.test(String(s.subscription_status || '')); };
      existing = before.some(activeOn);
      if (!existing && before.length) {
        const cx = before.map(s => String(s.subscription_date_canceled || '').slice(0, 10)).filter(Boolean).sort().pop();
        former = cx ? cx.slice(0, 7) : 'yes';
      }
      sale = c.subs.filter(s => { const sd = String(s.sold_date || '').slice(0, 10); return sd && (!date || (sd >= lo && sd <= hi)) && !isRen(s); }).sort((a, b) => String(a.sold_date).localeCompare(String(b.sold_date)))[0] || null;
    }
    const saleSrc = sale ? reportingSourceOf(sale) : '';
    if (existing) flags.push('Already an active customer before this lead');
    else if (former) flags.push('Former customer' + (former !== 'yes' ? ' (cancelled ' + former + ')' : '') + ' – counted as a lead');
    if (sale && prov && saleSrc !== prov && provOf(saleSrc) !== prov) flags.push('Sale sourced as “' + saleSrc + '” in FieldRoutes');
    // GoHighLevel.
    const inGhl = typeof ghlHasContact === 'function' ? ghlHasContact(phone, email) : null;
    const opps = OI ? [...((phone && OI.byPhone.get(phone)) || []), ...((email && OI.byEmail.get(email)) || [])] : [];
    const uniq = [...new Map(opps.map(o => [o.d + o.t + o.label + o.status, o])).values()].sort((a, b) => (b.d + b.t).localeCompare(a.d + a.t));
    const opp = uniq[0] || null;
    if (inGhl === false) flags.push('Not in GoHighLevel');
    if (opp && prov && opp.prov && opp.prov !== prov) flags.push('GoHighLevel opportunity under ' + opp.prov);
    if (uniq.length > 1 && new Set(uniq.map(o => o.prov).filter(Boolean)).size > 1) flags.push(uniq.length + ' opportunities from ' + [...new Set(uniq.map(o => o.prov).filter(Boolean))].join(', '));
    // The one-word answer the provider wants back.
    const st = sale ? String(sale.subscription_status || '') : '';
    // Sold only counts once the initial is completed. A sale whose initial is booked is Pending; one that was
    // never serviced (no appointment, cancelled, no-show, frozen) goes back to follow-up — GoHighLevel should
    // have it in Needs Follow Up so the automations keep working it until there's a yes or a no.
    const ini = sale ? String(sale.initial_status || '').trim() : '';
    const done = !!sale && (/completed/i.test(ini) || !!sale.initial_serviced_date || (Number(sale.subscription_completed_services) || 0) > 0);
    const booked = !!sale && !done && /active/i.test(st) && /pending/i.test(ini);
    const appt = sale && sale.initial_appt_date ? String(sale.initial_appt_date).slice(0, 10) : '';
    const svcState = !sale ? '' : done ? 'Completed' + (sale.initial_serviced_date ? ' ' + String(sale.initial_serviced_date).slice(0, 10) : '') : booked ? 'Scheduled' + (appt ? ' ' + appt : '') : (ini || 'No appointment');
    if (sale && !done && !booked && !(opp && /follow/i.test(opp.stage))) flags.push('Initial never completed – should be in Needs Follow Up in GoHighLevel');
    const disposition = sale ? (done ? (/active/i.test(st) ? 'Sold' : 'Sold – cancelled after service') : booked ? 'Pending – initial scheduled' + (appt ? ' ' + appt : '') : 'Needs follow-up – not serviced (' + (ini || 'no appointment').toLowerCase() + ')')
      : existing ? 'Existing customer'
      : opp ? (opp.status === 'won' ? 'Won in GoHighLevel – no FieldRoutes sale' : opp.status === 'lost' ? 'Lost' : opp.status === 'abandoned' ? 'Abandoned' : 'Open' + (opp.stage ? ' – ' + opp.stage : ''))
      : inGhl ? 'In GoHighLevel – no opportunity' : inGhl === false ? 'Not in GoHighLevel' : 'Not found';
    return { r, i, date, name, phone, email, disposition, flags,
      fr: { found: !!c, id: custId || '', how, existing, sold: sale ? String(sale.sold_date).slice(0, 10) : '', service: sale ? (sale.subscription || '') : '', status: st, initial: svcState, value: sale ? (Number(sale.subscription_contract_value) || 0) : 0, source: saleSrc, office: (sale && sale.office_name) || (c && c.office) || '' },
      ghl: { found: inGhl, status: opp ? opp.status : '', stage: opp ? opp.stage : '', source: opp ? opp.label : '', date: opp ? opp.d : '', n: uniq.length } };
  });
  return out;
}

function _dispExport(F, rows) {
  const data = rows.map(x => Object.assign({}, x.r, {
    'Disposition': x.disposition,
    'In FieldRoutes': x.fr.found ? 'Yes' : 'No',
    'FieldRoutes customer ID': x.fr.id,
    'Matched on': x.fr.how,
    'Sold date': x.fr.sold, 'Service': x.fr.service, 'Initial': x.fr.initial || '', 'Account status': x.fr.status, 'Contract value': x.fr.value || '',
    'Branch': x.fr.office ? _mktgTC(x.fr.office) : '',
    'In GoHighLevel': x.ghl.found == null ? '' : x.ghl.found ? 'Yes' : 'No',
    'GHL status': x.ghl.status, 'GHL stage': x.ghl.stage,
    'Flags': x.flags.join('; '),
  }));
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Disposition');
  XLSX.writeFile(wb, String(F.fileName).replace(/\.(csv|xlsx?|tsv)(\s·.*)?$/i, '') .replace(/[^a-z0-9 _.-]+/gi, '-') + ' - disposition.xlsx');
  if (typeof trackAction === 'function') trackAction('export', 'Disposition', { rows: rows.length });
}

function mktgDispositionView() {
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  const m = _mktgStore();
  const muted = { color: 'var(--text-muted)' };
  const files = state._dispFiles || [];
  const provs = [...new Set([...(m.channels || []), ...files.map(f => f.provider).filter(Boolean)])].sort();
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.csv,.xlsx,.xls,.tsv', class: 'hidden', onchange: (e) => { _dispUpload(e.target.files); e.target.value = ''; } });
  const head = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Lead disposition'),
        el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Upload a provider’s lead report. Each lead is matched to FieldRoutes (customer? sold? still active?) and GoHighLevel (status and stage), and you download their report back with the disposition columns added. Problems found on the way — duplicate leads, leads that never reached GoHighLevel, sales typed under another source — are flagged.')),
      el('label', { class: 'ml-auto rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer', style: { background: 'var(--accent)', color: 'var(--accent-text)' } }, '↑ Upload lead report', fileIn)));
  if (!(state.reportingSubscriptions || []).length) return el('div', { class: 'flex flex-col gap-4' }, head, el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, 'Waiting for the FieldRoutes data to load…'));
  const cards = files.map(F => {
    const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '200px' };
    const sel = (val, opts, on) => el('select', { class: 'rounded-lg border px-2 py-1 text-[11px]', style: selSt, onchange: (e) => { on(e.target.value); mountApp(); } }, ...opts.map(([v, t]) => el('option', { value: v, selected: v === val }, t)));
    const colOpts = [['', '—'], ...F.headers.map(h => [h, h])];
    const ready = F.provider && F.map.date && (F.map.phone || F.map.email || F.map.last || F.map.name);
    const rows = ready ? _dispRun(F) : [];
    const cnt = (fn) => rows.filter(fn).length;
    const tile = (label, n, color) => el('div', { class: 'rounded-xl px-3 py-2', style: { background: 'var(--card-2)', minWidth: '110px' } },
      el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: muted }, label),
      el('div', { class: 'text-lg font-black tabular-nums', style: color ? { color } : {} }, fmt.int(n)),
      el('div', { class: 'text-[10px] tabular-nums', style: muted }, rows.length ? (n / rows.length * 100).toFixed(1) + '%' : ''));
    const filt = state._dispFilt && state._dispFilt.key === F.key ? state._dispFilt.v : '';
    const shown = rows.filter(x => !filt || (filt === 'flag' ? x.flags.length : x.disposition.startsWith(filt)));
    const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 } }, t);
    const td = (t, st) => el('td', { class: 'px-2 py-1 whitespace-nowrap', style: st || {} }, t == null || t === '' ? '—' : t);
    const dCol = (d) => /^Sold$/.test(d) ? '#15803D' : /^Sold –|^Needs|Lost|Abandoned|Not in/.test(d) ? '#B91C1C' : /^(Open|Pending)/.test(d) ? '#B45309' : 'var(--text)';
    const fbtn = (label, v) => el('button', { class: 'rounded-lg border px-2 py-0.5 text-[11px] font-semibold', style: filt === v ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)' }, onclick: () => { state._dispFilt = filt === v ? null : { key: F.key, v }; mountApp(); } }, label);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
        el('span', { class: 'font-bold text-xs' }, F.fileName), el('span', { class: 'text-[11px]', style: muted }, fmt.int(F.rows.length) + ' rows'),
        F.remembered ? el('span', { class: 'text-[10px] font-bold', style: { color: '#5F6C5B' } }, '✓ columns remembered') : null,
        el('span', { class: 'ml-auto inline-flex gap-2' },
          ready ? el('button', { class: 'rounded-lg px-3 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => _dispExport(F, rows) }, '⬇ Download with disposition (.xlsx)') : null,
          el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._dispFiles = state._dispFiles.filter(x => x !== F); mountApp(); } }, 'Close'))),
      el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap text-[11px]' },
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Provider'), sel(F.provider, [['', 'Pick…'], ...provs.map(p => [p, p])], (v) => { F.provider = v; })),
        ...ATTR_FIELDS.filter(([k]) => k !== 'id').map(([k, label]) => el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, label), sel(F.map[k] || '', colOpts, (v) => { if (v) F.map[k] = v; else delete F.map[k]; }))),
        ready ? el('button', { class: 'underline', style: muted, title: 'Use these columns automatically next time this provider sends this report', onclick: () => { const all = Object.assign({}, _dispMaps(), { [_dispMapKey(F.provider, F.headers)]: F.map }); _setAdminRule('dispMaps', all); F.remembered = true; toast('Columns remembered for ' + F.provider, 'success'); mountApp(); } }, 'Remember columns') : null),
      !ready ? el('div', { class: 'px-5 pb-4 text-[11px]', style: { color: '#DC2626' } }, 'Pick the provider, the lead date column, and phone, email or name.') :
      el('div', { class: 'flex flex-col' },
        el('div', { class: 'px-5 pb-3 flex gap-2 flex-wrap' },
          tile('Leads', rows.length), tile('In FieldRoutes', cnt(x => x.fr.found)), tile('Sold', cnt(x => /^Sold/.test(x.disposition)), '#15803D'), tile('Pending', cnt(x => /^Pending/.test(x.disposition)), '#B45309'), tile('Needs follow-up', cnt(x => /^Needs/.test(x.disposition)), '#B91C1C'),
          tile('Open in GHL', cnt(x => /^Open/.test(x.disposition)), '#B45309'), tile('Lost / abandoned', cnt(x => /^(Lost|Abandoned)/.test(x.disposition))),
          tile('Existing customers', cnt(x => x.fr.existing)), tile('Not in GHL', cnt(x => x.ghl.found === false), '#B91C1C'),
          tile('Duplicates', cnt(x => x.flags.some(f => /^Duplicate/.test(f)))), tile('Any flag', cnt(x => x.flags.length), '#B91C1C')),
        el('div', { class: 'px-5 pb-2 flex gap-2 flex-wrap items-center text-[11px]' }, el('span', { style: muted }, 'Show:'), fbtn('Sold', 'Sold'), fbtn('Pending', 'Pending'), fbtn('Needs follow-up', 'Needs'), fbtn('Open', 'Open'), fbtn('Lost', 'Lost'), fbtn('Existing customers', 'Existing'), fbtn('Not in GHL', 'Not in'), fbtn('Flagged', 'flag'),
          filt ? el('span', { style: muted }, fmt.int(shown.length) + ' shown') : null),
        el('div', { class: 'overflow-auto', style: { maxHeight: '52vh', borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-[11px]', style: { borderCollapse: 'collapse' } },
          el('thead', {}, el('tr', {}, ...['Row', 'Lead date', 'Name', 'Phone', 'Disposition', 'FieldRoutes', 'Sold', 'Service', 'Initial', 'Sale source', 'GHL status', 'GHL stage', 'Flags'].map(th))),
          el('tbody', {}, ...shown.slice(0, 500).map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
            td(String(x.i + 2), muted), td(x.date), td(x.name), td(x.phone ? x.phone.replace(/^(\d{3})(\d{3})(\d{4})$/, '($1) $2-$3') : x.email),
            td(x.disposition, { fontWeight: '700', color: dCol(x.disposition) }),
            td(x.fr.found ? '#' + x.fr.id + ' · ' + x.fr.how : 'No', x.fr.found ? {} : muted), td(x.fr.sold), td(x.fr.service), td(x.fr.initial, /^Completed/.test(x.fr.initial || '') ? {} : x.fr.initial ? { color: '#B45309' } : {}), td(x.fr.source),
            td(x.ghl.status), td(x.ghl.stage), td(x.flags.join(' · '), x.flags.length ? { color: '#B91C1C', fontWeight: '600', whiteSpace: 'normal', minWidth: '260px' } : muted)))))),
        shown.length > 500 ? el('div', { class: 'px-5 py-2 text-[11px]', style: muted }, 'Showing 500 of ' + fmt.int(shown.length) + ' — the download has every row.') : null));
  });
  return el('div', { class: 'flex flex-col gap-4' }, head, ...cards,
    !files.length ? el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, 'No report open. Upload a provider’s lead report (CSV or Excel) to build its disposition.') : null);
}
