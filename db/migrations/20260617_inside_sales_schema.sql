-- ────────────────────────────────────────────────────────────────────────
-- INSIDE SALES (MO) TAB SCHEMA ADDITIONS
--
-- 1. sold_date + customer_auto_pay on reporting_subscriptions so revenue
--    can be bucketed by the month it was SOLD (and the committed-sold
--    payment filter can apply), matching the Inside Sales spreadsheet.
-- 2. reporting_is_manual — hand-entered cells for the Inside Sales P&L
--    (projections, wages, incentive costs, call counts). One row per
--    period; period is 'YYYY-MM' for months or 'YYYY' for year totals.
--
-- Re-runnable: every statement uses IF NOT EXISTS / OR REPLACE.
-- After running this, RE-UPLOAD the FieldRoutes Customer Report so
-- sold_date / customer_auto_pay get populated.
-- ────────────────────────────────────────────────────────────────────────

alter table public.reporting_subscriptions
  add column if not exists sold_date date,
  add column if not exists customer_auto_pay text;

create index if not exists reporting_subscriptions_sold_idx
  on public.reporting_subscriptions (sold_date);

create table if not exists public.reporting_is_manual (
  period            text primary key,   -- 'YYYY-MM' or 'YYYY'
  projected_revenue numeric,
  projected_ad_spend numeric,
  projected_wages   numeric,
  wages             numeric,
  incentive_costs   numeric,
  total_calls       integer,
  qualified_calls   integer,
  updated_at        timestamptz default now(),
  updated_by        uuid references auth.users(id)
);

alter table public.reporting_is_manual enable row level security;

drop policy if exists "reporting_is_manual: admin all" on public.reporting_is_manual;
create policy "reporting_is_manual: admin all"
  on public.reporting_is_manual
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.reporting_is_manual to authenticated;
