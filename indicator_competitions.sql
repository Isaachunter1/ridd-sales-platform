-- ────────────────────────────────────────────────────────────────────────
-- INDICATOR COMPETITIONS
--
-- Stores per-competition configuration for the Indicators tab (Comps mode).
-- Each competition carries its own excluded-teams list; the active one drives
-- every number while Comps is on. Shape:
--   { "active": "top_gun",
--     "list": [ { "id": "top_gun", "name": "Top Gun", "excludedTeams": [...] },
--               { "id": "spring_cleaning", "name": "Spring Cleaning", "excludedTeams": [...] } ] }
--
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.indicator_config
  add column if not exists competitions jsonb;
