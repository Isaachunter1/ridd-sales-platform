-- 20261001_developer_role.sql — re-runnable. Paste into the Supabase SQL editor.
-- Developer (per Isaac, Oct 1): the tech guy's role. Sees every layer of the
-- app (all three Sales worlds, Loyalty, Competitions, Indicators, read-only
-- Reporting, non-sensitive Settings) but no P&L / Marketing spend, pay stubs,
-- commission rules, goals, users, usage or Connections. What it sees is set in
-- the app (Settings → Permissions → Developer); on the database it is an
-- ordinary signed-in user — NOT admin — so every admin-only table and policy
-- (pay settings, commission results, integrations, all reps' sales) stays
-- closed to it.
alter type public.user_role add value if not exists 'developer';
insert into public.schema_migrations (name) values ('20261001_developer_role.sql') on conflict do nothing;
