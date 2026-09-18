// Nightly kick for the deleted-in-FieldRoutes scan (schedule in netlify.toml).
exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  const res = await fetch(base + '/.netlify/functions/crm-deleted-scan-background', { method: 'POST' });
  return { statusCode: 200, body: 'kick -> HTTP ' + res.status };
};
