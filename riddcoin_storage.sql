-- ═══════════════════════════════════════════════════════════════════════
-- RIDDCOIN STORE PHOTOS — public bucket for marketplace item images.
-- Run AFTER riddcoin.sql in the Supabase SQL Editor. Safe to re-run.
--   · Bucket "riddcoin" is PUBLIC-read (product photos, nothing sensitive)
--   · Only admins (riddcoin_is_admin) can upload / delete
-- ═══════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public)
  values ('riddcoin', 'riddcoin', true)
  on conflict (id) do update set public = true;

drop policy if exists riddcoin_photos_read on storage.objects;
create policy riddcoin_photos_read on storage.objects
  for select using (bucket_id = 'riddcoin');

drop policy if exists riddcoin_photos_insert on storage.objects;
create policy riddcoin_photos_insert on storage.objects
  for insert to authenticated with check (bucket_id = 'riddcoin' and riddcoin_is_admin());

drop policy if exists riddcoin_photos_update on storage.objects;
create policy riddcoin_photos_update on storage.objects
  for update to authenticated using (bucket_id = 'riddcoin' and riddcoin_is_admin());

drop policy if exists riddcoin_photos_delete on storage.objects;
create policy riddcoin_photos_delete on storage.objects
  for delete to authenticated using (bucket_id = 'riddcoin' and riddcoin_is_admin());
