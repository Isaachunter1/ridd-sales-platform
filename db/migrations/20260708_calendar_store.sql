-- ────────────────────────────────────────────────────────────────────────
-- SHARED CALENDAR — shifts + swap requests live in ONE shared row so the
-- schedule an admin builds shows up for every office-staff rep (and their
-- swap requests show up for admins). The app loads it on boot and pushes
-- (debounced) whenever the local calendar changes.
--
-- Writes are open to all signed-in users because shift SWAPS are rep
-- actions; shift creation stays admin-only in the app UI.
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.calendar_store (
  id         int primary key default 1 check (id = 1),   -- single shared row
  data       jsonb not null default '{}'::jsonb,          -- { shifts: [...], swaps: [...] }
  updated_by uuid,
  updated_at timestamptz not null default now()
);

insert into public.calendar_store (id) values (1) on conflict (id) do nothing;

alter table public.calendar_store enable row level security;

drop policy if exists "calendar readable by authenticated" on public.calendar_store;
create policy "calendar readable by authenticated"
  on public.calendar_store for select
  to authenticated
  using (true);

drop policy if exists "calendar writable by authenticated" on public.calendar_store;
create policy "calendar writable by authenticated"
  on public.calendar_store for all
  to authenticated
  using (true)
  with check (true);
