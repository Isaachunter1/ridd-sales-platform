// pay — commission rules that run on the server. Today: pricing-floors (the
// Standard / Loyalty floors + the signed-contract rule → sales.audit_status).
// No HTTP endpoints of its own; an admin re-run is POST /api/jobs/pricing-floors.
import { Router } from 'express';
import pricingFloors from './jobs/pricing-floors.js';
import plaibookCloseRates from './jobs/plaibook-close-rates.js';

export const router = Router();
export const jobs = [pricingFloors, plaibookCloseRates];
