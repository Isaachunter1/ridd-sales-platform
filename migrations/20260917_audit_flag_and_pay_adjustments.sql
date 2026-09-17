-- 1) Office audit state from FieldRoutes customer flags (Passed Audit /
--    Failed Audit), stamped on every CRM-origin sale each sync. 'failed' holds
--    auto-approval until the office re-flags the account.
alter table public.sales add column if not exists crm_audit text;

-- 2) Per-pay-period "Other Pay" lines (bonuses, competition winnings, etc.)
--    entered by an admin on the Pay tab. Replaces the static profile amount.
create table if not exists public.pay_adjustments (
  id bigserial primary key,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  period_year integer not null,
  period_id integer not null,
  amount numeric not null,
  label text not null default '',
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);
create index if not exists pay_adjustments_rep_period_idx on public.pay_adjustments (rep_id, period_year, period_id);
alter table public.pay_adjustments enable row level security;
create policy "pay_adjustments: own read" on public.pay_adjustments for select to authenticated using (rep_id = auth.uid() or public.is_admin());
create policy "pay_adjustments: admin write" on public.pay_adjustments for all to authenticated using (public.is_admin()) with check (public.is_admin());

insert into public.schema_migrations (name) values ('20260917_audit_flag_and_pay_adjustments.sql') on conflict do nothing;
