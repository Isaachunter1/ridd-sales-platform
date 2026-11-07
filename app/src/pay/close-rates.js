// ┌─ src/pay/close-rates.js ─────────────────────────────────────────────────
// │ Close rates from Plaibook (per Isaac, Nov 7): the Sales team page's own
// │ number per rep — sold ÷ qualified — keyed by the rep's NAME as Plaibook's
// │ roster shows it. Isaac only pays Plaibook seats for the reps he wants a
// │ close rate on, so a rep with no Plaibook row has NO close rate: the stub
// │ shows "No Close Rate" and the close-rate bonus never pays for them. The
// │ hand-kept close_rate_target on the profile is retired — no fallback.
// │
// │ Stored in app_settings.close_rates:
// │   { source: 'plaibook', window: { start, end, label }, pulled_at,
// │     reps: { '<name, lower-case>': { name, rate (0–1), sold, qualified, revenue } },
// │     aliases: { '<app name, lower-case>': '<plaibook name, lower-case>' } }
// │ Filled from Configurations → Commission rules → Close rates (paste the
// │ Plaibook rows, or Claude writes them from the Plaibook connection).
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
function _closeRatesStore() {
  if (typeof DEMO !== 'undefined' && DEMO) return state._closeRates || (state._closeRates = { source: 'plaibook', reps: {}, aliases: {} });
  if (state._closeRates === undefined) {
    state._closeRates = null;
    if (typeof supabase !== 'undefined' && supabase) supabase.from('app_settings').select('value, updated_at').eq('key', 'close_rates').maybeSingle().then(({ data }) => {
      (state._settingsSeen = state._settingsSeen || {}).close_rates = (data && data.updated_at) || null;
      state._closeRates = Object.assign({ source: 'plaibook', reps: {}, aliases: {} }, (data && data.value) || {});
      mountApp();
    }).catch(() => { state._closeRates = { source: 'plaibook', reps: {}, aliases: {} }; });
  }
  return state._closeRates;
}
const _crKey = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// The rep's Plaibook close rate, or null = no seat in Plaibook → No Close Rate.
function repCloseRate(repOrId) {
  const prof = typeof repOrId === 'string' ? ((state.allProfiles || []).find(p => p.id === repOrId) || (state.profile && state.profile.id === repOrId ? state.profile : null)) : repOrId;
  const S = _closeRatesStore();
  if (!prof || !S || !S.reps) return null;
  const k = _crKey(prof.full_name);
  const hit = S.reps[k] || S.reps[(S.aliases || {})[k]] || null;
  if (!hit || !Number.isFinite(Number(hit.rate))) return null;
  return { rate: Number(hit.rate), sold: Number(hit.sold) || 0, qualified: Number(hit.qualified) || 0, name: hit.name || prof.full_name, window: S.window || null, pulledAt: S.pulled_at || null };
}
const repCloseRateValue = (repOrId) => { const r = repCloseRate(repOrId); return r ? r.rate : null; };
function closeRateLabel(repOrId) {
  const r = repCloseRate(repOrId);
  return r ? Math.round(r.rate * 1000) / 10 + '%' : 'No Close Rate';
}

