// The DASHP pass-through, pinned with a fake fetch. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { createDashpClient, upstreamUrl } from '../services/dashp/functions/dashpClient.js';

const BASE = 'https://us-west3-example.cloudfunctions.net/sales-app-api';

// A fake DASHP: records every call, answers from a table of path → [status, body, headers].
function fakeDashp(table) {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    const u = new URL(url);
    calls.push({ path: u.pathname.split('/').pop(), search: u.search, token: opts.headers['X-API-Token'] });
    const [status, body, headers = {}] = table[u.pathname.split('/').pop()] || [404, { ok: false, error: 'unknown_route' }];
    return { status, headers: { get: (k) => headers[k.toLowerCase()] ?? null }, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  };
  return { calls, fetchImpl };
}

test('upstreamUrl: keeps the base path, forwards only known params, refuses unknown routes', () => {
  const u = upstreamUrl(BASE, 'technician-commission', { employee_id: '12942', year: '2026', quarter: '2', evil: 'x', type: ['a', 'b'] });
  assert.equal(u.toString(), BASE + '/technician-commission?year=2026&quarter=2&employee_id=12942');
  assert.equal(upstreamUrl(BASE + '/', 'd2d-commissions', { year: '2026' }).toString(), BASE + '/d2d-commissions?year=2026');
  assert.equal(upstreamUrl(BASE, 'healthz', {}), null);
  assert.equal(upstreamUrl(BASE, '../admin', {}), null);
  assert.equal(upstreamUrl(BASE, 'd2d-commission', { employee_id: 'x'.repeat(51) }).search, '');
});

test('get: adds the key, passes the envelope through, caches a good answer', async () => {
  const d = fakeDashp({ 'technician-commissions': [200, { ok: true, data: { year: 2026, rows: [] } }] });
  let t = 0;
  const c = createDashpClient({ baseUrl: BASE, token: 'k', fetchImpl: d.fetchImpl, ttlMs: 1000, now: () => t });
  const a = await c.get('technician-commissions', { year: '2026' });
  assert.deepEqual([a.status, a.cache, a.body.data.year], [200, 'miss', 2026]);
  assert.equal(d.calls[0].token, 'k');
  const b = await c.get('technician-commissions', { year: '2026' });
  assert.equal(b.cache, 'hit'); assert.equal(d.calls.length, 1);
  await c.get('technician-commissions', { year: '2025' });            // different year → its own call
  assert.equal(d.calls.length, 2);
  t = 1001;                                                           // past the TTL → upstream again
  assert.equal((await c.get('technician-commissions', { year: '2026' })).cache, 'miss');
  assert.equal(d.calls.length, 3);
});

test('get: DASHP errors come back as they are, and are never cached', async () => {
  const d = fakeDashp({
    'technician-commission': [404, { ok: false, error: 'commission_not_found', message: 'No stored result', employee_id: '1', year: 2026, quarter: 4 }],
    'd2d-commissions': [429, { ok: false, error: 'rate_limited', retry_after_seconds: 12 }, { 'retry-after': '12' }],
    'd2d-commission': [200, '<html>gateway</html>'],
  });
  const c = createDashpClient({ baseUrl: BASE, token: 'k', fetchImpl: d.fetchImpl });
  const nf = await c.get('technician-commission', { employee_id: '1', year: '2026', quarter: '4' });
  assert.deepEqual([nf.status, nf.body.error, nf.body.quarter], [404, 'commission_not_found', 4]);
  await c.get('technician-commission', { employee_id: '1', year: '2026', quarter: '4' });
  assert.equal(d.calls.length, 2);
  const rl = await c.get('d2d-commissions', { year: '2026' });
  assert.deepEqual([rl.status, rl.retryAfter, rl.body.retry_after_seconds], [429, '12', 12]);
  const bad = await c.get('d2d-commission', { employee_id: '1', year: '2026' });
  assert.deepEqual([bad.status, bad.body.error], [502, 'dashp_bad_response']);
});

test('get: not configured, unknown route, and a dead upstream all answer in the same envelope', async () => {
  const off = await createDashpClient({ baseUrl: '', token: '' }).get('d2d-commissions', {});
  assert.deepEqual([off.status, off.body.ok, off.body.error], [503, false, 'dashp_not_configured']);
  const c = createDashpClient({ baseUrl: BASE, token: 'k', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
  assert.equal((await c.get('nope', {})).body.error, 'unknown_route');
  const down = await c.get('d2d-commissions', { year: '2026' });
  assert.deepEqual([down.status, down.body.error], [502, 'dashp_unreachable']);
});

test('status: tells a wrong URL from a wrong key', async () => {
  const ROOT = 'https://sales-app-api-example.us-west3.run.app';      // a bare Cloud Run root, as deployed
  const ok = fakeDashp({ health: [200, { ok: true }], 'company-summary': [200, { ok: true, data: {} }] });
  assert.deepEqual(await createDashpClient({ baseUrl: ROOT, token: 'k', fetchImpl: ok.fetchImpl }).status(),
    { configured: true, reachable: true, authorized: true, upstream_status: 200, message: 'Connected.' });
  assert.deepEqual(ok.calls.map(c => [c.path, c.token]), [['health', undefined], ['company-summary', 'k']]);   // /health carries no key; /healthz is never called
  const badKey = fakeDashp({ health: [200, { ok: true }], 'company-summary': [401, { ok: false, error: 'unauthorized', message: 'Missing or wrong token' }] });
  const s = await createDashpClient({ baseUrl: ROOT, token: 'wrong', fetchImpl: badKey.fetchImpl }).status();
  assert.deepEqual([s.reachable, s.authorized, s.upstream_status, s.message], [true, false, 401, 'Missing or wrong token']);
  const badUrl = fakeDashp({ 'company-summary': [404, '<html>Google 404</html>'] });
  const w = await createDashpClient({ baseUrl: ROOT, token: 'k', fetchImpl: badUrl.fetchImpl }).status();
  assert.deepEqual([w.reachable, w.authorized, w.upstream_status], [false, false, 404]);
  assert.match(w.message, /check DASHP_API_URL/);
  assert.equal((await createDashpClient({ baseUrl: '', token: '' }).status()).configured, false);
});