-- ===== 20260920_owner_admin.sql =====
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

-- ===== 20260920_scorecard_write_policies.sql =====
-- ────────────────────────────────────────────────────────────────────────
-- P0-2 (AUDIT.md): scorecards, call audits and 1:1 meeting notes were
-- writable — and readable — by ANY signed-in user. The app only lets
-- admins and team leads grade, but the database didn't enforce it, so a
-- rep could rewrite a colleague's graded calls from the browser console.
--
-- Now: leads + admins read/write everything in these tables; everyone
-- else can read their OWN rows only and write nothing.
-- Re-runnable. Run in the Supabase SQL editor.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.is_lead_or_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role::text in ('admin', 'admin_rep', 'rep_office_lead', 'rep_loyalty_lead', 'rep_partner', 'rep_team_lead')
  );
$$;
grant execute on function public.is_lead_or_admin() to authenticated;

-- scorecard_cards
drop policy if exists scorecard_cards_rw on public.scorecard_cards;
drop policy if exists scorecard_cards_read on public.scorecard_cards;
drop policy if exists scorecard_cards_write on public.scorecard_cards;
create policy scorecard_cards_read on public.scorecard_cards
  for select to authenticated using (profile_id = auth.uid() or public.is_lead_or_admin());
create policy scorecard_cards_write on public.scorecard_cards
  for all to authenticated using (public.is_lead_or_admin()) with check (public.is_lead_or_admin());

-- call_audits
drop policy if exists call_audits_rw on public.call_audits;
drop policy if exists call_audits_read on public.call_audits;
drop policy if exists call_audits_write on public.call_audits;
create policy call_audits_read on public.call_audits
  for select to authenticated using (profile_id = auth.uid() or public.is_lead_or_admin());
create policy call_audits_write on public.call_audits
  for all to authenticated using (public.is_lead_or_admin()) with check (public.is_lead_or_admin());

-- scorecard_meetings (1:1 notes)
drop policy if exists scorecard_meetings_rw on public.scorecard_meetings;
drop policy if exists scorecard_meetings_read on public.scorecard_meetings;
drop policy if exists scorecard_meetings_write on public.scorecard_meetings;
create policy scorecard_meetings_read on public.scorecard_meetings
  for select to authenticated using (profile_id = auth.uid() or public.is_lead_or_admin());
create policy scorecard_meetings_write on public.scorecard_meetings
  for all to authenticated using (public.is_lead_or_admin()) with check (public.is_lead_or_admin());

-- ===== 20260920_app_settings_read_scope.sql =====
-- ────────────────────────────────────────────────────────────────────────
-- P0 (found during the audit): app_settings was readable by EVERY signed-in
-- user, and `commission_config` carries every rep's manual pay entries
-- (rent, paid-to-date, overrides, audit deductions) plus per-rep rate
-- overrides. Only admins ever load it in the app; the database now says so.
-- Company-wide keys (pay_settings rules, company_goal, autolog, crm_deleted,
-- mystery_boxes, company_logo) stay readable — reps' own stubs need them.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
drop policy if exists "settings: sensitive keys admin only" on public.app_settings;
create policy "settings: sensitive keys admin only" on public.app_settings
  as restrictive for select to authenticated
  using (
    key not in ('commission_config', 'commission_locks', 'source_spend')
    or public.is_admin()
  );

-- ===== 20260920_app_settings_history.sql =====
-- ────────────────────────────────────────────────────────────────────────
-- Change history for money-affecting shared settings (P3-2 in AUDIT.md).
-- Every UPDATE to app_settings (pay_settings, commission_config, autolog,
-- commission_locks, company_goal…) keeps the PREVIOUS value with who
-- changed it and when, so "what changed since last payroll?" is answerable
-- and any setting can be rolled back by hand. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.app_settings_history (
  id          bigserial primary key,
  key         text not null,
  old_value   jsonb,
  new_value   jsonb,
  changed_by  uuid,
  changed_at  timestamptz not null default now()
);
create index if not exists app_settings_history_key_idx on public.app_settings_history (key, changed_at desc);
alter table public.app_settings_history enable row level security;
drop policy if exists "settings history: admin read" on public.app_settings_history;
create policy "settings history: admin read" on public.app_settings_history
  for select to authenticated using (public.is_admin());
-- (no client write policy — only the trigger below inserts)

create or replace function public.app_settings_track()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if TG_OP = 'UPDATE' and NEW.value is not distinct from OLD.value then return NEW; end if;
  insert into public.app_settings_history (key, old_value, new_value, changed_by)
  values (NEW.key, case when TG_OP = 'UPDATE' then OLD.value else null end, NEW.value, auth.uid());
  return NEW;
end;
$$;
drop trigger if exists app_settings_track on public.app_settings;
create trigger app_settings_track
  after insert or update on public.app_settings
  for each row execute function public.app_settings_track();

-- ===== 20260920_app_settings_cas.sql =====
-- ────────────────────────────────────────────────────────────────────────
-- Compare-and-swap for money-affecting app_settings keys (AUDIT.md Sprint 2).
-- pay_settings and commission_config were plain upserts: two admins editing
-- at once, or one stale laptop, silently overwrote the other's work. Same
-- pattern as save_indicator_config: the write lands only when it was based
-- on the CURRENT server copy; otherwise the caller reloads and re-applies.
-- The app falls back to the plain upsert until this has been run.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.save_app_setting(p_key text, p_value jsonb, based_on timestamptz)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  cur timestamptz;
  caller_role text;
begin
  select role::text into caller_role from public.profiles where id = auth.uid();
  if caller_role is null or caller_role not like 'admin%' then
    return jsonb_build_object('ok', false, 'error', 'admins only');
  end if;
  select updated_at into cur from public.app_settings where key = p_key;
  if cur is not null and (based_on is null or cur > based_on + interval '1 millisecond') then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur);
  end if;
  insert into public.app_settings (key, value, updated_at) values (p_key, p_value, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return jsonb_build_object('ok', true, 'updated_at', now());
end;
$$;
grant execute on function public.save_app_setting(text, jsonb, timestamptz) to authenticated;

-- ===== 20260920_save_attempts.sql =====
-- ────────────────────────────────────────────────────────────────────────
-- Retention save attempts (P3-5 in AUDIT.md). The Daily Pulse churn list
-- shows who cancelled and why; this closes the loop — who called the
-- account, when, and what happened. Append-only log keyed by the CRM
-- customer #. Any signed-in user can log an attempt (as themselves) and
-- read them; only admins can delete. Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
create table if not exists public.save_attempts (
  id               bigserial primary key,
  customer_id      text not null,
  subscription_id  text,
  office_name      text,
  cancel_date      date,
  outcome          text not null check (outcome in ('saved', 'callback', 'no_answer', 'declined', 'other')),
  note             text,
  attempted_by     uuid default auth.uid() references public.profiles (id) on delete set null,
  attempted_at     timestamptz not null default now()
);
create index if not exists save_attempts_customer_idx on public.save_attempts (customer_id, attempted_at desc);
alter table public.save_attempts enable row level security;
drop policy if exists "save attempts: read" on public.save_attempts;
create policy "save attempts: read" on public.save_attempts
  for select to authenticated using (true);
drop policy if exists "save attempts: insert own" on public.save_attempts;
create policy "save attempts: insert own" on public.save_attempts
  for insert to authenticated with check (attempted_by = auth.uid());
drop policy if exists "save attempts: admin delete" on public.save_attempts;
create policy "save attempts: admin delete" on public.save_attempts
  for delete to authenticated using (public.is_admin());

