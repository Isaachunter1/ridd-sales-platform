-- ────────────────────────────────────────────────────────────────────────
-- MY GOAL WINDOW (per Isaac, Oct 16) — every user with a player card sets the
-- start and end date of their selling year next to their annual goal (Settings
-- → Goals). The Revenue Pacer counts work days inside that window (Sales Reps
-- Mon–Sat with July 4 off; Office Staff / Technicians Mon–Fri, company holidays
-- off) to show what they need per work day to hit the goal.
--
-- Same pattern as set_my_goal: SECURITY DEFINER, own row only, and it only
-- touches two keys inside profiles.year_goals (goal_start / goal_end).
-- Passing nulls clears them (back to the default window).
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.set_my_goal_window(p_start date, p_end date)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    raise exception 'end date is before the start date';
  end if;
  update public.profiles
     set year_goals = (coalesce(year_goals, '{}'::jsonb) - 'goal_start' - 'goal_end')
                      || jsonb_strip_nulls(jsonb_build_object('goal_start', p_start, 'goal_end', p_end))
   where id = auth.uid();
end $$;

revoke all on function public.set_my_goal_window(date, date) from public;
grant execute on function public.set_my_goal_window(date, date) to authenticated;
