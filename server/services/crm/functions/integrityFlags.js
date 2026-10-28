// Account Integrity — rows in, flags out (per Isaac, Oct 20 + Oct 27).
// Pure: no I/O. The job fetches the rows (fetchCustomerEdits.sql,
// fetchCustomerContacts.sql, fetchEmployeeContacts.sql) and writes what this
// returns to public.account_integrity_flags. Fixture test:
// server/test/integrity-flags.test.js.
//
// What gets flagged, and why each rule is shaped the way it is:
//   phone_one_digit   a phone edited so exactly ONE digit differs — the change
//                     that makes a customer unreachable without looking like a
//                     new number. Red when the rep who sold the account made it.
//   email_small_edit  an email edited by 1–2 characters before the @, same
//                     mail provider (gmail, yahoo …) on both sides — always
//                     amber. Typo fixes ("gmial" → "gmail") change the domain
//                     and are left out; even so this runs ~1,000 per 90 days
//                     (Oct 27), so it is an FYI, and the per-rep tally in the
//                     run summary is where a pattern shows.
//   autopay_off       autopay turned off (card/ACH → off) by a PERSON within
//                     60 days of the sale. FieldRoutes' own automatic shut-offs
//                     (employee 0 — declined payments, 3,562 in 90 days on
//                     Oct 27) are not flagged. Card SWAPS are never flagged
//                     (per Isaac, Oct 27 — normal). Red when the seller did it
//                     or within 14 days of the sale.
//   rep_own_contact   the selling rep's own phone or email on a customer they
//                     sold (Oct 20: one rep's email on 22 of their accounts).
//   shared_contact    one phone / email / street address on accounts that
//                     FieldRoutes does not link. Same last name → probably one
//                     customer with several properties: "link them in
//                     FieldRoutes" (amber). Different last names and the same
//                     seller → red.
//   shared_card       the same card (last four + expiry) on unlinked accounts
//                     with different last names. Red when one rep sold them.
//
// "The seller" matches on the person's NAME as well as the login: one person
// can hold a FieldRoutes login per office (Oct 27: one rep had four).

export const OFFICE_NAMES = {   // same baseline as the sync's office map (netlify/functions/revhawk-sync-background.js)
  '1': 'Salt Lake', '6': 'Charleston', '7': 'Myrtle Beach', '10': 'Destin', '13': 'Atlanta',
  '15': 'Virginia Beach', '16': 'Raleigh', '18': 'Detroit', '19': 'Joplin', '20': 'Little Rock',
};

const digits = (v) => String(v || '').replace(/\D/g, '').slice(-10);
const normName = (v) => String(v || '').toLowerCase().replace(/[^a-z]/g, '');
const normEmail = (v) => String(v || '').trim().toLowerCase();
// Placeholder contacts reps type when a customer won't give one — sharing one of these means nothing.
const FAKE_EMAIL = /^(no|none|noemail|na|n\/a|nomail|noreply|test|x+|customer)(\d*)@|@(noemail|none|example|test)\./;
const KNOWN_MAIL = /^(gmail|yahoo|hotmail|icloud|outlook|aol|live|msn|me|comcast|att|bellsouth|sbcglobal|verizon|protonmail)\.(com|net)$/;
const isRealEmail = (e) => /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/.test(e) && !FAKE_EMAIL.test(e);
const isRealPhone = (p) => p.length === 10 && !/^(\d)\1{9}$/.test(p) && p !== '1234567890' && !/^\d{3}5550/.test(p);
const normAddr = (a, zip) => {
  const s = String(a || '').toLowerCase().replace(/\b(street|st|avenue|ave|road|rd|drive|dr|lane|ln|court|ct|circle|cir|boulevard|blvd|place|pl|way|trail|trl|parkway|pkwy)\b\.?/g, '').replace(/[^a-z0-9]/g, '');
  const z = String(zip || '').slice(0, 5);
  return s.length >= 4 && /\d/.test(s) && z ? s + '|' + z : '';
};

