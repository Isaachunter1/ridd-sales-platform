// ┌─ plaibookMcp ────────────────────────────────────────────────────────────
// │ A thin client for Plaibook's MCP server (per Isaac, Nov 7 — "I'll get the
// │ API key or server token for the MCP so we can pipe it in live"). Speaks
// │ MCP over streamable HTTP: initialize → tools/call, Bearer token from
// │ PLAIBOOK_MCP_TOKEN, URL from PLAIBOOK_MCP_URL. Answers may come back as
// │ plain JSON or as an SSE stream; both are handled.
// │ The parsers below turn the two tools this job uses into plain rows:
// │   query_sales_kpis (groupBy agent) → { name, rate, sold, qualified, revenue }
// │   query_opportunities (show records) → the sample rows
// └────────────────────────────────────────────────────────────────────────
import env from '../../../config/env.js';

const PROTOCOL = '2025-06-18';

function parseSse(text) {
  // Last "data:" JSON object in the stream is the response.
  let last = null;
  for (const line of String(text).split(/\r?\n/)) { if (line.startsWith('data:')) { try { last = JSON.parse(line.slice(5).trim()); } catch (e) { /* keep looking */ } } }
  return last;
}

export class PlaibookMcp {
  constructor({ url = env.PLAIBOOK_MCP_URL, token = env.PLAIBOOK_MCP_TOKEN, fetchImpl = fetch } = {}) {
    if (!url || !token) throw new Error('Plaibook not configured: set PLAIBOOK_MCP_URL and PLAIBOOK_MCP_TOKEN (Cloud Run env / Secret Manager)');
    this.url = url; this.token = token; this.fetch = fetchImpl; this.session = null; this.id = 0;
  }
  async rpc(method, params, { notify = false } = {}) {
    const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++this.id, method, params };
    // Bearer is the MCP norm; Plaibook's keys (plb_…) may be read from X-API-Key instead — send both, one is ignored.
    const headers = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: 'Bearer ' + this.token, 'X-API-Key': this.token, 'MCP-Protocol-Version': PROTOCOL };
    if (this.session) headers['Mcp-Session-Id'] = this.session;
    const r = await this.fetch(this.url, { method: 'POST', headers, body: JSON.stringify(body) });
    const sid = r.headers && r.headers.get ? r.headers.get('mcp-session-id') : null;
    if (sid) this.session = sid;
    if (notify) return null;
    const text = await r.text();
    if (!r.ok) throw new Error('Plaibook MCP ' + method + ' failed: HTTP ' + r.status + ' ' + text.slice(0, 300));
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    let j = null;
    try { j = ct.includes('text/event-stream') || text.startsWith('event:') || text.startsWith('data:') ? parseSse(text) : JSON.parse(text); } catch (e) { throw new Error('Plaibook MCP ' + method + ': unreadable reply ' + text.slice(0, 200)); }
    if (!j) throw new Error('Plaibook MCP ' + method + ': empty reply');
    if (j.error) throw new Error('Plaibook MCP ' + method + ': ' + (j.error.message || JSON.stringify(j.error)).slice(0, 300));
    return j.result;
  }
  async init() {
    if (this.ready) return;
    await this.rpc('initialize', { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: 'ridd-sales-platform', version: env.JOB_VERSION || 'dev' } });
    await this.rpc('notifications/initialized', {}, { notify: true });
    this.ready = true;
  }
  // tools/call → the tool's JSON payload (its text content parsed), or the raw content.
  async call(name, args) {
    await this.init();
    const res = await this.rpc('tools/call', { name, arguments: args });
    if (res && res.isError) throw new Error('Plaibook ' + name + ': ' + JSON.stringify(res.content || res).slice(0, 300));
    const text = ((res && res.content) || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
    try { return JSON.parse(text); } catch (e) { const sc = res && res.structuredContent; return sc && sc.metadata ? sc : text; }   // the live server answers in prose; the parsers read both
  }
}

// ── Parsers (pure, pinned by test/plaibook-close-rates.test.js) ──
const pctOf = (text) => { const m = String(text || '').match(/([\d.]+)\s*%\s*\((\d[\d,]*)\s*\/\s*(\d[\d,]*)\)/); return m ? { rate: Math.round(Number(m[1]) * 10) / 1000, sold: Number(m[2].replace(/,/g, '')), qualified: Number(m[3].replace(/,/g, '')) } : null; };
const moneyOf = (text) => Number(String(text || '').replace(/[^0-9.-]/g, '')) || 0;

