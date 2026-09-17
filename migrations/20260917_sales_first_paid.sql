-- 20260917_sales_first_paid.sql — re-runnable. Paste into the Supabase SQL editor.
--
-- Commissionable-date rule (per Isaac, Sep 17 2026):
--   · Charged upfront  → commissionable on the sale date (unless it pre-service cancels)
--   · Not charged      → commissionable on the LATER of the initial completed service
--                        and the first payment received
-- The sync stamps the first successful FieldRoutes payment on/after the sale
-- here; the app derives the date from this + crm_serviced_at + upfront_collected.
alter table public.sales add column if not exists crm_first_paid_at date;   -- first successful payment (status 1, applied > 0) on/after the sale
comment on column public.sales.crm_first_paid_at is 'FieldRoutes: first successful payment on/after sold_date (stamped hourly by the RevHawk sync)';
notify pgrst, 'reload schema';
