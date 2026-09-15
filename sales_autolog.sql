-- sales_autolog.sql — re-runnable. Run once in the Supabase SQL editor.
--
-- Auto-logged sales (per Isaac, Sep 2026): nobody logs a sale by hand any
-- more. The hourly RevHawk sync creates one `sales` row per FieldRoutes
-- subscription sold by a linked rep — Inside Sales, D2D and Technicians —
-- and moves it through Upfront → Pending Backend Lock → Archived / History
-- from the account's live CRM state. The manual Log Sale form stays for
-- upsells only.
--
--   queue_type           which Sales tab the row belongs to: 'office' | 'd2d' | 'tech'
--                        (NULL = legacy manual rows → treated as 'office')
--   crm_subscription_id  the FieldRoutes subscription the row was born from
--                        (unique: one row per subscription, reruns idempotent)
--   app_settings.autolog the switches — edited in Settings → Configurations

alter table public.sales add column if not exists queue_type text;
alter table public.sales add column if not exists crm_subscription_id text;
create unique index if not exists sales_crm_subscription_uidx
  on public.sales (crm_subscription_id) where crm_subscription_id is not null;
create index if not exists sales_queue_type_idx on public.sales (queue_type);

insert into public.app_settings (key, value) values ('autolog', '{
  "enabled": true,
  "start": "2026-01-01",
  "types": ["Office Staff", "Sales Rep", "Technician"],
  "auto_approve": true,
  "lock_days": 90,
  "lock_min_services": 2
}'::jsonb)
on conflict (key) do nothing;
