-- ────────────────────────────────────────────────────────────────────────
-- AUDITING SUB-TAB (Reporting) SCHEMA ADDITION
--
-- customer_flags on reporting_subscriptions — carries the FieldRoutes
-- Customer Flags column (Passed Audit / Failed Audit / No Audit /
-- Sent to Collections / …) so the Reporting → Auditing sub-tab can read
-- audit results straight from the reporting snapshot.
--
-- Re-runnable. After running, RE-UPLOAD the Customer Report (with the
-- Flags column included) so the new field populates.
-- ────────────────────────────────────────────────────────────────────────

alter table public.reporting_subscriptions
  add column if not exists customer_flags text;
