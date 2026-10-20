-- job_runs: the lock, the run history and the health sheet's data source, in
-- one table (docs/ARCHITECTURE.md → "The server"). Written only by the
-- server (service role). Readable by admins so the health sheet can show it.
--
-- The LOCK is the partial unique index: at most one `running` row per job.
-- A second kick inserts, hits 23505, and is told a run is in progress.

create table if not exists public.job_runs (
  id           bigint generated always as identity primary key,
  job          text        not null,
  status       text        not null check (status in ('running', 'ok', 'failed', 'stale')),
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  duration_ms  integer,
  summary      jsonb,
  error        text,
  data_as_of   timestamptz,          -- RevHawk freshness stamp for the rows the run used, when the job knows it
  version      text,                 -- JOB_VERSION (commit SHA) that produced the run
  dry_run      boolean     not null default false
);

create unique index if not exists job_runs_one_running_per_job
  on public.job_runs (job) where (status = 'running');

create index if not exists job_runs_job_started_idx on public.job_runs (job, started_at desc);

alter table public.job_runs enable row level security;

-- Admins read the history; nobody writes through PostgREST (the server uses
-- the service role, which bypasses RLS).
drop policy if exists job_runs_admin_read on public.job_runs;
create policy job_runs_admin_read on public.job_runs
  for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'admin_rep')));

comment on table public.job_runs is 'Server job runs: lock (partial unique on running), history, health. Written by server/runtime/lock.js only.';
