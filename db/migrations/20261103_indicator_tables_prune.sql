-- 20261103_indicator_tables_prune.sql
--
-- Why (Nov 3 2026): indicator_sales held 19 stacked runs — 1.81M rows, 6 GB —
-- because the Netlify derive worker inserted a full copy every 5 minutes and
-- its DELETE of every older copy timed out through PostgREST, so the pile only
-- grew (29M attempted deletes in the stats window). Scanning that table every
-- run is what kept the database in swap. crm_subscriptions was separately
-- rewritten in full (109k upserts) every run.
--
-- This gives the ported job (server/services/indicators/jobs/derive.js) what it
-- needs to write cheaply, and a safety net so a failed run can never stack
-- copies again:
--   1. indicator_tables_prune(p_keep)  — delete ONE older run per call, in the
--      database, with its own statement timeout. The job loops until 0.
--   2. crm_subscriptions.row_hash       — content hash so the mirror upserts
--      only changed rows; crm_subscriptions_hashes() returns id→hash in one call.
--   3. pg_cron: indicator_tables_prune() every 10 minutes keeps the newest run
--      only, whether or not any job ran. (pg_cron must be enabled on the
--      project: Database → Extensions → pg_cron. The cron block is last and
--      can be run separately if the extension isn't on yet.)
--
-- One-time cleanup of the existing pile is NOT here — do it by hand first
-- (delete one computed_at at a time, then VACUUM FULL between sync runs).

-- 1. Prune: one older computed_at per call (bounded work; returns rows deleted).
create or replace function public.indicator_tables_prune(p_keep timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = public
set statement_timeout = '300s'
as $$
declare
  -- Called by the job with its own computed_at once its inserts are done. Called by cron
  -- with no argument: keep the newest run that is at least 15 minutes old, so a run still
  -- being inserted is never mistaken for the one to keep (and never deleted either).
  v_keep  timestamptz := coalesce(p_keep, (select max(computed_at) from public.indicator_sales where computed_at < now() - interval '15 minutes'));
  v_old   timestamptz;
  v_n     bigint := 0;
  v_w     bigint := 0;
begin
  if v_keep is null then return 0; end if;
  select min(computed_at) into v_old from public.indicator_sales where computed_at < v_keep;
  if v_old is not null then
    delete from public.indicator_sales where computed_at = v_old;
    get diagnostics v_n = row_count;
  end if;
  -- indicator_weekly is small (≈20k rows): clear every older run at once.
  delete from public.indicator_weekly where computed_at < v_keep;
  get diagnostics v_w = row_count;
  return v_n + v_w;
end $$;
revoke all on function public.indicator_tables_prune(timestamptz) from public, anon, authenticated;
grant execute on function public.indicator_tables_prune(timestamptz) to service_role;

-- 2. Row hash on the mirror + the id→hash read (one text blob, ~3 MB for 109k rows).
alter table public.crm_subscriptions add column if not exists row_hash text;

create or replace function public.crm_subscriptions_hashes()
returns text
language sql
security definer
set search_path = public
set statement_timeout = '120s'
stable
as $$
  select coalesce(string_agg(subscription_id || E'\t' || coalesce(row_hash, ''), E'\n'), '') from public.crm_subscriptions;
$$;
revoke all on function public.crm_subscriptions_hashes() from public, anon, authenticated;
grant execute on function public.crm_subscriptions_hashes() to service_role;

-- 3. Safety net: keep only the newest run, every 10 minutes, no matter who wrote it.
--    Requires pg_cron (Database → Extensions). Re-runnable: unschedules first.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'indicator-tables-prune';
    perform cron.schedule('indicator-tables-prune', '*/10 * * * *', $cron$select public.indicator_tables_prune()$cron$);
  else
    raise notice 'pg_cron is not enabled — enable it under Database → Extensions and re-run section 3 to add the safety prune.';
  end if;
end $$;
