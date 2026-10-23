-- ────────────────────────────────────────────────────────────────────────
-- LEAD-SOURCE REPORTING CONFIG
--
-- Lets the Configurations tab exclude lead sources from ALL snapshot-based
-- reporting (Overview, Geographic, Rep Performance, Waterfall, Inside Sales).
-- A source with included = false (e.g. Miscellaneous) is filtered out of the
-- shared `visible` set, so every tab drops it at once. Sources not present
-- here default to included (true). The Marketing tab uses a separate data
-- source and is unaffected.
--
-- Admin-only via the same is_admin() policy used by the rest of reporting.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.reporting_source_config (
  source     text primary key,
  included   boolean not null default true,
  updated_at timestamptz default now(),
  updated_by uuid references auth.users(id)
);

-- Revenue classification per source: 'new' | 'renewal' | 'upsell'. NULL = follow
-- the name-based default in-app (…Renewal…→renewal, …Upsell…→upsell, else new).
-- Drives how the Inside Sales pace and P&L count each source's revenue.
alter table public.reporting_source_config
  add column if not exists revenue_class text;

alter table public.reporting_source_config enable row level security;

drop policy if exists "reporting_source_config: admin all" on public.reporting_source_config;
create policy "reporting_source_config: admin all"
  on public.reporting_source_config
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.reporting_source_config to authenticated;
