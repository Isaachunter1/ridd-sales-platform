-- 20260921_sales_initial_appt.sql — re-runnable. Paste into the Supabase SQL editor.
-- Service date on the Sales queues (per Isaac): the SCHEDULED date of the
-- subscription's initial appointment in FieldRoutes, stamped by the sync.
-- The completed date already lives in crm_serviced_at.
alter table public.sales add column if not exists crm_initial_appt_at date;
comment on column public.sales.crm_initial_appt_at is 'FieldRoutes: scheduled date of the initial appointment (stamped by the RevHawk sync)';
notify pgrst, 'reload schema';
