-- ────────────────────────────────────────────────────────────────────────
-- Retention save attempts (P3-5 in AUDIT.md). The Daily Pulse churn list
-- shows who cancelled and why; this closes the loop — who called the
-- account, when, and what happened. Append-only log keyed by the CRM
-- customer #. Any signed-in user can log an attempt (as themselves) and
-- read them; only admins can delete. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.save_attempts (
  id               bigserial primary key,
  customer_id      text not null,
  subscription_id  text,
  office_name      text,
  cancel_date      date,
  outcome          text not null check (outcome in ('saved', 'callback', 'no_answer', 'declined', 'other')),
  note             text,
  attempted_by     uuid not null default auth.uid() references public.profiles (id) on delete set null,
  attempted_at     timestamptz not null default now()
);
create index if not exists save_attempts_customer_idx on public.save_attempts (customer_id, attempted_at desc);
alter table public.save_attempts enable row level security;
drop policy if exists "save attempts: read" on public.save_attempts;
create policy "save attempts: read" on public.save_attempts
  for select to authenticated using (true);
drop policy if exists "save attempts: insert own" on public.save_attempts;
create policy "save attempts: insert own" on public.save_attempts
  for insert to authenticated with check (attempted_by = auth.uid());
drop policy if exists "save attempts: admin delete" on public.save_attempts;
create policy "save attempts: admin delete" on public.save_attempts
  for delete to authenticated using (public.is_admin());
