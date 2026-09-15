-- ============================================================================
-- riddmarket feed — what the (separate) marketplace app may read from the
-- sales platform's Supabase. Run once in Supabase → SQL editor.
--
--   * Views only, in their own schema `market_feed`. The marketplace never
--     touches public.* directly, so tables underneath can change freely.
--   * One Postgres login, `market_ro`, that can SELECT these views and
--     nothing else. NOT the service_role key.
--   * Sign-in is handled separately: the marketplace uses the project URL +
--     anon key with supabase.auth.signInWithPassword; nothing here needed.
-- ============================================================================

create schema if not exists market_feed;

-- Reps: who can sign in, how to display them, where they sit.
-- (Views run as their owner, so this exposes email deliberately — the
--  marketplace matches accounts on it. Pay rates/goals are NOT exposed.)
create or replace view market_feed.reps as
  select p.id, p.full_name, p.email, p.role::text as role, p.rep_type::text as rep_type,
         p.office_id, o.name as office, p.fieldroutes_employee_id,
         p.is_active,   -- THE gate. Flipped by the Activate button in the sales app (Users screen),
                        -- which provisions/deactivates from the FieldRoutes roster. Marketplace
                        -- must refuse sign-in when this is false; Supabase auth alone won't.
         p.created_at
  from public.profiles p
  left join public.offices o on o.id = p.office_id;

-- Competitions: id, name, dates, status.
create or replace view market_feed.competitions as
  select id, name, category::text as category, type::text as type,
         start_date, end_date, prize_text, is_active, created_at
  from public.competitions;

-- Riddcoin ledger: every earn/spend, already keyed by rep. This IS the payout feed.
create or replace view market_feed.riddcoin_ledger as
  select id, user_id as rep_id, delta, kind, reason, item_id, created_at
  from public.riddcoin_ledger;

-- Convenience: current balance per rep.
create or replace view market_feed.riddcoin_balances as
  select user_id as rep_id, sum(delta)::bigint as balance, max(created_at) as last_activity
  from public.riddcoin_ledger group by user_id;

-- ── Read-only login ───────────────────────────────────────────────────────
-- CHANGE THE PASSWORD before running (long random string; keep it out of git).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'market_ro') then
    create role market_ro login password 'CHANGE-ME-long-random-password'
      nosuperuser nocreatedb nocreaterole noinherit;
  end if;
end $$;
grant connect on database postgres to market_ro;
revoke all on schema public from market_ro;
grant usage on schema market_feed to market_ro;
grant select on all tables in schema market_feed to market_ro;
alter default privileges in schema market_feed grant select on tables to market_ro;

-- Rotate later with:  alter role market_ro password 'new-password';
-- Remove with:        drop owned by market_ro; drop role market_ro;
