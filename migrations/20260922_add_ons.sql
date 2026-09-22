-- 20260922_add_ons.sql — re-runnable. Paste into the Supabase SQL editor.
-- ────────────────────────────────────────────────────────────────────────
-- Add-ons (technician / office upsells, per Isaac + COO, Sep 2026).
--
-- RIDD is consolidating 200+ service types down to < 25 and selling
-- everything else as an ADD-ON: a ticket item on the customer's invoice in
-- FieldRoutes, credited to the employee who sold it. This table is the app's
-- record of one add-on on one subscription and its life through time:
--
--   added_at ──▶ upfront commissionable ──▶ 5 paid invoices (streak) ──▶ locked
--                (serviced appt / paid inv.)   ON or after added_at,          backend
--                                              add-on still on each one      payable
--
-- One add-on = one (subscription, add-on service) pair. The same add-on can
-- be charged separately on the initial ticket and on the recurring tickets;
-- those are the same row here (initial_amount / recurring_amount), not two.
--
-- Written by the sync workers (service role). Reps read their own rows,
-- admins read all. No pay math lives here — the streak is the fact, the
-- Pay tab decides what it is worth.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.add_ons (
  id                    bigserial primary key,
  -- identity (FieldRoutes)
  customer_id           text not null,
  subscription_id       text not null,
  office_fr_id          text,
  service_id            text,                       -- FieldRoutes serviceID / productID of the add-on item
  service_name          text not null,              -- as it reads on the ticket item
  -- who sold it (per line item in FieldRoutes)
  credited_employee_id  text,                       -- FieldRoutes employeeID on the ticket item
  credited_profile_id   uuid references public.profiles (id) on delete set null,
  credited_role         text,                       -- 'technician' | 'office_staff' | 'sales_rep' (CRM type at the time)
  -- when / how much
  added_at              date not null,              -- date the add-on first appeared on a ticket
  initial_amount        numeric(10,2) not null default 0,   -- charged on the initial ticket (may be 0)
  recurring_amount      numeric(10,2) not null default 0,   -- per recurring ticket
  initial_ticket_id     text,
  first_recurring_ticket_id text,
  item_ids              text[] not null default '{}',       -- every FieldRoutes ticketItem id folded into this add-on
  -- link to the pay pipeline
  sale_id               bigint references public.sales (id) on delete set null,
  -- invoice streak (reconciled from tickets = invoices)
  invoices_paid         int not null default 0,     -- qualifying paid invoices so far (0–5)
  invoices              jsonb not null default '[]'::jsonb,  -- [{ticket_id, invoice_date, paid_at, amount, has_add_on}] in date order
  streak_status         text not null default 'accruing'
                        check (streak_status in ('accruing', 'locked', 'broken', 'clawback', 'cancelled')),
  locked_at             date,                       -- 5th qualifying invoice paid
  broke_at              date,
  break_reason          text,                       -- 'item_removed' | 'subscription_cancelled' | 'unpaid' | …
  -- payout stamps (written by the pay runs, never by the sync)
  upfront_eligible_at   date,                       -- serviced appt (tech) or paid invoice with the add-on (office)
  upfront_paid_at       date,
  backend_paid_at       date,
  clawback_at           date,
  -- bookkeeping
  source                text not null default 'fieldroutes',   -- 'fieldroutes' | 'import' (old platform)
  last_reconciled_at    timestamptz,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (subscription_id, service_name)
);
create index if not exists add_ons_credited_idx on public.add_ons (credited_profile_id, streak_status);
create index if not exists add_ons_customer_idx on public.add_ons (customer_id);
create index if not exists add_ons_status_idx on public.add_ons (streak_status, last_reconciled_at);

alter table public.add_ons enable row level security;
drop policy if exists "add_ons: read own or admin" on public.add_ons;
create policy "add_ons: read own or admin" on public.add_ons
  for select to authenticated using (credited_profile_id = auth.uid() or public.is_admin());
drop policy if exists "add_ons: admin write" on public.add_ons;
create policy "add_ons: admin write" on public.add_ons
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- The sale row an add-on created points back at it (the queues render the
-- "N of 5 paid" chip off this).
alter table public.sales add column if not exists add_on_id bigint references public.add_ons (id) on delete set null;
create index if not exists sales_add_on_idx on public.sales (add_on_id) where add_on_id is not null;

comment on table public.add_ons is 'One add-on (ticket item) on one subscription, tracked through 5 paid invoices for backend pay';
notify pgrst, 'reload schema';