// Configurations card: every Office Staff rep against the Plaibook rows, plus a paste box to refresh them.
function closeRatesCard() {
  if (!isAdminRole(state.profile?.role)) return null;
  const S = _closeRatesStore();
  const reps = (state.allProfiles || []).filter(p => p.is_active !== false && !['auditor', 'disabled'].includes(p.role) && (typeof repTypeGroup === 'function' ? repTypeGroup(p) === 'office' : true))
    .sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
  const muted = { color: 'var(--text-muted)' };
  const th = (t, r) => el('th', { class: 'px-2 py-1.5 text-[10px] uppercase tracking-wider font-semibold ' + (r ? 'text-right' : 'text-left'), style: muted }, t);
  const td = (t, r, st) => el('td', { class: 'px-2 py-1.5 tabular-nums ' + (r ? 'text-right' : ''), style: st || {} }, t);
  const rows = reps.map(p => { const r = repCloseRate(p); return el('tr', { style: { borderTop: '1px solid var(--border)' } },
    td(p.full_name || '—'),
    td(r ? Math.round(r.rate * 1000) / 10 + '%' : 'No Close Rate', true, r ? { fontWeight: '700' } : { color: '#B91C1C', fontWeight: '600' }),
    td(r ? r.sold + ' / ' + r.qualified : '—', true, muted),
    td(r ? 'close-rate bonus on' : 'no seat in Plaibook — no close-rate bonus', false, muted)); });
  const extra = Object.values((S && S.reps) || {}).filter(x => !reps.some(p => _crKey(p.full_name) === _crKey(x.name) || ((S.aliases || {})[_crKey(p.full_name)] === _crKey(x.name))));
  const box = el('textarea', { class: 'w-full rounded-lg border px-2 py-1 text-[11px]', rows: 4, placeholder: 'One rep per line, as Plaibook shows them:\nDrew Sauer, 45.1%, 390 / 865\nDom Polk, 37.5, 138/368', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', fontFamily: 'ui-monospace, monospace' } });
  const win = el('input', { type: 'text', value: (S && S.window && S.window.label) || '', placeholder: 'window, e.g. Aug 8 – Nov 6 (90 days)', class: 'rounded-lg border px-2 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '240px' } });
  const save = el('button', { class: 'rounded-lg px-3 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: async () => {
    const next = Object.assign({ source: 'plaibook', reps: {}, aliases: {} }, S || {});
    const raw = String(box.value || '').trim();
    let n = 0;
    if (raw.startsWith('{')) {
      // Full payload: { window: {label,start,end}, reps: { name: { rate, sold, qualified, closed: [{name,sub}], qualified_not_closed: [...], unqualified: [...] } } }
      try { const j = JSON.parse(raw); if (j.reps && typeof j.reps === 'object') { for (const [k, v] of Object.entries(j.reps)) { const rate = Number(v.rate); if (!Number.isFinite(rate)) continue; next.reps[_crKey(v.name || k)] = Object.assign({}, v, { name: v.name || k, rate: rate > 1 ? rate / 100 : rate }); n++; } if (j.window) next.window = Object.assign({}, next.window || {}, j.window); if (j.aliases) next.aliases = Object.assign({}, next.aliases || {}, j.aliases); } }
      catch (e) { toast('That JSON did not parse: ' + e.message, 'error'); return; }
    }
    const lines = raw.startsWith('{') ? [] : raw.split(/\n+/).map(x => x.trim()).filter(Boolean);
    for (const L of lines) {
      const m = L.match(/^(.+?)\s*[,\t]\s*([\d.]+)\s*%?(?:\s*[,\t]\s*(\d+)\s*\/\s*(\d+))?/);
      if (!m) continue;
      const rate = Number(m[2]); if (!Number.isFinite(rate)) continue;
      next.reps[_crKey(m[1])] = { name: m[1].trim(), rate: rate > 1 ? rate / 100 : rate, sold: Number(m[3]) || 0, qualified: Number(m[4]) || 0 }; n++;
    }
    if (!n && !lines.length && !win.value) { toast('Nothing to save', 'warn'); return; }
    if (win.value.trim()) next.window = Object.assign({}, next.window || {}, { label: win.value.trim() });
    next.pulled_at = new Date().toISOString();
    if (typeof DEMO !== 'undefined' && DEMO) { state._closeRates = next; toast(n + ' close rate' + (n === 1 ? '' : 's') + ' saved', 'success'); mountApp(); return; }
    const r = await saveAppSettingCas('close_rates', next, async () => { state._closeRates = undefined; _closeRatesStore(); });
    if (!r || !r.ok) { toast('Could not save close rates' + (r && r.error ? ': ' + r.error.message : r && r.conflict ? ' — someone else just saved; reloaded, try again' : ''), 'error'); return; }
    state._closeRates = next; toast(n + ' close rate' + (n === 1 ? '' : 's') + ' saved from Plaibook', 'success');
    try { logActivity('config_change', { detail: 'Close rates (Plaibook): ' + n + ' reps · ' + win.value }); } catch (e) { /* optional */ }
    mountApp();
  } }, 'Save');
  return el('div', { class: 'card p-5' },
    el('h3', { class: 'text-base font-bold mb-1' }, 'Close rates · Plaibook'),
    el('div', { class: 'text-[11px] mb-3', style: muted }, 'The close rate the bonus tier reads, per rep, as Plaibook’s Sales team page shows it (sold ÷ qualified). A rep with no seat in Plaibook has No Close Rate and no close-rate bonus.'
      + (S && S.pulled_at ? ' Last saved ' + new Date(S.pulled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + (S.window && S.window.label ? ' · ' + S.window.label : '') + '.' : '')),
    el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', { style: { background: 'var(--card-2)' } }, th('Office Staff rep'), th('Close rate', true), th('Sold / qualified', true), th(''))),
      el('tbody', {}, ...rows))),
    extra.length ? el('div', { class: 'text-[11px] mt-2', style: muted }, 'In Plaibook but not an Office Staff rep here: ' + extra.map(x => x.name + ' ' + Math.round(x.rate * 1000) / 10 + '%').join(' · ')) : null,
    el('div', { class: 'mt-3 flex flex-col gap-2' }, box, el('div', { class: 'flex items-center gap-2 flex-wrap' }, win, save)));
}
