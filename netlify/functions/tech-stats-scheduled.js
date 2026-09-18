// Hourly kick for the technician route-stats worker (schedule in netlify.toml).
exports.handler = async () => {
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, hourCycle: 'h23' }).format(new Date()));
  if (!(etHour >= 6 && etHour <= 23)) return { statusCode: 200, body: 'overnight — skipped' };
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  const res = await fetch(base + '/.netlify/functions/tech-stats-background', { method: 'POST' });
  return { statusCode: 200, body: 'kick -> HTTP ' + res.status };
};
