-- RIDD Sales Platform — Supabase schema
-- Run this in your Supabase SQL Editor (Project → SQL Editor → New query → paste → Run).
-- This script is idempotent: you can re-run it safely.

-- ============================================================================
-- 0. CLEAN SLATE (comment out if you don't want to drop existing app tables)
-- ============================================================================
drop table if exists public.competition_progress cascade;
drop table if exists public.competition_rules cascade;
drop table if exists public.competitions cascade;
drop table if exists public.sales cascade;
drop table if exists public.sources cascade;
drop table if exists public.service_types cascade;
drop table if exists public.contract_types cascade;
drop table if exists public.offices cascade;
drop table if exists public.pending_invites cascade;
drop table if exists public.app_settings cascade;
drop table if exists public.profiles cascade;
drop type if exists public.audit_status cascade;
drop type if exists public.competition_category cascade;
drop type if exists public.competition_type cascade;
drop type if exists public.user_role cascade;

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
create type public.user_role as enum ('rep', 'admin');
-- Statuses from RIDD SALES sheet column M validation
create type public.audit_status as enum (
  'pending',
  'serviced',
  'cancelled',
  'below_minimums',
  'nsf',
  'not_payable',
  'reschedule'
);
create type public.competition_category as enum ('inside_sales', 'loyalty');
create type public.competition_type as enum ('royalty', 'bingo');

-- ============================================================================
-- 2. LOOKUP TABLES
-- ============================================================================
create table public.offices (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.service_types (
  id bigserial primary key,
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.sources (
  id bigserial primary key,
  name text not null unique,
  is_renewal boolean not null default false,
  created_at timestamptz not null default now()
);

-- Seed values — RIDD offices
insert into public.offices (name) values
  ('Atlanta'),
  ('Charleston'),
  ('Destin'),
  ('Detroit'),
  ('Myrtle Beach'),
  ('Raleigh'),
  ('Salt Lake'),
  ('Virginia Beach')
on conflict do nothing;

-- Full RIDD service type catalog (from SALES sheet column E validation)
insert into public.service_types (name) values
  ('Carpenter Bee 12'), ('Carpenter Bee 4'), ('Carpenter Bee 6'),
  ('German Roach 12'), ('German Roach 4'), ('German Roach 6'), ('German Roach Mole 4'),
  ('Interior Flea 12'), ('Interior Flea 4'), ('Interior Flea 6'),
  ('Mole 12'), ('Mole 4'), ('Mole 6'),
  ('Mole Mosquito 12'), ('Mole Mosquito 4'), ('Mole Mosquito 6'), ('Mole Mosquito 6 Seasonal'),
  ('Mole Mosquito Rodent 4'), ('Mole Mosquito Snake 6'),
  ('Mole Rodent 4'), ('Mole Rodent 6'),
  ('Mole Snake 4'), ('Mole Snake 6'),
  ('Mosquito 12'), ('Mosquito 4'), ('Mosquito 6'),
  ('Mosquito Rodent 12'), ('Mosquito Rodent 4'), ('Mosquito Rodent 6'),
  ('Mosquito Rodent 6 Seasonal'), ('Mosquito Rodent Snake 6 Seasonal'),
  ('Mosquito Snake 4'), ('Mosquito Snake 6'),
  ('One Time German Roach'), ('One Time Interior Flea'), ('One Time Mosquito'),
  ('One Time Pest Control'), ('One Time Rodent'), ('One Time Termite Inspection'),
  ('One Time Vehicle Inpsection'),
  ('Pest 12'), ('Pest 4'), ('Pest 4 - Spanish'), ('Pest 6'), ('Pest 6 - Spanish'),
  ('Pest Carpenter Bee 4'), ('Pest Carpenter Bee 6'), ('Pest Carpenter Bee Mole 4'),
  ('Pest Carpenter Bee Mole 6'), ('Pest Carpenter Bee Mosquito 4 Seasonal'),
  ('Pest German Roach 12'), ('Pest German Roach 4'), ('Pest German Roach 6'),
  ('Pest German Roach Mole 4'), ('Pest German Roach Mole 6'),
  ('Pest German Roach Mole Mosquito 4'), ('Pest German Roach Mole Mosquito 6'),
  ('Pest German Roach Mole Mosquito Snake 6'),
  ('Pest German Roach Mole Rodent 4'), ('Pest German Roach Mole Rodent 6'),
  ('Pest German Roach Mole Snake 4'), ('Pest German Roach Mole Snake Rodent 4'),
  ('Pest German Roach Mosquito 4'), ('Pest German Roach Mosquito 4 Seasonal'),
  ('Pest German Roach Mosquito 6'), ('Pest German Roach Mosquito Snake 4'),
  ('Pest German Roach Rodent 12'), ('Pest German Roach Rodent 4'),
  ('Pest German Roach Rodent 6'), ('Pest German Roach Rodent Snake 6'),
  ('Pest German Roach Snake 4'), ('Pest German Roach Snake 6'),
  ('Pest Interior 4'), ('Pest Interior 6'),
  ('Pest Interior Flea 4'), ('Pest Interior Flea Mole 4'), ('Pest Interior Flea Mosquito 4'),
  ('Pest Mole 12'), ('Pest Mole 4'), ('Pest Mole 6'),
  ('Pest Mole Mosquito 4'), ('Pest Mole Mosquito 4 Seasonal'),
  ('Pest Mole Mosquito 6'), ('Pest Mole Mosquito 6 Seasonal'),
  ('Pest Mole Mosquito Snake 12'), ('Pest Mole Mosquito Snake 4'),
  ('Pest Mole Mosquito Snake 6'), ('Pest Mole Mosquito Snake 6 Seasonal'),
  ('Pest Mole Rodent 4'), ('Pest Mole Rodent 6'), ('Pest Mole Rodent Snake 6'),
  ('Pest Mole Snake 4'), ('Pest Mole Snake 6'), ('Pest Mole Snake Rodent 4'),
  ('Pest Mosquito 12'), ('Pest Mosquito 4'), ('Pest Mosquito 4 - Spanish'),
  ('Pest Mosquito 4 Seasonal'), ('Pest Mosquito 6'), ('Pest Mosquito 6 - Spanish'),
  ('Pest Mosquito 6 Seasonal'), ('Pest Mosquito 6 Seasonal - Spanish'),
  ('Pest Mosquito Mole 12'),
  ('Pest Mosquito Snake 4'), ('Pest Mosquito Snake 4 Seasonal'),
  ('Pest Mosquito Snake 6'), ('Pest Mosquito Snake 6 Seasonal'),
  ('Pest Rodent 12'), ('Pest Rodent 4'), ('Pest Rodent 6'),
  ('Pest Rodent Mole 4'), ('Pest Rodent Snake 4'), ('Pest Rodent Snake 6'),
  ('Pest Snake 12'), ('Pest Snake 4'), ('Pest Snake 6'),
  ('RIDD Package 12'), ('RIDD Package 4'), ('RIDD Package 4 - Spanish'),
  ('RIDD Package 4 Seasonal'), ('RIDD Package 6'), ('RIDD Package 6 - Spanish'),
  ('RIDD Package 6 Seasonal'),
  ('RIDD Package Carpenter Bee 4'), ('RIDD Package Carpenter Bee 6 Seasonal'),
  ('RIDD Package Carpenter Bee Mole 6'), ('RIDD Package Carpenter Bee Mole 6 Seasonal'),
  ('RIDD Package Flea Mole Snake 6'),
  ('RIDD Package German Roach 12'), ('RIDD Package German Roach 4'),
  ('RIDD Package German Roach 4 Seasonal'), ('RIDD Package German Roach 6'),
  ('RIDD Package German Roach 6 Seasonal'),
  ('RIDD Package German Roach Interior Flea 4'), ('RIDD Package German Roach Interior Flea 6'),
  ('RIDD Package German Roach Mole 4'), ('RIDD Package German Roach Mole 6'),
  ('RIDD Package German Roach Mole 6 Seasonal'),
  ('RIDD Package German Roach Snake 12'), ('RIDD Package German Roach Snake 4'),
  ('RIDD Package German Roach Snake 6'), ('RIDD Package German Roach Snake 6 Seasonal'),
  ('RIDD Package Interior Flea 4'), ('RIDD Package Interior Flea 6'),
  ('RIDD Package Interior Flea 6 Seasonal'),
  ('RIDD Package Interior Flea Mole 6'),
  ('RIDD Package Interior Flea Snake 6 Seasonal'),
  ('RIDD Package Mole 12'), ('RIDD Package Mole 4'), ('RIDD Package Mole 6'),
  ('RIDD Package Mole 6 Seasonal'),
  ('RIDD Package Mole Snake 12'), ('RIDD Package Mole Snake 4'),
  ('RIDD Package Mole Snake 6'), ('RIDD Package Mole Snake 6 Seasonal'),
  ('RIDD Package Snake 12'), ('RIDD Package Snake 4'), ('RIDD Package Snake 6'),
  ('RIDD Package Snake 6 Seasonal'),
  ('Rodent 12'), ('Rodent 4'), ('Rodent 6'),
  ('Rodent Snake 4'), ('Rodent Snake 6'),
  ('Sentricon - Retreat'),
  ('Snake 12'), ('Snake 4'), ('Snake 6'),
  ('Solo Seasonal Mosquito')
on conflict do nothing;

-- Full RIDD sources catalog (from SALES sheet column G validation)
insert into public.sources (name, is_renewal) values
  ('Angi', false), ('Baton', false), ('Bing Ads', false), ('eLocal', false),
  ('Facebook', false), ('Google Ads', false), ('Google Local Services', false),
  ('Inside Sale', false), ('Pest Net', false), ('Referral', false),
  ('Service Direct', false), ('Website', false), ('Yelp', false),
  ('Renewal - Inbound', true), ('Renewal - Loyalty', true),
  ('Renewal - Outbound', true), ('Renewal - Service Pro Upsell', true)
on conflict do nothing;

-- Contract types (lookup, seed from SALES sheet column F validation)
create table if not exists public.contract_types (
  id bigserial primary key,
  name text not null unique,
  implied_months integer,     -- null for categorical (Upsell/Commercial/Paid in Full), 0 for One Time
  created_at timestamptz not null default now()
);
-- Commercial + Paid in Full are checkbox modifiers on the sale, not contract types
insert into public.contract_types (name, implied_months) values
  ('12 Months', 12),
  ('18 Months', 18),
  ('24 Months', 24),
  ('Upsell - D2D', null),
  ('Upsell - Office', null),
  ('One Time Service', 0)
on conflict do nothing;

-- ============================================================================
-- 3. PROFILES (linked to auth.users)
-- ============================================================================
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  avatar_url text,
  role public.user_role not null default 'rep',
  office_id bigint references public.offices(id),
  initials text,                       -- e.g. 'BAJ' used in 'Audited' column
  upfront_commission_rate numeric(5,4) not null default 0.0700,  -- 7.00%
  below_min_commission_rate numeric(5,4) not null default 0.0350, -- 3.50%
  close_rate_target numeric(5,4) not null default 0.6000,  -- 60.00%
  annual_revenue_goal numeric(12,2) not null default 250000,
  created_at timestamptz not null default now()
);

-- ── Pending invites: admin pre-creates users before they sign up ──
create table public.pending_invites (
  id bigserial primary key,
  email text unique not null,
  full_name text not null,
  role public.user_role not null default 'rep',
  office_id bigint references public.offices(id),
  initials text,
  avatar_url text,
  annual_revenue_goal numeric(12,2) default 250000,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id)
);

alter table public.pending_invites enable row level security;
create policy "pending_invites: admin all" on public.pending_invites
  for all using (public.is_admin()) with check (public.is_admin());

-- ── App settings (company-wide goal, etc.) ──
create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
insert into public.app_settings (key, value) values
  ('company_goal', '{"amount": 6000000, "period": "year"}'::jsonb)
on conflict (key) do nothing;

alter table public.app_settings enable row level security;
create policy "settings: read all" on public.app_settings
  for select using (auth.role() = 'authenticated');
create policy "settings: admin write" on public.app_settings
  for all using (public.is_admin()) with check (public.is_admin());

-- ── Avatars storage bucket ──
-- NOTE: this runs best in Supabase Dashboard → Storage → New bucket → 'avatars' (public).
-- The statements below create it via SQL for convenience.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do nothing;

drop policy if exists "avatars: public read" on storage.objects;
drop policy if exists "avatars: user upload own" on storage.objects;
drop policy if exists "avatars: user update own" on storage.objects;
drop policy if exists "avatars: admin all" on storage.objects;

create policy "avatars: public read"
  on storage.objects for select
  using (bucket_id = 'avatars');

create policy "avatars: user upload own"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );

