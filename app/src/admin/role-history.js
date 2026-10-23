// ── Role history (per Isaac, Oct 15) ─────────────────────────────────────────
// profiles.role_history = [{ role: 'Sales Rep' | 'Technician' | 'Office Staff', start: 'YYYY-MM-DD' }].
const ROLE_HISTORY_ROLES = ['Sales Rep', 'Technician', 'Office Staff'];
function roleHistoryClean(h) {
  return (Array.isArray(h) ? h : []).filter(r => r && ROLE_HISTORY_ROLES.includes(r.role) && /^\d{4}-\d{2}-\d{2}$/.test(String(r.start || '')))
    .map(r => ({ role: r.role, start: String(r.start) })).sort((a, b) => a.start.localeCompare(b.start));
}
// The role this person is in today (latest start on/before today), or null without a history.
function currentRoleEntry(p) {
  const today = new Date().toISOString().slice(0, 10);
  const h = roleHistoryClean(p && p.role_history).filter(r => r.start <= today);
  return h.length ? h[h.length - 1] : null;
}
function roleStartForProfileId(id) { const p = id ? (state.allProfiles || []).find(x => x.id === id) : null; const e = currentRoleEntry(p); return e ? e.start : ''; }
// Tier default (per Isaac, Oct 16): Rookie / Vet is a door-to-door class — Office Staff (incl. loyalty and the
// office leads), admins and developers default to N/A. Matched by the rep's app login (name signature), else the
// CRM's Sold By Type. A tier someone sets by hand still wins (engine getRepTier checks tags first).
let _tierDefIdx = { src: null, map: new Map() };
function repTierDefaultFor(name) {
  if (!name) return '';
  const profs = state.allProfiles || [];
  const sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  if (_tierDefIdx.src !== profs) { const m = new Map(); for (const p of profs) { if (!p || !p.full_name) continue;
    const na = (typeof isAdminRole === 'function' && isAdminRole(p.role)) || p.role === 'developer' || (typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(p));
    m.set(sig(p.full_name), na ? 'na' : ''); } _tierDefIdx = { src: profs, map: m }; }
  const canon = typeof getCanonicalRepName === 'function' ? getCanonicalRepName(name) : name;
  const k = sig(canon), k2 = sig(name);
  if (_tierDefIdx.map.has(k)) return _tierDefIdx.map.get(k);
  if (_tierDefIdx.map.has(k2)) return _tierDefIdx.map.get(k2);
  const t = (state._indicatorRepTypeBySig || {})[typeof _repTypeNameSig === 'function' ? _repTypeNameSig(canon) : k];
  return t === 'Office Staff' ? 'na' : '';
}
// Rookie/Vet hook for the engine's getRepTier (name-keyed): the year they started as a Sales Rep (else the current role), 0 = no history.
let _roleYearIdx = { src: null, map: null };
function roleStartYearForName(name) {
  const profs = state.allProfiles || [];
  const sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  // Rookie/Vet is a door-to-door class: the year they FIRST started as a Sales Rep (a tech who moves to the doors is a
  // door rookie; a door vet who moves inside stays a vet for the seasons he sold). No Sales Rep entry → current role.
  if (_roleYearIdx.src !== profs) { const m = new Map(); for (const p of profs) { if (!p.full_name) continue; const h = roleHistoryClean(p.role_history); const sr = h.find(r => r.role === 'Sales Rep'); const e = sr || currentRoleEntry(p); if (e) m.set(sig(p.full_name), Number(e.start.slice(0, 4))); } _roleYearIdx = { src: profs, map: m }; }
  if (!_roleYearIdx.map.size || !name) return 0;
  const canon = typeof getCanonicalRepName === 'function' ? getCanonicalRepName(name) : name;
  return _roleYearIdx.map.get(sig(canon)) || _roleYearIdx.map.get(sig(name)) || 0;
}
// Prefill: each FieldRoutes login type's first sale under this person's name, in order.
function roleHistoryFromSales(fullName) {
  const sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  const want = sig(fullName); if (!want) return [];
  const first = new Map();
  for (const x of (state._indicatorRawSales || [])) {
    if (!x || !x.rep) continue;
    const nm = typeof getCanonicalRepName === 'function' ? getCanonicalRepName(x.rep) : x.rep;
    if (sig(nm) !== want && sig(x.rep) !== want) continue;
    const t = String(x.repType || '').trim(); const role = ROLE_HISTORY_ROLES.find(r => r.toLowerCase() === t.toLowerCase()); if (!role) continue;
    const iso = typeof dateSoldToIso === 'function' ? dateSoldToIso(x.dateSold) : ''; if (!iso) continue;
    if (!first.has(role) || iso < first.get(role)) first.set(role, iso);
  }
  return [...first.entries()].map(([role, start]) => ({ role, start })).sort((a, b) => a.start.localeCompare(b.start));
}
