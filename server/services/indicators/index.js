// indicators — the shared Indicators dataset and its derived tables.
// No HTTP endpoints of its own; an admin re-run is POST /api/jobs/indicators-derive.
import { Router } from 'express';
import derive from './jobs/derive.js';

export const router = Router();
export const jobs = [derive];
