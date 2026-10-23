// ── Company logo (drives the raffle-spin hub today; can be reused for
// auth/header branding later) ─────────────────────────────────────────────
// Mirrored through public.app_settings under key 'company_logo' so any
// admin uploading from any browser updates everyone's view. localStorage
// is the local cache for instant reads while Supabase is in flight.
const RIDD_LOGO_STORAGE_KEY = 'ridd-spin-logo-v1';
async function loadCompanyLogo() {
  // localStorage first — instant, no network.
  try {
    const local = localStorage.getItem(RIDD_LOGO_STORAGE_KEY);
    if (local) state.companyLogo = local;
  } catch {}
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', 'company_logo').maybeSingle();
    if (error) { console.warn('[ridd] company_logo select failed', error); return; }
    const serverLogo = data?.value?.data_url;
    if (serverLogo) {
      state.companyLogo = serverLogo;
      try { localStorage.setItem(RIDD_LOGO_STORAGE_KEY, serverLogo); } catch {}
    } else if (state.companyLogo && isAdminRole(state.profile?.role)) {
      // Server row is empty but this browser has a saved logo (one-time
      // migration after we enabled cross-browser sync). Push it up.
      saveCompanyLogo(state.companyLogo).catch(() => {});
    }
  } catch (err) { console.warn('[ridd] company_logo load threw', err); }
}
async function saveCompanyLogo(dataUrl) {
  state.companyLogo = dataUrl || '';
  try {
    if (dataUrl) localStorage.setItem(RIDD_LOGO_STORAGE_KEY, dataUrl);
    else         localStorage.removeItem(RIDD_LOGO_STORAGE_KEY);
  } catch {}
  if (DEMO || !supabase || !state.profile) return;
  if (!isAdminRole(state.profile?.role)) return;
  try {
    const { error } = await supabase.from('app_settings').upsert(
      { key: 'company_logo', value: dataUrl ? { data_url: dataUrl } : {} },
      { onConflict: 'key' }
    );
    if (error) {
      console.warn('[ridd] company_logo upsert failed', error);
      if (typeof toast === 'function') toast('Saved locally — server sync failed (' + (error.message || 'unknown') + ')', 'warn');
    }
  } catch (err) { console.warn('[ridd] company_logo save threw', err); }
}

