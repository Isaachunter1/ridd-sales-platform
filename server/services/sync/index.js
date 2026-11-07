// sync — the RevHawk sync worker, ported piece by piece from
// netlify/functions/revhawk-sync-background.js (MIGRATION.md → Backend).
// Today: staging (auto-stage). No HTTP endpoints of its own; an admin re-run
// or a dry run is POST /api/jobs/staging (?dry=1).
import { Router } from 'express';
import staging from './jobs/staging.js';

export const router = Router();
export const jobs = [staging];
