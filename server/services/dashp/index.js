// dashp — read-only pass-through to the DASHP commission API (technician and
// d2d commission results, computed on a separate platform and refreshed hourly).
//
//   GET /api/dashp/status                      is it connected? (admin)
//   GET /api/dashp/technician-commissions      ?year=
//   GET /api/dashp/technician-commission       ?employee_id=&year=&quarter=
//   GET /api/dashp/d2d-commissions             ?year=&type=
//   GET /api/dashp/d2d-commission              ?employee_id=&year=&type=
//   GET /api/dashp/company-summary             ?year=&type=&compare_type=
//
// It lives on the server because the DASHP key is a secret (CLAUDE.md → "an
// HTTP endpoint that needs a secret"). Admins only. The answer is DASHP's own
// status and JSON envelope, unchanged — this file adds the key and nothing
// else, so the app's screens are written against DASHP's documented shapes.
// No jobs: nothing is stored here.
import { Router } from 'express';
import env from '../../config/env.js';
import { requireRole, ADMIN_ROLES } from '../../middleware/auth.js';
import { createDashpClient } from './functions/dashpClient.js';

const client = createDashpClient({ baseUrl: env.DASHP_API_URL, token: env.DASHP_API_TOKEN });

export const router = Router();
export const jobs = [];

router.get('/dashp/status', requireRole(ADMIN_ROLES), async (_req, res, next) => {
  try {
    res.set('cache-control', 'no-store');
    res.json(await client.status());
  } catch (e) { next(e); }
});

router.get('/dashp/:route', requireRole(ADMIN_ROLES), async (req, res, next) => {
  try {
    const r = await client.get(req.params.route, req.query);
    res.set('cache-control', 'no-store');          // commission figures: never cached by a browser or proxy
    res.set('x-dashp-cache', r.cache);
    if (r.retryAfter) res.set('retry-after', r.retryAfter);
    res.status(r.status).json(r.body);
  } catch (e) { next(e); }
});