// ── Commission calculator config (shared across admins via app_settings) ──
// One JSON row holds: per-rep negotiated rates, the service→category map, and
// the multi-year bonus thresholds. Money config, so it lives server-side (not
// localStorage) to stay consistent for everyone.
const COMMISSION_MY_DEFAULT = { hiPct: 75, loPct: 55, rate18: 2, rate24: 3, penalty: 5 };
// Default rate model (matches the Retool backend): Pest % is the base; Ancillary
// and Bundle are MULTIPLES of the pest rate.
const COMMISSION_RATE_DEFAULT = { pest: 0.20, ancMult: 0.5, bundleMult: 1 };   // per Isaac, Oct 6 2026: every commissionable service type pays the rep's FULL rate; add-ons (ticket items) pay half
const COMMISSION_REP_TYPES = ['Office Staff', 'Sales Rep', 'Technician'];
function commissionConfig() {
  const c = state.commissionConfig || {};
  return {
    repRates:          c.repRates || {},          // { [empId]: { pest, ancMult, bundleMult } } — per-rep OVERRIDE
    typeRules:         c.typeRules || {},         // { [repType]: { pest, ancMult, bundleMult, multiYear:{...} } } — defaults by rep type
    serviceCategories: c.serviceCategories || {}, // { [serviceName]: 'pest'|'bundle'|'ancillary'|'exclude' }
    multiYear:         Object.assign({}, COMMISSION_MY_DEFAULT, c.multiYear || {}), // legacy company-wide fallback
    manual:            c.manual || {},            // { [empId]: { overrides, rent, paidYtd, other, audit, payPeriods } } — shared
    published:         c.published || {},         // { [empId]: { ...breakdown, period, at } } — what reps see
    upfrontTypeRules:  c.upfrontTypeRules || {},  // { [repType]: { pest, bundle, anc } } — UPFRONT rate defaults (fractions)
    upfrontRepRates:   c.upfrontRepRates || {},   // { [empId]: { pest, bundle, anc } } — per-rep upfront override
    d2dPayscales:      c.d2dPayscales || null,
    attritionPct:      c.attritionPct != null ? Number(c.attritionPct) : 20, // D2D Pay: estimated attrition % until the Jan 31 lock (per-rep manual.attrPct overrides)     // Sales Rep payscale ladders (Rookie / Veteran / Elite / Pro) — see D2D_PAYSCALE_DEFAULTS
  };
}
// Upfront pay model — category rates paid on contract value off the top
// (the old season pay-stub tool: Pest 60% / Bundle 48% / Ancillary 30%).
// Backend ("holistic") rates live in typeRules above; these are separate.
const UPFRONT_RATE_DEFAULT = { pest: 0.60, bundle: 0.48, anc: 0.30 };
function upfrontRulesForType(typeLabel) {
  const t = commissionConfig().upfrontTypeRules[typeLabel] || {};
  return {
    pest:   t.pest   != null ? Number(t.pest)   : UPFRONT_RATE_DEFAULT.pest,
    bundle: t.bundle != null ? Number(t.bundle) : UPFRONT_RATE_DEFAULT.bundle,
    anc:    t.anc    != null ? Number(t.anc)    : UPFRONT_RATE_DEFAULT.anc,
  };
}
function upfrontRatesFor(empId, typeLabel) {
  const base = upfrontRulesForType(typeLabel);
  const r = commissionConfig().upfrontRepRates[empId] || {};
  return {
    pest:   r.pest   != null ? Number(r.pest)   : base.pest,
    bundle: r.bundle != null ? Number(r.bundle) : base.bundle,
    anc:    r.anc    != null ? Number(r.anc)    : base.anc,
    overridden: (r.pest != null || r.bundle != null || r.anc != null),
  };
}
// The rule set for a rep TYPE — type config layered over company defaults.
function commissionRulesForType(typeLabel) {
  const cfg = commissionConfig();
  const t = cfg.typeRules[typeLabel] || {};
  return {
    pest:       t.pest != null ? Number(t.pest) : COMMISSION_RATE_DEFAULT.pest,
    ancMult:    t.ancMult != null ? Number(t.ancMult) : COMMISSION_RATE_DEFAULT.ancMult,
    bundleMult: t.bundleMult != null ? Number(t.bundleMult) : COMMISSION_RATE_DEFAULT.bundleMult,
    multiYear:  Object.assign({}, COMMISSION_MY_DEFAULT, cfg.multiYear, t.multiYear || {}),
  };
}
// Effective rates for a specific rep: per-rep override → rep-type default → company default.
function commissionRatesFor(empId, typeLabel) {
  const base = commissionRulesForType(typeLabel);
  const r = commissionConfig().repRates[empId] || {};
  const pest = r.pest != null ? Number(r.pest) : base.pest;
  const ancMult = r.ancMult != null ? Number(r.ancMult) : base.ancMult;
  const bundleMult = r.bundleMult != null ? Number(r.bundleMult) : base.bundleMult;
  return { pest, ancMult, bundleMult, ancRate: pest * ancMult, bundleRate: pest * bundleMult,
           overridden: (r.pest != null || r.ancMult != null || r.bundleMult != null) };
}
// CAS write for a shared setting (save_app_setting RPC, app_settings_cas.sql).
// `state._settingsSeen[key]` is the server updated_at we last loaded; a
// write based on an older copy is refused and the caller reloads instead
// of clobbering another admin's edit. Falls back to the plain upsert when
// the RPC isn't installed yet.
async function saveAppSettingCas(key, value, onConflict) {
  if (typeof trackAction === 'function') trackAction('setting_save', key);
  const seen = (state._settingsSeen || {})[key] || null;
  try {
    const { data, error } = await supabase.rpc('save_app_setting', { p_key: key, p_value: value, based_on: seen });
    if (error && /function|does not exist|schema cache/i.test(error.message || '')) {
      const r = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });
      return r.error ? { ok: false, error: r.error } : { ok: true };
    }
    if (error) return { ok: false, error };
    if (data && data.ok) { (state._settingsSeen = state._settingsSeen || {})[key] = data.updated_at; return { ok: true }; }
    if (data && data.conflict) { if (onConflict) await onConflict(data); return { ok: false, conflict: true }; }
    return { ok: false, error: new Error((data && data.error) || 'save refused') };
  } catch (e) { return { ok: false, error: e }; }
}
async function loadCommissionConfig() {
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const { data, error } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'commission_config').maybeSingle();
    if (error) { healthReport('commission', false, error); return; }
    healthReport('commission', true);
    if (data && data.value) { state.commissionConfig = data.value; (state._settingsSeen = state._settingsSeen || {}).commission_config = data.updated_at; }
  } catch (e) { healthReport('commission', false, e); }
}
async function saveCommissionConfig(next) {
  state.commissionConfig = next;
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const r = await saveAppSettingCas('commission_config', next, async () => {
      await loadCommissionConfig();
      toast('Another admin changed Commissions settings since you opened them — reloaded the latest, please re-apply your edit', 'warn');
      mountApp();
    });
    if (!r.ok && !r.conflict) { healthReport('commission', false, r.error); if (typeof toast === 'function') toast('Saved locally — server sync failed', 'warn'); }
  } catch (e) { healthReport('commission', false, e); }
}
// ── Company goal (annual target + monthly allocation) — shared via app_settings ──
// In demo mode this lives in the demo snapshot; in production it persists to
// app_settings under 'company_goal' so the Goals tab survives a reload.
async function loadCompanyGoal() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'company_goal').maybeSingle();
    if (error) { console.warn('[ridd] company_goal load failed', error); return; }
    if (data && data.value) state.companyGoal = data.value;
  } catch (e) { console.warn('[ridd] company_goal load threw', e); }
}
async function saveCompanyGoal() {
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const { error } = await supabase.from('app_settings').upsert({ key: 'company_goal', value: state.companyGoal }, { onConflict: 'key' });
    if (error) { console.warn('[ridd] company_goal save failed', error); if (typeof toast === 'function') toast('Saved locally — server sync failed', 'warn'); }
  } catch (e) { console.warn('[ridd] company_goal save threw', e); }
}
// ── Department goals (per Isaac, Sep 22): the Goals tab has one set per
// department. Office Staff IS the existing company_goal (every pacer /
// dashboard consumer keeps reading it unchanged); Door to Door and
// Technicians get their own objects under app_settings keys
// 'company_goal_d2d' / 'company_goal_tech', same shape, no consumers yet.
const GOAL_DEPTS = [
  { id: 'office', label: 'Office Staff',  key: 'company_goal',      lines: { a: 'New / Inside Sales', b: 'Renewal / Loyalty' }, reps: { a: 'Inside Sales Reps', b: 'Loyalty Reps' }, blocks: { a: 'Inside Sales', b: 'Loyalty' },
    // Row labels on the Office Staff Quota grid (per Isaac, Sep 23).
    names: { curveA: 'IS Seasonal Curve', revA: 'IS Revenue', perA: 'Revenue/IS Rep', curveB: 'Loyalty Seasonal Curve', revB: 'Loyalty Revenue', perB: 'Revenue/Loyalty Rep', total: 'Total Revenue',
             qPctA: 'IS Quarterly Revenue %', qA: 'IS Quarterly Revenue', repsA: 'IS Reps', quotaA: 'IS Quarterly Quota', qPctB: 'Loyalty Quarterly Revenue %', qB: 'Loyalty Quarterly Revenue', repsB: 'Loyalty Reps', quotaB: 'Loyalty Quarterly Quota', qTotal: 'Total Quarterly Revenue' } },
  { id: 'd2d',    label: 'Sales Rep',     key: 'company_goal_d2d',  lines: { a: 'New / Door to Door', b: 'Upsells / Termite Pro' }, reps: { a: 'Sales Reps', b: 'Termite Pro Reps' }, blocks: { a: 'Door to Door', b: 'Termite Pro' } },
  { id: 'tech',   label: 'Technician',    key: 'company_goal_tech', lines: { a: 'Upsells / Service Pro', b: 'Other' }, reps: { a: 'Technicians', b: 'Technicians (other)' }, blocks: { a: 'Service Pro', b: 'Other' } },
];
function deptGoalObj(deptId) {
  if (deptId === 'office' || !deptId) return state.companyGoal;
  state._deptGoals = state._deptGoals || {};
  if (!state._deptGoals[deptId]) state._deptGoals[deptId] = { amount: 0, new_amount: 0, renewal_amount: 0, is_reps: 1, loyalty_reps: 1, period: 'year' };
  return state._deptGoals[deptId];
}
async function loadDeptGoals() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const keys = GOAL_DEPTS.filter(d => d.id !== 'office').map(d => d.key);
    const { data, error } = await supabase.from('app_settings').select('key, value').in('key', keys);
    if (error) { console.warn('[ridd] dept goals load failed', error); return; }
    state._deptGoals = state._deptGoals || {};
    for (const row of (data || [])) { const d = GOAL_DEPTS.find(x => x.key === row.key); if (d && row.value) state._deptGoals[d.id] = row.value; }
  } catch (e) { console.warn('[ridd] dept goals load threw', e); }
}
async function saveDeptGoal(deptId) {
  if (deptId === 'office' || !deptId) return saveCompanyGoal();
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  const d = GOAL_DEPTS.find(x => x.id === deptId); if (!d) return;
  try {
    const { error } = await supabase.from('app_settings').upsert({ key: d.key, value: deptGoalObj(deptId) }, { onConflict: 'key' });
    if (error) { console.warn('[ridd] ' + d.key + ' save failed', error); if (typeof toast === 'function') toast('Saved locally — server sync failed', 'warn'); }
  } catch (e) { console.warn('[ridd] ' + d.key + ' save threw', e); }
}
// ── Pay settings (Inside Sales / Office Staff pay rules) — shared via
// app_settings key 'pay_settings'. Holds contract-type rates, below-min,
// PIF/commercial overrides, renewal flat $, backend rates, close-rate tiers.
// In demo mode these ride along in the demo snapshot; in production they
// persist here so the Office Staff rules (and the Pay tab math) survive a
// reload. Loaded for any signed-in user so reps see correct pay; saved by
// admins only.
async function loadAutologSwitch() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
    state._autologCache = (data && data.value) || null;
  } catch (e) { /* stays manual */ }
}
async function loadAppSettings() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'pay_settings').maybeSingle();
    if (error) { healthReport('pay', false, error); return; }
    healthReport('pay', true);
    if (data && data.value) { state.appSettings = Object.assign({}, state.appSettings, data.value); (state._settingsSeen = state._settingsSeen || {}).pay_settings = data.updated_at; }
  } catch (e) { healthReport('pay', false, e); }
}
// Per-pay-period "Other Pay" lines (per Isaac: bonuses, competition earnings
// and the like, entered by hand each pay period). RLS: reps read their own,
// admins read/write all. Loaded for everyone so the stub shows them.
async function loadPayAdjustments() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('pay_adjustments').select('*').order('created_at');
    if (error) { if (!/pay_adjustments/i.test(error.message || '')) console.warn('[ridd] pay_adjustments load failed', error); return; }
    state.payAdjustments = data || [];
  } catch (e) { console.warn('[ridd] pay_adjustments load threw', e); }
}
async function addPayAdjustment(repId, year, periodId, amount, label) {
  const row = { rep_id: repId, period_year: year, period_id: periodId, amount, label: label || '', created_by: state.profile.id };
  if (DEMO || !supabase) { state.payAdjustments.push({ id: 'demo-' + Date.now(), ...row, created_at: new Date().toISOString() }); return true; }
  const { data, error } = await supabase.from('pay_adjustments').insert(row).select('*').single();
  if (error) { toast('Could not save: ' + error.message, 'error'); return false; }
  state.payAdjustments.push(data);
  logActivity('config_change', { detail: 'Other Pay +' + amount + ' (' + (label || 'no label') + ') for ' + repId + ' · ' + year + '/' + periodId });
  return true;
}
async function removePayAdjustment(id) {
  if (!DEMO && supabase) {
    const { error } = await supabase.from('pay_adjustments').delete().eq('id', id);
    if (error) { toast('Could not remove: ' + error.message, 'error'); return false; }
  }
  state.payAdjustments = state.payAdjustments.filter(a => a.id !== id);
  return true;
}
async function saveAppSettings() {
  window._riddMutRev = (window._riddMutRev || 0) + 1;   // view cache: any saved change makes cached screens stale
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const r = await saveAppSettingCas('pay_settings', state.appSettings, async () => {
      await loadAppSettings();
      toast('Another admin changed Pay settings since you opened them — reloaded the latest, please re-apply your edit', 'warn');
      mountApp();
    });
    if (!r.ok && !r.conflict) { healthReport('pay', false, r.error); if (typeof toast === 'function') toast('Saved locally — server sync failed', 'warn'); }
  } catch (e) { healthReport('pay', false, e); }
}
// Publish one rep's computed breakdown to the per-rep, RLS-protected results
// table so that rep (and only that rep) can see it in "My Commission".
async function publishCommissionResult(empId, data, period) {
  if (DEMO || !supabase || !isAdminRole(state.profile?.role)) return { ok: false };
  try {
    const { error } = await supabase.from('commission_results').upsert({
      employee_id: String(empId), data,
      period_start: (period && period.start) || null, period_end: (period && period.end) || null,
      published_by: state.profile.id, published_at: new Date().toISOString(),
    }, { onConflict: 'employee_id' });
    if (error) { console.warn('[ridd] commission publish failed (run commission_results.sql?)', error); return { ok: false, msg: error.message }; }
    return { ok: true };
  } catch (e) { console.warn('[ridd] commission publish threw', e); return { ok: false, msg: String(e) }; }
}
// A rep loads ONLY their own published row (RLS keys on their linked id).
async function loadMyCommissionResult() {
  if (DEMO || !supabase || !state.profile) { state._myCommissionLoaded = true; return; }
  try {
    let q = supabase.from('commission_results').select('*');
    if (state.profile.fieldroutes_employee_id) q = q.eq('employee_id', String(state.profile.fieldroutes_employee_id));
    const { data, error } = await q.maybeSingle();
    state._myCommission = (!error && data) ? data : null;
  } catch (e) { state._myCommission = null; }
  state._myCommissionLoaded = true;
}

