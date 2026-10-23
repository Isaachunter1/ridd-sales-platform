-- ────────────────────────────────────────────────────────────────────────
-- Product usage events (Sep 2026). The app records page views (with time
-- on page and render ms), key actions (audit, stage, payroll, save attempt,
-- exports, drills, searches, filters), errors and modal open/close pairs,
-- so the next round of improvements is based on how people actually use
-- the app. Append-only; users insert their own rows, admins read via the
-- usage_summary() RPC below. Rows older than 90 days are pruned by that RPC.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.app_events (
  id          bigserial primary key,
  user_id     uuid default auth.uid(),
  role        text,
  session_id  text,
  device      text,                 -- 'phone' | 'desktop'
  event       text not null,        -- 'session' | 'view' | 'action' | 'error' | 'modal'
  name        text,                 -- view key, action name, error message (trimmed), modal name
  sub         text,                 -- sub-tab / queue / outcome
  dur_ms      int,                  -- time on previous view (view), render ms (view.render), modal open time (modal)
  props       jsonb,
  at          timestamptz not null default now()
);
create index if not exists app_events_at_idx on public.app_events (at desc);
create index if not exists app_events_user_at_idx on public.app_events (user_id, at desc);
alter table public.app_events enable row level security;
drop policy if exists "events: insert own" on public.app_events;
create policy "events: insert own" on public.app_events
  for insert to authenticated with check (user_id = auth.uid());
drop policy if exists "events: admin read" on public.app_events;
create policy "events: admin read" on public.app_events
  for select to authenticated using (public.is_admin());

-- One call, one JSON: everything the Admin → Usage panel shows.
create or replace function public.usage_summary(days int default 30)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  since timestamptz := now() - make_interval(days => greatest(1, least(days, 90)));
  out jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  delete from public.app_events where at < now() - interval '90 days';
  select jsonb_build_object(
    'days', days,
    'active_users', (select count(distinct user_id) from app_events where at >= since),
    'active_users_7d', (select count(distinct user_id) from app_events where at >= now() - interval '7 days'),
    'sessions', (select count(*) from app_events where at >= since and event = 'session'),
    'daily', (select coalesce(jsonb_agg(jsonb_build_object('d', d, 'users', u, 'views', v) order by d), '[]'::jsonb) from (
        select date_trunc('day', at)::date as d, count(distinct user_id) as u, count(*) filter (where event = 'view') as v
        from app_events where at >= since group by 1) x),
    'views', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'sub', sub, 'n', n, 'users', u, 'sec', sec, 'render_ms', rms) order by n desc), '[]'::jsonb) from (
        select name, sub, count(*) as n, count(distinct user_id) as u,
               round(coalesce(avg(dur_ms) filter (where dur_ms > 0 and dur_ms < 3600000), 0) / 1000.0) as sec,
               round(coalesce(percentile_cont(0.5) within group (order by (props->>'render_ms')::numeric) filter (where props ? 'render_ms'), 0)) as rms
        from app_events where at >= since and event = 'view' group by 1, 2) x),
    'by_role', (select coalesce(jsonb_agg(jsonb_build_object('role', role, 'users', u, 'views', v) order by v desc), '[]'::jsonb) from (
        select coalesce(role, '?') as role, count(distinct user_id) as u, count(*) filter (where event = 'view') as v
        from app_events where at >= since group by 1) x),
    'actions', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'sub', sub, 'n', n, 'users', u) order by n desc), '[]'::jsonb) from (
        select name, sub, count(*) as n, count(distinct user_id) as u
        from app_events where at >= since and event = 'action' group by 1, 2) x),
    'adoption', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'users', u, 'pct', pct) order by u desc), '[]'::jsonb) from (
        select name, count(distinct user_id) as u,
               round(100.0 * count(distinct user_id) / greatest(1, (select count(distinct user_id) from app_events where at >= since))) as pct
        from app_events where at >= since and event = 'action' group by 1) x),
    'errors', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n, 'users', u, 'last', last) order by n desc), '[]'::jsonb) from (
        select left(name, 160) as name, count(*) as n, count(distinct user_id) as u, max(at) as last
        from app_events where at >= since and event = 'error' group by 1 order by 2 desc limit 30) x),
    'modals', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'opened', opened, 'completed', completed, 'sec', sec) order by opened desc), '[]'::jsonb) from (
        select name, count(*) filter (where sub = 'open') as opened, count(*) filter (where sub = 'done') as completed,
               round(coalesce(avg(dur_ms) filter (where sub in ('done', 'dismiss') and dur_ms > 0), 0) / 1000.0) as sec
        from app_events where at >= since and event = 'modal' group by 1) x),
    'searches', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'n', n, 'users', u) order by n desc), '[]'::jsonb) from (
        select name, count(*) as n, count(distinct user_id) as u
        from app_events where at >= since and event = 'action' and name like 'search:%' group by 1) x),
    'time_to', (select coalesce(jsonb_agg(jsonb_build_object('name', name, 'median_sec', med, 'n', n) order by n desc), '[]'::jsonb) from (
        select name, round(percentile_cont(0.5) within group (order by (props->>'since_view_ms')::numeric) / 1000.0) as med, count(*) as n
        from app_events where at >= since and event = 'action' and props ? 'since_view_ms' group by 1) x)
  ) into out;
  return out;
end;
$$;
grant execute on function public.usage_summary(int) to authenticated;
