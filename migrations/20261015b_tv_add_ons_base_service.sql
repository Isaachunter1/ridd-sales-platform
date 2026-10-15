-- 20261015b_tv_add_ons_base_service.sql — re-runnable. Paste into the Supabase SQL editor.
-- TV + Sales tab show a sale as "Pest 6 + Mole + Rodent" (per Isaac, Oct 15). An add-on sold on its own
-- needs the plan it went on, so tv_add_ons() also returns base_service. Still no money / pay fields.
drop function if exists public.tv_add_ons(date);
create function public.tv_add_ons(since date default null)
returns table (
  subscription_id      text,
  customer_id          text,
  service_name         text,
  added_at             date,
  credited_profile_id  uuid,
  credited_employee_id text,
  base_service         text
)
language sql
stable
security definer
set search_path = public
as $$
  select a.subscription_id, a.customer_id, a.service_name, a.added_at, a.credited_profile_id,
         a.credited_employee_id::text, a.base_service
  from public.add_ons a
  where a.removed_at is null
    and a.added_at >= coalesce(since, current_date - 400)
$$;

revoke all on function public.tv_add_ons(date) from public;
revoke all on function public.tv_add_ons(date) from anon;
grant execute on function public.tv_add_ons(date) to authenticated;
