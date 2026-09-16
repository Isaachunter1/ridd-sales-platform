-- ────────────────────────────────────────────────────────────────────────
-- REP ROLES — explicit access profiles instead of deriving from CRM type:
--   rep_sales   →  "Rep - Sales Rep"    (Competitions + rep-lite Indicators)
--   rep_office  →  "Rep - Office Staff" (Competitions + Inside Sales)
-- The legacy 'rep' role keeps working: it falls back to the CRM rep-type
-- lookup, so existing accounts behave exactly as before.
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter type public.user_role add value if not exists 'rep_sales';
alter type public.user_role add value if not exists 'rep_office';
