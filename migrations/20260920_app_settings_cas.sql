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
