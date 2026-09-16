-- ────────────────────────────────────────────────────────────────────────
-- INDICATOR CONFIG HISTORY — one snapshot per change, keep the last 50.
--
-- Insurance against config loss (the roster-wipe incident): every write to
-- public.indicator_config is captured by a DB trigger, so it works no matter
-- which client/browser/version does the writing. Admins can restore any
-- snapshot from the app: 📋 Rosters → 🕘 History → Restore.
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create table if not exists public.indicator_config_history (
  id         bigint generated always as identity primary key,
  saved_at   timestamptz not null default now(),
  updated_by uuid,
  config     jsonb not null
);

alter table public.indicator_config_history enable row level security;

-- Read-only from clients; only the trigger (security definer) writes.
drop policy if exists "config history readable by authenticated" on public.indicator_config_history;
create policy "config history readable by authenticated"
  on public.indicator_config_history for select
  to authenticated
  using (true);

create or replace function public.capture_indicator_config()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.indicator_config_history (updated_by, config)
  values (new.updated_by, to_jsonb(new));
  -- Keep the most recent 50 snapshots.
  delete from public.indicator_config_history
  where id not in (
    select id from public.indicator_config_history order by id desc limit 50
  );
  return new;
end
$$;

drop trigger if exists trg_capture_indicator_config on public.indicator_config;
create trigger trg_capture_indicator_config
  after insert or update on public.indicator_config
  for each row execute function public.capture_indicator_config();

-- Seed the history with the current config so there's a restore point
-- from day one.
insert into public.indicator_config_history (updated_by, config)
select updated_by, to_jsonb(c) from public.indicator_config c where c.id = 1
on conflict do nothing;
