-- Roster view: the columns every signed-in user may see about every
-- other user (names, avatars, roles, types, offices). Pay rates, goals,
-- emails and Slack ids stay behind the `profiles` RLS (self or admin).
-- Views run as their owner (postgres) unless security_invoker is set, so
-- this deliberately bypasses the profiles self-read policy — for these
-- columns only. Run once in Supabase → SQL editor.
create or replace view public.profiles_roster as
  select id, full_name, initials, avatar_url, role, office_id, rep_type, is_active, created_at
  from public.profiles;
grant select on public.profiles_roster to authenticated;
