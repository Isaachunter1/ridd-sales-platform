-- 20261002_developer_attribution_write.sql — re-runnable. Paste into the Supabase SQL editor.
--
-- The Developer role gets full use of Reporting → Marketing → Attribution
-- (per Isaac, Oct 2): reading was already open (the reporting bucket is
-- readable by signed-in users); this lets a developer SAVE there too —
-- upload backup lead reports and re-run the reconcile. It covers ONLY the
-- attribution file (reporting/attribution/…). Nothing QuickBooks lives in
-- that path, and every other reporting write stays admin-only.

create or replace function public.is_developer()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role::text = 'developer');
$$;

drop policy if exists "reporting storage: developer attribution insert" on storage.objects;
drop policy if exists "reporting storage: developer attribution update" on storage.objects;

create policy "reporting storage: developer attribution insert"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'reporting' and name like 'attribution/%' and public.is_developer());

create policy "reporting storage: developer attribution update"
  on storage.objects for update to authenticated
  using (bucket_id = 'reporting' and name like 'attribution/%' and public.is_developer())
  with check (bucket_id = 'reporting' and name like 'attribution/%' and public.is_developer());

insert into public.schema_migrations (name) values ('20261002_developer_attribution_write.sql') on conflict do nothing;
