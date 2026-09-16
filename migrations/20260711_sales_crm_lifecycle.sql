-- ── CRM lifecycle columns on sales ─────────────────────────────────────
-- Run once in the Supabase SQL editor. The hourly sync stamps each logged
-- sale with the account's live state from the FieldRoutes warehouse:
--   crm_serviced_at        — date the initial service was completed (null = not yet)
--   crm_completed_services — how many services have run on the subscription
--   crm_days_past_due      — customer's days past due (0 = current)
--   crm_balance            — customer's responsible balance
-- The audit queue renders these as Serviced / Current / Exact-value chips,
-- so auditors only need to verify the signed contract by hand.
alter table public.sales add column if not exists crm_serviced_at date;
alter table public.sales add column if not exists crm_completed_services integer;
alter table public.sales add column if not exists crm_days_past_due integer;
alter table public.sales add column if not exists crm_balance numeric(10,2);
