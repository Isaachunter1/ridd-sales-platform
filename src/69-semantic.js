// ┌─ src/69-semantic.js ───────────────────────────────────────────────────
// │ SEMANTIC LAYER (per Isaac, Oct 6 2026) — the one place that says what a
// │ number MEANS. Three parts, the same shape as a dbt semantic layer:
// │
// │   RULES     what counts (read live from Settings; never copied here)
// │   ENTITIES  the things we count, built once: the retention book (one row
// │             per recurring, serviced subscription with its COUNTED cancel)
// │             and the customer life (every subscription a customer has had,
// │             linked by customer_id)
// │   METRICS   each number defined once — id, plain-English meaning, formula,
// │             the entity it reads, the rules it depends on, and a compute
// │             function. A screen asks for a metric by name (semMetric(id))
// │             instead of working it out again.
// │
// │ Reporting → Definitions renders this registry, so anyone can see how a
// │ number is built and which screens show it. Add a metric HERE first, then
// │ use it; do not add new rate math inside a view.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────

const SEM_MO_MS = 2629800000;            // one average month (365.25 d ÷ 12)
const _semIso = (x) => String(x || '').slice(0, 10);
const _semMs = (x) => { const i = _semIso(x); if (!i) return null; const t = new Date(i + 'T00:00').getTime(); return isNaN(t) ? null : t; };   // local midnight, like the rest of the app
const _semArr = (r) => Number(r && r.annual_recurring_value) || 0;
const semPct = (n, d) => d > 0 ? n / d : null;

// ── RULES ───────────────────────────────────────────────────────────────
// Read live so the Definitions page shows what is in force right now.
const SEM_RULES = {
  recurring_services:   { label: 'Recurring service types', where: 'Settings → Reporting rules → Service types', now: () => { const m = reportingServiceRecurringMap(); let n = 0; m.forEach(v => { if (v) n++; }); return n + ' service types count as recurring'; } },
  excluded_sources:     { label: 'Excluded lead sources', where: 'Settings → Marketing & lead sources', now: () => { const s = reportingExcludedSources(); return s.size ? [...s].join(', ') : 'none'; } },
  excluded_reasons:     { label: 'Cancel reasons that are not churn', where: 'Settings → Reporting rules → Cancel reasons', now: () => { const s = reportingExcludedCancelReasons(); return s.size ? [...s].join(', ') : 'none'; } },
  ror:                  { label: '3-day right of rescission', where: 'Settings → Reporting rules', now: () => reportingExcludeRorChurn() ? 'not counted as churn (within ' + crmRorWindowDays() + ' days of the sale)' : 'counted as churn' },
  population:           { label: 'Who is in the retention book', where: 'Settings → Reporting rules (and the Attrition Steps toggles)', now: () => [retenExclRenewalSubs() ? 'renewal subscriptions out' : 'renewal subscriptions in', retenExclZeroPay() ? '$0-paying out' : '$0-paying in', retenExclOneSvc() ? 'under 2 services out' : 'under 2 services in', retenExclFrozenOneSvc() ? 'frozen with 1 service out' : 'frozen with 1 service in'].join(' · ') },
  renewal_sources:      { label: 'Which sources are renewals', where: 'Settings → Marketing & lead sources (revenue class = Renewal)', now: () => 'a subscription whose source is classed Renewal' },
};

