-- Rep goals for CRM roster reps who have no app account yet (per Isaac,
-- Sep 24): partners see every rep Manage Teams assigns to their team, not
-- just the ones who have logged in. Keyed by canonical CRM name + year;
-- when the rep gets an account the Goals card keeps reading this row.
create table if not exists public.rep_name_goals (
  year        int  not null,
  name        text not null,
  revenue     numeric not null default 0,
  goals       jsonb not null default '{}'::jsonb,
  updated_by  uuid references public.profiles(id),
  updated_at  timestamptz not null default now(),
  primary key (year, name)
);
alter table public.rep_name_goals enable row level security;
drop policy if exists "rep_name_goals read" on public.rep_name_goals;
create policy "rep_name_goals read" on public.rep_name_goals for select to authenticated using (true);

create or replace function public.set_rep_name_goals(yr int, nm text, revenue numeric, goals jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare caller_role text;
begin
  select role into caller_role from public.profiles where id = auth.uid();
  if caller_role is null then raise exception 'not signed in'; end if;
  if not (public.is_admin() or caller_role in ('rep_partner', 'rep_team_lead')) then
    raise exception 'not allowed to set rep goals';
  end if;
  insert into public.rep_name_goals (year, name, revenue, goals, updated_by, updated_at)
  values (yr, nm, coalesce(revenue, 0), coalesce(goals, '{}'::jsonb), auth.uid(), now())
  on conflict (year, name) do update
    set revenue = excluded.revenue, goals = excluded.goals, updated_by = excluded.updated_by, updated_at = now();
end $$;
grant execute on function public.set_rep_name_goals(int, text, numeric, jsonb) to authenticated;
insert into public.schema_migrations (name) values ('20260924_rep_name_goals.sql') on conflict do nothing;