create policy "avatars: user update own"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'avatars'
    and (split_part(name, '/', 1) = auth.uid()::text or public.is_admin())
  );

create policy "avatars: admin all"
  on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and public.is_admin());

create index profiles_role_idx on public.profiles(role);
create index profiles_office_idx on public.profiles(office_id);

-- Auto-create a profile row whenever a new auth user signs up.
-- If a pending_invites row matches the email, merge that stub into the new profile.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
declare
  invite record;
begin
  select * into invite from public.pending_invites where lower(email) = lower(new.email) limit 1;

  if found then
    insert into public.profiles (
      id, full_name, email, avatar_url, role, office_id, initials, annual_revenue_goal
    ) values (
      new.id, invite.full_name, new.email, invite.avatar_url, invite.role,
      invite.office_id, invite.initials, coalesce(invite.annual_revenue_goal, 250000)
    )
    on conflict (id) do nothing;
    delete from public.pending_invites where id = invite.id;
  else
    insert into public.profiles (id, full_name, email, role)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)),
      new.email,
      'rep'
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ============================================================================
-- 4. SALES
-- ============================================================================
create table public.sales (
  id bigserial primary key,
  rep_id uuid not null references public.profiles(id) on delete restrict,
  logged_by uuid references public.profiles(id),     -- who actually entered the sale (may differ from rep if admin logs on behalf)
  customer_name text not null,
  customer_number text,
  office_id bigint references public.offices(id),
  service_type_id bigint references public.service_types(id),
  contract_type_id bigint references public.contract_types(id),
  contract_months integer default 12,                 -- 0 = one-time, 12, 18, 24 — derived from contract_type when applicable
  source_id bigint references public.sources(id),
  initial_amount numeric(10,2) not null default 0,
  monthly_amount numeric(10,2) not null default 0,    -- labeled "Recurring" in UI; when PPS=true this is amount per service
  num_services integer,                                -- only set when pay_per_service = true
  pay_per_service boolean not null default false,     -- if true, monthly_amount is per-service not monthly
  revenue_amount numeric(10,2) not null default 0,    -- total contract value
  sold_date date not null default current_date,
  commission_date date,                                -- when commission is paid out
  bill_date date,                                      -- legacy, kept for compatibility
  paid_in_full boolean not null default false,        -- no hold on backend, full commission paid upfront
  is_commercial boolean not null default false,       -- commercial property flag
  audit_status public.audit_status not null default 'pending',
  audited_by uuid references public.profiles(id),
  audited_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index sales_rep_idx on public.sales(rep_id);
create index sales_status_idx on public.sales(audit_status);
create index sales_sold_date_idx on public.sales(sold_date);
create index sales_office_idx on public.sales(office_id);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists sales_touch on public.sales;
create trigger sales_touch
  before update on public.sales
  for each row execute function public.touch_updated_at();

-- ============================================================================
-- 5. COMPETITIONS
-- ============================================================================
create table public.competitions (
  id bigserial primary key,
  name text not null,
  category public.competition_category not null,
  type public.competition_type not null,
  start_date date not null,
  end_date date not null,
  prize_text text,                     -- free-form prize description ("$300/mo", "150,000 RC", etc.)
  prize_image_url text,                -- banner image
  description text,
  min_qualifying_revenue numeric(12,2),-- for royalty comps ($650k, $1M, etc.)
  is_active boolean not null default true,
  created_by uuid references public.profiles(id),
  created_at timestamptz not null default now()
);

create index competitions_dates_idx on public.competitions(start_date, end_date);
create index competitions_active_idx on public.competitions(is_active);

-- ============================================================================
-- 6. COMPETITION RULES
-- Each row is one "bingo square" or one qualifying rule.
-- The rule engine in the app evaluates these against sales data.
-- ============================================================================
create table public.competition_rules (
  id bigserial primary key,
  competition_id bigint not null references public.competitions(id) on delete cascade,
  label text not null,                 -- human-readable: "5 Accounts Sold In A Day"

  -- The metric to aggregate
  metric text not null,                -- 'count' | 'sum_revenue' | 'sum_initial' | 'sum_monthly' | 'avg_initial' | 'close_rate' | 'saves_count'

  -- Aggregation window
  window text not null,                -- 'day' | 'week' | 'month' | 'competition'

  -- Comparison
  operator text not null,              -- '>' | '>=' | '<' | '<=' | '=' | '!='
  threshold numeric(12,2) not null,

  -- Optional filters (JSON for flexibility)
  -- { "source_id": [1,2], "service_type_id": [3], "office_id": [1], "min_revenue": 100 }
  filters jsonb default '{}'::jsonb,

  -- Bingo card position (null for non-bingo rules)
  bingo_row integer,
  bingo_col integer,

  created_at timestamptz not null default now()
);

create index competition_rules_comp_idx on public.competition_rules(competition_id);

-- ============================================================================
-- 7. COMPETITION PROGRESS (materialized per rep)
-- Updated by the app whenever sales are approved or rules are edited.
-- ============================================================================
create table public.competition_progress (
  id bigserial primary key,
  competition_id bigint not null references public.competitions(id) on delete cascade,
  rule_id bigint not null references public.competition_rules(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete cascade,
  current_value numeric(12,2) not null default 0,
  met boolean not null default false,
  last_computed_at timestamptz not null default now(),
  unique(rule_id, rep_id)
);

create index competition_progress_rep_idx on public.competition_progress(rep_id);
create index competition_progress_comp_idx on public.competition_progress(competition_id);

-- ============================================================================
-- 8. ROW LEVEL SECURITY
-- Leaderboard-only transparency: reps see their own detailed data + aggregated
-- leaderboard view. Admins see everything.
-- ============================================================================
alter table public.profiles enable row level security;
alter table public.sales enable row level security;
alter table public.offices enable row level security;
alter table public.service_types enable row level security;
alter table public.sources enable row level security;
alter table public.competitions enable row level security;
alter table public.competition_rules enable row level security;
alter table public.competition_progress enable row level security;

-- Helper: is current user an admin?
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------- profiles ----------
create policy "profiles: self read" on public.profiles
  for select using (id = auth.uid() or public.is_admin());

create policy "profiles: self update" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy "profiles: admin write" on public.profiles
  for all using (public.is_admin()) with check (public.is_admin());

-- ---------- sales ----------
create policy "sales: own rows" on public.sales
  for select using (rep_id = auth.uid() or public.is_admin());

create policy "sales: self insert" on public.sales
  for insert with check (rep_id = auth.uid() or public.is_admin());

create policy "sales: self update pending" on public.sales
  for update using (
    (rep_id = auth.uid() and audit_status = 'pending')
    or public.is_admin()
  );

create policy "sales: admin delete" on public.sales
  for delete using (public.is_admin());

-- ---------- lookup tables: readable by all, writable by admin ----------
create policy "offices: read all" on public.offices for select using (auth.role() = 'authenticated');
create policy "offices: admin write" on public.offices for all using (public.is_admin()) with check (public.is_admin());

create policy "service_types: read all" on public.service_types for select using (auth.role() = 'authenticated');
create policy "service_types: admin write" on public.service_types for all using (public.is_admin()) with check (public.is_admin());

create policy "sources: read all" on public.sources for select using (auth.role() = 'authenticated');
create policy "sources: admin write" on public.sources for all using (public.is_admin()) with check (public.is_admin());

-- ---------- competitions ----------
create policy "competitions: read all" on public.competitions for select using (auth.role() = 'authenticated');
create policy "competitions: admin write" on public.competitions for all using (public.is_admin()) with check (public.is_admin());

create policy "comp rules: read all" on public.competition_rules for select using (auth.role() = 'authenticated');
create policy "comp rules: admin write" on public.competition_rules for all using (public.is_admin()) with check (public.is_admin());

-- ---------- progress ----------
-- Reps see their own progress; admins see everything; leaderboard read is open to all authenticated
create policy "progress: read authenticated" on public.competition_progress
  for select using (auth.role() = 'authenticated');

create policy "progress: self upsert" on public.competition_progress
  for insert with check (rep_id = auth.uid() or public.is_admin());

create policy "progress: self update" on public.competition_progress
  for update using (rep_id = auth.uid() or public.is_admin());

create policy "progress: admin delete" on public.competition_progress
  for delete using (public.is_admin());

-- ============================================================================
-- 9. LEADERBOARD VIEW (public, aggregated)
-- Includes the detailed columns shown on the dashboard leaderboard:
-- sales count, revenue, initial, recurring, ACV, MY%, REC MIX%
-- ============================================================================
create or replace view public.leaderboard as
with approved as (
  select * from public.sales
  where audit_status in ('approved','serviced')
    and sold_date >= date_trunc('month', current_date)
),
rep_stats as (
  select
    p.id as rep_id,
    p.full_name,
    p.email,
    p.avatar_url,
    p.initials,
    o.name as office,
    p.role,
    count(a.id) as approved_sales,
    coalesce(sum(a.revenue_amount), 0) as approved_revenue,
    coalesce(sum(a.initial_amount), 0) as total_initial,
    coalesce(sum(a.monthly_amount * a.contract_months), 0) as total_recurring,
    coalesce(sum(a.initial_amount + a.monthly_amount * 12), 0) as total_acv,
    -- MY%:  count(12mo) / count(12 + 18 + 24 mo)
    count(a.id) filter (where a.contract_months = 12) as cnt_12,
    count(a.id) filter (where a.contract_months in (12,18,24)) as cnt_12_18_24,
    -- REC MIX%: count(12,18,24) / count(12,18,24 + one-time(<=1 or 0))
    count(a.id) filter (where coalesce(a.contract_months, 0) <= 1) as cnt_one_time,
    (select count(*) from public.sales where audit_status = 'pending' and rep_id = p.id) as pending_sales
  from public.profiles p
  left join public.offices o on o.id = p.office_id
  left join approved a on a.rep_id = p.id
  group by p.id, p.full_name, p.email, p.avatar_url, p.initials, o.name, p.role
)
select
  *,
  case when cnt_12_18_24 > 0
    then (cnt_12::numeric / cnt_12_18_24) else 0 end as my_pct,
  case when (cnt_12_18_24 + cnt_one_time) > 0
    then (cnt_12_18_24::numeric / (cnt_12_18_24 + cnt_one_time)) else 0 end as rec_mix_pct,
  date_trunc('month', current_date) as as_of_month
from rep_stats;

grant select on public.leaderboard to authenticated;

-- ============================================================================
-- 10. SEED: an example admin bootstrap helper
-- After creating your first auth user via the app, run:
--   select public.promote_to_admin('you@example.com');
-- ============================================================================
create or replace function public.promote_to_admin(email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_id uuid;
begin
  select id into target_id from auth.users where auth.users.email = promote_to_admin.email;
  if target_id is null then
    raise exception 'No auth user found with email %', email;
  end if;
  update public.profiles set role = 'admin' where id = target_id;
end;
$$;

-- Done. After running this, come back to the app and sign up for the first
-- account; then run:  select public.promote_to_admin('your-email@domain.com');
