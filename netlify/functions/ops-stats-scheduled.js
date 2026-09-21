// Kick for the operations weekly-stats worker (schedule in netlify.toml).
exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  const res = await fetch(base + '/.netlify/functions/ops-stats-background', { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } });
  return { statusCode: 200, body: 'kick -> HTTP ' + res.status };
};
