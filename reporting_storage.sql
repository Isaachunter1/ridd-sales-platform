-- ────────────────────────────────────────────────────────────────────────
-- FAST SNAPSHOT STORAGE
--
-- Snapshots are stored as ONE gzipped JSON object in Supabase Storage
-- instead of ~78 chunked row-inserts. Upload = single PUT (seconds);
-- load = single download (no pagination, no dropped pages).
--
-- reporting_uploads.storage_path points at the object; old snapshots
-- without it still load through the legacy row-table path.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.reporting_uploads
  add column if not exists storage_path text;

insert into storage.buckets (id, name, public)
values ('reporting', 'reporting', false)
on conflict (id) do nothing;

drop policy if exists "reporting storage: admin read"   on storage.objects;
drop policy if exists "reporting storage: admin insert" on storage.objects;
drop policy if exists "reporting storage: admin update" on storage.objects;
drop policy if exists "reporting storage: admin delete" on storage.objects;

create policy "reporting storage: admin read"
  on storage.objects for select
  using (bucket_id = 'reporting' and public.is_admin());

create policy "reporting storage: admin insert"
  on storage.objects for insert
  with check (bucket_id = 'reporting' and public.is_admin());

-- Required for upsert re-uploads: overwriting an existing object is an
-- UPDATE on storage.objects, so without this policy the FIRST share works
-- and every subsequent re-upload fails RLS (other admins stay stuck on
-- the previous snapshot).
create policy "reporting storage: admin update"
  on storage.objects for update
  using (bucket_id = 'reporting' and public.is_admin())
  with check (bucket_id = 'reporting' and public.is_admin());

create policy "reporting storage: admin delete"
  on storage.objects for delete
  using (bucket_id = 'reporting' and public.is_admin());
