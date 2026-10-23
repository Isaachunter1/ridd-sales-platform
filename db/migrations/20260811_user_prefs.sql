-- user_prefs.sql — cross-device user preferences (rep page layouts, section
-- edits, indicator presets). Own-row RLS: each user reads/writes only theirs.
create table if not exists public.user_prefs (
  user_id    uuid primary key references public.profiles(id) on delete cascade,
  prefs      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.user_prefs enable row level security;
drop policy if exists user_prefs_own on public.user_prefs;
create policy user_prefs_own on public.user_prefs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
