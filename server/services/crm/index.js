// crm — FieldRoutes data quality and the few FieldRoutes reads that need the
// BigQuery credential. Jobs: Account Integrity (Auditing tab); an admin re-run
// is POST /api/jobs/account-integrity. Endpoint: POST /api/crm/customer-notes
// (per Isaac, Nov 18) — general + cancellation notes for a list of customers,
// for the Sales export so reps can see what is going on with an account.
// (ARCHITECTURE.md's crm/ also takes deleted-scan and live-sync when they port.)
import { Router } from 'express';
import accountIntegrity from './jobs/account-integrity.js';
import { requireRole } from '../../middleware/auth.js';
import { fetchCustomerNotes } from './functions/fetchCustomerNotes.js';

export const router = Router();
// Any signed-in, non-disabled user: the notes come back only for the ids the screen already shows (RLS decided
// those). Body { customer_ids: [..] } → { notes: { <cid>: { general: [{d, type, who, text}], cancel: [{d, type, who, reason, text}] } } }.
router.post('/crm/customer-notes', requireRole(), async (req, res, next) => {
  try {
    const out = await fetchCustomerNotes(Array.isArray(req.body && req.body.customer_ids) ? req.body.customer_ids : []);
    res.json(out);
  } catch (e) { if (e && e.status === 400) return res.status(400).json({ error: e.message }); next(e); }
});
export const jobs = [accountIntegrity];
