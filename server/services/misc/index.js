// misc — endpoints that belong to no single domain.
// Today: GET /api/sync-status. Later (per the HTTP inventory): feedback,
// client-error, integrations-admin, ask-data.
import { Router } from 'express';
import { syncStatus } from './functions/syncStatus.js';

export const router = Router();
export const jobs = [];

// NOTE: open on purpose, exactly like the Netlify function it replaces — the
// app's health sheet calls it without an Authorization header (src/10-core.js
// openHealthSheet). It returns timestamps only. Adding requireRole() here is a
// behaviour change and belongs to a later commit that also updates the caller.
router.get('/sync-status', async (_req, res, next) => {
  try {
    res.set('cache-control', 'no-store');
    res.json(await syncStatus());
  } catch (e) { next(e); }
});
