-- 20261014_tv_add_ons.sql — re-runnable. Paste into the Supabase SQL editor.
-- TV display add-ons (per Isaac, Oct 14 2026). The TV's Latest sales shows
-- "ADDONS +N" on each sale and flags add-ons credited to nobody. add_ons RLS
-- only lets a non-admin read add-ons credited to themselves, so a TV signed in
-- as an office lead never saw the unassigned ones.
--
-- Instead of loosening the table policy (it carries amounts, invoices and pay
-- status), this exposes ONLY what the board needs — which plan / customer, the
-- item name, the day it was added, and who (if anyone) it is credited to — to
-- any signed-in user. No money, no streak, no pay fields.

create or replace function public.tv_add_ons(since date default null)
returns table (
  subscription_id     text,
  customer_id         text,
  service_name        text,
  added_at            date,
  credited_profile_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select a.subscription_id, a.customer_id, a.service_name, a.added_at, a.credited_profile_id
  from public.add_ons a
  where a.removed_at is null
    and a.added_at >= coalesce(since, current_date - 400)
$$;

revoke all on function public.tv_add_ons(date) from public;
revoke all on function public.tv_add_ons(date) from anon;
grant execute on function public.tv_add_ons(date) to authenticated;
