-- rep_roles_v3.sql — re-runnable. Adds the Loyalty team-lead role.
--
-- Role split (per Isaac):
--   rep_office_lead   →  "Rep - Inside Sales Team Lead"  (label rename only,
--                        the enum value stays rep_office_lead so existing
--                        accounts keep working unchanged)
--   rep_loyalty_lead  →  "Rep - Loyalty Team Lead"       (NEW — team lead for
--                        loyalty-typed office staff; same dept-wide reach and
--                        scorecard powers as the inside-sales lead)
alter type public.user_role add value if not exists 'rep_loyalty_lead';