// ── ENTITY: the retention book ──────────────────────────────────────────
// One row per recurring, serviced subscription that survives the population
// rules, carrying `_effCancel` = the cancel date IF the cancel counts as
// churn (excluded reasons and 3-day RORs do not). `initial_service` is the
// origin first service, so a transferred account keeps its true start.
// Memoized per population array + rules.
const _semBookCache = new WeakMap();
function semRetentionBook(pop) {
  const key = (retenExclRenewalSubs() ? 'R' : '') + (retenExclZeroPay() ? 'Z' : '') + (retenExclFrozenOneSvc() ? 'F' : '') + (retenExclOneSvc() ? 'O' : '') + (reportingExcludeRorChurn() ? 'r' : '') + '|' + [...retenPopExclReasons()].join(',') + '|' + retenOneSvcExemptTerms().join(',') + '|' + reportingExcludedCancelReasons().size + '|' + JSON.stringify(state._retenWhatIf || null);
  const hit = _semBookCache.get(pop);
  if (hit && hit._rulesKey === key) return hit;
  const recurringByName = reportingServiceRecurringMap();
  const excludedReasons = reportingExcludedCancelReasons();
  const out = pop
    .filter(r => !!recurringByName.get(r.subscription))
    .filter(r => !!r.initial_service && r.initial_service >= '2000-01-01')   // garbage dates can't blow up the year walks
    .filter(r => !retenPopulationExcluded(r))
    .map(r => {
      const realCancel = r.subscription_date_canceled
        && !excludedReasons.has(_normCancelReason(reportingCancelReasonOf(r)))
        && !(reportingExcludeRorChurn() && _reporting3dayRor(r))
        ? r.subscription_date_canceled : null;
      return { ...r, initial_service: r.origin_initial_service || r.initial_service, _effCancel: realCancel };
    });
  out._rulesKey = key;
  _semBookCache.set(pop, out);
  return out;
}

// ── ENTITY: the customer life ───────────────────────────────────────────
// Every subscription a customer has had, linked by customer_id into one life.
//   start        first service (else first sale) across their subscriptions
//   alive        any subscription still Active
//   end          the day their LAST subscription ended (null while alive)
//   firstRenewal { at, row } — the first renewal-source subscription they bought
//   firstContract{ at, end, row } — their first non-renewal contract of 12+ months
// opts.include(row) narrows which subscriptions take part (e.g. serviced only).
function semCustomerLives(rows, opts) {
  const include = (opts && opts.include) || (() => true);
  const lives = new Map();
  for (const r of rows || []) {
    if (!r || !r.customer_id || !include(r)) continue;
    const k = String(r.customer_id);
    let c = lives.get(k);
    if (!c) { c = { id: k, subs: [], start: null, alive: false, end: null, firstRenewal: null, firstContract: null, arr: 0 }; lives.set(k, c); }
    c.subs.push(r);
    const st = _semMs(r.initial_service) != null ? _semMs(r.initial_service) : _semMs(r.sold_date);
    if (st != null && (c.start == null || st < c.start)) c.start = st;
    if (/active/i.test(String(r.subscription_status || ''))) { c.alive = true; c.arr += _semArr(r); }
    else { const cd = _semMs(r.subscription_date_canceled); if (cd != null && (c.end == null || cd > c.end)) c.end = cd; }
    const sd = _semMs(r.sold_date);
    if (sd == null) continue;
    if (reportingSourceClass(r.subscription_source) === 'renewal') { if (!c.firstRenewal || sd < c.firstRenewal.at) c.firstRenewal = { at: sd, row: r }; }
    else if ((Number(r.agreement_length) || 0) >= 12 && (!c.firstContract || sd < c.firstContract.at)) {
      const e = new Date(sd); e.setMonth(e.getMonth() + (Number(r.agreement_length) || 0));
      c.firstContract = { at: sd, end: e.getTime(), row: r };
    }
  }
  for (const c of lives.values()) if (c.alive) c.end = null;
  return lives;
}
// When a customer's life stops being measured: today while they are still a customer.
function semCustomerEnd(c, nowMs) { return c.alive ? nowMs : (c.end != null ? c.end : nowMs); }
// Reached the end of their first contract still a customer (the point a renewal decision exists).
function semReachedContractEnd(c, nowMs) { const f = c.firstContract; if (!f || f.end > nowMs) return false; return c.alive || c.end == null || c.end > f.end; }

// ── Row-level facts every metric shares ─────────────────────────────────
// Months a book row lived: first service → counted cancel (null while active).
function semLifeMonths(r) { const a = _semMs(r.initial_service), c = r._effCancel ? _semMs(r._effCancel) : null; return (a == null || c == null) ? null : Math.max(0, (c - a) / SEM_MO_MS); }
// Months since first service.
function semAgeMonths(r, nowMs) { const a = _semMs(r.initial_service); return a == null ? null : ((nowMs == null ? Date.now() : nowMs) - a) / SEM_MO_MS; }
function semIsDelinquent(r) { return /delinquent/i.test(String(reportingCancelReasonOf(r) || '')); }

