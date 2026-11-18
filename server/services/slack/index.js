// slack — messages the server sends to people (not the admin job lines; those
// are runtime/slack.js). Today: rep-eod, the end-of-day DM to each Inside
// Sales / Loyalty rep. No HTTP endpoints of its own: the Settings page's
// "Send me a preview" and "Send now" buttons are admin kicks of the job —
// POST /api/jobs/rep-eod?preview=<profile id> and POST /api/jobs/rep-eod?force=1.
import { Router } from 'express';
import repEod from './jobs/rep-eod.js';

export const router = Router();
export const jobs = [repEod];
