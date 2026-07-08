-- ────────────────────────────────────────────────────────────────────────
-- REP SELF-SETTINGS — lets a signed-in user set THEIR OWN annual revenue
-- goal from the ⚙ My Settings sheet, without opening up profile writes.
-- SECURITY DEFINER + fixed WHERE id = auth.uid() means: own row only, one
-- column only — a rep cannot touch roles, rates, or anyone else's record.
-- (Password changes go through Supabase Auth directly — no SQL needed.)
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.set_my_goal(goal numeric)
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set annual_revenue_goal = greatest(0, coalesce(goal, 0))
   where id = auth.uid();
$$;

revoke all on function public.set_my_goal(numeric) from public;
grant execute on function public.set_my_goal(numeric) to authenticated;
