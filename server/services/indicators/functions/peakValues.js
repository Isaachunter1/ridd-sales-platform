// Peak value per subscription (per Isaac + CSO, Oct 15 2026; definition set by Isaac Nov 23 2026).
//
// "peak revenue = revenue when contract is sold + any additional revenue that the sales rep added to an account
//  after the fact … then the downgrades and tech upsells and office upsells aren't even relevant" — and "you need
// to also add the service fees to peak revenue too".
//
//   peak = the contract as the rep sold it
//        + every later change the selling rep made themselves (any of their FieldRoutes employee IDs)
//        + the +$4.87/mo service fee (SERVICE_FEE), whoever added it
//   Every other change — office or tech upsells, saves, downgrades — is taken back out.
//
//   value = initial + recurring × 11                      when billed monthly (billingFrequency 30)
//   value = initial + recurring × annualRecurringServices  when billed per service (billingFrequency 0 / -1)
//
// Changes are undone as DELTAS (new − old), not by restoring the old value, so a rep's own later change survives
// an office change made before it. Billing frequency is a setting, not an amount: an office change to it restores
// the old setting. A subscription whose peak equals today is not published; the app falls back to today's value.
// Rows come from peakValues.sql: one row per (subscription, change, field) with the field `k`, its value before `o`
// and after `n`, and who made it `emp`; each row also carries today's values and the seller `rep`.

export const PEAK_KEYS = ['recurringCharge', 'annualRecurringServices', 'billingFrequency', 'initialQuote', 'initialDiscount'];

// The service fee (per Isaac, Nov 23): the office adds a flat +$4.87 to the recurring charge (e.g. $49 → $53.87,
// $99 → $103.87 — 504 times on Reggie Grayek's 2026 accounts). It is revenue that counts to the rep, so a
// recurring-charge change of exactly +$4.87 is always kept.
export const SERVICE_FEE = 4.87;

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };

/** Contract value from its parts, by Isaac's rule. Monthly billing = 11 recurring payments after the initial. */
export function contractValue({ init, rec, ars, bf }) {
  const i = Math.max(0, num(init) || 0), r = Math.max(0, num(rec) || 0);
  const monthly = num(bf) != null && num(bf) > 0;   // 0 / -1 = billed after each service
  const n = monthly ? 11 : Math.max(0, num(ars) || 0);
  return Math.round((i + r * n) * 100) / 100;
}

/**
 * rows → { peaks: { 'cust|svc': peak }, stats }
 * sameRep(soldBy, employeeId) → true when the change was made by the selling rep (default: same employee ID; the
 * job passes the roster so a rep's other branch IDs count too).
 */
export function computePeaks(rows, sameRep = (a, b) => String(a || '') === String(b || '')) {
  const bySid = new Map();
  for (const x of rows || []) { const k = String(x.sid); (bySid.get(k) || bySid.set(k, []).get(k)).push(x); }
  const peaks = {};
  let up = 0, down = 0, same = 0, skipped = 0, repKept = 0, feeKept = 0, undone = 0;
  for (const list of bySid.values()) {
    const h = list[0];
    const cv = num(h.cv);
    if (cv == null || cv <= 0) { skipped++; continue; }
    let rec = num(h.rec) || 0, ars = num(h.ars) || 0, bf = num(h.bf), iq = num(h.iq), idisc = num(h.idisc) || 0;
    // newest → oldest, so a billing-frequency restore lands on the earliest office change last
    const changes = list.filter(c => c.k).sort((a, b) => (a.at_ < b.at_ ? 1 : a.at_ > b.at_ ? -1 : String(b.cid_).localeCompare(String(a.cid_))));
    for (const c of changes) {
      const o = num(c.o), n = num(c.n);
      if (sameRep(h.rep, c.emp)) { repKept++; continue; }
      if (c.k === 'billingFrequency') { if (o != null) { bf = o; undone++; } continue; }
      if (o == null || n == null) continue;
      const d = n - o;
      if (c.k === 'recurringCharge' && Math.abs(d - SERVICE_FEE) < 0.005) { feeKept++; continue; }
      undone++;
      if (c.k === 'recurringCharge') rec -= d;
      else if (c.k === 'annualRecurringServices') ars -= d;
      else if (c.k === 'initialQuote') iq = (iq == null ? null : iq - d);
      else if (c.k === 'initialDiscount') idisc -= d;
    }
    // initial: quote − discount when the quote is known, else today's initialServiceTotal
    const init = (iq != null) ? Math.max(0, iq - (idisc || 0)) : (num(h.init) || 0);
    const peak = contractValue({ init, rec, ars, bf });
    if (Math.abs(peak - cv) <= 0.5) { same++; continue; }
    if (peak > cv) down++; else up++;   // down = account was cut by someone else; up = someone else upsold it
    const key = String(h.cust) + '|' + String(h.svc || '').trim().toLowerCase();
    // one customer can hold two plans with the same name: keep the larger peak, as the old build did
    if (!(key in peaks) || peak > peaks[key]) peaks[key] = peak;
  }
  return { peaks, stats: { subscriptions: bySid.size, reduced: down, upsold: up, unchanged: same, skipped, repChangesKept: repKept, serviceFeesKept: feeKept, changesUndone: undone } };
}

/**
 * The rule the frozen Netlify build used (netlify/functions/revhawk-sync-background.js, Oct 15 → Nov 19 2026),
 * kept so the port can be diffed against its output: the HIGHEST recurring × services value in effect at any
 * point after the initial's completion, rescaling the recurring part of today's contract value; published only
 * when that beats today. Superseded by computePeaks (per Isaac, Nov 19: peak is the value right after the initial,
 * not the high-water mark — upsells are modifications too).
 */
export function legacyPeaks(rows) {
  const bySid = new Map();
  for (const x of rows || []) { const k = String(x.sid); (bySid.get(k) || bySid.set(k, []).get(k)).push(x); }
  const peaks = {};
  const put = (k, v) => { v = Math.round(v * 100) / 100; if (v > (peaks[k] || 0)) peaks[k] = v; };
  for (const list of bySid.values()) {
    const h = list[0];
    const cv = num(h.cv) || 0, init = Math.max(0, num(h.init) || 0);
    let rec = num(h.rec) || 0, ars = num(h.ars) || 0;
    if (cv <= 0 || rec <= 0) continue;
    if (!(ars > 0)) ars = 1;
    const nowAnnual = rec * ars;
    let peakAnnual = nowAnnual;
    const money = list.filter(c => c.k === 'recurringCharge' || c.k === 'annualRecurringServices').sort((a, b) => (a.at_ < b.at_ ? 1 : a.at_ > b.at_ ? -1 : 0));
    for (const c of money) {
      const o = num(c.o);
      if (o == null || o <= 0) continue;
      if (c.k === 'recurringCharge') rec = o; else ars = o;
      peakAnnual = Math.max(peakAnnual, rec * ars);
    }
    if (peakAnnual <= nowAnnual + 0.01) continue;
    const peak = init + Math.max(0, cv - init) * (peakAnnual / nowAnnual);
    if (peak > cv + 0.5) put(String(h.cust) + '|' + String(h.svc || '').trim().toLowerCase(), peak);
  }
  return { peaks, stats: { subscriptions: bySid.size, published: Object.keys(peaks).length } };
}