// query_sales_kpis (groupBy agent) → one row per rep, Plaibook's own numbers.
// Two shapes: the JSON payload (metadata.metrics, Nov 7) and the markdown table the live MCP server
// sends as plain text (Nov 11 — first Cloud Run run failed with "no per-rep close rates" on it).
const cellNum = (t) => Number(String(t || '').replace(/[^0-9.-]/g, '').split('.').slice(0, 2).join('.')) || 0;
export function parseSalesKpisTable(text) {
  const lines = String(text || '').split(/\r?\n/).filter(l => l.trim().startsWith('|'));
  const hi = lines.findIndex(l => /\|\s*group\s*\|/i.test(l) && /close rate/i.test(l));
  if (hi < 0) return [];
  const cells = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
  const head = cells(lines[hi]).map(h => h.toLowerCase());
  const col = (name) => head.indexOf(name);
  const iName = col('group'), iRate = col('close rate'), iRev = col('revenue'), iOpp = col('opportunities');
  const out = [];
  for (const l of lines.slice(hi + 1)) {
    const c = cells(l); if (c.length < head.length || /^-+$/.test(c[0])) continue;
    const name = c[iName]; if (!name || /unattributed|no seated rep/i.test(name)) continue;
    const p = pctOf(c[iRate]); if (!p) continue;
    const r = { name, ...p };
    if (iRev >= 0) r.revenue = moneyOf((c[iRev] || '').split(' from ')[0]);
    if (iOpp >= 0) r.opportunities = cellNum(c[iOpp]);
    out.push(r);
  }
  return out;
}
export function parseSalesKpis(payload) {
  if (typeof payload === 'string') return parseSalesKpisTable(payload);
  const metrics = (payload && payload.metadata && payload.metadata.metrics) || {};
  const by = new Map();
  for (const v of Object.values(metrics)) {
    const lbl = String(v.label || ''); const i = lbl.indexOf(', '); if (i < 0) continue;
    const k = lbl.slice(0, i), name = lbl.slice(i + 2);
    if (/unattributed|no seated rep/i.test(name)) continue;
    const r = by.get(name) || by.set(name, { name }).get(name);
    if (k === 'close rate') { const p = pctOf(v.text); if (p) Object.assign(r, p); }
    else if (k === 'revenue') r.revenue = moneyOf(v.text);
    else if (k === 'opportunities') r.opportunities = Number(String(v.text).replace(/,/g, '')) || 0;
  }
  return [...by.values()].filter(r => Number.isFinite(r.rate));
}

// query_opportunities (show records) → the sample rows as the job's list items.
const SERVICE = { general_pest: 'Pest', termite: 'Termite', mosquito: 'Mosquito', rodent_wildlife: 'Rodent', bed_bug: 'Bed bug', bundle: 'Bundle' };
const human = (s) => String(s || '').replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
// The live server answers "show records" as prose + a ```json block of the rows ("All 21 matching sales below").
export function sampleRows(payload) {
  if (typeof payload === 'string') { const m = payload.match(/```json\s*([\s\S]*?)```/); if (m) { try { const a = JSON.parse(m[1]); return Array.isArray(a) ? a : []; } catch (e) { return []; } } return []; }
  return (payload && payload.metadata && payload.metadata.queryResult && payload.metadata.queryResult.sample) || [];
}
export function parseRecords(payload, kind, planOf) {
  const rows = sampleRows(payload);
  return rows.map(x => {
    const name = x.unnamed ? (x.customer || 'Unnamed lead') + (x.phone ? ' · ' + x.phone.replace(/^\+1/, '') : '') : (x.customer || '—');
    let sub;
    if (kind === 'closed') { const plan = planOf ? planOf(x) : null; sub = plan || ((SERVICE[x.serviceLine] || human(x.serviceLine) || 'Sale') + (x.value ? ' · $' + Math.round(x.value) : '')); }
    else if (kind === 'qualified_not_closed') { const st = String(x.status || ''); sub = (/booked/i.test(st) ? 'Booked · not sold yet' : 'Still open') + (x.closureReason && x.closureReason !== 'sale_completed' ? ' · ' + human(x.closureReason) : x.journeyBookedReason ? ' · ' + human(x.journeyBookedReason) : ''); }
    else sub = human(x.closureReason) || human(x.status) || 'Unqualified';
    return { name, sub, phone: x.phone || null, id: x._id || null };
  });
}
export const recordCount = (payload) => {
  if (typeof payload === 'string') { const m = payload.match(/All\s+([\d,]+)\s+matching/i) || payload.match(/\(all\s+([\d,]+)\s+rows\)/i) || payload.match(/first\s+[\d,]+\s+of\s+([\d,]+)/i); return m ? Number(m[1].replace(/,/g, '')) : sampleRows(payload).length; }
  return Number((payload && payload.metadata && payload.metadata.queryResult && payload.metadata.queryResult.documentCount) || 0);
};
