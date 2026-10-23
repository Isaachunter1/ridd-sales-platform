-- 20260922_technician_roles.sql — run this file ALONE (enum values can't be
-- used in the same transaction they're added in). Paste into the Supabase
-- SQL editor, then record it in schema_migrations.
-- Technician access profiles (per Isaac, Sep 22 2026):
--   tech_regional     Technician - Regional Manager   (override across their offices)
--   tech_branch       Technician - Branch Manager     (override on their office)
--   tech_senior_lead  Technician - Senior Lead Service Pro
--   tech_pro          Technician - Service Pro
-- Before this, technicians signed in on the legacy 'rep' role and the app
-- inferred "technician" from the FieldRoutes employee type; these make it
-- explicit so permissions, reach and the Pay tab can differ by level.
alter type public.user_role add value if not exists 'tech_regional';
alter type public.user_role add value if not exists 'tech_branch';
alter type public.user_role add value if not exists 'tech_senior_lead';
alter type public.user_role add value if not exists 'tech_pro';
