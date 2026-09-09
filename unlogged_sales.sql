-- ── Unlogged sales ("ghost" rows a rep can claim) ───────────────────────
-- Run once in the Supabase SQL editor. The sync (revhawk-sync-background)
-- finds FieldRoutes subscriptions that are (a) sold by an inside-sales rep
-- with an app account, (b) e-signed (FieldRoutesContract COMPLETED), and
-- (c) NOT logged in the app — and writes one row here per subscription.
-- The rep's Sales log shows them ghosted with a Claim button; claiming
-- opens the normal Log Sale form pre-filled, and the resulting sale goes
-- through audit like any other. "Not mine" dismisses the row (admins can
-- still see dismissed rows).
create table if not exists public.unlogged_sales (
  id               bigserial primary key,
  rep_id           uuid not null references public.profiles(id) on delete cascade,
  customer_number  text not null,
  customer_name    text,
  office_name      text,
  crm_subscription text not null,
  subscription_source text,
  contract_months  integer,
  initial_amount   numeric(10,2),
  monthly_amount   numeric(10,2),
  revenue_amount   numeric(10,2),
  sold_date        date not null,
  contract_signed_at date,
  status           text not null default 'open',   -- open | claimed | dismissed | logged
  sale_id          bigint references public.sales(id) on delete set null,
  resolved_at      timestamptz,
  resolved_by      uuid references public.profiles(id),
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  unique (customer_number, crm_subscription, sold_date)
);
create index if not exists unlogged_sales_rep_status on public.unlogged_sales (rep_id, status);

alter table public.unlogged_sales enable row level security;
-- Reps read their own ghosts; admins/auditors read everything.
create policy "unlogged read: own or admin/auditor"
  on public.unlogged_sales for select to authenticated
  using (rep_id = auth.uid() or public.caller_role() in ('admin', 'admin_rep', 'auditor'));
-- Reps may only resolve their own rows (claim / dismiss); rows are created
-- by the sync (service role bypasses RLS).
create policy "unlogged update: own or admin/auditor"
  on public.unlogged_sales for update to authenticated
  using (rep_id = auth.uid() or public.caller_role() in ('admin', 'admin_rep', 'auditor'));
