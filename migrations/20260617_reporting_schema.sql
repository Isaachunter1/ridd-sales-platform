-- ────────────────────────────────────────────────────────────────────────
-- REPORTING TAB SCHEMA
--
-- Three tables back the new admin-only Reporting tab:
--
--   reporting_uploads          — one row per CSV upload (snapshot metadata)
--   reporting_subscriptions    — subscription rows belonging to an upload
--   reporting_service_config   — per-service-type recurring/category/hidden
--
-- Each CSV upload is an "all-time" snapshot — uploads are appended (not
-- merged) so the admin can compare metrics across snapshot dates. Subscription
-- rows cascade-delete when an upload is removed.
--
-- Service config is global (not per-upload) — the same service name means
-- the same thing across snapshots. New service names found in an upload
-- get auto-seeded as non-recurring/non-hidden so the admin can mark them up.
--
-- Re-runnable: every statement uses IF NOT EXISTS / OR REPLACE.
-- ────────────────────────────────────────────────────────────────────────

-- Snapshot envelope — one row per CSV upload.
create table if not exists public.reporting_uploads (
  id           uuid primary key default gen_random_uuid(),
  uploaded_at  timestamptz not null default now(),
  uploaded_by  uuid references auth.users(id),
  filename     text,
  row_count    integer not null default 0,
  notes        text
);

-- Subscription rows from a snapshot. Cascade on upload delete so a bad
-- upload can be cleared without leaving orphans.
create table if not exists public.reporting_subscriptions (
  id           bigserial primary key,
  upload_id    uuid not null references public.reporting_uploads(id) on delete cascade,
  -- Identity
  customer_id                 text,
  last_name                   text,
  first_name                  text,
  -- Money
  annual_recurring_value      numeric,
  subscription_contract_value numeric,
  initial_price               numeric,
  -- Sales attribution
  sold_by_id                  text,
  sold_by                     text,
  sold_by_type                text,
  -- Service info
  subscription                          text,    -- maps to reporting_service_config.service_name
  subscription_status                   text,
  subscription_cancellation_reason      text,
  subscription_date_canceled            date,
  initial_service                       date,
  subscription_completed_services       integer,
  subscription_source                   text,
  recurring_frequency                   text,
  agreement_length                      integer,
  -- Location
  county        text,
  country       text,
  state         text,
  zip_code      text,
  office_name   text,
  -- Misc
  days_past_due integer
);
create index if not exists reporting_subscriptions_upload_idx
  on public.reporting_subscriptions (upload_id);
create index if not exists reporting_subscriptions_initial_idx
  on public.reporting_subscriptions (initial_service);
create index if not exists reporting_subscriptions_cancel_idx
  on public.reporting_subscriptions (subscription_date_canceled);
create index if not exists reporting_subscriptions_sub_idx
  on public.reporting_subscriptions (subscription);

-- Per-service-type configuration. Drives churn/retention exclusion
-- rules (only is_recurring=true counts against churn) and the "hidden"
-- tag in the Service Type Configuration table.
create table if not exists public.reporting_service_config (
  service_name  text primary key,
  category      text,
  is_recurring  boolean not null default false,
  is_hidden     boolean not null default false,
  updated_at    timestamptz default now(),
  updated_by    uuid references auth.users(id)
);

-- Admin-only RLS on all three. Unlike the rest of the app where reads
-- are broad and writes are gated, reporting data is company-wide
-- financials — admins only on both sides.
alter table public.reporting_uploads          enable row level security;
alter table public.reporting_subscriptions    enable row level security;
alter table public.reporting_service_config   enable row level security;

drop policy if exists "reporting_uploads: admin all"          on public.reporting_uploads;
drop policy if exists "reporting_subscriptions: admin all"    on public.reporting_subscriptions;
drop policy if exists "reporting_service_config: admin all"   on public.reporting_service_config;

create policy "reporting_uploads: admin all"
  on public.reporting_uploads
  for all using (public.is_admin()) with check (public.is_admin());

create policy "reporting_subscriptions: admin all"
  on public.reporting_subscriptions
  for all using (public.is_admin()) with check (public.is_admin());

create policy "reporting_service_config: admin all"
  on public.reporting_service_config
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.reporting_uploads          to authenticated;
grant select, insert, update, delete on public.reporting_subscriptions    to authenticated;
grant select, insert, update, delete on public.reporting_service_config   to authenticated;
grant usage, select on sequence public.reporting_subscriptions_id_seq     to authenticated;