-- ────────────────────────────────────────────────────────────────────────
-- Technician pay ledger (from the old platform's Sales Commissions /
-- Overrides tabs, Sep 2026). Every dollar a quarter pays or takes back is a
-- ROW here, so a quarter can be re-opened and reproduced:
--   commission        25% of qualified contract value (rep)
--   upfront_advance   the $50 paid per job on the pay period it was serviced
--   clawback          job stopped qualifying (not active / has balance /
--                     cancelled) after it was paid → −rate × CV
--   reverse_clawback  job re-qualified later ("Now serviced") → +rate × CV
--   manual            an admin adjustment with a reason
--   override*         the manager's 5% on the same events (override_commission,
--                     override_clawback, override_reverse), scoped by
--                     tech_override_scopes below
-- Applies to EVERY technician sale (personal subscriptions and add-ons),
-- not only add_ons rows: sale_id is the join; add_on_id is set when the
-- sale came from an add-on. Append-only. Pay math itself is not here yet —
-- the table exists so the build lands on a stable shape.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.tech_pay_ledger (
  id              bigserial primary key,
  profile_id      uuid not null references public.profiles (id) on delete cascade,   -- who is paid / charged
  sale_id         bigint references public.sales (id) on delete set null,
  add_on_id       bigint references public.add_ons (id) on delete set null,
  pay_year        int not null,
  pay_quarter     int not null check (pay_quarter between 1 and 4),
  kind            text not null check (kind in ('commission', 'upfront_advance', 'clawback', 'reverse_clawback', 'manual',
                                                'override_commission', 'override_clawback', 'override_reverse')),
  amount          numeric(10,2) not null,             -- signed: clawbacks negative
  rate            numeric(6,4),                        -- 0.25 / 0.05 at the time
  contract_value  numeric(10,2),
  reason          text,                                -- 'Not active' | 'Has balance' | 'Canceled — reverted' | 'Now serviced' | free text for manual
  snapshot        jsonb not null default '{}'::jsonb,  -- {serviced, active, autopay, balance, audit} as judged when the row was written
  run_id          bigint,                              -- pay_runs.id when a run wrote it
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists tech_pay_ledger_q_idx on public.tech_pay_ledger (profile_id, pay_year, pay_quarter, kind);
create index if not exists tech_pay_ledger_sale_idx on public.tech_pay_ledger (sale_id);
alter table public.tech_pay_ledger enable row level security;
drop policy if exists "tech ledger: read own or admin" on public.tech_pay_ledger;
create policy "tech ledger: read own or admin" on public.tech_pay_ledger
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());
drop policy if exists "tech ledger: admin insert" on public.tech_pay_ledger;
create policy "tech ledger: admin insert" on public.tech_pay_ledger
  for insert to authenticated with check (public.is_admin());

-- Who earns an override on whose sales: a manager's rate over a set of
-- branches (and, optionally, seller types), excluding their own sales.
create table if not exists public.tech_override_scopes (
  id              bigserial primary key,
  profile_id      uuid not null references public.profiles (id) on delete cascade,
  rate            numeric(6,4) not null default 0.05,
  office_ids      bigint[] not null default '{}',     -- app offices; empty = every office
  seller_roles    text[] not null default '{technician}',
  label           text,                               -- 'Technician Sales'
  active          boolean not null default true,
  starts_on       date,
  ends_on         date,
  created_at      timestamptz not null default now()
);
alter table public.tech_override_scopes enable row level security;
drop policy if exists "override scopes: read own or admin" on public.tech_override_scopes;
create policy "override scopes: read own or admin" on public.tech_override_scopes
  for select to authenticated using (profile_id = auth.uid() or public.is_admin());
drop policy if exists "override scopes: admin write" on public.tech_override_scopes;
create policy "override scopes: admin write" on public.tech_override_scopes
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Quarter lock (the old platform: "These lock each quarter, subject to
-- RIDD's audit"). One row per closed quarter; while absent the quarter is open.
create table if not exists public.tech_pay_quarters (
  pay_year        int not null,
  pay_quarter     int not null check (pay_quarter between 1 and 4),
  locked_at       timestamptz,
  locked_by       uuid,
  note            text,
  primary key (pay_year, pay_quarter)
);
alter table public.tech_pay_quarters enable row level security;
drop policy if exists "tech quarters: read all" on public.tech_pay_quarters;
create policy "tech quarters: read all" on public.tech_pay_quarters for select to authenticated using (true);
drop policy if exists "tech quarters: admin write" on public.tech_pay_quarters;
create policy "tech quarters: admin write" on public.tech_pay_quarters
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
notify pgrst, 'reload schema';
