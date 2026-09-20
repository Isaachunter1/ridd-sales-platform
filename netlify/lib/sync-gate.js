// Shared-secret gate for background workers (P0-1 in AUDIT.md). Every
// worker that spends CRM / BigQuery quota checks this first so an anonymous
// POST to its URL does nothing. The scheduled kickers pass the same secret.
// Skipped (open) only when REVHAWK_SYNC_SECRET is not configured, so a
// fresh environment still works — set the env var in production.
function requireSyncSecret(event) {
  const need = process.env.REVHAWK_SYNC_SECRET;
  if (!need) return null;
  const h = (event && event.headers) || {};
  const got = h['x-sync-secret'] || h['X-Sync-Secret'] || '';
  if (got !== need) return { statusCode: 401, body: 'unauthorized' };
  return null;
}
module.exports = { requireSyncSecret };
