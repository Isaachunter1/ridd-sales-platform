'use strict';
// ════════════════════════════════════════════════════════════════════════
// SHARED BUSINESS RULES for the server functions (settings audit, Sep 30).
// The admin configures these in the app; the server must read the SAME
// values instead of keeping its own copies:
//   · Services that are never a sale = FieldRoutes' global exclusions
//     (mirrors engine/src/10-sales-helpers.js FR_GLOBAL_EXCLUDED_SERVICES,
//     plus the long-standing server extra 'Rodent Station Removal') + every
//     service type an admin marks Hidden in Settings → Reporting rules →
//     Service types (reporting_service_config.is_hidden).
//   · Admin rules (indicator_config.competitions.extras.adminRules) — the
//     same object the app's _adminRules() reads.
// ════════════════════════════════════════════════════════════════════════
const FR_GLOBAL_EXCLUDED = ['ACH Chargeback', 'Early Cancellation Fee', 'German Roach Initial', 'Rodent Station Removal'];

async function loadNonSaleServices(supabase) {
  const set = new Set(FR_GLOBAL_EXCLUDED);
  try {
    const { data } = await supabase.from('reporting_service_config').select('service_name, is_hidden').eq('is_hidden', true);
    for (const r of data || []) if (r && r.service_name) set.add(String(r.service_name).trim());
  } catch (e) { /* table missing → the FieldRoutes list alone */ }
  return set;
}

async function loadAdminRules(supabase) {
  try {
    const { data } = await supabase.from('indicator_config').select('competitions').eq('id', 1).maybeSingle();
    const ar = data && data.competitions && data.competitions.extras && data.competitions.extras.adminRules;
    return ar && typeof ar === 'object' ? ar : {};
  } catch (e) { return {}; }
}

// "Not an add-on" fallback when no per-item rule is set — fees, tax,
// discounts. One definition for every sync (was two opposite defaults).
const NOT_ADDON_RE = /^(service fee|tax|nsf fee|late fee|finance charge|credit card fee)\b|discount/i;
const notAddOnDefault = (n) => !NOT_ADDON_RE.test(String(n || '').trim());

module.exports = { FR_GLOBAL_EXCLUDED, loadNonSaleServices, loadAdminRules, NOT_ADDON_RE, notAddOnDefault };
