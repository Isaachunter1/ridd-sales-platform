-- ────────────────────────────────────────────────────────────────────────
-- FIELDROUTES SOURCE SYNC — the RevHawk sync (every 30 min) mirrors the
-- FieldRoutes source master list into public.sources:
--   • a source added in FieldRoutes appears in the app automatically
--   • hiding/showing a source in FieldRoutes carries over to the app
--   • an in-app visibility override sticks until FieldRoutes changes again
--     (fr_visible remembers the last CRM state — only a CRM-side CHANGE
--      flips is_active)
--   • app-only sources (no fr_source_id) are never touched
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.sources add column if not exists fr_source_id text;         -- FieldRoutes sourceID(s), comma-joined when the CRM has duplicate names
alter table public.sources add column if not exists fr_visible   boolean;      -- last visibility seen in FieldRoutes (change detector)
alter table public.sources add column if not exists fr_synced_at timestamptz;  -- last time the CRM sync touched this row

-- One app row per CRM source.
create unique index if not exists sources_fr_source_id_key
  on public.sources (fr_source_id)
  where fr_source_id is not null;