// ── DIMENSIONS ──────────────────────────────────────────────────────────
// The ways a set of subscriptions can be split. One definition per split, so
// "by rep" means the same thing on every screen. order = a fixed row order
// (otherwise biggest first); minRows folds tiny groups into one "Other" row.
const SEM_DIMENSIONS = {
  contract: { label: 'Contract Length', meaning: 'The agreement length on the subscription, in months.', order: ['12 mo', '18 mo', '24 mo', '24+ mo', 'Under 12 mo', 'No term'],
    of: (r) => { const m = Number(r.agreement_length) || 0; return m === 12 ? '12 mo' : m === 18 ? '18 mo' : m === 24 ? '24 mo' : m > 24 ? '24+ mo' : m > 0 ? 'Under 12 mo' : 'No term'; } },
  service:  { label: 'Service Type', meaning: 'The FieldRoutes service type on the subscription.', of: (r) => String(r.subscription || '').trim() || 'Unspecified' },
  source:   { label: 'Source', meaning: 'Where the account came from: the lead source on the subscription.', of: (r) => String(r.subscription_source || '').trim() || 'Unspecified' },
  type:     { label: 'Rep Type', meaning: 'Who sold it: Door to Door, Office Staff or Technician, from the seller\u2019s FieldRoutes type.', order: ['Door to Door', 'Office Staff', 'Technician'],
    of: (r) => { const t = String(r.sold_by_type || '').trim(); const role = crmSellerRole(t); if (role) return CRM_SELLER_LABELS[role]; return t ? (t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()) : 'Unknown'; } },
  // A rep who has left FieldRoutes has an id on the subscription but no name in the export \u2192 "Former rep #id".
  rep:      { label: 'Rep', meaning: 'The rep who sold it. A rep no longer active in FieldRoutes shows as \u201cFormer rep #id\u201d; reps with under 20 subscriptions roll into one Other row.', minRows: 20, otherLabel: 'Other reps (under 20 subs)',
    of: (r) => { const raw = String(r.sold_by || '').trim(); const nm = (typeof flipLastFirst === 'function') ? flipLastFirst(raw) : raw; if (nm) return nm; const id = String(r.sold_by_id || '').trim(); return id && id !== '0' ? 'Former rep #' + id : 'Unknown'; } },
};
// rows → [{ label, rows }] in display order for one dimension.
function semGroupBy(rows, dimId) {
  const D = SEM_DIMENSIONS[dimId]; if (!D) return [];
  const m = new Map();
  for (const r of rows) { const k = D.of(r); let g = m.get(k); if (!g) { g = []; m.set(k, g); } g.push(r); }
  let other = null;
  if (D.minRows) for (const [k, g] of [...m]) if (g.length < D.minRows) { (other = other || []).push(...g); m.delete(k); }
  let out = [...m].map(([label, rows]) => ({ label, rows }));
  if (D.order) out.sort((a, b) => { const ia = D.order.indexOf(a.label), ib = D.order.indexOf(b.label); return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.label.localeCompare(b.label); });
  else out.sort((a, b) => b.rows.length - a.rows.length || a.label.localeCompare(b.label));
  if (other) out.push({ label: D.otherLabel || 'Other', rows: other });
  return out;
}

// ── METRICS ─────────────────────────────────────────────────────────────
// compute(...) takes entity rows and returns { value, n, d, ... } — value is
// a FRACTION (0–1) for rates, months for durations. n / d are the counts the
// rate was built from, so every screen can show "x of y".
const SEM_METRICS = {};
function _semDefine(id, def) { SEM_METRICS[id] = Object.assign({ id, used: [] }, def); }
function semMetric(id) { const m = SEM_METRICS[id]; if (!m) throw new Error('semantic layer: unknown metric ' + id); return m.compute; }

