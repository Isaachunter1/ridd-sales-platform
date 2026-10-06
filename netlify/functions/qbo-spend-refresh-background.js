// QuickBooks marketing spend — BACKGROUND refresh via Windsor.ai.
// The general-ledger pull (month × account, ~20 months) takes Windsor
// 15-40s, past the sync-function limit, so it runs here (background
// functions get 15 min) and parks the result in Netlify Blobs. qbo-spend.js
// serves the cached copy instantly and kicks this off when it's stale.
//
// Trigger: POST with x-sync-secret: REVHAWK_SYNC_SECRET (same shared secret
// the RevHawk sync uses). Fired by qbo-spend.js (stale cache) and by
// marketing-refresh-scheduled.js (nightly).
const FETCH_MS = 240000;

async function fetchT(url, opts) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), FETCH_MS);
  try { const r = await fetch(url, { ...opts, signal: ac.signal }); const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {} return { ok: r.ok, status: r.status, json, text }; }
  finally { clearTimeout(t); }
}
const { kvStore } = require('../lib/kv-store.js');
async function blobStore() { return kvStore('qbo'); }

async function pullWindsor(startYear) {
  const key = process.env.WINDSOR_API_KEY;
  if (!key) throw new Error('WINDSOR_API_KEY not set');
  const now = new Date();
  const from = `${startYear}-01-01`, to = now.toISOString().slice(0, 10);
  const fields = 'year_month,generalledger__item__account_name,generalledger__item__subt_nat_amount';
  const url = `https://connectors.windsor.ai/quickbooks?api_key=${encodeURIComponent(key)}&date_from=${from}&date_to=${to}&fields=${fields}&_renderer=json`;
  const r = await fetchT(url, { headers: { accept: 'application/json' } });
  if (!r.ok || !r.json) throw new Error(`Windsor quickbooks ${r.status}: ${(r.text || '').slice(0, 200)}`);
  const rows = Array.isArray(r.json) ? r.json : (r.json.data || r.json.result || []);
  const out = {};        // marketing only: {ym: {"Atlanta Marketing": $}}
  const ledger = {};     // EVERY account: {ym: {"Advertising & Marketing:Atlanta Marketing": $}} — feeds the Putis Shid tab
  let any = false;
  for (const row of rows) {
    const acct = String(row.generalledger__item__account_name || '').trim();
    if (!acct) continue;
    const m = String(row.year_month || '').match(/^(\d{4})\|(\d{1,2})$/); if (!m) continue;
    const ym = m[1] + '-' + m[2].padStart(2, '0');
    const amt = Number(row.generalledger__item__subt_nat_amount); if (!amt) continue;
    (ledger[ym] = ledger[ym] || {});
    ledger[ym][acct] = (ledger[ym][acct] || 0) + amt;
    if (!/^advertising\s*&\s*marketing:/i.test(acct)) continue;
    const name = acct.split(':').pop().trim();
    (out[ym] = out[ym] || {});
    out[ym][name] = (out[ym][name] || 0) + amt;
    any = true;
  }
  if (!any) throw new Error('Windsor returned no Advertising & Marketing rows (' + rows.length + ' ledger rows)');
  let total = 0; for (const ym in out) for (const k in out[ym]) total += out[ym][k];
  const pulledAt = new Date().toISOString();
  return { bySourceMonth: out, total, pulledAt, source: 'windsor', rows: rows.length, ledger: { months: ledger, pulledAt, source: 'windsor' } };
}

