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
