-- ────────────────────────────────────────────────────────────────────────
-- INDICATOR ROSTERS — stage 1 of moving config out of the JSON blob.
--
-- Rosters become real rows (one per rep per team per competition). The app
-- DUAL-WRITES: every successful config sync also mirrors the NRLA rosters
-- here. The JSON blob remains the source of truth until after the season;
-- then reads cut over (stage 2) with instant rollback available.
--
-- Realtime is enabled so admins hear each other's roster changes live.
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.indicator_rosters (
  comp_id    text not null,
  team       text not null,
  rep_name   text not null,
  rep_id     text,                       -- FieldRoutes employee ID when known
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (comp_id, team, rep_name)
);

alter table public.indicator_rosters enable row level security;

drop policy if exists "rosters readable by authenticated" on public.indicator_rosters;
create policy "rosters readable by authenticated"
  on public.indicator_rosters for select
  to authenticated
  using (true);

drop policy if exists "rosters writable by admins" on public.indicator_rosters;
create policy "rosters writable by admins"
  on public.indicator_rosters for all
  to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','admin_rep')))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin','admin_rep')));

-- Live change feed (safe to re-run — duplicate membership is ignored).
do $$
begin
  alter publication supabase_realtime add table public.indicator_rosters;
exception
  when duplicate_object then null;
end $$;
