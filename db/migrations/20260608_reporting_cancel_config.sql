-- ────────────────────────────────────────────────────────────────────────
-- CANCELLATION-REASON ATTRITION CONFIG
--
-- Lets the Configurations tab decide which cancellation reasons count as
-- real attrition. A reason with counts_attrition = false is excluded from
-- churn EVERYWHERE — the Overview cancel count + rate AND the Geographic
-- attrition map. Reasons not present here default to counting (true).
--
-- Admin-only via the same is_admin() policy used by the rest of reporting.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.reporting_cancel_config (
  reason           text primary key,
  counts_attrition boolean not null default true,
  updated_at       timestamptz default now(),
  updated_by       uuid references auth.users(id)
);

alter table public.reporting_cancel_config enable row level security;

drop policy if exists "reporting_cancel_config: admin all" on public.reporting_cancel_config;
create policy "reporting_cancel_config: admin all"
  on public.reporting_cancel_config
  for all using (public.is_admin()) with check (public.is_admin());

grant select, insert, update, delete on public.reporting_cancel_config to authenticated;
