-- ────────────────────────────────────────────────────────────────────────
-- SERVICE LIFECYCLE + RECURRING OVERRIDE
--
-- Adds per-service config columns the Configurations tab uses to tell the
-- dashboard what each service should count as and when an active sub is stale:
--
--   lifecycle text   → 'recurring' (ongoing, active is fine)
--                      'onetime'   (flag active subs already serviced)
--                      'retired'   (flag ANY active sub — discontinued)
--                      NULL        (Auto — infer from revenue/ARV)
--
--   recurring_override boolean → legacy override, still honored:
--                      true → recurring, false → one-time, NULL → auto
--
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.reporting_service_config
  add column if not exists recurring_override boolean;

alter table public.reporting_service_config
  add column if not exists lifecycle text;

-- Preserve any service previously hand-marked recurring. Guarded so it's a
-- no-op if your schema never had an is_recurring column (avoids a hard error).
do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'reporting_service_config'
       and column_name  = 'is_recurring'
  ) then
    update public.reporting_service_config
       set recurring_override = true
     where is_recurring = true
       and recurring_override is null;
  end if;
end $$;
