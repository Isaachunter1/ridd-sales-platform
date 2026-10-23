-- market_feed.fieldroutes_employees: add employee_ids (every branch id in the
-- person's roaming group, comma-separated) so riddmarket can collapse split
-- identities the same way the app does. Column is appended, so no drop needed.
create or replace view market_feed.fieldroutes_employees as
  select employee_id, fname, lname, nickname, office_id, office_name, office_ids, type, type_label, active, synced_at, employee_ids
  from public.fieldroutes_employees;
insert into public.schema_migrations (name) values ('20260917_market_feed_employee_ids.sql') on conflict do nothing;
