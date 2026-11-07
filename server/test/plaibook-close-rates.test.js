// Plaibook payload parsers pinned on the shapes the MCP returned on Nov 7 2026. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSalesKpis, parseRecords, recordCount, PlaibookMcp } from '../services/pay/functions/plaibookMcp.js';

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
