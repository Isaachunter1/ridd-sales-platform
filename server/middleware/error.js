// Last handler on the stack. Plain-English message out, stack to the log.
export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;
  console.error(JSON.stringify({ severity: 'ERROR', msg: String((err && err.message) || err), path: req.path, stack: (err && err.stack) || '' }));
  if (res.headersSent) return;
  res.status(status).json({ error: String((err && err.message) || err) });
}

export function notFound(req, res) {
  res.status(404).json({ error: 'No such route: ' + req.method + ' ' + req.path });
}
