-- ────────────────────────────────────────────────────────────────────────
-- Pay runs (provenance audit, Sep 2026). Inside Sales pay was recomputed
-- from CURRENT rates on every render and "Run Pay Period" only stamped a
-- date, so no historical stub could be reproduced. Now every upfront /
-- backend run stores what it paid and every input it used (per-sale rate,
-- tier multiplier, settings snapshot). Append-only. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.pay_runs (
  id            bigserial primary key,
  rep_id        uuid not null references public.profiles (id) on delete cascade,
  pay_year      int not null,
  period_id     int not null,
  period_label  text,
  kind          text not null check (kind in ('upfront', 'backend')),
  totals        jsonb not null default '{}'::jsonb,
  inputs        jsonb not null default '{}'::jsonb,
  sale_ids      bigint[] not null default '{}',
  run_by        uuid default auth.uid(),
  run_at        timestamptz not null default now()
);
create index if not exists pay_runs_rep_period_idx on public.pay_runs (rep_id, pay_year, period_id, kind, run_at desc);
alter table public.pay_runs enable row level security;
drop policy if exists "pay runs: read own or admin" on public.pay_runs;
create policy "pay runs: read own or admin" on public.pay_runs
  for select to authenticated using (rep_id = auth.uid() or public.is_admin());
drop policy if exists "pay runs: admin insert" on public.pay_runs;
create policy "pay runs: admin insert" on public.pay_runs
  for insert to authenticated with check (public.is_admin());
