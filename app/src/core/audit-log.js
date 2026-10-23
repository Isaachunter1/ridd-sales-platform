// ──────────────────────────────────────────────────────────────────────────
// Audit log — records every status change so there's a paper trail
// ──────────────────────────────────────────────────────────────────────────
function logActivity(action, details = {}) {
  if (!state.auditLog) state.auditLog = [];
  state.auditLog.unshift({
    timestamp: new Date().toISOString(),
    action,
    sale_id: details.sale_id || null,
    customer_name: details.customer_name || null,
    old_status: details.old_status || null,
    new_status: details.new_status || null,
    by_user: state.profile?.full_name || 'system',
    rep_name: details.rep_name || null,
    detail: details.detail || null,
  });
  // Keep up to last 1000 entries — bigger history so the Backup search bar
  // can find old movements across many sales without losing context.
  if (state.auditLog.length > 1000) state.auditLog.length = 1000;
}

