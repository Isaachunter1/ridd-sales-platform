-- ────────────────────────────────────────────────────────────────────────
-- CONFIG COMPARE-AND-SWAP — deterministic end to config clobbering.
--
-- Before: every admin device pushed its ENTIRE config blob whenever it
-- thought it had changes, and Postgres happily accepted whichever arrived —
-- so one stale laptop could overwrite everyone's fresh work (this is exactly
-- how the "only NRLA shows" incident happened).
--
-- After: writes go through this function, which REJECTS any write that was
-- based on an outdated copy of the config. The client then pulls the current
-- server copy and asks the admin to re-apply their one edit — a 5-second
-- inconvenience instead of a silent company-wide rollback.
--
-- The app falls back to the old direct upsert until this has been run, so
-- deploy order doesn't matter. Run once in the Supabase SQL editor.
-- Re-runnable.
-- ────────────────────────────────────────────────────────────────────────

create or replace function public.save_indicator_config(payload jsonb, based_on timestamptz)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cur timestamptz;
  caller_role text;
begin
  -- Server-side admin check (SECURITY DEFINER bypasses RLS, so gate here).
  select role::text into caller_role from public.profiles where id = auth.uid();
  if caller_role is null or caller_role not like 'admin%' then
    return jsonb_build_object('ok', false, 'error', 'admins only');
  end if;

  select updated_at into cur from public.indicator_config where id = 1;

  -- The swap: only land if the caller's edits were based on the CURRENT
  -- server copy. A missing baseline (based_on null) with an existing server
  -- row also conflicts — a device that has never synced must read first.
  if cur is not null and (based_on is null or cur > based_on) then
    return jsonb_build_object('ok', false, 'conflict', true, 'server_updated_at', cur);
  end if;

  insert into public.indicator_config
  select * from jsonb_populate_record(
    null::public.indicator_config,
    payload || jsonb_build_object('id', 1, 'updated_at', to_jsonb(now()))
  )
  on conflict (id) do update set
    teams         = excluded.teams,
    team_colors   = excluded.team_colors,
    team_logos    = excluded.team_logos,
    team_excluded = excluded.team_excluded,
    competitions  = excluded.competitions,
    rep_teams     = excluded.rep_teams,
    rep_tiers     = excluded.rep_tiers,
    rep_active    = excluded.rep_active,
    rep_offices   = excluded.rep_offices,
    updated_at    = excluded.updated_at,
    updated_by    = excluded.updated_by;

  select updated_at into cur from public.indicator_config where id = 1;
  return jsonb_build_object('ok', true, 'server_updated_at', cur);
end $$;

revoke all on function public.save_indicator_config(jsonb, timestamptz) from public;
grant execute on function public.save_indicator_config(jsonb, timestamptz) to authenticated;
