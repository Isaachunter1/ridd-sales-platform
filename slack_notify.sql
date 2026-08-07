-- ────────────────────────────────────────────────────────────────────────
-- PER-USER SLACK NOTIFICATIONS (per Isaac). Every user can opt in from
-- ⚙ My Settings: they paste their Slack Member ID and flip the toggle;
-- the slack-dm Netlify function then DMs them app events (audit results
-- to start). Own-row, two-columns-only writes via SECURITY DEFINER —
-- same pattern as set_my_goal. Run once in the SQL Editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists slack_member_id text;
alter table public.profiles add column if not exists slack_notify boolean not null default false;

create or replace function public.set_my_slack(member_id text, notify boolean)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set slack_member_id = nullif(trim(coalesce(member_id, '')), ''),
         slack_notify    = coalesce(notify, false)
   where id = auth.uid();
$$;

revoke all on function public.set_my_slack(text, boolean) from public;
grant execute on function public.set_my_slack(text, boolean) to authenticated;
