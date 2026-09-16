-- ────────────────────────────────────────────────────────────────────────
-- CRM AUTO-VERIFY — every 30-min sync cross-checks recent rep-logged sales
-- against the FieldRoutes warehouse (matched by customer #, subscriptions
-- sold within ±7 days of the logged sold date) and stamps the verdict here:
--   crm_status:          'verified' | 'revenue_mismatch' | 'not_found'
--   crm_contract_value:  the CRM-side contract value it compared against
--   crm_subscription:    the CRM service it matched
--   crm_checked_at:      when the sync last stamped this row
-- The audit queue shows the verdict as a chip so manual auditing collapses
-- to the mismatches and outliers (upsells can legitimately differ).
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.sales add column if not exists crm_status         text;
alter table public.sales add column if not exists crm_contract_value double precision;
alter table public.sales add column if not exists crm_subscription   text;
alter table public.sales add column if not exists crm_checked_at     timestamptz;

create index if not exists sales_crm_status_idx on public.sales (crm_status);
