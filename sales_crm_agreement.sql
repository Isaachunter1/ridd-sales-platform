-- ── Signed-agreement columns on sales ──────────────────────────────────
-- Run once in the Supabase SQL editor. The sync (revhawk-sync-background)
-- stamps each logged sale with the FieldRoutes e-sign document state pulled
-- from the FieldRoutesContract warehouse table:
--   crm_contract_state     — 'signed' | 'sent' (e-sign out, not signed) | 'none'
--   crm_contract_signed_at — date the document was COMPLETED (null unless signed)
-- Matched by subscription id first, then by customer (a document signed on/
-- after the day the subscription was added). The audit queue renders these
-- as a Signed / Sent / No agreement chip next to Serviced + Paid.
alter table public.sales add column if not exists crm_contract_state text;
alter table public.sales add column if not exists crm_contract_signed_at date;
