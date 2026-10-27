// crm — FieldRoutes data quality. Today: Account Integrity (Auditing tab).
// No HTTP endpoints of its own; an admin re-run is POST /api/jobs/account-integrity.
// (ARCHITECTURE.md's crm/ also takes deleted-scan and live-sync when they port.)
import { Router } from 'express';
import accountIntegrity from './jobs/account-integrity.js';

export const router = Router();
export const jobs = [accountIntegrity];