_semDefine('attrition_rate', {
  label: 'Attrition %', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'Of the subscriptions in a group, the share that have cancelled for a reason that counts as churn.',
  formula: 'counted cancels ÷ subscriptions in the group',
  used: ['Retention → Cohort Waterfall (rows by Contract Length, Service Type, Source, Rep Type or Rep: the % under each row\u2019s size)'],
  compute: (rows) => { let c = 0; for (const r of rows) if (r._effCancel) c++; return { value: semPct(c, rows.length), n: c, d: rows.length, active: rows.length - c }; },
});
_semDefine('retention_rate', {
  label: 'Retention %', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'The share of a group still active. Always 100% minus Attrition %.',
  formula: 'active subscriptions ÷ subscriptions in the group',
  used: ['Retention → Cohort Waterfall (row drill)'],
  compute: (rows) => { const a = SEM_METRICS.attrition_rate.compute(rows); return { value: semPct(a.active, a.d), n: a.active, d: a.d }; },
});
_semDefine('arr_attrition_rate', {
  label: 'ARR Attrition %', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'Attrition weighted by dollars: the share of a group’s annual recurring revenue that sat on subscriptions which cancelled.',
  formula: 'ARR on counted cancels ÷ ARR on every subscription in the group',
  used: ['Retention → Cohort Waterfall (rows by a dimension, ARR view)'],
  compute: (rows) => { let c = 0, t = 0; for (const r of rows) { const v = _semArr(r); t += v; if (r._effCancel) c += v; } return { value: semPct(c, t), n: c, d: t }; },
});
_semDefine('annual_attrition', {
  label: 'Annual attrition', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'Of the subscriptions that were active on January 1, the share that cancelled during that year. Sales made during the year never enter, so growth cannot hide churn. The current year is year to date.',
  formula: 'counted cancels dated in the year ÷ the book on January 1 (first serviced before Jan 1, not yet cancelled)',
  used: ['Retention → Attrition Steps (headline tiles)', 'Retention → Cohort Waterfall (Blended attrition row, and every year cell when rows are a dimension)'],
  compute: (book, year) => {
    const st = year + '-01-01', en = year + '-12-31';
    const boy = book.filter(r => r.initial_service < st && (!r._effCancel || r._effCancel >= st));
    const counted = boy.filter(r => r._effCancel && r._effCancel >= st && r._effCancel <= en);
    return { value: semPct(counted.length, boy.length), n: counted.length, d: boy.length, st, en, rows: { boy, counted } };
  },
});
_semDefine('trailing12_attrition', {
  label: 'Trailing 12-month attrition', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'The same read as annual attrition, but over the last 365 days, so it is comparable on any day of the year.',
  formula: 'counted cancels in the last 365 days ÷ the book exactly one year ago',
  used: ['Retention → Attrition Steps (Trailing 12 months tile)'],
  compute: (book, today) => {
    const t = today || new Date(); const s = new Date(t); s.setFullYear(s.getFullYear() - 1);
    const st = s.toISOString().slice(0, 10), en = t.toISOString().slice(0, 10);
    const boy = book.filter(r => r.initial_service < st && (!r._effCancel || r._effCancel >= st));
    const counted = boy.filter(r => r._effCancel && r._effCancel >= st && r._effCancel <= en);
    return { value: semPct(counted.length, boy.length), n: counted.length, d: boy.length, st, en, rows: { boy, counted } };
  },
});
_semDefine('survival_at', {
  label: 'Still here at N months', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'Of the subscriptions old enough to be judged (first serviced at least N months ago), the share that lasted at least N months.',
  formula: '(still active, or cancelled at N months or later) ÷ subscriptions first serviced at least N months ago',
  used: ['Retention → Cohort Waterfall → rows by Contract Length → row drill (Here at 12 mo)'],
  compute: (rows, months, nowMs) => { let d = 0, n = 0; for (const r of rows) { const age = semAgeMonths(r, nowMs); if (age == null || age < months) continue; d++; const life = semLifeMonths(r); if (life == null || life >= months) n++; } return { value: semPct(n, d), n, d }; },
});
_semDefine('finished_term_rate', {
  label: 'Finished the term', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'Of the subscriptions whose contract term has ended (plus one month of grace), the share that lasted the whole term.',
  formula: '(still active, or cancelled at the term length or later) ÷ subscriptions first serviced at least term + 1 months ago',
  used: ['Retention → Cohort Waterfall → rows by Contract Length → row drill (Finished term)'],
  compute: (rows, term, nowMs) => { let d = 0, n = 0; for (const r of rows) { const age = semAgeMonths(r, nowMs); if (age == null || age < term + 1) continue; d++; const life = semLifeMonths(r); if (life == null || life >= term) n++; } return { value: semPct(n, d), n, d }; },
});
_semDefine('median_cancel_life', {
  label: 'Median life of cancels', entity: 'Retention book', unit: 'months', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'How long the subscriptions that cancelled had lasted, at the midpoint: half left sooner, half later.',
  formula: 'median of (counted cancel date − first service), in months',
  used: ['Retention → Cohort Waterfall → rows by Contract Length → row drill'],
  compute: (rows) => { const L = []; for (const r of rows) { const v = semLifeMonths(r); if (v != null) L.push(v); } L.sort((a, b) => a - b); return { value: L.length ? L[Math.floor(L.length / 2)] : null, n: L.length, d: L.length }; },
});
_semDefine('delinquent_share', {
  label: 'Delinquent % of cancels', entity: 'Retention book', unit: 'rate', rules: ['recurring_services', 'population', 'excluded_reasons', 'ror'],
  meaning: 'Of the counted cancels in a group, the share whose cancel reason is Delinquent.',
  formula: 'counted cancels with a Delinquent reason ÷ counted cancels',
  used: ['Retention → Cohort Waterfall → rows by Contract Length → row drill'],
  compute: (rows) => { let d = 0, n = 0; for (const r of rows) { if (!r._effCancel || _semMs(r._effCancel) == null || _semMs(r.initial_service) == null) continue; d++; if (semIsDelinquent(r)) n++; } return { value: semPct(n, d), n, d }; },
});
_semDefine('customer_retention', {
  label: 'Still a customer %', entity: 'Customer life', unit: 'rate', rules: ['renewal_sources'],
  meaning: 'Of a group of customers, the share who still have at least one active subscription today.',
  formula: 'customers with any active subscription ÷ customers in the group',
  used: ['Retention → Renewal Retention (Retention %)'],
  compute: (lives) => { let n = 0; for (const c of lives) if (c.alive) n++; return { value: semPct(n, lives.length), n, d: lives.length }; },
});
_semDefine('customer_survival_after', {
  label: 'Still a customer N months after a decision point', entity: 'Customer life', unit: 'rate', rules: ['renewal_sources'],
  meaning: 'Measured from a decision point (the day a renewal was sold, or the day the first contract ended). Of the customers whose decision point is at least N months old, the share who were still customers N months after it.',
  formula: '(still a customer, or left N months or more after the decision point) ÷ customers whose decision point is at least N months old',
  used: ['Retention → Renewal Retention (Retained +12 mo, Retained +24 mo)'],
  compute: (lives, anchorOf, months, nowMs) => { let d = 0, n = 0; for (const c of lives) { const a = anchorOf(c); if (a == null || (nowMs - a) / SEM_MO_MS < months) continue; d++; if (c.alive || (semCustomerEnd(c, nowMs) - a) / SEM_MO_MS >= months) n++; } return { value: semPct(n, d), n, d }; },
});
_semDefine('customer_tenure', {
  label: 'Customer tenure', entity: 'Customer life', unit: 'months', rules: ['renewal_sources'],
  meaning: 'How long a customer has been with RIDD across every plan they have had: first service to today, or to the day their last subscription ended.',
  formula: 'average of (end of life − first service), in months',
  used: ['Retention → Renewal Retention (Total tenure, Tenure at renewal, Stayed after)'],
  // from / to pick the two ends: default = whole life. Returns the average.
  compute: (lives, nowMs, from, to) => { let s = 0, n = 0; for (const c of lives) { const a = from ? from(c) : c.start, b = to ? to(c) : semCustomerEnd(c, nowMs); if (a == null || b == null) continue; s += Math.max(0, (b - a) / SEM_MO_MS); n++; } return { value: n ? s / n : null, n, d: n }; },
});