// Balance sheet, month-end snapshots (Windsor's balancesheet__* report
// fields, one row per year_month). Feeds the Putis Shid debt / leverage rows.
// Non-fatal: if this pull fails the ledger still lands, just without debt.
async function pullBalanceSheet(startYear) {
  const key = process.env.WINDSOR_API_KEY;
  const now = new Date();
  const from = `${startYear}-01-01`, to = now.toISOString().slice(0, 10);
  const F = {
    assets: 'balancesheet__totalassets',
    currentAssets: 'balancesheet__totalassets__currentassets',
    cash: 'balancesheet__totalassets__currentassets__bankaccounts',
    ar: 'balancesheet__totalassets__currentassets__ar',
    liabilities: 'balancesheet__totalliabilitiesandequity__liabilities',
    currentLiabilities: 'balancesheet__totalliabilitiesandequity__liabilities__currentliabilities',
    ap: 'balancesheet__totalliabilitiesandequity__liabilities__currentliabilities__ap',
    cards: 'balancesheet__totalliabilitiesandequity__liabilities__currentliabilities__creditcards',
    otherCurrent: 'balancesheet__totalliabilitiesandequity__liabilities__currentliabilities__OtherCurrentLiabilities',
    equity: 'balancesheet__totalliabilitiesandequity__equity',
  };
  const fields = ['year_month', ...Object.values(F)].join(',');
  const url = `https://connectors.windsor.ai/quickbooks?api_key=${encodeURIComponent(key)}&date_from=${from}&date_to=${to}&fields=${fields}&_renderer=json`;
  const r = await fetchT(url, { headers: { accept: 'application/json' } });
  if (!r.ok || !r.json) throw new Error(`Windsor balancesheet ${r.status}: ${(r.text || '').slice(0, 200)}`);
  const rows = Array.isArray(r.json) ? r.json : (r.json.data || r.json.result || []);
  const out = {};
  for (const row of rows) {
    const m = String(row.year_month || '').match(/^(\d{4})\|(\d{1,2})$/); if (!m) continue;
    const ym = m[1] + '-' + m[2].padStart(2, '0');
    const o = {};
    for (const k in F) {
      // Windsor lower-cases some field ids in the response; try both.
      const v = row[F[k]] != null ? row[F[k]] : row[F[k].toLowerCase()];
      o[k] = Number(v) || 0;
    }
    o.ltDebt = o.liabilities - o.currentLiabilities;   // long-term liabilities = the term debt
    out[ym] = o;
  }
  return out;
}

// Long-term liability accounts with today's balance (the loans by branch —
// "Mizzen Loan - Atlanta" etc.). Windsor reports liability balances negative.
async function pullDebtAccounts() {
  const key = process.env.WINDSOR_API_KEY;
  const fields = 'accounts__fullyqualifiedname,accounts__accounttype,accounts__currentbalance,accounts__active';
  const url = `https://connectors.windsor.ai/quickbooks?api_key=${encodeURIComponent(key)}&date_preset=last_7d&fields=${fields}&_renderer=json`;
  const r = await fetchT(url, { headers: { accept: 'application/json' } });
  if (!r.ok || !r.json) throw new Error(`Windsor accounts ${r.status}: ${(r.text || '').slice(0, 200)}`);
  const rows = Array.isArray(r.json) ? r.json : (r.json.data || r.json.result || []);
  const out = {};
  for (const row of rows) {
    if (String(row.accounts__accounttype || '') !== 'Long Term Liability') continue;
    if (String(row.accounts__active || 'True') !== 'True') continue;
    const name = String(row.accounts__fullyqualifiedname || '').trim(); if (!name) continue;
    out[name] = Math.abs(Number(row.accounts__currentbalance) || 0);
  }
  return { accounts: out, pulledAt: new Date().toISOString() };
}

