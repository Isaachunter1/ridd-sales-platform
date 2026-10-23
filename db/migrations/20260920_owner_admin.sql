-- ────────────────────────────────────────────────────────────────────────
-- OWNER ADMIN (per Isaac, Sep 2026). Exactly ONE profile carries
-- is_owner = true. The owner is the only person who can grant or remove
-- admin access (role admin / admin_rep ↔ anything else) and the only one
-- who can hand ownership to another admin. Server syncs (service role,
-- no auth.uid()) are never blocked.
--
-- Run once in the Supabase SQL editor. Re-runnable. Then claim ownership:
--   select public.claim_owner('you@ridd.com');   -- only works while no owner exists
-- ────────────────────────────────────────────────────────────────────────

alter table public.profiles add column if not exists is_owner boolean not null default false;
create unique index if not exists profiles_single_owner on public.profiles (is_owner) where is_owner;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and is_owner);
$$;
grant execute on function public.is_owner() to authenticated;

create or replace function public.profiles_role_guard()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  admin_roles text[] := array['admin', 'admin_rep'];
  was_admin boolean := OLD.role::text = any(admin_roles);
  is_admin_now boolean := NEW.role::text = any(admin_roles);
begin
  -- Server-side jobs (service role) and nested statements from this guard
  -- pass straight through.
  if auth.uid() is null or pg_trigger_depth() > 1 then return NEW; end if;

  -- Admin access changes hands only through the owner.
  if was_admin and not is_admin_now and not public.is_owner() then
    raise exception 'Only the Admin - Owner can remove admin access from %', coalesce(OLD.full_name, OLD.email);
  end if;
  if is_admin_now and not was_admin and not public.is_owner() then
    raise exception 'Only the Admin - Owner can grant admin access to %', coalesce(NEW.full_name, NEW.email);
  end if;

  -- Ownership transfer: owner sets is_owner on another ADMIN; the previous
  -- owner (the caller) drops back to a plain admin in the same statement.
  if NEW.is_owner is distinct from OLD.is_owner then
    -- First claim (nobody owns the app yet) is open to any admin; after
    -- that only the owner can move the flag.
    if not public.is_owner() and exists (select 1 from public.profiles where is_owner) then
      raise exception 'Only the Admin - Owner can transfer ownership';
    end if;
    if NEW.is_owner then
      if not is_admin_now then
        raise exception 'Ownership can only go to an Admin or Admin + Sales account';
      end if;
      update public.profiles set is_owner = false where is_owner and id <> NEW.id;
    elsif NEW.id = auth.uid() then
      raise exception 'Transfer ownership to another admin instead of removing it';
    end if;
  end if;

  -- The owner always stays an admin.
  if NEW.is_owner and not is_admin_now then
    raise exception 'The Admin - Owner has to keep an admin role — transfer ownership first';
  end if;
  return NEW;
end;
$$;

drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard
  before update of role, is_owner on public.profiles
  for each row execute function public.profiles_role_guard();

-- One-time claim: works only while nobody owns the app.
create or replace function public.claim_owner(email text)
returns void language plpgsql security definer set search_path = public as $$
declare
  target_id uuid;
begin
  if exists (select 1 from public.profiles where is_owner) then
    raise exception 'An owner already exists — transfer ownership from Settings → Users instead';
  end if;
  select id into target_id from public.profiles p where lower(p.email) = lower(claim_owner.email);
  if target_id is null then
    select id into target_id from auth.users u where lower(u.email) = lower(claim_owner.email);
  end if;
  if target_id is null then raise exception 'No profile found for %', email; end if;
  update public.profiles set is_owner = true, role = case when role::text in ('admin','admin_rep') then role else 'admin_rep'::public.user_role end where id = target_id;
end;
$$;
revoke all on function public.claim_owner(text) from public;
