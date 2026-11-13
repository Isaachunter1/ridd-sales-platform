// Plaibook payload parsers pinned on the shapes the MCP returned on Nov 7 2026. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSalesKpis, parseSalesKpisTable, parseRecords, recordCount, PlaibookMcp } from '../services/pay/functions/plaibookMcp.js';
import { tvWindow, tvWindows, TV_RANGE_IDS } from '../services/pay/functions/tvWindows.js';

const kpis = { metadata: { action: 'query_sales_kpis', metrics: {
  a: { label: 'close rate, Drew Sauer', text: '45.1% (390/865)' }, b: { label: 'revenue, Drew Sauer', text: '$268,092.92' }, c: { label: 'opportunities, Drew Sauer', text: '1,584' },
  d: { label: 'close rate, Pere Le Sueur', text: '36.8% (140/380)' }, e: { label: 'close rate, unattributed (no seated rep credited)', text: '57.0% (232/407)' }, f: { label: 'calls, Drew Sauer', text: '1,365' } } } };

test('parseSalesKpis: one row per rep, unattributed dropped', () => {
  const rows = parseSalesKpis(kpis);
  assert.equal(rows.length, 2);
  const drew = rows.find(r => r.name === 'Drew Sauer');
  assert.deepEqual({ rate: drew.rate, sold: drew.sold, qualified: drew.qualified, revenue: drew.revenue, opportunities: drew.opportunities }, { rate: 0.451, sold: 390, qualified: 865, revenue: 268092.92, opportunities: 1584 });
});

const recs = { metadata: { queryResult: { documentCount: 390, sample: [
  { _id: '1', customer: 'ERIK BAUTISTA', phone: '+19196237810', status: 'sold', serviceLine: 'general_pest', value: 631.57, closureReason: 'sale_completed' },
  { _id: '2', customer: 'Missed Call', unnamed: true, phone: '+18015550100', status: 'booked', closureReason: null, journeyBookedReason: 'waiting_on_autopay' },
  { _id: '3', customer: 'Chuck Bull', phone: '+18015550101', status: 'lost', closureReason: 'outside_service_area' } ] } } };

test('parseRecords: closed shows the FieldRoutes plan when the phone matches, else the service line', () => {
  const planOf = (x) => x.phone === '+19196237810' ? 'Pest 4' : null;
  const closed = parseRecords(recs, 'closed', planOf);
  assert.equal(closed[0].sub, 'Pest 4'); assert.equal(closed[0].name, 'ERIK BAUTISTA');
  assert.equal(closed[1].sub, 'Sale'); assert.match(closed[1].name, /Missed Call · 8015550100/);
  const q = parseRecords(recs, 'qualified_not_closed');
  assert.equal(q[1].sub, 'Booked · not sold yet · Waiting on autopay');
  const u = parseRecords(recs, 'unqualified');
  assert.equal(u[2].sub, 'Outside service area');
  assert.equal(recordCount(recs), 390);
});

test('PlaibookMcp: initialize then tools/call, plain JSON and SSE replies, session header kept', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push({ url, auth: opts.headers.Authorization, sid: opts.headers['Mcp-Session-Id'], method: body.method });
    const headers = { get: (k) => k.toLowerCase() === 'mcp-session-id' ? 'sess-1' : k.toLowerCase() === 'content-type' ? (body.method === 'tools/call' ? 'text/event-stream' : 'application/json') : null };
    if (body.method === 'notifications/initialized') return { ok: true, status: 202, headers, text: async () => '' };
    if (body.method === 'initialize') return { ok: true, status: 200, headers, text: async () => JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } }) };
    return { ok: true, status: 200, headers, text: async () => 'event: message\ndata: ' + JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: JSON.stringify({ metadata: { metrics: {} } }) }] } }) + '\n\n' };
  };
  const c = new PlaibookMcp({ url: 'https://mcp.example/plaibook', token: 'tok', fetchImpl });
  const r = await c.call('query_sales_kpis', { groupBy: 'agent' });
  assert.deepEqual(r, { metadata: { metrics: {} } });
  assert.deepEqual(calls.map(x => x.method), ['initialize', 'notifications/initialized', 'tools/call']);
  assert.equal(calls[0].auth, 'Bearer tok'); assert.equal(calls[2].sid, 'sess-1');
});

