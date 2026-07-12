-- ── Enforce single-writer on the shared indicators blob ──────────────────
-- OPTIONAL but recommended. Run once in the Supabase SQL editor.
--
-- Why: /api/sync-status caught a browser overwriting indicators/latest.json.gz
-- (7:48pm 7/11) — an old app bundle still cached on someone's device ran the
-- retired client-push code. RESTRICTIVE policies below block EVERY client
-- (any bundle age) from writing to the indicators/ path; the sync job uses
-- the service role, which bypasses RLS, so the server keeps publishing.
--
-- Trade-off: the legacy "admin uploads a CSV and it shares itself to
-- everyone" path would no longer propagate (live sync replaced it). If you
-- ever need manual CSV sharing again, it'll need a small server endpoint.
create policy "indicators blob server-only insert"
  on storage.objects as restrictive for insert to authenticated
  with check (not (bucket_id = 'reporting' and name like 'indicators/%'));

create policy "indicators blob server-only update"
  on storage.objects as restrictive for update to authenticated
  using (not (bucket_id = 'reporting' and name like 'indicators/%'));