// ── ENTITIES (documentation for the Definitions page) ───────────────────
const SEM_ENTITIES = [
  { id: 'subscription', label: 'Subscription', key: 'FieldRoutes subscriptionID', meaning: 'One plan on one customer, as FieldRoutes holds it. The raw unit everything else is built from.', built: 'Synced from FieldRoutes; nothing removed.' },
  { id: 'retention_book', label: 'Retention book', key: 'subscriptionID', meaning: 'The subscriptions that can retain or churn: recurring service types that received a first service and pass the population rules. Each row carries its counted cancel date, which is empty when the cancel does not count as churn.', built: 'semRetentionBook() — Attrition Steps scope, then the population rules, then the cancel rules.' },
  { id: 'customer_life', label: 'Customer life', key: 'FieldRoutes customerID', meaning: 'Every subscription a customer has had, linked into one life: first service to the day their last subscription ended. A renewal is a new subscription on the same life, not a new customer.', built: 'semCustomerLives() — groups subscriptions by customer.' },
];

// ── ENTITY: the lead, and whether it converted ──────────────────────────
// A lead is one GoHighLevel contact record credited to a provider (last paid
// touch, else its own source — src/86-ghl-leads.js). It CONVERTED when the
// same person (phone or email) bought a new, non-renewal subscription in
// FieldRoutes from 1 day before to `windowDays` after the lead came in.
// One sale converts ONE lead: when a person has several lead records, the
// latest one on or before the sale gets the credit.
const SEM_LEAD_WINDOW_DAYS = 90;
function semLeadConversions(leads, crm, windowDays) {
  const W = (windowDays == null ? SEM_LEAD_WINDOW_DAYS : windowDays) * 86400000, DAY = 86400000;
  const out = leads.map(l => ({ lead: l, ms: _semMs(l.d), converted: false, sale: null }));
  if (!crm) return out;
  const byCust = new Map();
  for (const x of out) {
    if (x.ms == null) continue;
    const id = (x.lead.p && crm.byPhone.get(x.lead.p)) || (x.lead.e && crm.byEmail.get(x.lead.e)) || null;
    if (!id) continue;
    x.customer = id;
    if (!byCust.has(id)) byCust.set(id, []);
    byCust.get(id).push(x);
  }
  for (const [id, L] of byCust) {
    const c = crm.cust.get(id); if (!c) continue;
    L.sort((a, b) => a.ms - b.ms);
    for (const r of c.subs) {
      if (reportingSourceClass(reportingSourceOf(r)) === 'renewal') continue;
      const sd = _semMs(r.sold_date); if (sd == null) continue;
      let best = null;
      for (const x of L) { if (x.converted) continue; if (x.ms <= sd + DAY && sd - x.ms <= W) best = x; }
      if (best) { best.converted = true; best.sale = r; }
    }
  }
  return out;
}
SEM_RULES.lead_window = { label: 'Lead conversion window', where: 'src/69-semantic.js (SEM_LEAD_WINDOW_DAYS)', now: () => 'a sale counts for a lead when it is sold within ' + SEM_LEAD_WINDOW_DAYS + ' days of the lead' };
SEM_RULES.lead_sources = { label: 'Which GoHighLevel labels are leads, and whose', where: 'Settings → Configurations → GoHighLevel sources', now: () => 'current customers, door-to-door and CRM workflow records are not leads; each remaining label maps to a provider' };
SEM_RULES.marketing_spend = { label: 'Marketing spend', where: 'QuickBooks (Advertising & Marketing accounts), pulled automatically', now: () => 'booked spend by branch account and month' };
SEM_RULES.spend_by_provider = { label: 'Which provider a QuickBooks charge belongs to', where: 'automatic, by QuickBooks name', now: () => 'each QuickBooks name maps to a provider (automatic by name, or an admin\u2019s pick); journal entries are left out' };
SEM_ENTITIES.push({ id: 'lead', label: 'Lead', key: 'GoHighLevel contact record', meaning: 'One inbound contact, credited to the provider that earned it. It is converted when the same person (matched on phone or email) buys a new subscription within the conversion window. One sale converts one lead.', built: 'ghlLeads() for the credit, semLeadConversions() for the match to FieldRoutes.' });
_semDefine('lead_conversion_rate', {
  label: 'Lead conversion rate', entity: 'Lead', unit: 'rate', rules: ['lead_sources', 'lead_window', 'renewal_sources'],
  meaning: 'Of the leads that came in, the share that became a sale. Leads from the last few weeks read low because they have not had time to close yet.',
  formula: 'converted leads ÷ leads',
  used: ['Marketing → Metrics (tile, weekly chart, by provider)'],
  compute: (L) => { let n = 0; for (const x of L) if (x.converted) n++; return { value: semPct(n, L.length), n, d: L.length }; },
});
_semDefine('cost_per_lead', {
  label: 'Cost per lead', entity: 'Lead', unit: 'usd', rules: ['marketing_spend', 'lead_sources'],
  meaning: 'What one paid lead cost. Organic and referral leads are left out of the count because nothing was spent to get them.',
  formula: 'marketing spend ÷ leads credited to a paid provider',
  used: ['Marketing → Metrics'],
  compute: (spend, L) => { const d = L.filter(x => x.paid).length; return { value: d > 0 ? spend / d : null, n: spend, d }; },
});
_semDefine('cost_per_sale', {
  label: 'Cost per sale', entity: 'Lead', unit: 'usd', rules: ['marketing_spend', 'lead_sources', 'lead_window'],
  meaning: 'What it cost in marketing to get one sale from a paid lead.',
  formula: 'marketing spend ÷ converted leads credited to a paid provider',
  used: ['Marketing → Metrics'],
  compute: (spend, L) => { const d = L.filter(x => x.paid && x.converted).length; return { value: d > 0 ? spend / d : null, n: spend, d }; },
});
_semDefine('wasted_spend', {
  label: 'Wasted spend', entity: 'Lead', unit: 'usd', rules: ['marketing_spend', 'lead_sources', 'lead_window'],
  meaning: 'The share of marketing spend that bought leads which did not turn into a sale.',
  formula: 'cost per lead × paid leads that did not convert',
  used: ['Marketing → Metrics'],
  compute: (spend, L) => { const P = L.filter(x => x.paid); const miss = P.filter(x => !x.converted).length; return { value: P.length ? spend * miss / P.length : null, n: miss, d: P.length }; },
});

