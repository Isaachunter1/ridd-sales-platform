-- 20261014b_tv_add_ons_employee.sql — re-runnable. Paste into the Supabase SQL editor.
-- TV add-ons: also return WHO FieldRoutes credits (Commission To). The board
-- turned an add-on red when it had no APP profile — Dylan Kozian's Snake on
-- #107904 is credited to him in FieldRoutes, but his FieldRoutes login isn't
-- linked to an app account yet. Red now means "credited to nobody in
-- FieldRoutes". Still no money, streak or pay fields.
drop function if exists public.tv_add_ons(date);
create function public.tv_add_ons(since date default null)
returns table (
  subscription_id      text,
  customer_id          text,
  service_name         text,
  added_at             date,
  credited_profile_id  uuid,
  credited_employee_id text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.subscription_id, a.customer_id, a.service_name, a.added_at, a.credited_profile_id, a.credited_employee_id::text
  from public.add_ons a
  where a.removed_at is null
    and a.added_at >= coalesce(since, current_date - 400)
$$;

revoke all on function public.tv_add_ons(date) from public;
revoke all on function public.tv_add_ons(date) from anon;
grant execute on function public.tv_add_ons(date) to authenticated;
