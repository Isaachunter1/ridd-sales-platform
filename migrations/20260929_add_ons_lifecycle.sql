-- 20260929_add_ons_lifecycle.sql — re-runnable. Paste into the Supabase SQL editor
-- (after 20260922_add_ons.sql).
-- Add-on lifecycle (per Isaac, Sep 29): add-ons live as line items on the
-- subscription's RECURRING ticket (FieldRoutes templateType 'R'). The sync
-- now reads those tickets directly and records when each add-on appeared,
-- who it is credited to, when it disappeared (item removed or subscription
-- cancelled), and the base plan it sits on.
alter table public.add_ons add column if not exists recurring_ticket_id text;
alter table public.add_ons add column if not exists base_service text;          -- the subscription's service type (the base plan)
alter table public.add_ons add column if not exists last_seen_at timestamptz;   -- last sweep that found the item on the recurring ticket
alter table public.add_ons add column if not exists removed_at date;            -- item gone from the recurring ticket, or subscription cancelled
alter table public.add_ons add column if not exists removed_reason text;        -- 'item_removed' | 'subscription_cancelled'
create index if not exists add_ons_open_idx on public.add_ons (subscription_id) where removed_at is null;

-- Revenue credit by account (per Isaac, Sep 29): one row per subscription,
-- its FieldRoutes contract value split into lines — base plan, service fees,
-- and each add-on with the user it is credited to — so the app can show the
-- TOTAL revenue on the account and the piece the sales rep gets credit for
-- (total − service fees − add-ons credited to someone else).
-- Written by fieldroutes-addons-sync-background (service role).
create table if not exists public.subscription_revenue (
  subscription_id        text primary key,
  customer_id            text not null,
  base_service           text,
  sold_by_employee_id    text,
  sold_by_profile_id     uuid references public.profiles (id) on delete set null,
  contract_value         numeric(12,2) not null default 0,   -- FieldRoutes contract value (incl. initial)
  recurring_services     numeric(8,2),                       -- services the contract covers after the initial
  base_value             numeric(12,2) not null default 0,   -- initial charge + base recurring charge × services
  fee_value              numeric(12,2) not null default 0,   -- service fees / tax / discounts (never commissionable)
  addon_own_value        numeric(12,2) not null default 0,   -- add-ons credited to the same person as the base plan
  addon_other_value      numeric(12,2) not null default 0,   -- add-ons credited to someone else
  commissionable_value   numeric(12,2) not null default 0,   -- base_value + addon_own_value
  lines                  jsonb not null default '[]'::jsonb, -- [{name, kind: base|fee|addon, per_service, value, credited_employee_id, credited_profile_id}]
  active                 boolean not null default true,
  updated_at             timestamptz not null default now()
);
create index if not exists subscription_revenue_rep_idx on public.subscription_revenue (sold_by_profile_id);
alter table public.subscription_revenue enable row level security;
drop policy if exists "sub revenue: read own or admin" on public.subscription_revenue;
create policy "sub revenue: read own or admin" on public.subscription_revenue
  for select to authenticated using (sold_by_profile_id = auth.uid() or public.is_admin()
    or exists (select 1 from jsonb_array_elements(lines) l where l->>'credited_profile_id' = auth.uid()::text));
notify pgrst, 'reload schema';

-- Service fees are never credited to anyone (per Isaac, Sep 29). The sync
-- records any fee line that IS credited so Auditing can list them to fix.
alter table public.subscription_revenue add column if not exists fee_credited_count int not null default 0;
alter table public.subscription_revenue add column if not exists fee_credited_employee_ids text[] not null default '{}';
create index if not exists subscription_revenue_fee_credited_idx on public.subscription_revenue (fee_credited_count) where fee_credited_count > 0;
notify pgrst, 'reload schema';

-- One row per rep per account (per Isaac, Sep 29): the base sale row carries
-- the commissionable piece in revenue_amount (base plan + add-ons credited
-- to the same rep; service fees and other users' add-ons out), the account's
-- full contract value in total_revenue, and the lines it was built from.
alter table public.sales add column if not exists total_revenue numeric(12,2);
alter table public.sales add column if not exists addon_names text;
alter table public.sales add column if not exists commission_split jsonb;
notify pgrst, 'reload schema';
