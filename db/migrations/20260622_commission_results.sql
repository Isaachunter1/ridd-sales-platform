-- ────────────────────────────────────────────────────────────────────────────
-- Commission results — published, per-rep pay breakdowns
-- ────────────────────────────────────────────────────────────────────────────
-- Run once in the Supabase SQL editor. The Commission Calculator (admin) writes
-- one row per rep when "Publish to rep" is clicked; each rep can read ONLY their
-- own row (matched by the FieldRoutes employee id linked on their profile), so
-- the rep-facing "My Commission" tab never exposes anyone else's pay.

create table if not exists public.commission_results (
  employee_id   text primary key,          -- FieldRoutes Base EID (matches profiles.fieldroutes_employee_id)
  data          jsonb not null,            -- the computed breakdown snapshot
  period_start  date,
  period_end    date,
  published_by  uuid references public.profiles(id),
  published_at  timestamptz not null default now()
);

alter table public.commission_results enable row level security;

-- Admins (and admin_reps) manage every row.
drop policy if exists "comm_results: admin all" on public.commission_results;
create policy "comm_results: admin all" on public.commission_results
  for all using (public.is_admin()) with check (public.is_admin());

-- A rep may read only the row whose employee_id matches the FieldRoutes id
-- linked on their own profile.
drop policy if exists "comm_results: self read" on public.commission_results;
create policy "comm_results: self read" on public.commission_results
  for select using (
    employee_id = (select p.fieldroutes_employee_id from public.profiles p where p.id = auth.uid())
  );