// Known places where two screens still answer the same question differently.
// Listed on the Definitions page until each is moved onto one metric.
const SEM_OPEN_DIFFERENCES = [
  { what: 'How long a cancelled account lasted', a: 'Semantic layer (median life of cancels): first service \u2192 cancel', b: 'The Lifetime card and the tiles inside a waterfall row drill: sold date \u2192 cancel', effect: 'The sold-date version runs longer by the gap between sale and first service.' },
  { what: 'Is this account still here?', a: 'Retention book: no counted cancel (an excluded-reason cancel still counts as here)', b: 'Renewal Retention (customer life): FieldRoutes status is Active', effect: 'An account cancelled for an excluded reason is active in one read and gone in the other.' },
  { what: 'Monthly churn', a: 'Seasonality: cancels \u00f7 the book at the start of that month', b: 'LTV card: its own monthly churn over a trailing 24 months', effect: 'Two monthly rates built separately that should be one.' },
];

// ── Reporting → Definitions ─────────────────────────────────────────────
function viewSemanticDefinitions() {
  const q = String(state._semSearch || '').trim().toLowerCase();
  const hit = (...xs) => !q || xs.some(x => String(x || '').toLowerCase().includes(q));
  const chip = (t) => el('span', { class: 'inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold', style: { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)', marginRight: '4px', marginBottom: '4px' } }, t);
  const lab = (t) => el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)', marginTop: '8px' } }, t);
  const section = (title, sub, ...kids) => el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'font-display text-lg' }, title), sub ? el('div', { class: 'text-xs mt-0.5', style: { color: 'var(--text-muted)' } }, sub) : null),
    el('div', { class: 'p-4 flex flex-col gap-3' }, ...kids));
  const safe = (f) => { try { return f(); } catch (e) { return 'unavailable'; } };
  const metrics = Object.values(SEM_METRICS).filter(m => hit(m.label, m.meaning, m.formula, m.entity, (m.used || []).join(' ')));
  const byEntity = new Map(); metrics.forEach(m => { if (!byEntity.has(m.entity)) byEntity.set(m.entity, []); byEntity.get(m.entity).push(m); });
  const metricCard = (m) => el('div', { class: 'rounded-xl p-3', style: { border: '1px solid var(--border)', background: 'var(--card)' } },
    el('div', { class: 'flex items-baseline justify-between gap-2 flex-wrap' }, el('div', { class: 'text-sm font-bold' }, m.label), el('code', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, m.id)),
    el('div', { class: 'text-xs mt-1' }, m.meaning),
    lab('Formula'), el('div', { class: 'text-xs', style: { fontFamily: 'ui-monospace, monospace' } }, m.formula),
    lab('Rules it follows'), el('div', { style: { marginTop: '4px' } }, ...(m.rules || []).map(k => chip((SEM_RULES[k] || {}).label || k))),
    lab('Shown on'), el('div', { class: 'text-xs' }, (m.used || []).join(' · ') || 'Not on a screen yet'));
  return el('div', { class: 'flex flex-col gap-4 w-full' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
      el('div', {}, el('h1', { class: 'text-2xl font-bold' }, 'Definitions'),
        el('div', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, 'How every number is built: the rules in force, the things we count, and each metric’s formula. A screen listed under a metric reads that exact definition.')),
      el('input', { class: 'rounded-lg border px-3 py-1.5 text-xs', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', minWidth: '220px' }, placeholder: 'Search definitions…', value: state._semSearch || '',
        oninput: (e) => { state._semSearch = e.target.value; clearTimeout(viewSemanticDefinitions._t); viewSemanticDefinitions._t = setTimeout(() => { mountApp(); const i = document.querySelector('input[placeholder^="Search definitions"]'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); } })),
    section('Rules', 'What counts. These are set in Settings and read live, so this is what is in force right now.',
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, ...['Rule', 'In force now', 'Change it in'].map(t => el('th', { class: 'px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t)))),
        el('tbody', {}, ...Object.entries(SEM_RULES).filter(([, r]) => hit(r.label, r.where)).map(([, r]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, r.label), el('td', { class: 'px-3 py-2' }, safe(r.now)), el('td', { class: 'px-3 py-2', style: { color: 'var(--text-muted)' } }, r.where))))))),
    section('Dimensions', 'The ways a number can be split. The same split means the same thing everywhere.',
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('tbody', {}, ...Object.values(SEM_DIMENSIONS).filter(d => hit(d.label, d.meaning)).map(d => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, d.label), el('td', { class: 'px-3 py-2' }, d.meaning))))))),
    section('Entities', 'The things we count. Each is built once and every metric reads the same one.',
      ...SEM_ENTITIES.filter(e => hit(e.label, e.meaning)).map(e => el('div', { class: 'rounded-xl p-3', style: { border: '1px solid var(--border)' } },
        el('div', { class: 'flex items-baseline justify-between gap-2 flex-wrap' }, el('div', { class: 'text-sm font-bold' }, e.label), el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'one row per ' + e.key)),
        el('div', { class: 'text-xs mt-1' }, e.meaning), lab('Built by'), el('div', { class: 'text-xs' }, e.built)))),
    ...[...byEntity.entries()].map(([ent, ms]) => section('Metrics · ' + ent, ms.length + ' defined', el('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))' } }, ...ms.map(metricCard)))),
    q ? null : section('Still answered two ways', 'Places where two screens work out the same thing differently. Each one needs a decision on which version is right before it moves onto a single metric.',
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, ...['Question', 'Version A', 'Version B', 'Why it matters'].map(t => el('th', { class: 'px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t)))),
        el('tbody', {}, ...SEM_OPEN_DIFFERENCES.map(d => el('tr', { class: 'border-t align-top', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-2 font-semibold' }, d.what), el('td', { class: 'px-3 py-2' }, d.a), el('td', { class: 'px-3 py-2' }, d.b), el('td', { class: 'px-3 py-2', style: { color: 'var(--text-muted)' } }, d.effect))))))));
}
