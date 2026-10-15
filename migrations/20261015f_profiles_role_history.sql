-- Role history (per Isaac, Oct 15): when someone started each role, for people who changed roles
-- (e.g. Sales Rep → Technician → Office Staff). [{ "role": "Office Staff", "start": "2026-09-22" }, ...]
-- Read by Rookie/Vet tiers and scorecard working days; sales attribution is unchanged (per FieldRoutes login).
alter table public.profiles add column if not exists role_history jsonb;
