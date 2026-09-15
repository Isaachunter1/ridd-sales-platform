-- ============================================================================
-- riddmarket — DB guardrails for a second app/module on the SAME Supabase
-- project as the RIDD Sales Platform. Run once in the Supabase SQL editor.
--
-- Rules (see CONTRIBUTING-MODULES.md):
--   1. Everything riddmarket owns lives in schema `market`. Nothing in `public`.
--   2. Row Level Security is ON for every table, from the first migration.
--   3. Reads of who-is-this-rep go through public.profiles_roster (a view the
--      sales app already exposes) — never public.profiles directly.
--   4. No service-role key outside the sales app's own Netlify Functions.
-- ============================================================================

create schema if not exists market;

-- The anon/publishable key can SEE the schema; RLS decides what rows.
grant usage on schema market to anon, authenticated;

-- Tables created later in `market` are reachable through the API by default
-- (still gated by RLS). Sequences too, so inserts with serial ids work.
alter default privileges in schema market grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema market grant select on tables to anon;
alter default privileges in schema market grant usage, select on sequences to authenticated;

-- One helper every market policy can use: the current user's role from the
-- sales app's profiles table, without granting riddmarket read access to it.
create or replace function market.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;
revoke all on function market.my_role() from public;
grant execute on function market.my_role() to authenticated;

create or replace function market.is_admin()
returns boolean
language sql
stable
as $$
  select coalesce(market.my_role() in ('admin', 'admin_rep'), false)
$$;
grant execute on function market.is_admin() to authenticated;

-- ── Template table: copy this shape for every market table ─────────────────
create table if not exists market.listings (
  id           bigint generated always as identity primary key,
  created_at   timestamptz not null default now(),
  created_by   uuid not null default auth.uid() references auth.users (id) on delete cascade,
  title        text not null,
  body         text,
  price_cents  integer check (price_cents is null or price_cents >= 0),
  status       text not null default 'open' check (status in ('open', 'sold', 'closed'))
);
alter table market.listings enable row level security;

-- Everyone signed in can read; you can only write your own rows; admins can do anything.
create policy "market listings: read"   on market.listings for select to authenticated using (true);
create policy "market listings: insert" on market.listings for insert to authenticated with check (created_by = auth.uid());
create policy "market listings: update" on market.listings for update to authenticated using (created_by = auth.uid() or market.is_admin());
create policy "market listings: delete" on market.listings for delete to authenticated using (created_by = auth.uid() or market.is_admin());

-- ── Belt and braces: riddmarket must never see the sales tables raw ───────
-- (RLS already restricts them per user; this just documents the intent — the
-- sales app's own policies stay in force. Do NOT grant riddmarket anything
-- extra on public.*.)

-- ── After running this ──────────────────────────────────────────────────────
-- Supabase Dashboard → Project Settings → API → "Exposed schemas": add `market`
-- (public is there by default). Without this the REST API returns 404 for
-- market.* even though the grants are right.
--
-- From the app: supabase.schema('market').from('listings').select('*')
