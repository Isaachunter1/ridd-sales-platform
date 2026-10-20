// X-API-TOKEN gate — what Cloud Scheduler sends on every /jobs/<name> POST.
// Replaces netlify/lib/sync-gate.js (x-sync-secret). Unlike the old gate it
// is NEVER open: API_TOKEN is required at boot (config/env.js).
import crypto from 'node:crypto';
import env from '../config/env.js';

function safeEqual(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function hasApiToken(req) {
  return safeEqual(req.get('x-api-token'), env.API_TOKEN);
}

export function requireApiToken(req, res, next) {
  if (!hasApiToken(req)) return res.status(401).json({ error: 'unauthorized' });
  req.caller = { kind: 'scheduler' };
  next();
}
