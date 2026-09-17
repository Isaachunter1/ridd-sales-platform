-- ═══════════════════════════════════════════════════════════════════════
-- FEEDBACK ATTACHMENTS (per Isaac, Sep 17 2026)
-- Reps can attach screenshots / screen recordings / notes to in-app
-- feedback. Files land in a PRIVATE "feedback" bucket under the sender's
-- own folder; the attachment list rides usage_events.meta so the Adoption
-- → Feedback drill-down can show them (admins read via signed URLs).
-- Run in the Supabase SQL Editor. Safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.usage_events add column if not exists meta jsonb;
comment on column public.usage_events.meta is 'feedback: { attachments: [{ path, name, type, size }] }';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('feedback', 'feedback', false, 52428800, array['image/png','image/jpeg','image/gif','image/webp','image/heic','video/mp4','video/quicktime','video/webm','text/plain'])
  on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

-- Anyone signed in can upload into THEIR OWN folder (<uid>/...).
drop policy if exists feedback_files_insert on storage.objects;
create policy feedback_files_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'feedback' and (storage.foldername(name))[1] = auth.uid()::text);

-- Admins read everything; senders can read their own.
drop policy if exists feedback_files_read on storage.objects;
create policy feedback_files_read on storage.objects
  for select to authenticated
  using (bucket_id = 'feedback' and (
    (storage.foldername(name))[1] = auth.uid()::text
    or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('admin', 'admin_rep'))
  ));

notify pgrst, 'reload schema';
