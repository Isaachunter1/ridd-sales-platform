-- rep_roles_v4.sql — re-runnable. Adds the plain Loyalty rep role.
--   rep_loyalty  →  "Office Staff - Loyalty Rep"  (NEW — a loyalty-typed office
--                   staff rep; same permissions as an Inside Sales Rep, self-only
--                   reach. rep_loyalty_lead stays the Loyalty Team Lead.)
alter type public.user_role add value if not exists 'rep_loyalty';
