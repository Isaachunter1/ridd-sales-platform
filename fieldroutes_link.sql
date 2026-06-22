-- ────────────────────────────────────────────────────────────────────────────
-- FieldRoutes ↔ app identity link
-- ────────────────────────────────────────────────────────────────────────────
-- Run this once in the Supabase SQL editor. It does three things:
--
--   1. Creates `fieldroutes_employees` — a mirror of the CRM employee roster.
--      The nightly RevHawk sync upserts every FieldRoutes employee here. These
--      are NOT app logins (a profile requires an auth.users row); they're the
--      pool the Users screen shows as "in CRM, not in the app yet." Toggling one
--      on provisions a real profile pre-filled from this row (name/email/phone).
--
--   2. Adds `fieldroutes_employee_id` to `profiles` — the stable key that joins
--      an app user to their CRM sales, replacing fragile rep-name matching.
--
--   3. Adds `phone` to `profiles` so the CRM phone carries over on provision.
--
-- Safe to re-run (everything is IF NOT EXISTS / idempotent).

-- 1. CRM employee roster (written by the sync's service role) ──────────────────
create table if not exists public.fieldroutes_employees (
  employee_id text primary key,          -- fieldRoutes_employeeID (the join key)
  fname       text,
  lname       text,
  nickname    text,
  email       text,
  phone       text,
  office_id   text,
  office_name text,                       -- resolved via the sync's office map
  type        text,                       -- raw fieldRoutes_type ('0','1','2')
  type_label  text,                       -- Office Staff / Technician / Sales Rep
  active      boolean,                    -- fieldRoutes_active (see caveat in app)
  last_login  text,                       -- fieldRoutes_lastLogin (recency signal)
  synced_at   timestamptz not null default now()
);

alter table public.fieldroutes_employees enable row level security;

-- The roster carries employee PII (emails/phones), so only admins/auditors read
-- it — that's who the linking + provisioning UI is for. The sync writes with the
-- service role, which bypasses RLS, so no insert/update policy is needed.
drop policy if exists "fr_employees: admin read" on public.fieldroutes_employees;
create policy "fr_employees: admin read" on public.fieldroutes_employees
  for select using (public.is_admin_or_auditor());

-- 2 + 3. Link key + phone on profiles ─────────────────────────────────────────
alter table public.profiles
  add column if not exists phone text,
  add column if not exists fieldroutes_employee_id text;

-- One CRM employee maps to at most one app profile.
create unique index if not exists profiles_fr_emp_uidx
  on public.profiles(fieldroutes_employee_id)
  where fieldroutes_employee_id is not null;
