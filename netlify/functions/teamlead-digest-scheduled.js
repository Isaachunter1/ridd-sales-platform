// 🌙 Inside Sales — nightly team-lead digest (per Isaac).
// Fires hourly at :45 (Netlify silently ignores range/list cron), gates
// itself to 7:45pm EASTERN inside, reads the latest RevHawk snapshot from
// storage, and posts the day's Office Staff highlights to Slack:
//   · Most revenue  · Highest MY %  · Highest ACV  · Most subscriptions
//
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and
//      SLACK_TEAMLEAD_WEBHOOK (falls back to SLACK_ADMIN_WEBHOOK).
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, hourCycle: 'h23' }).format(new Date());
  if (Number(et) !== 19) return { statusCode: 200, body: 'not 7:45pm ET — skipped' };

  const hook = process.env.SLACK_TEAMLEAD_WEBHOOK || process.env.SLACK_ADMIN_WEBHOOK;
  if (!hook) return { statusCode: 200, body: 'no Slack webhook configured — skipped' };
  const SUPABASE_URL = process.env.SUPABASE_URL, KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !KEY) return { statusCode: 500, body: 'missing Supabase env' };
  const supabase = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });

  try {
    // Latest snapshot blob (same one the app derives from).
    const { data: files, error: listErr } = await supabase.storage.from('reporting')
      .list('snapshots', { limit: 100, sortBy: { column: 'name', order: 'desc' } });
    if (listErr) throw new Error('list: ' + listErr.message);
    const latest = (files || []).filter(f => /^revhawk-\d+\.json\.gz$/.test(f.name))
      .sort((a, b) => b.name.localeCompare(a.name))[0];
    if (!latest) throw new Error('no snapshot found');
    const { data: blob, error: dlErr } = await supabase.storage.from('reporting').download('snapshots/' + latest.name);
    if (dlErr) throw new Error('download: ' + dlErr.message);
    const payload = JSON.parse(zlib.gunzipSync(Buffer.from(await blob.arrayBuffer())).toString('utf8'));
    const rows = Array.isArray(payload.rawSales) ? payload.rawSales : [];

    // TODAY in Eastern, matched against the mirror's MM/DD/YY sold stamps.
    const now = new Date();
    const fmtET = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: '2-digit', day: '2-digit', year: '2-digit' }).format(now); // MM/DD/YY
    const [mm, dd, yy] = fmtET.split('/');
    const todayKey = mm + '/' + dd + '/' + yy;
    const prettyDay = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric' }).format(now);

    const todays = rows.filter(r => r
      && /office\s*staff/i.test(String(r.repType || ''))
      && String(r.dateSold || '').slice(0, 8) === todayKey);

    if (!todays.length) {
      await post(hook, { text: '🌙 Inside Sales · ' + prettyDay + ' — no Office Staff sales landed in the sync today.' });
      return { statusCode: 200, body: 'posted (empty day)' };
    }

    // Per-rep tallies.
    const byRep = new Map();
    for (const r of todays) {
      const nm = String(r.rep || 'Unknown').trim();
      const t = byRep.get(nm) || { rev: 0, n: 0, multi: 0, twelve: 0 };
      t.rev += Number(r.contractValue) || 0;
      t.n++;
      const cm = Number(r.contract) || 0;
      if (cm >= 18) t.multi++; else if (cm === 12) t.twelve++;
      byRep.set(nm, t);
    }
    const reps = [...byRep.entries()].map(([nm, t]) => ({
      nm, ...t,
      acv: t.n > 0 ? t.rev / t.n : 0,
      myDen: t.multi + t.twelve,
      my: (t.multi + t.twelve) > 0 ? t.multi / (t.multi + t.twelve) : null,
    }));
    const usd = (v) => '$' + Math.round(v).toLocaleString();
    const top = (arr, key) => arr.slice().sort((a, b) => (b[key] || 0) - (a[key] || 0))[0];
    const topRev = top(reps, 'rev');
    const topSubs = top(reps, 'n');
    // MY% + ACV need ≥2 contract sales so a single lucky sale can't take it.
    const eligible = reps.filter(r => r.n >= 2);
    const topAcv = top(eligible.length ? eligible : reps, 'acv');
    const myPool = (eligible.length ? eligible : reps).filter(r => r.my != null);
    const topMy = myPool.slice().sort((a, b) => b.my - a.my)[0];

    const lines = [
      '💰 *Most revenue:* ' + topRev.nm + ' — ' + usd(topRev.rev) + ' (' + topRev.n + ' sub' + (topRev.n === 1 ? '' : 's') + ')',
      topMy ? '📈 *Highest MY %:* ' + topMy.nm + ' — ' + Math.round(topMy.my * 100) + '% (' + topMy.multi + ' of ' + topMy.myDen + ' contracts)' : null,
      '💎 *Highest ACV:* ' + topAcv.nm + ' — ' + usd(topAcv.acv) + ' avg (' + topAcv.n + ' subs)',
      '🧾 *Most subscriptions:* ' + topSubs.nm + ' — ' + topSubs.n,
    ].filter(Boolean);
    const totalRev = reps.reduce((a, r) => a + r.rev, 0);
    const totalSubs = reps.reduce((a, r) => a + r.n, 0);

    await post(hook, {
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: '🌙 Inside Sales — Daily Highlights', emoji: true } },
        { type: 'context', elements: [{ type: 'mrkdwn', text: prettyDay + ' · ' + totalSubs + ' subscriptions · ' + usd(totalRev) + ' total · ' + reps.length + ' sellers' }] },
        { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n') } },
      ],
    });
    return { statusCode: 200, body: 'posted' };
  } catch (e) {
    console.error('[teamlead-digest] failed:', e && e.message || e);
    try { await post(hook, { text: '⚠️ Team-lead digest failed: ' + (e && e.message || e) }); } catch (e2) { /* both down */ }
    return { statusCode: 500, body: String(e && e.message || e) };
  }
};

async function post(hook, body) {
  const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error('Slack returned HTTP ' + res.status);
}
