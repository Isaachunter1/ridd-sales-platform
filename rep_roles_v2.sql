-- rep_roles_v2.sql — re-runnable. Adds the role enum values the app already
-- writes but no tracked migration ever created (prod has them via an ad-hoc
-- statement; a rebuild/staging clone would break user creation without this),
-- plus the auto-revoke undo columns.

-- Roles the app writes today:
alter type public.user_role add value if not exists 'rep_partner';
alter type public.user_role add value if not exists 'rep_office_lead';
alter type public.user_role add value if not exists 'disabled';

-- Auto-revoke memory: the sync stores the role it took away so a re-hire /
-- CRM reactivation restores the RIGHT role automatically (no admin guessing
-- between rep_sales / rep_partner / rep_office_lead).
alter table public.profiles add column if not exists previous_role public.user_role;
alter table public.profiles add column if not exists access_revoked_at timestamptz;
