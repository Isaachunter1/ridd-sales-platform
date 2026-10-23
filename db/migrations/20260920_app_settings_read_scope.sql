-- ────────────────────────────────────────────────────────────────────────
-- P0 (found during the audit): app_settings was readable by EVERY signed-in
-- user, and `commission_config` carries every rep's manual pay entries
-- (rent, paid-to-date, overrides, audit deductions) plus per-rep rate
-- overrides. Only admins ever load it in the app; the database now says so.
-- Company-wide keys (pay_settings rules, company_goal, autolog, crm_deleted,
-- mystery_boxes, company_logo) stay readable — reps' own stubs need them.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists "settings: sensitive keys admin only" on public.app_settings;
create policy "settings: sensitive keys admin only" on public.app_settings
  as restrictive for select to authenticated
  using (
    key not in ('commission_config', 'commission_locks', 'source_spend')
    or public.is_admin()
  );
