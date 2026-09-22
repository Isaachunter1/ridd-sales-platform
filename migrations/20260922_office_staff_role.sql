-- 20260922_office_staff_role.sql — re-runnable. Paste into the Supabase SQL editor.
-- Office Staff - Office (per Isaac): a non-selling office user (Cameron, Casey).
-- Works in the office, isn't a rep — no player card, no pay stub, not on the
-- leaderboard; sees the boards and the Inside Sales tabs. Permissions are
-- tunable in Settings → Permissions like any other role.
alter type public.user_role add value if not exists 'office_staff';