// The live MCP server (Nov 11) answers as markdown text, not the metadata JSON above.
const kpiText = `Sales KPIs by rep for the team, 2026-08-13 → 2026-11-12.

| group | opportunities | calls | unique leads | qualified | booked | sold | qualification rate | close rate | new-customer close rate | booked rate | commit rate | revenue | avg sale | missed calls |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Drew Sauer | 1,729 | 1,363 | 1,706 | 857 | 472 | 398 | 49.6% (857/1729) | 46.4% (398/857) | 46.4% (398/857) | 55.1% (472/857) | 84.3% (398/472) | $267,254.59 from 375 sales | $712.68 | — |
| Pere Le Sueur | 525 | 503 | 522 | 341 | 160 | 127 | 65.0% (341/525) | 37.2% (127/341) | 37.2% (127/341) | 46.9% (160/341) | 79.4% (127/160) | $88,880.93 from 115 sales | $772.88 | — |
| unattributed (no seated rep credited) | 326 | 0 | 313 | 323 | 322 | 193 | 99.1% (323/326) | 59.8% (193/323) | 59.8% (193/323) | 99.7% (322/323) | 59.9% (193/322) | $30,335.73 from 38 sales | $798.31 | — |

Close rate is sold over qualified.`;

test('parseSalesKpis: the markdown table the live server sends', () => {
  const rows = parseSalesKpis(kpiText);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0], { name: 'Drew Sauer', rate: 0.464, sold: 398, qualified: 857, revenue: 267254.59, opportunities: 1729 });
  assert.equal(rows[1].name, 'Pere Le Sueur'); assert.equal(rows[1].qualified, 341);
  assert.deepEqual(parseSalesKpisTable('no table here'), []);
});

const recText = 'Sales records for Pere Le Sueur. All 21 matching sales below; the link opens every one.\n\n**Sample (all 21 rows):**\n```json\n' + JSON.stringify([
  { _id: '1', customer: 'A B', phone: '+19196237810', status: 'sold', serviceLine: 'general_pest', value: 631.57, closureReason: 'sale_completed' },
  { _id: '2', customer: 'C D', phone: '+18015550100', status: 'sold', serviceLine: 'bundle', value: 1071.57, closureReason: 'sale_completed' } ]) + '\n```\n';

test('parseRecords / recordCount: the prose + json-block shape', () => {
  const closed = parseRecords(recText, 'closed', () => null);
  assert.equal(closed.length, 2); assert.equal(closed[1].sub, 'Bundle · $1072');
  assert.equal(recordCount(recText), 21);
  assert.equal(recordCount('nothing'), 0);
});

// TV ranges on the board's Mountain calendar: 2026-11-11 05:46Z is still Tue Nov 10, 10:46 pm in Denver.
test('tvWindows: the board\'s ranges, on Mountain time, Sun–Sat weeks, whole past periods', () => {
  const now = new Date('2026-11-11T05:46:00Z');
  const w = Object.fromEntries(tvWindows(now).map(x => [x.id, x]));
  assert.deepEqual(TV_RANGE_IDS, Object.keys(w));
  assert.deepEqual([w.today.start, w.today.end, w.today.label], ['2026-11-10', '2026-11-10', 'Today']);
  assert.deepEqual([w.yesterday.start, w.yesterday.end], ['2026-11-09', '2026-11-09']);
  assert.deepEqual([w.this_week.start, w.this_week.end], ['2026-11-08', '2026-11-10']);     // Sunday Nov 8 → Tue Nov 10
  assert.deepEqual([w.last_week.start, w.last_week.end], ['2026-11-01', '2026-11-07']);
  assert.deepEqual([w.this_month.start, w.this_month.end, w.this_month.label], ['2026-11-01', '2026-11-10', 'November']);
  assert.deepEqual([w.last_month.start, w.last_month.end, w.last_month.label], ['2026-10-01', '2026-10-31', 'October']);
  assert.deepEqual([w.this_year.start, w.this_year.end, w.this_year.label], ['2026-01-01', '2026-11-10', '2026']);
  // January: last month rolls into the prior year.
  const j = tvWindow('last_month', new Date('2026-01-05T18:00:00Z'));
  assert.deepEqual([j.start, j.end, j.label], ['2025-12-01', '2025-12-31', 'December']);
});

test('parseSalesKpis: the team-level table (no groupBy) keeps the "team" row', () => {
  const txt = '| group | opportunities | qualified | sold | close rate | revenue |\n|---|---|---|---|---|---|\n| team | 2,401 | 1,157 | 420 | 36.3% (420/1157) | $301,252.89 from 380 sales |\n';
  const rows = parseSalesKpis(txt);
  assert.equal(rows.length, 1); assert.equal(rows[0].name, 'team'); assert.deepEqual([rows[0].rate, rows[0].sold, rows[0].qualified, rows[0].opportunities], [0.363, 420, 1157, 2401]);
});
