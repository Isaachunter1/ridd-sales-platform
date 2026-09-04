-- Scorecards v1: permanent storage for monthly scorecards + call audits.
-- Run once in the Supabase SQL editor. Cards and audits move out of the
-- shared settings blob into real tables so history is queryable forever.

create table if not exists public.scorecard_cards (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null,
  period      text not null,                       -- 'YYYY-MM'
  dept        text not null default 'inside_sales',
  data        jsonb not null default '{}'::jsonb,  -- { metrics, attendance, notes }
  weights     jsonb,                               -- template weights frozen at save time
  final_score numeric,
  finalized   jsonb,                               -- { on, by } or null
  reviewed    jsonb,                               -- { on, by } or null
  updated_at  timestamptz not null default now(),
  unique (profile_id, period)
);

create table if not exists public.call_audits (
  id             uuid primary key default gen_random_uuid(),
  profile_id     uuid not null,
  period         text not null,                    -- 'YYYY-MM'
  dept           text not null default 'inside_sales',
  call_date      date,
  call_ref       text,                             -- Five9 / phone number
  customer_ref   text,                             -- FieldRoutes customer id
  call_type      text,
  outcome        text,
  notes          text,
  grades         jsonb not null default '{}'::jsonb, -- { 'section.criterion': 2|1|0|null }
  call_score     numeric,                          -- 0-100, from the call rubric
  accuracy_score numeric,                          -- 0-100, from the accuracy rubric
  flagged        boolean not null default false,   -- compliance criterion graded No
  created_by     uuid,
  created_at     timestamptz not null default now()
);

create index if not exists scorecard_cards_period_idx on public.scorecard_cards (period);
create index if not exists call_audits_profile_period_idx on public.call_audits (profile_id, period);
create index if not exists call_audits_period_idx on public.call_audits (period);

alter table public.scorecard_cards enable row level security;
alter table public.call_audits enable row level security;

-- Permissive to signed-in users for now (the app gates edit access by role);
-- tighten to lead/admin-only writes later if desired.
drop policy if exists scorecard_cards_rw on public.scorecard_cards;
create policy scorecard_cards_rw on public.scorecard_cards
  for all to authenticated using (true) with check (true);

drop policy if exists call_audits_rw on public.call_audits;
create policy call_audits_rw on public.call_audits
  for all to authenticated using (true) with check (true);
