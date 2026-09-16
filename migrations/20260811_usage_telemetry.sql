-- usage_telemetry.sql — adoption telemetry (per Isaac). Tiny event log:
-- who logs in, which tabs get used. Own-row inserts; admins read everything.
create table if not exists public.usage_events (
  id         bigint generated always as identity primary key,
  profile_id uuid not null references public.profiles(id) on delete cascade,
  event      text not null,          -- 'login' | 'view' | 'feedback'
  detail     text,                   -- tab key / feedback snippet
  at         timestamptz not null default now()
);
create index if not exists usage_events_profile_at on public.usage_events (profile_id, at desc);
create index if not exists usage_events_at on public.usage_events (at desc);
alter table public.usage_events enable row level security;
drop policy if exists usage_events_own_insert on public.usage_events;
create policy usage_events_own_insert on public.usage_events
  for insert with check (profile_id = auth.uid());
drop policy if exists usage_events_admin_read on public.usage_events;
create policy usage_events_admin_read on public.usage_events
  for select using (exists (
    select 1 from profiles p where p.id = auth.uid() and p.role in ('admin', 'admin_rep')
  ));