// Marketing spend BY PAYEE (per Isaac, Oct 6 2026): the Transaction Detail
// behind "Advertising & Marketing" — one line per card charge / bill with the
// QuickBooks Name (Google, Facebook, PESTNET.COM …) and the memo. Summed to
// month × payee so the app can map each payee to a lead provider and price a
// lead by provider. Journal entries are kept apart: they are the controller's
// month-end allocation of the same dollars to the branches, not new spend.
// A line with no Name is keyed by the first words of its memo.
async function pullMarketingPayees(startYear) {
  const key = process.env.WINDSOR_API_KEY;
  const now = new Date();
  const from = `${startYear}-01-01`, to = now.toISOString().slice(0, 10);
  const fields = 'generalledger__item__tx_date,generalledger__item__account_name,generalledger__item__name,generalledger__item__vendor_name,generalledger__item__memo,generalledger__item__txn_type,generalledger__item__subt_nat_amount';
  const filter = encodeURIComponent(JSON.stringify([['generalledger__item__account_name', 'contains', 'Advertising & Marketing']]));
  const url = `https://connectors.windsor.ai/quickbooks?api_key=${encodeURIComponent(key)}&date_from=${from}&date_to=${to}&fields=${fields}&filter=${filter}&_renderer=json`;
  const r = await fetchT(url, { headers: { accept: 'application/json' } });
  if (!r.ok || !r.json) throw new Error(`Windsor marketing detail ${r.status}: ${(r.text || '').slice(0, 200)}`);
  const rows = Array.isArray(r.json) ? r.json : (r.json.data || r.json.result || []);
  const months = {}, journal = {}, memo = {}; let n = 0;
  const cents = (x) => Math.round(x * 100) / 100;
  for (const row of rows) {
    const acct = String(row.generalledger__item__account_name || '').trim();
    if (!/^advertising\s*&\s*marketing/i.test(acct)) continue;   // the filter is also applied here, in case Windsor ignores it
    const ym = String(row.generalledger__item__tx_date || '').slice(0, 7); if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const amt = Number(row.generalledger__item__subt_nat_amount); if (!amt) continue;
    if (/journal/i.test(String(row.generalledger__item__txn_type || ''))) { journal[ym] = cents((journal[ym] || 0) + amt); continue; }
    const m = String(row.generalledger__item__memo || '').replace(/\s+/g, ' ').trim();
    let payee = String(row.generalledger__item__name || row.generalledger__item__vendor_name || '').trim();
    if (!payee) payee = m ? '(no name) ' + m.replace(/[*#]?[A-Z0-9]*\d{4,}.*$/i, '').trim().slice(0, 24) : '(no name)';
    (months[ym] = months[ym] || {});
    months[ym][payee] = cents((months[ym][payee] || 0) + amt);
    if (m && !memo[payee]) memo[payee] = m.slice(0, 60);
    n++;
  }
  return { months, journal, memo, rows: n, pulledAt: new Date().toISOString() };
}

exports.handler = async (event) => {
  console.log('[qbo-refresh] invoked');
  const need = process.env.REVHAWK_SYNC_SECRET;
  if (need) {
    const got = (event && event.headers && (event.headers['x-sync-secret'] || event.headers['X-Sync-Secret'])) || '';
    if (got !== need) return { statusCode: 401, body: 'bad secret' };
  }
  const store = await blobStore();
  if (!store) { console.error('[qbo-refresh] cache store unavailable (SUPABASE_SERVICE_ROLE_KEY?)'); return { statusCode: 500, body: 'no blobs' }; }
  const startYear = new Date().getFullYear() - 1;
  const started = Date.now();
  try {
    await store.set('spend_refreshing', { at: new Date().toISOString() });
    const data = await pullWindsor(startYear);
    const ledger = data.ledger; delete data.ledger;
    try { ledger.balance = await pullBalanceSheet(startYear); console.log('[qbo-refresh] balance sheet months:', Object.keys(ledger.balance).length); }
    catch (be) { console.warn('[qbo-refresh] balance sheet pull failed (non-fatal):', be && be.message); }
    try { ledger.debt = await pullDebtAccounts(); console.log('[qbo-refresh] long-term liability accounts:', Object.keys(ledger.debt.accounts).length); }
    catch (de) { console.warn('[qbo-refresh] debt accounts pull failed (non-fatal):', de && de.message); }
    // Spend by payee rides on the same cached object the app already reads (non-fatal).
    try { data.byPayee = await pullMarketingPayees(startYear); console.log('[qbo-refresh] marketing payee lines:', data.byPayee.rows); }
    catch (pe) { console.warn('[qbo-refresh] marketing payee pull failed (non-fatal):', pe && pe.message); }
    await store.set('ledger', ledger);
    await store.set('spend', data);
    await store.delete('spend_refreshing').catch(() => {});
    console.log('[qbo-refresh] ok', data.rows, 'ledger rows,', Object.keys(data.bySourceMonth).length, 'months, total', Math.round(data.total), 'in', Date.now() - started, 'ms');
    return { statusCode: 200, body: 'ok' };
  } catch (e) {
    await store.delete('spend_refreshing').catch(() => {});
    await store.set('spend_error', { at: new Date().toISOString(), error: String(e && e.message || e) }).catch(() => {});
    console.error('[qbo-refresh] failed after', Date.now() - started, 'ms:', e && e.message);
    return { statusCode: 500, body: String(e && e.message || e) };
  }
};
