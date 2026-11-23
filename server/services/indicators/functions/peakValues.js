// Peak value per subscription (per Isaac + CSO, Oct 15 2026; rule changed by Isaac Nov 23 2026).
//
// Nov 23: "contract values just PRIOR to appointments being completed" — "sum revenue AFTER the contract is signed
// from the sales reps". Peak is the contract the rep signed, as it stood the moment before the initial service was
// completed. Anything a technician or the office changes at or after the initial — an upsell on the initial visit,
// a rate lowered to save a cancel — is a modification and is undone. (Nov 19 rule, superseded: value at the END of
// the completion day, so same-day tech upsells counted.)
//
//   peak = initial + recurring × 11                      when billed monthly (billingFrequency 30)
//   peak = initial + recurring × annualRecurringServices  when billed per service (billingFrequency 0 / -1)
//
// with initial / recurring / services / billing as they stood just BEFORE the initial was completed (done_at, to the
// second). Changes before that (the rep's own edits after signing) stay; any change at or after it is undone. A
// subscription with no such change — or whose initial isn't completed yet — is worth what it is today, so it is not
// published and the app falls back to the current contract value.
//
// Rows come from peakValues.sql: one row per (subscription, change), newest change first, each row carrying
// today's values and the change's field `k` and its value BEFORE the change `o`.

export const PEAK_KEYS = ['recurringCharge', 'annualRecurringServices', 'billingFrequency', 'initialQuote', 'initialDiscount'];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const day = (s) => String(s || '').slice(0, 10);

/** Contract value from its parts, by Isaac's rule. Monthly billing = 11 recurring payments after the initial. */
export function contractValue({ init, rec, ars, bf }) {
  const i = Math.max(0, num(init) || 0), r = Math.max(0, num(rec) || 0);
  const monthly = num(bf) != null && num(bf) > 0;   // 0 / -1 = billed after each service
  const n = monthly ? 11 : Math.max(0, num(ars) || 0);
  return Math.round((i + r * n) * 100) / 100;
}

/**
 * rows → { peaks: { 'cust|svc': peak }, stats }
 * Only subscriptions whose peak differs from today's contract value are kept (either direction).
 */
export function computePeaks(rows) {
  const bySid = new Map();
  for (const x of rows || []) { const k = String(x.sid); (bySid.get(k) || bySid.set(k, []).get(k)).push(x); }
  const peaks = {};
  let up = 0, down = 0, same = 0, skipped = 0;
  for (const list of bySid.values()) {
    const h = list[0];
    const cv = num(h.cv);
    if (cv == null || cv <= 0) { skipped++; continue; }
    const doneAt = String(h.done_at || '');
    // today's parts
    let rec = num(h.rec) || 0, ars = num(h.ars) || 0, bf = num(h.bf), iq = num(h.iq), idisc = num(h.idisc);
    // Walk newest → oldest; undo every change made at or after the moment the initial was completed.
    const later = list.filter(c => doneAt && String(c.at_ || '') >= doneAt).sort((a, b) => (a.at_ < b.at_ ? 1 : a.at_ > b.at_ ? -1 : 0));
    for (const c of later) {
      const o = num(c.o);
      if (o == null) continue;
      if (c.k === 'recurringCharge') rec = o;
      else if (c.k === 'annualRecurringServices') ars = o;
      else if (c.k === 'billingFrequency') bf = o;
      else if (c.k === 'initialQuote') iq = o;
      else if (c.k === 'initialDiscount') idisc = o;
    }
    // initial before completion: quote − discount when both are known, else today's initialServiceTotal
    const init = (iq != null) ? Math.max(0, iq - (idisc || 0)) : (num(h.init) || 0);
    const peak = contractValue({ init, rec, ars, bf });
    if (Math.abs(peak - cv) <= 0.5) { same++; continue; }
    if (peak > cv) down++; else up++;   // down = account was reduced since the initial; up = upsold
    const key = String(h.cust) + '|' + String(h.svc || '').trim().toLowerCase();
    // one customer can hold two plans with the same name: keep the larger peak, as the old build did
    if (!(key in peaks) || peak > peaks[key]) peaks[key] = peak;
  }
  return { peaks, stats: { subscriptions: bySid.size, reduced: down, upsold: up, unchanged: same, skipped } };
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
