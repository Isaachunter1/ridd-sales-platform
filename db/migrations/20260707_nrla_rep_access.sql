-- ────────────────────────────────────────────────────────────────────────
-- NRLA REP ACCESS — let every signed-in user READ the shared indicator
-- config and the shared indicators dataset, so the rep-facing NRLA board
-- works for non-admins. Writes stay admin-gated in the app (and by any
-- existing write policies — this file adds READ access only).
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

-- Shared config (teams / rosters / competitions).
drop policy if exists "indicator_config readable by authenticated" on public.indicator_config;
create policy "indicator_config readable by authenticated"
  on public.indicator_config for select
  to authenticated
  using (true);

-- Shared indicators dataset blob (reporting bucket → indicators/latest.json.gz)
-- plus the reporting snapshots the board derives from.
drop policy if exists "reporting bucket readable by authenticated" on storage.objects;
create policy "reporting bucket readable by authenticated"
  on storage.objects for select
  to authenticated
  using (bucket_id = 'reporting');