export function digitDiff(a, b) {
  const x = digits(a), y = digits(b);
  if (x.length !== 10 || y.length !== 10) return null;
  let n = 0; for (let i = 0; i < 10; i++) if (x[i] !== y[i]) n++;
  return n;
}
export function editDistance(a, b) {
  a = String(a || ''); b = String(b || '');
  if (Math.abs(a.length - b.length) > 2) return 3;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0]; prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}
const office = (id, names) => (names || OFFICE_NAMES)[String(id || '')] || (id ? 'Office ' + id : '');
const fullName = (c) => [c.fname, c.lname].filter(Boolean).join(' ').trim();

export function integrityFlags({ edits = [], contacts = [], employees = [], officeNames = OFFICE_NAMES }) {
  const flags = [];
  const bySeller = (e) => !!e.changed_by_id && (e.changed_by_id === e.sold_by_id || (!!e.changed_by_name && normName(e.changed_by_name) === normName(e.sold_by_name)));

  // ── Edits from the change log ─────────────────────────────────────────────
  for (const e of edits) {
    const base = {
      customer_id: e.customer_id, customer_name: e.customer_name || '', office: office(e.office_id, officeNames),
      rep_name: e.sold_by_name || '', changed_by: e.changed_by_name || '', field: e.field,
      old_value: e.old_value, new_value: e.new_value, changed_at: e.changed_at, sold_on: e.sold_on || null,
      days_after_sale: e.days_after_sale == null ? null : Number(e.days_after_sale),
    };
    const seller = bySeller(e);
    if (e.field === 'phone1' || e.field === 'phone2') {
      if (digitDiff(e.old_value, e.new_value) === 1) flags.push({ ...base, kind: 'phone_one_digit', severity: seller ? 'red' : 'amber',
        detail: 'Phone changed by one digit' + (seller ? ' by the rep who sold it' : '') + (base.days_after_sale != null ? ', ' + base.days_after_sale + ' days after the sale' : '') });
    } else if (e.field === 'email') {
      const o = normEmail(e.old_value), n = normEmail(e.new_value), dom = o.split('@')[1] || '';
      const d = editDistance(o, n);
      if (d >= 1 && d <= 2 && isRealEmail(o) && isRealEmail(n) && dom === (n.split('@')[1] || '') && KNOWN_MAIL.test(dom)) flags.push({ ...base, kind: 'email_small_edit', severity: 'amber',
        detail: 'Email changed by ' + d + ' character' + (d === 1 ? '' : 's') + (seller ? ' by the rep who sold it' : '') + (base.days_after_sale != null ? ', ' + base.days_after_sale + ' days after the sale' : '') });
    } else if (e.field === 'aPay') {
      const person = e.changed_by_id && e.changed_by_id !== '0';
      if (person && base.days_after_sale != null && base.days_after_sale <= 60) flags.push({ ...base, kind: 'autopay_off',
        severity: seller || base.days_after_sale <= 14 ? 'red' : 'amber',
        old_value: e.old_value === '2' ? 'ACH' : 'Card', new_value: 'Off',
        detail: 'Autopay turned off ' + base.days_after_sale + ' days after the sale' + (seller ? ' by the rep who sold it' : '') });
    }
  }

  // ── Rep's own contact info on a customer they sold ─────────────────────────
  const empById = new Map(employees.map(x => [String(x.id), x]));
  const contactsByName = new Map();
  for (const x of employees) {
    const k = normName(x.name); if (!k) continue;
    if (!contactsByName.has(k)) contactsByName.set(k, { phones: new Set(), emails: new Set() });
    const p = digits(x.phone), m = normEmail(x.email);
    if (isRealPhone(p)) contactsByName.get(k).phones.add(p);
    if (isRealEmail(m) && !/@riddpest\.com$|@ridd\.com$/.test(m)) contactsByName.get(k).emails.add(m);   // a shared company inbox is not the rep's own
  }
  for (const c of contacts) {
    const seller = empById.get(String(c.sold_by_id)), sk = normName(c.sold_by_name || (seller && seller.name));
    const mine = sk && contactsByName.get(sk); if (!mine) continue;
    const hitPhone = [c.phone1, c.phone2].map(digits).find(p => mine.phones.has(p));
    const hitEmail = mine.emails.has(normEmail(c.email));
    if (hitPhone || hitEmail) flags.push({
      kind: 'rep_own_contact', severity: 'red', customer_id: c.customer_id, customer_name: fullName(c), office: office(c.office_id, officeNames),
      rep_name: c.sold_by_name || '', field: hitEmail ? 'email' : 'phone', sold_on: c.sold_on || null,
      detail: "The selling rep's own " + (hitEmail && hitPhone ? 'email and phone are' : hitEmail ? 'email is' : 'phone is') + ' on this account',
    });
  }

  // ── Shared phone / email / address / card across unlinked accounts ─────────
  const groups = new Map();   // key → [contact]
  const add = (kind, key, c) => { if (!key) return; const k = kind + '|' + key; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); };
  for (const c of contacts) {
    const p1 = digits(c.phone1), m = normEmail(c.email);
    if (isRealPhone(p1)) add('phone', p1, c);
    if (isRealEmail(m)) add('email', m, c);
    add('address', normAddr(c.address, c.zip), c);
    const l4 = String(c.card_last4 || '').trim(), ex = String(c.card_exp || '').trim();
    if (/^\d{4}$/.test(l4) && ex && ex !== '0') add('card', l4 + '|' + ex, c);
  }
  for (const [k, members] of groups) {
    const linkGroups = new Set(members.map(c => String(c.link_group || c.customer_id)));
    if (linkGroups.size < 2) continue;                       // all linked already — fine
    if (members.length > 25) continue;                       // a placeholder nobody listed (an office phone, a builder's email) — noise, not fraud
    const kind = k.split('|')[0];
    const lastNames = new Set(members.map(c => normName(c.lname)).filter(Boolean));
    const sellers = new Set(members.map(c => normName(c.sold_by_name)).filter(Boolean));
    const sameName = lastNames.size <= 1, oneSeller = sellers.size === 1;
    if (kind === 'card' && sameName) continue;               // one family's card on their own properties
    const isCard = kind === 'card', what = isCard ? 'card' : kind === 'address' ? 'street address' : kind;
    const severity = !sameName && oneSeller ? 'red' : isCard ? 'red' : 'amber';
    const detail = sameName
      ? 'Same ' + what + ' on ' + members.length + ' unlinked accounts with the same last name — likely one customer with several properties: link them in FieldRoutes'
      : 'Same ' + what + ' on ' + members.length + ' unlinked accounts with different names' + (oneSeller ? ', all sold by the same rep' : '');
    const groupKey = kind + ':' + members.map(c => c.customer_id).sort().join(',');
    for (const c of members) flags.push({
      kind: isCard ? 'shared_card' : 'shared_contact', severity, customer_id: c.customer_id, customer_name: fullName(c),
      office: office(c.office_id, officeNames), rep_name: c.sold_by_name || '', field: kind, sold_on: c.sold_on || null,
      group_key: groupKey, related_customer_ids: members.map(x => String(x.customer_id)).filter(id => id !== String(c.customer_id)),
      detail: isCard ? detail.replace('Same card', 'Same card (ending ' + String(c.card_last4).trim() + ')') : detail,
    });
  }
  return flags;
}

export function summarize(flags) {
  const out = { total: flags.length, red: 0 };
  const reps = new Map();
  for (const f of flags) {
    out[f.kind] = (out[f.kind] || 0) + 1; if (f.severity === 'red') out.red++;
    const k = f.rep_name || '(no rep)'; const r = reps.get(k) || { rep: k, red: 0, total: 0 };
    r.total++; if (f.severity === 'red') r.red++; reps.set(k, r);
  }
  // Top reps by red, then total — the Account Integrity screen's "by rep" strip reads this, so the browser never tallies.
  out.topReps = [...reps.values()].filter(r => r.rep !== '(no rep)').sort((a, b) => b.red - a.red || b.total - a.total).slice(0, 12).map(r => [r.rep, r.red, r.total]);
  return out;
}
