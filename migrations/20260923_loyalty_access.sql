-- Loyalty tab (Renewals · Customer Health) for office staff: they read the
-- same reporting snapshot the admin Retention tab uses. The snapshot blobs in
-- the reporting bucket are already readable by every signed-in user
-- (20260707_nrla_rep_access.sql); these open the snapshot list + the three
-- config lists (no customer data in any of them) to signed-in users too.
create policy "reporting_uploads: authenticated read" on public.reporting_uploads for select to authenticated using (true);
create policy "reporting_service_config: authenticated read" on public.reporting_service_config for select to authenticated using (true);
create policy "reporting_cancel_config: authenticated read" on public.reporting_cancel_config for select to authenticated using (true);
create policy "reporting_source_config: authenticated read" on public.reporting_source_config for select to authenticated using (true);

-- Renewals board is worked by several reps at once: realtime on the worklog
-- so every board moves together; delete lets a card go back to Eligible.
create policy "renewal worklog delete" on public.renewal_worklog for delete to authenticated using (true);
alter publication supabase_realtime add table public.renewal_worklog;
insert into public.schema_migrations (name) values ('20260923_loyalty_access.sql') on conflict do nothing;
