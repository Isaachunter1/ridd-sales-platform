// One structured line per request — Cloud Logging parses JSON stdout into
// fields, so `jsonPayload.path="/jobs/ops-stats"` is a usable filter.
export function requestLog(req, res, next) {
  const t0 = Date.now();
  res.on('finish', () => {
    if (req.path === '/healthz') return;
    console.log(JSON.stringify({
      severity: res.statusCode >= 500 ? 'ERROR' : 'INFO',
      msg: 'http', method: req.method, path: req.path, status: res.statusCode,
      ms: Date.now() - t0, caller: (req.caller && req.caller.kind) || 'anon',
    }));
  });
  next();
}

// Job-scoped logger handed to every job as ctx.log. Every line carries the
// job name so `jsonPayload.job="ops-stats"` is the whole story of one run.
export function jobLogger(job, runId) {
  const emit = (severity, msg, extra) => console.log(JSON.stringify({ severity, job, runId, msg, ...(extra || {}) }));
  return {
    info: (msg, extra) => emit('INFO', msg, extra),
    warn: (msg, extra) => emit('WARNING', msg, extra),
    error: (msg, extra) => emit('ERROR', msg, extra),
  };
}
