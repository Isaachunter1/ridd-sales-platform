// marketing — what the Marketing tab needs computed on the server. Today:
// ltv-cohorts (nightly LTV cohorts from the RevHawk mirror → marketing/ltv.json).
// Spend, leads and CAC stay where they are (QuickBooks upload + GHL file, read
// under RLS); an admin re-run is POST /api/jobs/ltv-cohorts.
import { Router } from 'express';
import ltvCohorts from './jobs/ltv-cohorts.js';

export const router = Router();
export const jobs = [ltvCohorts];
