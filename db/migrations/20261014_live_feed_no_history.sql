-- ────────────────────────────────────────────────────────────────────────
-- The FieldRoutes live pull (every 15 min) now publishes two machine-written
-- feeds to app_settings for the TV board: crm_signed_recent (who signed in
-- the last two days) and crm_live_recent (every subscription added in the
-- last two days). They change most runs and the live feed is ~100–300 KB, so
-- keeping old+new copies in app_settings_history would bloat it with nothing
-- anyone would roll back to. Same history trigger, minus those keys.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────
create or replace function public.app_settings_track()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if NEW.key in ('crm_live_recent', 'crm_signed_recent') then return NEW; end if;
  if TG_OP = 'UPDATE' and NEW.value is not distinct from OLD.value then return NEW; end if;
  insert into public.app_settings_history (key, old_value, new_value, changed_by)
  values (NEW.key, case when TG_OP = 'UPDATE' then OLD.value else null end, NEW.value, auth.uid());
  return NEW;
end;
$$;

-- Clear what the signed feed already wrote there.
delete from public.app_settings_history where key in ('crm_live_recent', 'crm_signed_recent');
