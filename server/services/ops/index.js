// ops — Operations / technician stats for the Reporting tab.
// No HTTP endpoints of its own; "Refresh now" is POST /api/jobs/ops-stats.
import { Router } from 'express';
import opsStats from './jobs/ops-stats.js';

export const router = Router();
export const jobs = [opsStats];
