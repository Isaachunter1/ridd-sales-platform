-- ────────────────────────────────────────────────────────────────────────
-- REP-TYPE ACCESS — let a signed-in user read THEIR OWN row of the CRM
-- roster mirror (fieldroutes_employees), so the app can shape access by
-- rep type: Sales Rep → Competitions tab only · Office Staff → Competitions
-- + Inside Sales. Admin read stays as-is; this adds one narrow self-read.
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

drop policy if exists "fr_employees: read own row" on public.fieldroutes_employees;
create policy "fr_employees: read own row"
  on public.fieldroutes_employees for select
  to authenticated
  using (
    lower(coalesce(email, '')) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or employee_id = (select fieldroutes_employee_id from public.profiles where id = auth.uid())
  );
