-- ────────────────────────────────────────────────────────────────────────
-- APP LAST LOGIN — the Users tab's "Last Login" column shows the last
-- sign-in to the RIDD app (not FieldRoutes). Each session load stamps the
-- caller's own row through a security-definer function: own row only, one
-- column only.
--
-- Run once in the Supabase SQL editor. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists last_login_at timestamptz;

create or replace function public.touch_last_login()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set last_login_at = now()
   where id = auth.uid();
$$;

revoke all on function public.touch_last_login() from public;
grant execute on function public.touch_last_login() to authenticated;
