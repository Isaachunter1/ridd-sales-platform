// ┌─ rollupLtv ──────────────────────────────────────────────────────────────
// │ The long rows ltvCohorts.sql returns → the published marketing/ltv.json
// │ (per Isaac, Nov 18 2026). One block per group ("all", "office:10",
// │ "seller:office", "office_seller:10|office", "source:Facebook"), one entry
// │ per start month: n customers, ACV (first-subscription contract value),
// │ customers active today, collected revenue by month since start (rev[k])
// │ and survivors at the end of each month (alive[k]; null past the cohort's
// │ age — a month that has not happened yet is unknown, not zero).
// │ Pure: rows in, payload out. The browser does the projecting
// │ (app/src/integrations/marketing-ltv.js) so the model can be changed
// │ without a redeploy of the job.
// └─────────────────────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');

// Months a cohort has fully lived through as of `today` (iso): cohort 2026-01 on 2026-11-18 → k 0..9 are closed, so 10.
export function cohortAge(cohortYm, todayIso) {
  const [cy, cm] = cohortYm.split('-').map(Number), [ty, tm] = todayIso.split('-').map(Number);
  return Math.max(0, (ty - cy) * 12 + (tm - cm));   // the current month is still open, so it does not count
}

export function rollupLtv(rows, { today, maxK = 47, start = '2021-01', generatedAt, officeNames = {} } = {}) {
  const groups = {};
  const get = (kind, key) => { const id = kind + ':' + key; return groups[id] || (groups[id] = { kind, key, cohorts: {} }); };
  const coh = (g, ym) => g.cohorts[ym] || (g.cohorts[ym] = { n: 0, acv: null, aliveNow: 0, rev: new Array(maxK + 1).fill(0), alive: new Array(maxK + 1).fill(null) });
  for (const r of rows || []) {
    const kind = String(r.grp_kind || ''), key = String(r.grp_key || ''), ym = String(r.cohort || ''), k = Number(r.k);
    if (!kind || !key || !/^\d{4}-\d{2}$/.test(ym) || !Number.isFinite(k)) continue;
    const c = coh(get(kind, key), ym);
    if (k === -1) { c.n = Number(r.n) || 0; c._cvSum = Number(r.rev) || 0; c.aliveNow = Number(r.alive) || 0; continue; }
    if (k < 0 || k > maxK) continue;
    if (r.rev != null) c.rev[k] = Math.round((Number(r.rev) || 0) * 100) / 100;
    if (r.alive != null) c.alive[k] = Number(r.alive) || 0;
  }
  // Finish each cohort: ACV, age, and alive = 0 (not null) for closed months with no survivors left.
  let cohorts = 0, customers = 0;
  for (const g of Object.values(groups)) {
    for (const [ym, c] of Object.entries(g.cohorts)) {
      c.acv = c.n ? Math.round((c._cvSum || 0) / c.n * 100) / 100 : null; delete c._cvSum;
      c.age = Math.min(maxK + 1, cohortAge(ym, today));
      for (let k = 0; k < c.age; k++) if (c.alive[k] == null) c.alive[k] = 0;
      for (let k = c.age; k <= maxK; k++) { c.alive[k] = null; }
      cohorts++; customers += g.kind === 'all' ? c.n : 0;
    }
  }
  return { version: 1, generatedAt: generatedAt || new Date().toISOString(), asOf: today, start, maxK, officeNames, groups, totals: { groups: Object.keys(groups).length, cohorts, customers } };
}

// fieldroutes_employees rows carry "office_ids" and "office_name" in the same order — the only office-name source
// the server has without the Offices table RevHawk keeps off (per RevHawk support, Nov 2026).
export function officeNamesFromRoster(roster) {
  const out = {};
  for (const e of roster || []) {
    const ids = String(e.office_ids || e.office_id || '').split(',').map(s => s.trim()).filter(Boolean);
    const names = String(e.office_name || '').split(',').map(s => s.trim()).filter(Boolean);
    if (ids.length === names.length) ids.forEach((id, i) => { if (!out[id] && names[i]) out[id] = names[i]; });
  }
  return out;
}
