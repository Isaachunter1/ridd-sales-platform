-- ────────────────────────────────────────────────────────────────────────
-- FIELDROUTES SOURCE SYNC — the RevHawk sync (every 30 min) mirrors the
-- FieldRoutes source master list into public.sources as a STRICT MIRROR:
--   • a source added in FieldRoutes appears in the app automatically
--   • CRM visibility is authoritative — hide/show in FieldRoutes only
--   • any app source NOT in the CRM list is hidden automatically
--     (not deleted — past sales keep pointing at their source name)
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
