// ┌─ src/12-crm-vocab.js ──────────────────────────────────────────────────────
// │ CRM vocabulary — the ONE place the app knows what a FieldRoutes label
// │ MEANS. Every rule in the app (attrition steps, ROR window, CRM
// │ reconciliation, seller-type scoping) asks these predicates instead of
// │ testing a RIDD spelling like "3 Day ROR" or "Upsell - Service Pro".
// │
// │ Generalization (Isaac, Sep 22 2026): the rules stay exactly as built;
// │ what a second company configures is the MAPPING from their FieldRoutes
// │ labels to the buckets the rules read. Nothing configured = RIDD's
// │ spellings (the defaults below), so RIDD's numbers do not move.
// │
// │ Stored in adminRules.crmVocab (same persisted store as the other
// │ Configurations rules). Shape — every key optional:
// │   { rorWindowDays: 3,
// │     reasons:     { ror: ['3 Day ROR'], combined: ['Combined Subscriptions'], renewal: ['Renewal - Outbound', …] },
// │     sellerTypes: { sales_rep: ['Sales Rep'], office_staff: ['Office Staff'], technician: ['Technician'] },
// │     sources:     { d2d: ['Door to Door'], tech_upsell: ['Upsell - Service Pro'], termite_upsell: ['Upsell - Termite Pro'], unset: ['N/A'] } }
// │ A configured list matches by normalized equality; an unconfigured key
// │ falls back to the default pattern for that bucket.
// └────────────────────────────────────────────────────────────────────────

// RIDD defaults — the patterns the app matched on before the vocabulary
// layer existed. Kept as regexes so legacy spellings keep matching.
const CRM_VOCAB_DEFAULTS = Object.freeze({
  rorWindowDays: 3,
  reasons: {
    ror:      /\bror\b|rescission/i,
    combined: /combined/i,
    renewal:  /renewal/i,
  },
  sellerTypes: {
    sales_rep:    /^sales\s*rep$/i,
    office_staff: /office\s*staff/i,
    technician:   /technician/i,
  },
  sources: {
    d2d:            ['door to door'],
    tech_upsell:    ['upsell - service pro'],
    termite_upsell: ['upsell - termite pro'],
    unset:          ['n/a', ''],
  },
});
const CRM_VOCAB_BUCKETS = Object.freeze({
  reasons:     [['ror', '3-day right of rescission'], ['combined', 'Merged into another subscription on the same account'], ['renewal', 'Closed because the customer renewed onto a new subscription']],
  sellerTypes: [['sales_rep', 'Door-to-door sales rep'], ['office_staff', 'Inside sales / office staff'], ['technician', 'Technician']],
  sources:     [['d2d', 'Door-to-door sale'], ['tech_upsell', 'Technician upsell'], ['termite_upsell', 'Termite upsell by a sales rep'], ['unset', 'Default / blank source that should have been changed']],
});

function _crmNorm(v) { return String(v == null ? '' : v).replace(/\s+/g, ' ').trim().toLowerCase(); }
// Merged vocabulary, memoized on the stored object (predicates run per row).
const _crmVocabMemo = { src: undefined, out: null };
function crmVocab() {
  const rules = (typeof _adminRules === 'function') ? _adminRules() : null;
  const src = rules && rules.crmVocab && typeof rules.crmVocab === 'object' ? rules.crmVocab : null;
  if (_crmVocabMemo.out && _crmVocabMemo.src === src) return _crmVocabMemo.out;
  const listOf = (group, key) => {
    const v = src && src[group] && Array.isArray(src[group][key]) ? src[group][key].map(_crmNorm).filter((x, i, a) => a.indexOf(x) === i) : null;
    return v && v.length ? new Set(v) : null;   // null = not configured → default pattern
  };
  const out = { rorWindowDays: src && Number(src.rorWindowDays) > 0 ? Number(src.rorWindowDays) : CRM_VOCAB_DEFAULTS.rorWindowDays, reasons: {}, sellerTypes: {}, sources: {}, configured: !!src };
  for (const g of ['reasons', 'sellerTypes', 'sources']) for (const k in CRM_VOCAB_DEFAULTS[g]) out[g][k] = listOf(g, k);
  _crmVocabMemo.src = src; _crmVocabMemo.out = out;
  return out;
}
function _crmMatch(group, key, value) {
  const v = crmVocab(); const n = _crmNorm(value);
  const set = v[group][key];
  if (set) return set.has(n);
  const d = CRM_VOCAB_DEFAULTS[group][key];
  return d instanceof RegExp ? d.test(n) : (Array.isArray(d) ? d.includes(n) : false);
}
// ── Predicates the rest of the app uses ──
// Cancel reasons
function crmReasonIs(kind, reason) { return _crmMatch('reasons', kind, reason); }
function crmReasonKind(reason) { for (const k of ['ror', 'combined', 'renewal']) if (crmReasonIs(k, reason)) return k; return null; }
// Seller types (FieldRoutes employee type label on the sold-by employee)
function crmSellerRole(typeLabel) { for (const k of ['sales_rep', 'office_staff', 'technician']) if (_crmMatch('sellerTypes', k, typeLabel)) return k; return null; }
function crmSellerIs(kind, typeLabel) { return _crmMatch('sellerTypes', kind, typeLabel); }
// Lead sources
function crmSourceIs(kind, source) { return _crmMatch('sources', kind, source); }
function crmSourceChannel(source) { for (const k of ['d2d', 'tech_upsell', 'termite_upsell', 'unset']) if (crmSourceIs(k, source)) return k; return null; }
// Right-of-rescission window (days) — state law; RIDD's markets are 3.
function crmRorWindowDays() { return crmVocab().rorWindowDays; }
// Display labels for a seller role (what the app calls each seller type).
const CRM_SELLER_LABELS = Object.freeze({ sales_rep: 'Door to Door', technician: 'Technician', office_staff: 'Office Staff' });
function setCrmVocab(obj) { if (typeof _setAdminRule === 'function') _setAdminRule('crmVocab', obj && typeof obj === 'object' ? obj : null); _crmVocabMemo.src = undefined; }
