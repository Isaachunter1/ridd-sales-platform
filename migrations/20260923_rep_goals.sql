-- Per-rep yearly goals set by partners / team leads from Settings → Goals.
-- annual_revenue_goal already drives the Individual pacer; year_goals holds
-- the rest ({accounts, acv, retained_pct, other}). The RPC lets a partner
-- write goals for sales reps without profile-wide update rights.
alter table public.profiles add column if not exists year_goals jsonb not null default '{}'::jsonb;

create or replace function public.set_rep_goals(target uuid, revenue numeric, goals jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare caller_role text;
begin
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is null then raise exception 'not signed in'; end if;
  if not (public.is_admin() or caller_role in ('rep_partner', 'rep_team_lead')) then
    raise exception 'not allowed to set rep goals';
  end if;
  update public.profiles
     set annual_revenue_goal = coalesce(revenue, 0),
         year_goals = coalesce(goals, '{}'::jsonb)
   where id = target
     and role in ('rep_sales', 'rep_partner', 'rep_team_lead', 'rep');
end $$;
grant execute on function public.set_rep_goals(uuid, numeric, jsonb) to authenticated;

-- Goals are behind the profiles self-read policy; partners read their reps'
-- goals through this (admins / partners / team leads only, sales reps only).
create or replace function public.rep_goals_all()
returns table (id uuid, annual_revenue_goal numeric, year_goals jsonb)
language sql security definer set search_path = public as $$
  select p.id, p.annual_revenue_goal, p.year_goals
    from public.profiles p
   where p.role in ('rep_sales', 'rep_partner', 'rep_team_lead', 'rep')
     and exists (select 1 from public.profiles c where c.id = auth.uid() and (public.is_admin() or c.role in ('rep_partner', 'rep_team_lead')));
$$;
grant execute on function public.rep_goals_all() to authenticated;
insert into public.schema_migrations (name) values ('20260923_rep_goals.sql') on conflict do nothing;
