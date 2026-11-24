// ── Market Watch: public share price ────────────────────────────────────
// GET /api/market-quote  → { symbol, price, prevClose, change, changePct, asOf, hi52, lo52, closes:[weekly, 1 year], source }
// Public market data only, for a FIXED symbol (Rollins, NYSE: ROL) — no input is taken, so this cannot be used to
// fetch anything else. No secrets, no customer data, nothing stored. Tries Yahoo's chart feed first, then Stooq's
// daily CSV; if both fail it answers { unavailable: true } and the page shows a link to the quote instead of a number.
// Cached 15 minutes at the edge so a busy page does not hammer the source.
const SYMBOL = 'ROL';

async function getText(url) {
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 7000);
  try {
    const r = await fetch(url, { signal: ctl.signal, headers: { 'user-agent': 'Mozilla/5.0 (compatible; ridd-market-watch)' } });
    if (!r.ok) throw new Error('http ' + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}

async function fromYahoo() {
  const j = JSON.parse(await getText('https://query1.finance.yahoo.com/v8/finance/chart/' + SYMBOL + '?range=1y&interval=1wk'));
  const res = j && j.chart && j.chart.result && j.chart.result[0]; const m = res && res.meta;
  const price = m && Number(m.regularMarketPrice);
  if (!(price > 0)) throw new Error('no price');
  const q = res.indicators && res.indicators.quote && res.indicators.quote[0];
  const closes = ((q && q.close) || []).map(Number).filter(v => v > 0);
  // The previous day's close: the daily feed is the only reliable place for it.
  let prevClose = null;
  try {
    const d = JSON.parse(await getText('https://query1.finance.yahoo.com/v8/finance/chart/' + SYMBOL + '?range=5d&interval=1d'));
    const dc = (((d.chart.result[0].indicators || {}).quote || [{}])[0].close || []).map(Number).filter(v => v > 0);
    if (dc.length >= 2) prevClose = dc[dc.length - 2];
  } catch (e) { /* change stays blank */ }
  return { symbol: SYMBOL, price, prevClose, asOf: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
    hi52: Number(m.fiftyTwoWeekHigh) || (closes.length ? Math.max(...closes) : null), lo52: Number(m.fiftyTwoWeekLow) || (closes.length ? Math.min(...closes) : null),
    closes, source: 'Yahoo Finance' };
}

async function fromStooq() {
  const csv = await getText('https://stooq.com/q/l/?s=' + SYMBOL.toLowerCase() + '.us&f=sd2t2ohlcv&h&e=csv');
  const lines = csv.trim().split(/\r?\n/); if (lines.length < 2) throw new Error('empty');
  const head = lines[0].split(',').map(s => s.trim().toLowerCase()), row = lines[1].split(',');
  const at = (k) => row[head.indexOf(k)];
  const price = Number(at('close')); if (!(price > 0)) throw new Error('no price');
  const asOf = /^\d{4}-\d{2}-\d{2}$/.test(at('date') || '') ? at('date') + 'T' + (at('time') || '00:00:00') + 'Z' : null;
  return { symbol: SYMBOL, price, prevClose: null, asOf, hi52: null, lo52: null, closes: [], source: 'Stooq' };
}

exports.handler = async () => {
  let out = null;
  for (const f of [fromYahoo, fromStooq]) { try { out = await f(); break; } catch (e) { out = null; } }
  if (!out) return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=120' }, body: JSON.stringify({ unavailable: true, symbol: SYMBOL }) };
  if (out.prevClose > 0) { out.change = out.price - out.prevClose; out.changePct = out.change / out.prevClose; }
  out.fetchedAt = new Date().toISOString();
  return { statusCode: 200, headers: { 'content-type': 'application/json', 'cache-control': 'public, max-age=900' }, body: JSON.stringify(out) };
};
