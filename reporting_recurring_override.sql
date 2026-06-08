-- ────────────────────────────────────────────────────────────────────────
-- SERVICE RECURRING OVERRIDE
--
-- Adds a tri-state override so the Configurations tab can pin a service as
-- recurring or non-recurring, independent of the revenue-based guess:
--
--   recurring_override = NULL   → follow the data (recurring if the service
--                                 has any Annual Recurring Value)  [default]
--   recurring_override = true   → force recurring
--   recurring_override = false  → force non-recurring
--
-- Any service previously hand-marked recurring (is_recurring = true) is
-- preserved as an explicit override so existing choices don't reset.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.reporting_service_config
  add column if not exists recurring_override boolean;

update public.reporting_service_config
   set recurring_override = true
 where is_recurring = true
   and recurring_override is null;
