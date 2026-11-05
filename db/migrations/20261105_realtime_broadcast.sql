-- 20261105_realtime_broadcast.sql
--
-- Why: Realtime's WAL poller (`SELECT wal->>$5 as type …`) was the single biggest query on the
-- instance — 11,032 calls / 469 s in one stats window — because five `postgres_changes`
-- subscriptions (dashboards, TV board, the rep's own sales, loyalty boards, rosters) keep it
-- decoding the write-ahead log all day and evaluating RLS once per subscriber per change,
-- while the 5-minute sync fills that log with hundreds of thousands of rows.
--
-- Now: the database tells clients itself. Triggers on `sales` and `renewal_worklog` publish a
-- Broadcast message when a row changes; clients subscribe to a topic. No WAL decoding, no
-- per-user RLS per change. Topics (all private — a signed-in user is required):
--   ridd:sales                 every insert / update / delete on public.sales, payload = {table, op, id}
--                              (no row data: dashboards and the TV only need "something changed")
--   ridd:sales:rep:<uuid>      updates to that rep's own sales, with the row — only that rep can read it
--   ridd:renewal_worklog       every change on public.renewal_worklog, with old + new rows
-- The rosters subscription is dropped: its callback has done nothing since the Sep toast retired.
--
-- Ships with the app change (nav-mount.js, tv-board.js, config-sync.js, reporting/view.js) that
-- subscribes to these topics instead. Until this has run, those clients hear nothing on realtime
-- and fall back to their 2-minute polls (dashboards, TV) / reload (renewals) — nothing breaks.
--
-- Requires Realtime's "broadcast from database" functions (realtime.send / realtime.broadcast_changes),
-- present on current Supabase projects. The DO block at the end says so if they're missing.

-- 1. Who may listen. Private channels are gated by RLS on realtime.messages.
drop policy if exists "ridd realtime topics" on realtime.messages;
create policy "ridd realtime topics" on realtime.messages
  for select to authenticated
  using (
    realtime.topic() in ('ridd:sales', 'ridd:renewal_worklog')
    or (realtime.topic() like 'ridd:sales:rep:%' and split_part(realtime.topic(), ':', 4) = auth.uid()::text)
  );

-- 2. sales → ridd:sales (no row data) + ridd:sales:rep:<rep_id> (the row, updates only)
create or replace function public.ridd_broadcast_sales()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.send(jsonb_build_object('table', 'sales', 'op', tg_op, 'id', case when tg_op = 'DELETE' then old.id else new.id end), 'change', 'ridd:sales', true);
  if tg_op = 'UPDATE' and new.rep_id is not null then
    perform realtime.broadcast_changes('ridd:sales:rep:' || new.rep_id::text, tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  end if;
  return null;
end $$;
drop trigger if exists ridd_broadcast_sales on public.sales;
create trigger ridd_broadcast_sales
  after insert or update or delete on public.sales
  for each row execute function public.ridd_broadcast_sales();

-- 3. renewal_worklog → ridd:renewal_worklog (old + new row: the boards patch their local copy from it)
create or replace function public.ridd_broadcast_renewal_worklog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.broadcast_changes('ridd:renewal_worklog', tg_op, tg_op, tg_table_name, tg_table_schema, new, old);
  return null;
end $$;
drop trigger if exists ridd_broadcast_renewal_worklog on public.renewal_worklog;
create trigger ridd_broadcast_renewal_worklog
  after insert or update or delete on public.renewal_worklog
  for each row execute function public.ridd_broadcast_renewal_worklog();

-- 4. Stop the WAL poller for good: nothing left in the publication means no decoding, even for
--    a tab still running the old build.
do $$
declare t text;
begin
  for t in select tablename from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public'
           and tablename in ('sales', 'indicator_rosters', 'renewal_worklog') loop
    execute format('alter publication supabase_realtime drop table public.%I', t);
  end loop;
end $$;

-- 5. Sanity: the broadcast functions must exist, or the triggers above would fail every write.
do $$
begin
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null
     or to_regprocedure('realtime.broadcast_changes(text,text,text,text,text,record,record,text)') is null then
    raise exception 'realtime.send / realtime.broadcast_changes not found — this project''s Realtime is too old for broadcast-from-database; roll back this file (drop the two triggers) and keep postgres_changes.';
  end if;
end $$;
