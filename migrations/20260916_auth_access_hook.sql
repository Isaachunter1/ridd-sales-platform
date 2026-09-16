-- auth_access_hook.sql — re-runnable. Run once in the Supabase SQL editor,
-- then enable it: Dashboard → Authentication → Hooks → "Customize Access
-- Token (JWT) Claims" → Postgres function → public.custom_access_token_hook.
--
-- Closes the gap Isaac raised: a rep who never logs out keeps a refresh
-- token, and a refresh silently mints a new session. With this hook Supabase
-- asks Postgres before issuing ANY access token (login AND refresh); if the
-- profile is inactive / disabled the token is refused and the app lands on
-- the login screen. Deactivate in Settings → Users and they are out within
-- one token lifetime (default 60 min) even with the app left open.
create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
declare
  uid uuid := (event->>'user_id')::uuid;
  p record;
begin
  select is_active, role into p from public.profiles where id = uid;
  if p is null then
    return event;                                  -- brand-new user, profile not created yet
  end if;
  if p.is_active = false or p.role = 'disabled' then
    raise exception 'Account deactivated. Contact an admin to restore access.';
  end if;
  return event;
end;
$$;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.custom_access_token_hook to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook from authenticated, anon, public;
grant select on table public.profiles to supabase_auth_admin;
