// Add-ons (per Isaac + COO, Sep 2026). Every 15 min in selling hours: pull
// new FieldRoutes ticket items into add_ons; once a night (~3am ET) run the
// invoice reconcile that advances / locks / breaks each add-on's 5-invoice
// streak. Schedule lives in netlify.toml [functions."addons-scheduled"].
exports.handler = async () => {
  if (!process.env.FIELDROUTES_AUTH_KEY) return { statusCode: 200, body: 'fieldroutes env not set — skipped' };
  const et = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: 'numeric', hour12: false, hourCycle: 'h23' }).formatToParts(new Date());
  const hour = Number(et.find(p => p.type === 'hour').value), minute = Number(et.find(p => p.type === 'minute').value);
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  const kick = async (fn) => { try { const res = await fetch(base + '/.netlify/functions/' + fn, { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } }); console.log('[addons-scheduled] ' + fn + ' -> HTTP', res.status); } catch (e) { console.error('[addons-scheduled] ' + fn + ' failed', e); } };
  if (hour >= 7 && hour <= 23) await kick('fieldroutes-addons-sync-background');
  if (hour === 3 && minute < 15) await kick('addon-reconcile-background');
  return { statusCode: 200, body: 'kicked' };
};
